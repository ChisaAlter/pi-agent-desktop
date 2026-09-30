import { spawn as nodeSpawn } from "node:child_process";
import {
    HerdrRpcClient,
    type HerdrSubscriptionHandle,
    type HerdrSubscriptionListener,
} from "./rpc-client";
import type { HerdrRuntimeInfo } from "./runtime-locator";
import { toHerdrSocketPath } from "./socket-path";

export interface HerdrRuntimeLocatorLike {
    locate(): Promise<HerdrRuntimeInfo | null>;
}

export interface HerdrRpcService {
    request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
    subscribe(
        params: unknown,
        listener: HerdrSubscriptionListener,
        timeoutMs?: number,
    ): Promise<HerdrSubscriptionHandle>;
    dispose(): void;
}

export interface HerdrServerProcess {
    onError(listener: (error: Error) => void): void;
    onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
    unref(): void;
}

export interface HerdrServerSpawnOptions {
    detached: true;
    stdio: "ignore";
    windowsHide: true;
    env?: NodeJS.ProcessEnv;
}

export type HerdrSpawnServer = (
    executable: string,
    args: readonly string[],
    options: HerdrServerSpawnOptions,
) => HerdrServerProcess;

export interface HerdrSupervisorTimers {
    now(): number;
    sleep(ms: number): Promise<void>;
}

export type HerdrServerOwnership = "external" | "desktop";

export interface HerdrServerHandle {
    /** RPC service; each request opens its own socket and does not retain a connection. */
    rpc: HerdrRpcService;
    ownership: HerdrServerOwnership;
    runtime: HerdrRuntimeInfo | null;
}

export interface HerdrRuntimeSupervisorOptions {
    /** Herdr API filesystem marker path; converted to NPFS on Windows. */
    socketPath: string;
    locator: HerdrRuntimeLocatorLike;
    /** Environment inherited by a Desktop-spawned `herdr server` child. */
    serverEnv?: NodeJS.ProcessEnv;
    rpcFactory?: (socketPath: string) => HerdrRpcService;
    spawnServer?: HerdrSpawnServer;
    timers?: HerdrSupervisorTimers;
    connectTimeoutMs?: number;
    stopTimeoutMs?: number;
    healthTimeoutMs?: number;
    healthPollIntervalMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 1_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 200;

export class HerdrRuntimeSupervisor {
    private readonly socketPath: string;
    private readonly locator: HerdrRuntimeLocatorLike;
    private readonly serverEnv?: NodeJS.ProcessEnv;
    private readonly rpcFactory: (socketPath: string) => HerdrRpcService;
    private readonly spawnServer: HerdrSpawnServer;
    private readonly timers: HerdrSupervisorTimers;
    private readonly connectTimeoutMs: number;
    private readonly stopTimeoutMs: number;
    private readonly healthTimeoutMs: number;
    private readonly healthPollIntervalMs: number;
    private readonly probeServices = new Set<HerdrRpcService>();
    private serverHandle: HerdrServerHandle | null = null;
    private ensurePromise: Promise<HerdrServerHandle> | null = null;
    private disposed = false;

    constructor(options: HerdrRuntimeSupervisorOptions) {
        this.socketPath = toHerdrSocketPath(options.socketPath);
        this.locator = options.locator;
        this.serverEnv = options.serverEnv;
        this.rpcFactory = options.rpcFactory ?? ((socketPath) => new HerdrRpcClient({ socketPath }));
        this.spawnServer = options.spawnServer ?? spawnHerdrServer;
        this.timers = options.timers ?? {
            now: () => Date.now(),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        };
        this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
        this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
        this.healthPollIntervalMs = options.healthPollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS;
    }

    ensureServer(): Promise<HerdrServerHandle> {
        if (this.disposed) return Promise.reject(new Error("Herdr runtime supervisor is disposed"));
        if (this.serverHandle) return Promise.resolve(this.serverHandle);
        if (this.ensurePromise) return this.ensurePromise;

        this.ensurePromise = this.startOrAttach().finally(() => {
            this.ensurePromise = null;
        });
        return this.ensurePromise;
    }

    async stop(): Promise<boolean> {
        const handle = this.serverHandle;
        if (!handle) return false;
        try {
            await handle.rpc.request<unknown>("server.stop", {}, this.stopTimeoutMs);
            return true;
        } finally {
            handle.rpc.dispose();
            if (this.serverHandle === handle) this.serverHandle = null;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const handle = this.serverHandle;
        this.serverHandle = null;
        handle?.rpc.dispose();
        for (const rpc of this.probeServices) rpc.dispose();
        this.probeServices.clear();
    }

    private async startOrAttach(): Promise<HerdrServerHandle> {
        const externalRpc = await this.probeServer();
        if (externalRpc) {
            return this.rememberServer({
                rpc: externalRpc,
                ownership: "external",
                runtime: null,
            });
        }

        this.assertActive();
        const runtime = await this.locator.locate();
        this.assertActive();
        if (!runtime) {
            throw new Error(
                `Herdr runtime executable was not found or failed --version validation (PI_HERDR_EXECUTABLE_PATH=${JSON.stringify(process.env.PI_HERDR_EXECUTABLE_PATH)})`,
            );
        }

        let startupFailure: Error | null = null;
        const serverProcess = this.spawnServer(runtime.path, ["server"], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            ...(this.serverEnv ? { env: this.serverEnv } : {}),
        });
        serverProcess.onError((error) => {
            startupFailure = error;
        });
        serverProcess.onExit((code, signal) => {
            startupFailure = new Error(
                `Herdr server exited before becoming healthy (${describeExit(code, signal)})`,
            );
        });
        serverProcess.unref();

        const deadline = this.timers.now() + this.healthTimeoutMs;
        while (true) {
            this.assertActive();

            const rpc = await this.probeServer();
            if (rpc) {
                const spawnedProcessFailed = startupFailure !== null;
                return this.rememberServer({
                    rpc,
                    ownership: spawnedProcessFailed ? "external" : "desktop",
                    runtime: spawnedProcessFailed ? null : runtime,
                });
            }
            if (startupFailure) throw startupFailure;

            const remaining = deadline - this.timers.now();
            if (remaining <= 0) break;
            await this.timers.sleep(Math.min(this.healthPollIntervalMs, remaining));
        }

        throw new Error(`Herdr server did not become healthy within ${this.healthTimeoutMs}ms`);
    }

    private async probeServer(): Promise<HerdrRpcService | null> {
        let rpc: HerdrRpcService;
        try {
            rpc = this.rpcFactory(this.socketPath);
        } catch {
            return null;
        }
        this.probeServices.add(rpc);
        let healthy = false;
        try {
            await rpc.request<unknown>("ping", {}, this.connectTimeoutMs);
            if (this.disposed) return null;
            healthy = true;
            return rpc;
        } catch {
            return null;
        } finally {
            const wasTracked = this.probeServices.delete(rpc);
            if (!healthy && wasTracked) rpc.dispose();
        }
    }

    private rememberServer(handle: HerdrServerHandle): HerdrServerHandle {
        if (this.disposed) {
            handle.rpc.dispose();
            throw new Error("Herdr runtime supervisor is disposed");
        }
        this.serverHandle = handle;
        return handle;
    }

    private assertActive(): void {
        if (this.disposed) throw new Error("Herdr runtime supervisor is disposed");
    }
}

function spawnHerdrServer(
    executable: string,
    args: readonly string[],
    options: HerdrServerSpawnOptions,
): HerdrServerProcess {
    const child = nodeSpawn(executable, [...args], {
        detached: options.detached,
        stdio: options.stdio,
        windowsHide: options.windowsHide,
        ...(options.env ? { env: options.env } : {}),
    });
    return {
        onError: (listener) => {
            child.once("error", listener);
        },
        onExit: (listener) => {
            child.once("exit", listener);
        },
        unref: () => child.unref(),
    };
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    if (signal) return `signal ${signal}`;
    return `code ${code ?? "unknown"}`;
}
