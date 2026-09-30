import { describe, expect, it, vi } from "vitest";
import type { HerdrRuntimeInfo } from "../runtime-locator";
import {
    HerdrRuntimeSupervisor,
    type HerdrRpcService,
    type HerdrServerProcess,
    type HerdrSpawnServer,
} from "../runtime-supervisor";

interface FakeRpcService {
    rpc: HerdrRpcService;
    request: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
}

function fakeRpcService(result: unknown | Error): FakeRpcService {
    const request = vi.fn(async (
        _method: string,
        _params: unknown,
        _timeout?: number,
    ): Promise<unknown> => {
        if (result instanceof Error) throw result;
        return result;
    });
    const dispose = vi.fn();
    return {
        rpc: {
            request: async <T>(method: string, params?: unknown, timeout?: number): Promise<T> =>
                request(method, params, timeout) as Promise<T>,
            subscribe: async () => ({
                unsubscribe: () => undefined,
                closed: Promise.resolve(null),
            }),
            dispose,
        },
        request,
        dispose,
    };
}

function fakeProcess(): HerdrServerProcess {
    return {
        onError: vi.fn(),
        onExit: vi.fn(),
        unref: vi.fn(),
    };
}

const runtime: HerdrRuntimeInfo = {
    path: "C:\\managed\\herdr.exe",
    source: "managed",
    version: "0.8.0",
};

describe("HerdrRuntimeSupervisor", () => {
    it("attaches to an already-running external server without locating or spawning", async () => {
        const attached = fakeRpcService({ type: "pong", version: "0.8.0" });
        const locate = vi.fn(async () => runtime);
        const spawnServer: HerdrSpawnServer = vi.fn(() => fakeProcess());
        const rpcFactory = vi.fn(() => attached.rpc);
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "C:\\Users\\alice\\herdr\\herdr.sock",
            locator: { locate },
            rpcFactory,
            spawnServer,
        });

        await expect(supervisor.ensureServer()).resolves.toMatchObject({
            rpc: attached.rpc,
            ownership: "external",
        });
        expect(rpcFactory).toHaveBeenCalledWith("\\\\.\\pipe\\C:\\Users\\alice\\herdr\\herdr.sock");
        expect(locate).not.toHaveBeenCalled();
        expect(spawnServer).not.toHaveBeenCalled();
    });

    it("locates and starts Herdr when no API is reachable, then waits for health", async () => {
        const unavailable = fakeRpcService(new Error("ENOENT"));
        const warming = fakeRpcService(new Error("ECONNREFUSED"));
        const healthy = fakeRpcService({ type: "pong", version: "0.8.0" });
        const services = [unavailable.rpc, warming.rpc, healthy.rpc];
        const process = fakeProcess();
        const spawnServer: HerdrSpawnServer = vi.fn(() => process);
        let now = 0;
        const isolatedEnv = {
            HERDR_SESSION: "pi-e2e",
            HERDR_SOCKET_PATH: "C:\\tmp\\isolated.sock",
        };
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate: vi.fn(async () => runtime) },
            serverEnv: isolatedEnv,
            rpcFactory: () => {
                const rpc = services.shift();
                if (!rpc) throw new Error("unexpected RPC service request");
                return rpc;
            },
            spawnServer,
            healthTimeoutMs: 100,
            healthPollIntervalMs: 10,
            timers: {
                now: () => now,
                sleep: async (ms) => { now += ms; },
            },
        });

        await expect(supervisor.ensureServer()).resolves.toMatchObject({
            ownership: "desktop",
            runtime,
        });
        expect(spawnServer).toHaveBeenCalledWith(runtime.path, ["server"], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: isolatedEnv,
        });
        expect(process.unref).toHaveBeenCalledOnce();
        expect(unavailable.dispose).toHaveBeenCalledOnce();
        expect(warming.dispose).toHaveBeenCalledOnce();
        expect(healthy.dispose).not.toHaveBeenCalled();
    });

    it("treats a healthy server as external when the spawned process loses a startup race", async () => {
        const unavailable = fakeRpcService(new Error("ENOENT"));
        let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
        const process: HerdrServerProcess = {
            onError: vi.fn(),
            onExit: (listener) => { onExit = listener; },
            unref: vi.fn(),
        };
        const healthyRequest = vi.fn(async (
            _method: string,
            _params: unknown,
            _timeout?: number,
        ): Promise<unknown> => {
            onExit?.(1, null);
            return { type: "pong" };
        });
        const healthy: HerdrRpcService = {
            request: async <T>(method: string, params?: unknown, timeout?: number): Promise<T> =>
                healthyRequest(method, params, timeout) as Promise<T>,
            subscribe: async () => ({
                unsubscribe: () => undefined,
                closed: Promise.resolve(null),
            }),
            dispose: vi.fn(),
        };
        const services = [unavailable.rpc, healthy];
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate: vi.fn(async () => runtime) },
            rpcFactory: () => {
                const rpc = services.shift();
                if (!rpc) throw new Error("unexpected RPC service request");
                return rpc;
            },
            spawnServer: vi.fn(() => process),
        });

        await expect(supervisor.ensureServer()).resolves.toEqual({
            rpc: healthy,
            ownership: "external",
            runtime: null,
        });
    });

    it("does not stop an external persistent server when Desktop disposes", async () => {
        const attached = fakeRpcService({ type: "pong" });
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate: vi.fn(async () => null) },
            rpcFactory: () => attached.rpc,
            spawnServer: vi.fn(() => fakeProcess()),
        });
        await supervisor.ensureServer();

        supervisor.dispose();

        expect(attached.dispose).toHaveBeenCalledOnce();
        expect(attached.request).toHaveBeenCalledTimes(1);
        expect(attached.request).not.toHaveBeenCalledWith("server.stop", expect.anything(), expect.anything());
    });

    it("does not kill or stop a Desktop-started persistent server when Desktop disposes", async () => {
        const unavailable = fakeRpcService(new Error("ENOENT"));
        const healthy = fakeRpcService({ type: "pong" });
        const services = [unavailable.rpc, healthy.rpc];
        const process = fakeProcess();
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate: vi.fn(async () => runtime) },
            rpcFactory: () => {
                const rpc = services.shift();
                if (!rpc) throw new Error("unexpected RPC service request");
                return rpc;
            },
            spawnServer: vi.fn(() => process),
            timers: { now: () => 0, sleep: async () => undefined },
        });
        await supervisor.ensureServer();

        supervisor.dispose();

        expect(healthy.dispose).toHaveBeenCalledOnce();
        expect(healthy.request).toHaveBeenCalledTimes(1);
        expect(healthy.request).not.toHaveBeenCalledWith("server.stop", expect.anything(), expect.anything());
        expect(process.unref).toHaveBeenCalledOnce();
    });

    it("does not spawn after dispose wins a race with runtime location", async () => {
        const unavailable = fakeRpcService(new Error("ENOENT"));
        let resolveLocation: ((value: HerdrRuntimeInfo | null) => void) | undefined;
        const locate = vi.fn(() => new Promise<HerdrRuntimeInfo | null>((resolve) => {
            resolveLocation = resolve;
        }));
        const spawnServer: HerdrSpawnServer = vi.fn(() => fakeProcess());
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate },
            rpcFactory: () => unavailable.rpc,
            spawnServer,
        });
        const ensuring = supervisor.ensureServer();
        await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());

        supervisor.dispose();
        resolveLocation?.(runtime);

        await expect(ensuring).rejects.toThrow("supervisor is disposed");
        expect(spawnServer).not.toHaveBeenCalled();
    });

    it("disposes an in-flight connection probe immediately", async () => {
        let resolvePing: ((value: unknown) => void) | undefined;
        const dispose = vi.fn();
        const request = vi.fn((
            _method: string,
            _params: unknown,
            _timeout?: number,
        ) => new Promise<unknown>((resolve) => {
            resolvePing = resolve;
        }));
        const rpc: HerdrRpcService = {
            request: async <T>(method: string, params?: unknown, timeout?: number): Promise<T> =>
                request(method, params, timeout) as Promise<T>,
            subscribe: async () => ({
                unsubscribe: () => undefined,
                closed: Promise.resolve(null),
            }),
            dispose,
        };
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate: vi.fn(async () => runtime) },
            rpcFactory: () => rpc,
            spawnServer: vi.fn(() => fakeProcess()),
        });
        const ensuring = supervisor.ensureServer();
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

        supervisor.dispose();

        expect(dispose).toHaveBeenCalledOnce();
        resolvePing?.({ type: "pong" });
        await expect(ensuring).rejects.toThrow("supervisor is disposed");
    });

    it("stops the persistent server only through the explicit stop method", async () => {
        const attached = fakeRpcService({ type: "pong" });
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: "herdr.sock",
            locator: { locate: vi.fn(async () => null) },
            rpcFactory: () => attached.rpc,
            spawnServer: vi.fn(() => fakeProcess()),
        });
        await supervisor.ensureServer();

        await expect(supervisor.stop()).resolves.toBe(true);

        expect(attached.request).toHaveBeenNthCalledWith(2, "server.stop", {}, expect.any(Number));
        expect(attached.dispose).toHaveBeenCalledOnce();
        await expect(supervisor.stop()).resolves.toBe(false);
    });
});
