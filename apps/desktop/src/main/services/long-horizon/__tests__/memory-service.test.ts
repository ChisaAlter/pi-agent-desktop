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

    it("stores memory as a recoverable parent-child tree", () => {
        const service = createService();
        const root = service.put({
            scope: "project",
            workspaceId: "ws1",
            kind: "summary",
            text: "long horizon root",
        });
        const child = service.put({
            scope: "project",
            workspaceId: "ws1",
            kind: "task-progress",
            parentId: root.id,
            text: "workflow sandbox child",
        });

        expect(service.getTree(root.id)).toEqual({
            record: root,
            children: [{ record: child, children: [] }],
        });
    });

    it("ranks full-text results with BM25-style scoring and a relative floor", () => {
        const service = createService();
        service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "checkpoint checkpoint common" });
        service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "workflow sandbox checkpoint" });
        service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "unrelated checkpoint" });

        const results = service.search("workflow sandbox checkpoint", {
            workspaceId: "ws1",
            searchScoreFloor: 0.4,
        });

        expect(results[0]).toEqual(expect.objectContaining({ text: "workflow sandbox checkpoint" }));
        expect(results).toHaveLength(1);
    });

    it("falls back to raw history trajectory when memory hits are missing", () => {
        const service = createService();
        service.putHistory({
            workspaceId: "ws1",
            sessionId: "s1",
            text: "raw trajectory contains goal judge retry evidence",
        });

        expect(service.search("judge retry", {
            workspaceId: "ws1",
            includeHistoryFallback: true,
        })).toEqual([
            expect.objectContaining({
                kind: "history",
                text: "raw trajectory contains goal judge retry evidence",
            }),
        ]);
    });
});
