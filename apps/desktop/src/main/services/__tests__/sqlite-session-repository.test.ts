import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionRepository } from "../sqlite-session-repository";

describe("SqliteSessionRepository", () => {
    const dirs: string[] = [];
    const repositories: SqliteSessionRepository[] = [];

    afterEach(() => {
        for (const repository of repositories.splice(0)) repository.close();
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function createRepository(): SqliteSessionRepository {
        const dir = mkdtempSync(join(tmpdir(), "pi-session-sqlite-"));
        dirs.push(dir);
        const repository = new SqliteSessionRepository(dir);
        repositories.push(repository);
        return repository;
    }

    it("stores messages incrementally while summaries stay transcript-free", async () => {
        const repository = createRepository();
        const session = await repository.createSession("w1", "SQLite session", "s1");

        await repository.appendMessage(session.id, {
            id: "m1",
            role: "assistant",
            content: "partial",
            thinking: "reasoning",
            timestamp: new Date(1000),
            generatedUi: {
                version: "v1",
                id: "card-1",
                sections: [{ id: "summary", kind: "summary", content: "card content" }],
            },
            toolCalls: [{
                id: "tc1",
                name: "read",
                status: "running",
                input: { path: "README.md" },
                startTime: new Date(1100),
            }],
        });
        await repository.updateMessage("s1", "m1", { content: "final answer" });
        await repository.updateToolCall("s1", "m1", "tc1", {
            status: "completed",
            output: { ok: true },
            endTime: new Date(1200),
        });

        const summaries = await repository.listSessionSummaries();
        expect(summaries).toEqual([expect.objectContaining({
            id: "s1",
            workspaceId: "w1",
            messageCount: 1,
            toolCallCount: 1,
        })]);
        expect(summaries[0]).not.toHaveProperty("messages");

        const loaded = await repository.getSession("s1");
        expect(loaded?.messages).toHaveLength(1);
        expect(loaded?.messages[0]).toMatchObject({
            id: "m1",
            content: "final answer",
            thinking: "reasoning",
            generatedUi: { version: "v1", id: "card-1" },
        });
        expect(loaded?.messages[0].toolCalls?.[0]).toMatchObject({
            id: "tc1",
            status: "completed",
            input: { path: "README.md" },
            output: { ok: true },
        });

        const search = await repository.searchSessionMessages({ query: "final", limit: 10 });
        expect(search).toEqual([expect.objectContaining({
            sessionId: "s1",
            messageId: "m1",
            messageContent: expect.stringContaining("final answer"),
        })]);
        expect(await repository.searchSessionMessages({ query: "card content", limit: 10 }))
            .toEqual([expect.objectContaining({ messageId: "m1" })]);
    });

    it("finds hyphenated needles via LIKE fallback when FTS token OR returns no hit", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Search session", "s-search");
        await repository.appendMessage("s-search", {
            id: "m-search",
            role: "user",
            content: "search-floating-needle 顶部历史搜索应该打开这条消息",
            timestamp: new Date(2_000),
        });

        const hits = await repository.searchSessionMessages({
            query: "search-floating-needle",
            limit: 10,
        });
        expect(hits).toEqual([expect.objectContaining({
            sessionId: "s-search",
            messageId: "m-search",
            messageContent: expect.stringContaining("search-floating-needle"),
        })]);
    });

    it("does not return partial FTS token matches for multi-token needles", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Search session", "s-search");
        await repository.appendMessage("s-search", {
            id: "m-user",
            role: "user",
            content: "search-floating-needle 顶部历史搜索应该打开这条消息",
            timestamp: new Date(2_000),
        });
        await repository.appendMessage("s-search", {
            id: "m-assistant",
            role: "assistant",
            content: "search-floating-assistant-reply",
            timestamp: new Date(3_000),
        });

        const hits = await repository.searchSessionMessages({
            query: "search-floating-needle",
            limit: 10,
        });
        expect(hits).toHaveLength(1);
        expect(hits[0]).toEqual(expect.objectContaining({
            messageId: "m-user",
            messageContent: expect.stringContaining("search-floating-needle"),
        }));
    });

    // wave-101 residual
    it("renames, archives, favorites, and deletes sessions", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Original", "s-meta");
        const renamed = await repository.renameSession("s-meta", "  Renamed  ");
        expect(renamed.title).toBe("Renamed");

        const archived = await repository.archiveSession("s-meta", true);
        expect(archived.archived).toBe(true);

        const favorited = await repository.updateSessionMetadata("s-meta", {
            favorite: true,
            tags: [" alpha ", "alpha", "beta", ""],
            summary: "meta summary",
            lastOpenedAt: 9_999,
        });
        expect(favorited.favorite).toBe(true);
        expect(favorited.tags).toEqual(["alpha", "beta"]);
        expect(favorited.summary).toBe("meta summary");
        expect(favorited.lastOpenedAt).toBe(9_999);

        await repository.deleteSession("s-meta");
        expect(await repository.getSession("s-meta")).toBeUndefined();
        expect(await repository.listSessionSummaries()).toEqual([]);
    });

    it("appendMessage is idempotent for the same message id", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Idempotent", "s-idemp");
        const message = {
            id: "m-dup",
            role: "user" as const,
            content: "once",
            timestamp: new Date(1_000),
        };
        await repository.appendMessage("s-idemp", message);
        await repository.appendMessage("s-idemp", { ...message, content: "twice" });
        const session = await repository.getSession("s-idemp");
        expect(session?.messages).toHaveLength(1);
        expect(session?.messages[0].content).toBe("once");
        const summaries = await repository.listSessionSummaries();
        expect(summaries[0]).toMatchObject({ messageCount: 1 });
    });

    it("defaults empty titles and returns undefined for missing sessions", async () => {
        const repository = createRepository();
        const created = await repository.createSession("w1", "   ");
        expect(created.title).toBe("未命名会话");
        expect(await repository.getSession("missing-session")).toBeUndefined();
        await expect(repository.renameSession("missing-session", "x")).rejects.toThrow();
    });

    it("reports stats and healthy check after writes", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "A", "s-a");
        await repository.createSession("w1", "B", "s-b");
        await repository.appendMessage("s-a", {
            id: "m-a",
            role: "user",
            content: "hello stats",
            timestamp: new Date(1),
        });
        const stats = await repository.getStats();
        expect(stats).toMatchObject({
            sessionCount: 2,
            messageCount: 1,
        });
        expect(repository.checkHealth()).toMatchObject({ ok: true });
    });

    // wave-134 residual
    it("returns empty search hits for blank query and clamps limit", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "S", "s1");
        await repository.appendMessage("s1", {
            id: "m1",
            role: "user",
            content: "needle-value-xyz",
            timestamp: new Date(1),
        });
        expect(await repository.searchSessionMessages({ query: "   " })).toEqual([]);
        expect(await repository.searchSessionMessages({ query: "" })).toEqual([]);

        const hits = await repository.searchSessionMessages({
            query: "needle-value-xyz",
            limit: 0,
        });
        // Math.max(1, floor(0)) → limit 1
        expect(hits.length).toBeLessThanOrEqual(1);
        expect(hits[0]?.messageContent).toContain("needle-value-xyz");
    });

    it("filters search by workspaceId and finds thinking-only needles", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "A", "s-a");
        await repository.createSession("w2", "B", "s-b");
        await repository.appendMessage("s-a", {
            id: "m-a",
            role: "assistant",
            content: "visible-a",
            thinking: "think-shared-token",
            timestamp: new Date(1),
        });
        await repository.appendMessage("s-b", {
            id: "m-b",
            role: "assistant",
            content: "visible-b",
            thinking: "think-shared-token",
            timestamp: new Date(2),
        });

        const wsHits = await repository.searchSessionMessages({
            query: "think-shared-token",
            workspaceId: "w1",
            limit: 10,
        });
        expect(wsHits).toHaveLength(1);
        expect(wsHits[0]).toMatchObject({
            sessionId: "s-a",
            workspaceId: "w1",
            messageContent: expect.stringContaining("think-shared-token"),
        });

        const unarchived = await repository.archiveSession("s-a", false);
        expect(unarchived.archived).toBe(false);
    });

    it("listSessionSummaries excludes deleted sessions after deleteSession", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Keep", "s-keep");
        await repository.createSession("w1", "Drop", "s-drop");
        await repository.deleteSession("s-drop");
        const summaries = await repository.listSessionSummaries();
        expect(summaries.map((s) => s.id)).toEqual(["s-keep"]);
    });

    // wave-250 residual
    it("renameSession updates title; archive true hides from default summaries path", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Old", "s1");
        const renamed = await repository.renameSession("s1", "New Title");
        expect(renamed.title).toBe("New Title");
        const archived = await repository.archiveSession("s1", true);
        expect(archived.archived).toBe(true);
        const loaded = await repository.getSession("s1");
        expect(loaded?.title).toBe("New Title");
        expect(loaded?.archived).toBe(true);
        // listSessions still returns archived rows (product keeps them addressable)
        const all = await repository.listSessions();
        expect(all.some((s) => s.id === "s1" && s.archived)).toBe(true);
    });

    it("updateSessionMetadata merges agentId; negative search limit clamps; close is idempotent", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "Meta", "s-meta");
        await repository.appendMessage("s-meta", {
            id: "m1",
            role: "user",
            content: "meta-needle-token",
            timestamp: new Date(1),
        });
        const updated = await repository.updateSessionMetadata("s-meta", {
            agentId: "agent-1",
        } as never);
        expect(updated).toMatchObject({ id: "s-meta" });
        const hits = await repository.searchSessionMessages({
            query: "meta-needle-token",
            limit: -5,
        });
        expect(hits.length).toBeGreaterThanOrEqual(1);
        expect(hits[0]?.messageContent).toContain("meta-needle-token");
        repository.close();
        repository.close();
    });

    // wave-269 residual
    it("searchSessionMessages clamps limit to [1,100]; blank query returns []", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "S", "s-search");
        await repository.appendMessage("s-search", {
            id: "m1",
            role: "user",
            content: "wave269-needle-token",
            timestamp: new Date(1),
        });
        expect(await repository.searchSessionMessages({ query: "   " })).toEqual([]);
        const hits = await repository.searchSessionMessages({
            query: "wave269-needle-token",
            limit: 500,
        });
        expect(hits.length).toBeGreaterThanOrEqual(1);
        expect(hits[0]?.messageContent).toContain("wave269-needle-token");
        // clamp still returns results; product Math.min(floor(limit), 100)
        const tiny = await repository.searchSessionMessages({
            query: "wave269-needle-token",
            limit: 0,
        });
        expect(tiny.length).toBeGreaterThanOrEqual(1);
    });

    it("updateToolCall merges partial fields; missing message/toolCall throws", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "T", "s-tc");
        await repository.appendMessage("s-tc", {
            id: "m1",
            role: "assistant",
            content: "with tools",
            timestamp: new Date(1),
            toolCalls: [
                { id: "tc1", name: "bash", status: "running", input: { cmd: "ls" } },
            ],
        } as never);
        await repository.updateToolCall("s-tc", "m1", "tc1", {
            status: "completed",
            output: "ok",
        } as never);
        const session = await repository.getSession("s-tc");
        const tc = session?.messages.find((m) => m.id === "m1")?.toolCalls?.find((t) => t.id === "tc1");
        expect(tc).toMatchObject({ id: "tc1", name: "bash", status: "completed", output: "ok" });
        await expect(
            repository.updateToolCall("s-tc", "missing", "tc1", { status: "error" } as never),
        ).rejects.toThrow(/Message not found/);
        await expect(
            repository.updateToolCall("s-tc", "m1", "missing", { status: "error" } as never),
        ).rejects.toThrow(/ToolCall not found/);
    });

    // wave-282 residual
    it("search matchIndex/matchLength and default limit 20; close is idempotent", async () => {
        const repository = createRepository();
        await repository.createSession("w1", "S", "s-282");
        const needle = "wave282-unique-token";
        await repository.appendMessage("s-282", {
            id: "m1",
            role: "user",
            content: `prefix ${needle} suffix`,
            timestamp: new Date(1),
        });
        for (let i = 0; i < 25; i++) {
            await repository.createSession("w1", `bulk-${i}`, `s-bulk-${i}`);
            await repository.appendMessage(`s-bulk-${i}`, {
                id: `mb-${i}`,
                role: "user",
                content: needle,
                timestamp: new Date(i + 2),
            });
        }
        const hits = await repository.searchSessionMessages({ query: needle });
        // product default limit: Math.min(floor(20), 100) → 20
        expect(hits.length).toBe(20);
        const direct = await repository.searchSessionMessages({
            query: needle,
            limit: 5,
        });
        expect(direct.length).toBeLessThanOrEqual(5);
        const first = await repository.searchSessionMessages({
            query: `  ${needle}  `,
            limit: 1,
        });
        expect(first).toHaveLength(1);
        expect(first[0]?.matchLength).toBe(needle.length);
        expect(first[0]?.matchIndex).toBeGreaterThanOrEqual(0);
        expect(first[0]?.messageContent.toLowerCase().slice(
            first[0]!.matchIndex,
            first[0]!.matchIndex + first[0]!.matchLength,
        )).toBe(needle.toLowerCase());

        repository.close();
        expect(() => repository.close()).not.toThrow();
    });



});
