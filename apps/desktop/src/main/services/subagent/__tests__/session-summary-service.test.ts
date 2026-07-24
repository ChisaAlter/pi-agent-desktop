import { describe, it, expect } from "vitest";
import type { Session, ToolCall } from "@shared";
import { SessionSummaryService, type SessionSource } from "../session-summary-service";

// ── Test fixtures ───────────────────────────────────────────────
//
// Build a small in-memory Session[] to feed into SessionSummaryService.
// Tests cover:
//   - searchRecentSessions: filters by workspaceId, sinceMs; sorts newest first;
//     respects limit; computes messageCount + lastMessageAt correctly.
//   - getSessionMessages: returns last `limit` messages; tool calls collapsed
//     to deduped toolNames[]; unknown sessionId → [].
//   - searchSessionTranscript: case-insensitive substring match across content
//     + thinking; respects limit; unknown sessionId → [].

function buildMessage(overrides: Partial<Session["messages"][number]> & { id: string }): Session["messages"][number] {
    return {
        id: overrides.id,
        role: overrides.role ?? "user",
        content: overrides.content ?? "",
        timestamp: overrides.timestamp ?? new Date("2026-01-01T00:00:00Z"),
        thinking: overrides.thinking,
        toolCalls: overrides.toolCalls,
    };
}

function buildToolCall(name: string): ToolCall {
    return {
        id: `tc_${name}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        status: "completed",
    };
}

function buildSession(overrides: Partial<Session> & { id: string }): Session {
    return {
        id: overrides.id,
        workspaceId: overrides.workspaceId ?? "ws1",
        title: overrides.title ?? "untitled",
        messages: overrides.messages ?? [],
        createdAt: overrides.createdAt ?? 1_000,
        updatedAt: overrides.updatedAt ?? 1_000,
    };
}

function makeSource(sessions: Session[]): SessionSource {
    // Return a fresh copy on each call so tests cannot mutate the fixture.
    return () => sessions.map((s) => ({ ...s, messages: [...s.messages] }));
}

// ── Tests ───────────────────────────────────────────────────────

describe("SessionSummaryService", () => {
    describe("searchRecentSessions", () => {
        it("returns summaries with messageCount + lastMessageAt from session", async () => {
            const s1 = buildSession({
                id: "s1",
                workspaceId: "ws1",
                title: "First",
                createdAt: 1_000,
                updatedAt: 2_000,
                messages: [
                    buildMessage({ id: "m1", role: "user", content: "hi", timestamp: 1_500 }),
                    buildMessage({ id: "m2", role: "assistant", content: "hello", timestamp: 2_000 }),
                ],
            });
            const s2 = buildSession({
                id: "s2",
                workspaceId: "ws1",
                title: "Second",
                createdAt: 3_000,
                updatedAt: 4_000,
                messages: [
                    buildMessage({ id: "m3", role: "user", content: "ping", timestamp: 3_500 }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([s1, s2]));

            const results = await svc.searchRecentSessions({});

            expect(results).toHaveLength(2);
            // Newest first.
            expect(results[0].sessionId).toBe("s2");
            expect(results[0].messageCount).toBe(1);
            expect(results[0].lastMessageAt).toBe(3_500);
            expect(results[0].title).toBe("Second");
            expect(results[1].sessionId).toBe("s1");
            expect(results[1].messageCount).toBe(2);
            expect(results[1].lastMessageAt).toBe(2_000);
        });

        it("filters by workspaceId", async () => {
            const s1 = buildSession({ id: "s1", workspaceId: "ws1", createdAt: 100 });
            const s2 = buildSession({ id: "s2", workspaceId: "ws2", createdAt: 200 });
            const svc = new SessionSummaryService(makeSource([s1, s2]));

            const results = await svc.searchRecentSessions({ workspaceId: "ws1" });

            expect(results.map((r) => r.sessionId)).toEqual(["s1"]);
        });

        it("filters by sinceMs (only sessions created after the floor)", async () => {
            const s1 = buildSession({ id: "s1", createdAt: 100 });
            const s2 = buildSession({ id: "s2", createdAt: 500 });
            const s3 = buildSession({ id: "s3", createdAt: 1_000 });
            const svc = new SessionSummaryService(makeSource([s1, s2, s3]));

            const results = await svc.searchRecentSessions({ sinceMs: 400 });

            expect(results.map((r) => r.sessionId).sort()).toEqual(["s2", "s3"]);
        });

        it("respects limit (newest first)", async () => {
            const sessions = Array.from({ length: 5 }, (_, i) =>
                buildSession({ id: `s${i + 1}`, createdAt: 100 * (i + 1) }),
            );
            const svc = new SessionSummaryService(makeSource(sessions));

            const results = await svc.searchRecentSessions({ limit: 3 });

            expect(results.map((r) => r.sessionId)).toEqual(["s5", "s4", "s3"]);
        });

        it("returns empty array when no sessions exist", async () => {
            const svc = new SessionSummaryService(makeSource([]));
            const results = await svc.searchRecentSessions({});
            expect(results).toEqual([]);
        });

        it("omits title when session title is empty string", async () => {
            const s = buildSession({ id: "s1", title: "" });
            const svc = new SessionSummaryService(makeSource([s]));
            const results = await svc.searchRecentSessions({});
            expect(results[0].title).toBeUndefined();
        });

        it("falls back to updatedAt when session has no messages", async () => {
            const s = buildSession({ id: "s1", createdAt: 100, updatedAt: 5_000, messages: [] });
            const svc = new SessionSummaryService(makeSource([s]));
            const results = await svc.searchRecentSessions({});
            expect(results[0].messageCount).toBe(0);
            expect(results[0].lastMessageAt).toBe(5_000);
        });
    });

    describe("getSessionMessages", () => {
        it("returns all messages in chronological order with toolNames collapsed", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({
                        id: "m1",
                        role: "user",
                        content: "do thing",
                        timestamp: 1_000,
                        toolCalls: [buildToolCall("bash"), buildToolCall("edit"), buildToolCall("bash")],
                    }),
                    buildMessage({
                        id: "m2",
                        role: "assistant",
                        content: "done",
                        timestamp: 2_000,
                        toolCalls: [buildToolCall("read")],
                    }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const messages = await svc.getSessionMessages({ sessionId: "s1" });

            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe("user");
            expect(messages[0].text).toBe("do thing");
            expect(messages[0].createdAt).toBe(1_000);
            // Deduped in original order: ["bash", "edit", "bash"] → ["bash", "edit"]
            expect(messages[0].toolNames).toEqual(["bash", "edit"]);
            expect(messages[1].toolNames).toEqual(["read"]);
        });

        it("returns last `limit` messages when session has more than limit", async () => {
            const messages = Array.from({ length: 60 }, (_, i) =>
                buildMessage({ id: `m${i + 1}`, role: "user", content: `msg ${i + 1}`, timestamp: 1_000 + i }),
            );
            const session = buildSession({ id: "s1", messages });
            const svc = new SessionSummaryService(makeSource([session]));

            const out = await svc.getSessionMessages({ sessionId: "s1", limit: 50 });

            expect(out).toHaveLength(50);
            // Should be the LAST 50 messages (m11..m60).
            expect(out[0].text).toBe("msg 11");
            expect(out[49].text).toBe("msg 60");
        });

        it("uses default limit of 50 when limit is omitted", async () => {
            const messages = Array.from({ length: 80 }, (_, i) =>
                buildMessage({ id: `m${i + 1}`, role: "user", content: `msg ${i + 1}`, timestamp: 1_000 + i }),
            );
            const session = buildSession({ id: "s1", messages });
            const svc = new SessionSummaryService(makeSource([session]));

            const out = await svc.getSessionMessages({ sessionId: "s1" });

            expect(out).toHaveLength(50);
        });

        it("returns empty array when sessionId is unknown", async () => {
            const svc = new SessionSummaryService(makeSource([]));
            const out = await svc.getSessionMessages({ sessionId: "nonexistent" });
            expect(out).toEqual([]);
        });

        it("omits toolNames when message has no tool calls", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({ id: "m1", role: "user", content: "hi" }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const out = await svc.getSessionMessages({ sessionId: "s1" });

            expect(out[0].toolNames).toBeUndefined();
        });

        it("parses ISO timestamp strings into epoch ms", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({
                        id: "m1",
                        role: "user",
                        content: "hi",
                        timestamp: "2026-01-15T12:00:00.000Z",
                    }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const out = await svc.getSessionMessages({ sessionId: "s1" });

            expect(typeof out[0].createdAt).toBe("number");
            expect(out[0].createdAt).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
        });
    });

    describe("searchSessionTranscript", () => {
        it("returns matches case-insensitively across content", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({ id: "m1", role: "user", content: "Please refactor the database" }),
                    buildMessage({ id: "m2", role: "assistant", content: "OK, working on it" }),
                    buildMessage({ id: "m3", role: "user", content: "Wait, stop refactoring" }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const matches = await svc.searchSessionTranscript({ sessionId: "s1", query: "REFACTOR" });

            expect(matches).toHaveLength(2);
            expect(matches.map((m) => m.id ?? m.text)).toEqual([
                "Please refactor the database",
                "Wait, stop refactoring",
            ]);
        });

        it("searches across thinking blocks too", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({ id: "m1", role: "assistant", content: "OK", thinking: "I should consider the cache-invalidation pattern" }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const matches = await svc.searchSessionTranscript({ sessionId: "s1", query: "cache-invalidation" });

            expect(matches).toHaveLength(1);
        });

        it("respects limit (chronological order preserved)", async () => {
            const session = buildSession({
                id: "s1",
                messages: Array.from({ length: 25 }, (_, i) =>
                    buildMessage({ id: `m${i + 1}`, role: "user", content: `search term ${i + 1}` }),
                ),
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const matches = await svc.searchSessionTranscript({ sessionId: "s1", query: "search term", limit: 10 });

            expect(matches).toHaveLength(10);
            expect(matches[0].text).toBe("search term 1");
            expect(matches[9].text).toBe("search term 10");
        });

        it("returns empty array when sessionId is unknown", async () => {
            const svc = new SessionSummaryService(makeSource([]));
            const matches = await svc.searchSessionTranscript({ sessionId: "unknown", query: "anything" });
            expect(matches).toEqual([]);
        });

        it("returns empty array when query is empty / whitespace", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({ id: "m1", role: "user", content: "anything" }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            expect(await svc.searchSessionTranscript({ sessionId: "s1", query: "" })).toEqual([]);
            expect(await svc.searchSessionTranscript({ sessionId: "s1", query: "   " })).toEqual([]);
        });

        it("does not match empty content", async () => {
            const session = buildSession({
                id: "s1",
                messages: [
                    buildMessage({ id: "m1", role: "assistant", content: "" }),
                ],
            });
            const svc = new SessionSummaryService(makeSource([session]));

            const matches = await svc.searchSessionTranscript({ sessionId: "s1", query: "anything" });
            expect(matches).toEqual([]);
        });
    });

    // wave-232 residual
    it("combines workspaceId + sinceMs + limit filters", async () => {
        const sessions = [
            buildSession({ id: "old-ws1", workspaceId: "ws1", createdAt: 100 }),
            buildSession({ id: "new-ws1", workspaceId: "ws1", createdAt: 500 }),
            buildSession({ id: "new-ws2", workspaceId: "ws2", createdAt: 600 }),
            buildSession({ id: "newer-ws1", workspaceId: "ws1", createdAt: 900 }),
        ];
        const svc = new SessionSummaryService(makeSource(sessions));
        const results = await svc.searchRecentSessions({
            workspaceId: "ws1",
            sinceMs: 200,
            limit: 1,
        });
        expect(results).toHaveLength(1);
        expect(results[0].sessionId).toBe("newer-ws1");
    });

    it("searchSessionTranscript unknown query returns empty even with messages", async () => {
        const session = buildSession({
            id: "s1",
            messages: [buildMessage({ id: "m1", role: "user", content: "hello world" })],
        });
        const svc = new SessionSummaryService(makeSource([session]));
        expect(
            await svc.searchSessionTranscript({ sessionId: "s1", query: "zzzz-not-present" }),
        ).toEqual([]);
    });

    it("getSessionMessages preserves chronological order for Date timestamps", async () => {
        const session = buildSession({
            id: "s1",
            messages: [
                buildMessage({
                    id: "m1",
                    role: "user",
                    content: "first",
                    timestamp: new Date("2026-01-01T00:00:00.000Z"),
                }),
                buildMessage({
                    id: "m2",
                    role: "assistant",
                    content: "second",
                    timestamp: new Date("2026-01-01T01:00:00.000Z"),
                }),
            ],
        });
        const svc = new SessionSummaryService(makeSource([session]));
        const out = await svc.getSessionMessages({ sessionId: "s1" });
        expect(out.map((m) => m.text)).toEqual(["first", "second"]);
        expect(out[0].createdAt).toBeLessThan(out[1].createdAt);
    });
});
