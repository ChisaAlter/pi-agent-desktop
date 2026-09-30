import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HerdrRuntimeSupervisor } from "../runtime-supervisor";
import { HerdrRpcClient } from "../rpc-client";
import { toHerdrSocketPath } from "../socket-path";
import { resolveIsolatedHerdrExecutable } from "./isolated-runtime";

const executable = resolveIsolatedHerdrExecutable();

describe.skipIf(!executable)("Herdr supervisor real spawn", () => {
    const cleanup: Array<() => void> = [];

    afterEach(() => {
        for (const fn of cleanup.splice(0)) {
            try { fn(); } catch { /* ignore */ }
        }
    });

    it("spawns a real persistent server under isolated APPDATA and attaches to it", async () => {
        const appData = mkdtempSync(join(tmpdir(), "pi-herdr-super-spawn-"));
        cleanup.push(() => { try { rmSync(appData, { recursive: true, force: true }); } catch { /* ignore */ } });

        const socketMarker = join(appData, "herdr", "herdr.sock");
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: socketMarker,
            locator: {
                locate: async () => ({
                    path: executable!,
                    source: "env",
                    version: "0.8.0-preview",
                }),
            },
            serverEnv: {
                ...process.env,
                APPDATA: appData,
                HERDR_SOCKET_PATH: socketMarker,
            },
            healthTimeoutMs: 20_000,
            healthPollIntervalMs: 250,
        });

        const handle = await supervisor.ensureServer();
        expect(handle.ownership).toBe("desktop");
        expect(handle.runtime).toMatchObject({ path: executable });

        // 连接后可以 ping 和取快照
        const snapshot = await handle.rpc.request<{ type: string }>("session.snapshot", {}, 10_000);
        expect(snapshot.type).toBe("session_snapshot");

        // 显式 stop → 真实退出（socket 不可再连）
        await supervisor.stop();
        const client = new HerdrRpcClient({ socketPath: toHerdrSocketPath(socketMarker) });
        await expect(client.request("ping", {}, 1_000)).rejects.toThrow();
        client.dispose();
    }, 45_000);
});
