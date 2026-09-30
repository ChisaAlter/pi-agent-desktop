import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrRpcClient } from "../rpc-client";
import { toHerdrSocketPath } from "../socket-path";

export interface IsolatedHerdrRuntime {
    executable: string;
    root: string;
    sessionName: string;
    socketMarker: string;
    rpc: HerdrRpcClient;
    stop(): Promise<void>;
    dispose(): void;
}

const LOCAL_PREVIEW = "C:\\Ai\\herdr-bin\\herdr.exe";

export function resolveIsolatedHerdrExecutable(): string | null {
    const explicit = process.env.PI_HERDR_EXECUTABLE_PATH?.trim();
    if (explicit && existsSync(explicit)) return explicit;
    if (existsSync(LOCAL_PREVIEW)) return LOCAL_PREVIEW;
    return null;
}

export async function startIsolatedHerdrRuntime(
    executable = resolveIsolatedHerdrExecutable(),
): Promise<IsolatedHerdrRuntime> {
    if (!executable) throw new Error("Isolated Herdr executable was not found");

    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const root = mkdtempSync(join(tmpdir(), `pi-herdr-g3a-${token}-`));
    const sessionName = `pi-g3a-${token}`.slice(0, 64);
    const socketMarker = join(root, "herdr.sock");
    const childEnv = {
        ...process.env,
        HERDR_SESSION: sessionName,
        HERDR_SOCKET_PATH: socketMarker,
    };
    const child: ChildProcess = spawn(executable, ["server"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: childEnv,
    });
    child.unref();

    const rpc = new HerdrRpcClient({ socketPath: toHerdrSocketPath(socketMarker) });
    await waitForPing(rpc);

    return {
        executable,
        root,
        sessionName,
        socketMarker,
        rpc,
        async stop() {
            try {
                await rpc.request("server.stop", {}, 5_000);
            } catch {
                // The isolated server may already be gone after an explicit stop test.
            } finally {
                rpc.dispose();
                try { child.kill(); } catch { /* ignore */ }
            }
        },
        dispose() {
            rpc.dispose();
            try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
        },
    };
}

export async function createIsolatedWorkspace(
    runtime: IsolatedHerdrRuntime,
    cwd: string,
    label: string,
): Promise<void> {
    await runtime.rpc.request("workspace.create", {
        cwd,
        focus: true,
        label,
    }, 10_000);
}

async function waitForPing(rpc: HerdrRpcClient, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            await rpc.request("ping", {}, 1_000);
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
    throw new Error(`Isolated Herdr server did not become healthy: ${
        lastError instanceof Error ? lastError.message : String(lastError)
    }`);
}
