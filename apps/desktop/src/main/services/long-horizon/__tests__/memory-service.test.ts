import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../memory-service";

describe("MemoryService", () => {
    const dirs: string[] = [];
    const services: MemoryService[] = [];

    afterEach(async () => {
        for (const service of services.splice(0)) {
            await service.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createService() {
        const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
        dirs.push(dir);
        const service = new MemoryService({ rootDir: dir });
        services.push(service);
        return service;
    }

    it("persists memories and retrieves them by full-text terms", async () => {
        const service = createService();

        await service.put({
            scope: "project",
            workspaceId: "ws1",
            sessionId: "s1",
            kind: "task-progress",
            text: "Goal 集成需要右侧栏展示任务目标和 judge reason",
            tags: ["goal", "right-rail"],
        });
        await service.put({
            scope: "global",
            kind: "note",
            text: "默认会话模式必须保持 build",
        });

        expect(await service.search("judge 右侧栏", { workspaceId: "ws1" })).toEqual([
            expect.objectContaining({ kind: "task-progress", layer: "project_memory", score: expect.any(Number) }),
        ]);
        expect(await service.search("默认 build")).toEqual([
            expect.objectContaining({ scope: "global", layer: "global_memory", kind: "note" }),
        ]);
    });

    it("reloads the file mirror across service instances", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
        dirs.push(dir);
        const first = new MemoryService({ rootDir: dir });
        services.push(first);
        await first.put({ scope: "session", workspaceId: "ws1", sessionId: "s1", kind: "checkpoint", text: "checkpoint 保留 plan ledger" });

        const second = new MemoryService({ rootDir: dir });
        services.push(second);

        expect(await second.search("ledger", { workspaceId: "ws1", sessionId: "s1" })).toEqual([
            expect.objectContaining({ text: "checkpoint 保留 plan ledger" }),
        ]);
    });

    it("stores memory as a recoverable parent-child tree", async () => {
        const service = createService();
        const root = await service.put({
            scope: "project",
            workspaceId: "ws1",
            kind: "summary",
            text: "long horizon root",
        });
        const child = await service.put({
            scope: "project",
            workspaceId: "ws1",
            kind: "task-progress",
            parentId: root.id,
            text: "workflow sandbox child",
        });

        expect(await service.getTree(root.id)).toEqual({
            record: root,
            children: [{ record: child, children: [] }],
        });
    });

    it("ranks full-text results with BM25-style scoring and a relative floor", async () => {
        const service = createService();
        await service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "checkpoint checkpoint common" });
        await service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "workflow sandbox checkpoint" });
        await service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "unrelated checkpoint" });

        const results = await service.search("workflow sandbox checkpoint", {
            workspaceId: "ws1",
            searchScoreFloor: 0.4,
        });

        expect(results[0]).toEqual(expect.objectContaining({ text: "workflow sandbox checkpoint" }));
        expect(results).toHaveLength(1);
    });

    it("falls back to raw history trajectory when memory hits are missing", async () => {
        const service = createService();
        await service.putHistory({
            workspaceId: "ws1",
            sessionId: "s1",
            text: "raw trajectory contains goal judge retry evidence",
        });

        expect(await service.search("judge retry", {
            workspaceId: "ws1",
            includeHistoryFallback: true,
        })).toEqual([
            expect.objectContaining({
                kind: "history",
                layer: "history",
                text: "raw trajectory contains goal judge retry evidence",
            }),
        ]);
    });

    it("lists recent memories for the workspace in descending time order", async () => {
        const service = createService();
        await service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "first memory" });
        await service.put({ scope: "project", workspaceId: "ws1", kind: "checkpoint", text: "second memory" });

        const recent = await service.listRecent({ workspaceId: "ws1", limit: 2 });

        expect(recent).toHaveLength(2);
        expect(recent[0]).toEqual(expect.objectContaining({ text: "second memory" }));
        expect(recent[1]).toEqual(expect.objectContaining({ text: "first memory" }));
    });

    it("migrates legacy memory.jsonl into long-horizon.db on first load", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
        dirs.push(dir);
        writeFileSync(join(dir, "memory.jsonl"), `${JSON.stringify({
            id: "legacy-1",
            scope: "project",
            kind: "note",
            text: "legacy checkpoint memory",
            workspaceId: "ws1",
            createdAt: 123,
        })}\n`, "utf8");

        const service = new MemoryService({ rootDir: dir });
        services.push(service);
        await service.ready();

        expect(await service.search("legacy checkpoint", { workspaceId: "ws1" })).toEqual([
            expect.objectContaining({ id: "legacy-1", layer: "project_memory", text: "legacy checkpoint memory" }),
        ]);
        expect(existsSync(join(dir, "memory.jsonl.migrated"))).toBe(true);
    });

    // wave-231 residual
    it("search with no matches returns empty array", async () => {
        const service = createService();
        await service.put({
            scope: "project",
            workspaceId: "ws1",
            kind: "note",
            text: "only known token alpha-beta",
        });
        expect(await service.search("zzz-no-such-term-999", { workspaceId: "ws1" })).toEqual([]);
    });

    it("listRecent on empty workspace returns empty", async () => {
        const service = createService();
        expect(await service.listRecent({ workspaceId: "ws-empty", limit: 5 })).toEqual([]);
    });

    it("listRecent respects limit of 1", async () => {
        const service = createService();
        await service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "older" });
        await service.put({ scope: "project", workspaceId: "ws1", kind: "note", text: "newer" });
        const recent = await service.listRecent({ workspaceId: "ws1", limit: 1 });
        expect(recent).toHaveLength(1);
        expect(recent[0]).toEqual(expect.objectContaining({ text: "newer" }));
    });
});
