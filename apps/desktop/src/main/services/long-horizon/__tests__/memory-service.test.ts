import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../memory-service";

describe("MemoryService", () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createService() {
        const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
        dirs.push(dir);
        return new MemoryService({ rootDir: dir });
    }

    it("persists memories and retrieves them by full-text terms", () => {
        const service = createService();

        service.put({
            scope: "project",
            workspaceId: "ws1",
            sessionId: "s1",
            kind: "task-progress",
            text: "Goal 集成需要右侧栏展示任务目标和 judge reason",
            tags: ["goal", "right-rail"],
        });
        service.put({
            scope: "global",
            kind: "note",
            text: "默认会话模式必须保持 build",
        });

        expect(service.search("judge 右侧栏", { workspaceId: "ws1" })).toEqual([
            expect.objectContaining({ kind: "task-progress", score: expect.any(Number) }),
        ]);
        expect(service.search("默认 build")).toEqual([
            expect.objectContaining({ scope: "global", kind: "note" }),
        ]);
    });

    it("reloads the file mirror across service instances", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
        dirs.push(dir);
        const first = new MemoryService({ rootDir: dir });
        first.put({ scope: "session", workspaceId: "ws1", sessionId: "s1", kind: "checkpoint", text: "checkpoint 保留 plan ledger" });

        const second = new MemoryService({ rootDir: dir });

        expect(second.search("ledger", { workspaceId: "ws1", sessionId: "s1" })).toEqual([
            expect.objectContaining({ text: "checkpoint 保留 plan ledger" }),
        ]);
    });
});
