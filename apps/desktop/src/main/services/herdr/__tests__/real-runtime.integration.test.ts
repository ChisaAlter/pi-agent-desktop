import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HerdrRuntimeSupervisor } from "../runtime-supervisor";
import { HerdrStateBridge } from "../state-bridge";
import { herdrServerChildEnv } from "../session-paths";
import {
    createIsolatedWorkspace,
    resolveIsolatedHerdrExecutable,
    startIsolatedHerdrRuntime,
    type IsolatedHerdrRuntime,
} from "./isolated-runtime";

const executable = resolveIsolatedHerdrExecutable();

describe.skipIf(!executable)("Herdr G3A isolated real runtime", () => {
    let runtime: IsolatedHerdrRuntime | null = null;
    const leftoverDirs: string[] = [];

    afterEach(async () => {
        await runtime?.stop();
        runtime?.dispose();
        runtime = null;
        for (const dir of leftoverDirs.splice(0)) {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it("projects a live snapshot and performs typed focus/read without stopping the persistent server on dispose", async () => {
        runtime = await startIsolatedHerdrRuntime(executable!);
        const workspaceDir = mkdtempSync(join(tmpdir(), "pi-herdr-ws-"));
        leftoverDirs.push(workspaceDir);
        await createIsolatedWorkspace(runtime, workspaceDir, "g3a-isolated");

        const childEnv = herdrServerChildEnv({
            ...process.env,
            HERDR_SESSION: runtime.sessionName,
            HERDR_SOCKET_PATH: runtime.socketMarker,
            PI_HERDR_EXECUTABLE_PATH: runtime.executable,
        }, runtime.sessionName, runtime.socketMarker);
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: runtime.socketMarker,
            locator: {
                locate: async () => ({
                    path: runtime!.executable,
                    source: "env",
                    version: "0.8.0-preview",
                }),
            },
            serverEnv: childEnv,
        });
        const bridge = new HerdrStateBridge({
            supervisor,
            sessionName: runtime.sessionName,
        });

        const projection = await bridge.start();
        expect(projection.status.connection).toBe("connected");
        expect(projection.status.protocol).toBe(19);
        expect(projection.tree.session).toBe(runtime.sessionName);
        expect(projection.tree.workspaces.some((workspace) => workspace.name === "g3a-isolated")).toBe(true);

        const liveSnapshot = await runtime.rpc.request<{
            type: string;
            snapshot: {
                workspaces: Array<{ label: string; workspace_id: string }>;
                panes: Array<{ pane_id: string }>;
                agents: Array<{ pane_id: string }>;
            };
        }>("session.snapshot", {}, 10_000);
        expect(liveSnapshot.type).toBe("session_snapshot");
        const officialLabels = liveSnapshot.snapshot.workspaces.map((workspace) => workspace.label);
        expect(officialLabels).toContain("g3a-isolated");
        expect(projection.tree.workspaces.map((workspace) => workspace.name).sort())
            .toEqual([...officialLabels].sort());
        expect(projection.agents.map((agent) => agent.target).sort()).toEqual(
            liveSnapshot.snapshot.agents.map((agent) => agent.pane_id).sort(),
        );

        const agentTarget = projection.agents[0]?.target ?? liveSnapshot.snapshot.agents[0]?.pane_id;
        if (agentTarget) {
            await expect(bridge.focusAgent({ target: agentTarget })).resolves.toMatchObject({
                status: { connection: "connected" },
            });
            const history = await bridge.readAgentOutput({ target: agentTarget, source: "recent" });
            expect(history.paneId).toBe(agentTarget);
            expect(typeof history.text).toBe("string");
        } else {
            const paneId = liveSnapshot.snapshot.panes[0]?.pane_id;
            expect(paneId).toBeTruthy();
            await runtime.rpc.request("pane.focus", { pane_id: paneId }, 5_000);
            const paneRead = await runtime.rpc.request<{
                type: string;
                read: { pane_id: string; text: string };
            }>("pane.read", { pane_id: paneId, source: "recent" }, 5_000);
            expect(paneRead.type).toBe("pane_read");
            expect(paneRead.read.pane_id).toBe(paneId);
        }

        const beforeDispose = await runtime.rpc.request("ping", {}, 2_000);
        expect(beforeDispose).toBeTruthy();
        bridge.dispose();
        supervisor.dispose();
        await expect(runtime.rpc.request("ping", {}, 2_000)).resolves.toBeTruthy();

        await runtime.stop();
        await expect(runtime.rpc.request("ping", {}, 1_000)).rejects.toThrow();
    }, 45_000);
});
