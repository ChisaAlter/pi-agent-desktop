import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../memory-service";
import { TaskService } from "../task-service";

describe("TaskService", () => {
    const dirs: string[] = [];
    const memories: MemoryService[] = [];

    afterEach(() => {
        for (const memory of memories.splice(0)) {
            memory.close();
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

    it("replaces per-source task snapshots and returns the active running task", () => {
        const service = createService();

        service.setSourceTasks("ws1", undefined, "plan", [
            { id: "P1", text: "write checkpoint", status: "completed" },
            { id: "P2", text: "verify goal", status: "running" },
        ]);
        service.setSourceTasks("ws1", undefined, "goal", [
            { id: "G1", text: "finish migration", status: "running" },
        ]);

        expect(service.list({ workspaceId: "ws1" })).toEqual([
            expect.objectContaining({ id: "G1", source: "goal", ordinal: 0 }),
            expect.objectContaining({ id: "P1", source: "plan", ordinal: 0 }),
            expect.objectContaining({ id: "P2", source: "plan", ordinal: 1 }),
        ]);
        expect(service.getActive({ workspaceId: "ws1" })).toEqual(
            expect.objectContaining({ id: "G1", source: "goal", status: "running" }),
        );
    });

    it("clears the previous snapshot when a source is updated with an empty list", () => {
        const service = createService();
        service.setSourceTasks("ws1", "agent-1", "plan", [
            { id: "P1", text: "temporary step", status: "running" },
        ]);

        service.setSourceTasks("ws1", "agent-1", "plan", []);

        expect(service.list({ workspaceId: "ws1", agentId: "agent-1" })).toEqual([]);
        expect(service.getActive({ workspaceId: "ws1", agentId: "agent-1" })).toBeNull();
    });
});
