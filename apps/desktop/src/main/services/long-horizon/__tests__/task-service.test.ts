import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../memory-service";
import { TaskService } from "../task-service";

describe("TaskService", () => {
    const dirs: string[] = [];
    const memories: MemoryService[] = [];

    afterEach(async () => {
        for (const memory of memories.splice(0)) {
            await memory.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createService() {
        const dir = mkdtempSync(join(tmpdir(), "pi-task-"));
        dirs.push(dir);
        const memory = new MemoryService({ rootDir: dir });
        memories.push(memory);
        return new TaskService(memory.getDatabase());
    }

    // DEPRECATED: setSourceTasks will be removed in future spec; use createTask
    it("replaces per-source task snapshots and returns the active running task", async () => {
        const service = createService();

        await service.setSourceTasks("ws1", undefined, "plan", [
            { id: "P1", text: "write checkpoint", status: "completed" },
            { id: "P2", text: "verify goal", status: "running" },
        ]);
        await service.setSourceTasks("ws1", undefined, "goal", [
            { id: "G1", text: "finish migration", status: "running" },
        ]);

        expect(await service.list({ workspaceId: "ws1" })).toEqual([
            expect.objectContaining({ id: "G1", source: "goal", ordinal: 0 }),
            expect.objectContaining({ id: "P1", source: "plan", ordinal: 0 }),
            expect.objectContaining({ id: "P2", source: "plan", ordinal: 1 }),
        ]);
        expect(await service.getActive({ workspaceId: "ws1" })).toEqual(
            expect.objectContaining({ id: "G1", source: "goal", status: "running" }),
        );
    });

    // DEPRECATED: setSourceTasks will be removed in future spec; use createTask
    it("clears the previous snapshot when a source is updated with an empty list", async () => {
        const service = createService();
        await service.setSourceTasks("ws1", "agent-1", "plan", [
            { id: "P1", text: "temporary step", status: "running" },
        ]);

        await service.setSourceTasks("ws1", "agent-1", "plan", []);

        expect(await service.list({ workspaceId: "ws1", agentId: "agent-1" })).toEqual([]);
        expect(await service.getActive({ workspaceId: "ws1", agentId: "agent-1" })).toBeNull();
    });

    it("deduplicates repeated task ids in a single progress snapshot", async () => {
        const service = createService();

        await expect(service.setSourceTasks("ws1", "agent-1", "plan", [
            { id: "P1", text: "first update", status: "pending" },
            { id: "P1", text: "latest update", status: "running" },
        ])).resolves.toBeUndefined();

        expect(await service.list({ workspaceId: "ws1", agentId: "agent-1" })).toEqual([
            expect.objectContaining({ id: "P1", text: "latest update", status: "running" }),
        ]);
    });

    it("isolates identical task ids across sources and agents", async () => {
        const service = createService();

        await service.setSourceTasks("ws1", "agent-1", "plan", [
            { id: "P1", text: "agent plan", status: "running" },
        ]);
        await service.setSourceTasks("ws1", "agent-1", "goal", [
            { id: "P1", text: "agent goal", status: "pending" },
        ]);
        await service.setSourceTasks("ws1", "agent-2", "plan", [
            { id: "P1", text: "other agent plan", status: "completed" },
        ]);

        expect(await service.list({ workspaceId: "ws1", agentId: "agent-1" })).toEqual([
            expect.objectContaining({ id: "P1", source: "goal", text: "agent goal" }),
            expect.objectContaining({ id: "P1", source: "plan", text: "agent plan" }),
        ]);
        expect(await service.list({ workspaceId: "ws1", agentId: "agent-2" })).toEqual([
            expect.objectContaining({ id: "P1", source: "plan", text: "other agent plan" }),
        ]);
    });

    // wave-232 residual
    it("list and getActive return empty/null for unknown workspace", async () => {
        const service = createService();
        await service.setSourceTasks("ws1", undefined, "plan", [
            { id: "P1", text: "only ws1", status: "running" },
        ]);
        expect(await service.list({ workspaceId: "ws-missing" })).toEqual([]);
        expect(await service.getActive({ workspaceId: "ws-missing" })).toBeNull();
    });

    it("getActive returns null when all tasks are completed", async () => {
        const service = createService();
        await service.setSourceTasks("ws1", undefined, "plan", [
            { id: "P1", text: "done a", status: "completed" },
            { id: "P2", text: "done b", status: "completed" },
        ]);
        expect(await service.list({ workspaceId: "ws1" })).toHaveLength(2);
        expect(await service.getActive({ workspaceId: "ws1" })).toBeNull();
    });

    it("list without agentId returns only unbound (default agent) tasks", async () => {
        const service = createService();
        await service.setSourceTasks("ws1", undefined, "plan", [
            { id: "P1", text: "no agent", status: "pending" },
        ]);
        await service.setSourceTasks("ws1", "agent-1", "plan", [
            { id: "P2", text: "with agent", status: "running" },
        ]);
        // product scopes unbound list to default agent key; agent-bound tasks need agentId filter
        expect(await service.list({ workspaceId: "ws1" })).toEqual([
            expect.objectContaining({ id: "P1", text: "no agent" }),
        ]);
        expect(await service.list({ workspaceId: "ws1", agentId: "agent-1" })).toEqual([
            expect.objectContaining({ id: "P2", text: "with agent" }),
        ]);
    });
});
