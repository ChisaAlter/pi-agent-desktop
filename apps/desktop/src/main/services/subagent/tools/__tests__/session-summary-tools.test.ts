import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionSummaryTools } from "../session-summary-tools";
import type { SessionSummaryService } from "../../session-summary-service";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

async function exec(
  tool: { execute: (...args: never[]) => Promise<unknown> },
  params: Record<string, unknown>,
) {
  return tool.execute(
    "call-1" as never,
    params as never,
    undefined as never,
    undefined as never,
    {} as never,
  ) as Promise<{ content: Array<{ type: string; text?: string }>; details: unknown }>;
}

describe("createSessionSummaryTools", () => {
  const searchRecentSessions = vi.fn();
  const getSessionMessages = vi.fn();
  const searchSessionTranscript = vi.fn();
  let svc: SessionSummaryService;

  beforeEach(() => {
    searchRecentSessions.mockReset();
    getSessionMessages.mockReset();
    searchSessionTranscript.mockReset();
    svc = {
      searchRecentSessions,
      getSessionMessages,
      searchSessionTranscript,
    } as unknown as SessionSummaryService;
  });

  it("exposes the three read-only tool names", () => {
    const tools = createSessionSummaryTools(svc);
    expect(tools.map((t) => t.name)).toEqual([
      "session_summary_search",
      "session_summary_get",
      "session_transcript_search",
    ]);
  });

  it("formats empty and populated session lists", async () => {
    const [search] = createSessionSummaryTools(svc);
    searchRecentSessions.mockResolvedValueOnce([]);
    const empty = await exec(search, { limit: 5 });
    expect(textOf(empty)).toBe("No sessions found.");

    searchRecentSessions.mockResolvedValueOnce([
      {
        sessionId: "s1",
        title: "Hello",
        createdAt: Date.UTC(2026, 0, 1),
        messageCount: 2,
        lastMessageAt: Date.UTC(2026, 0, 2),
      },
      {
        sessionId: "s2",
        title: null,
        createdAt: 0,
        messageCount: 0,
        lastMessageAt: 0,
      },
    ]);
    const listed = await exec(search, { workspaceId: "ws", limit: 10 });
    expect(searchRecentSessions).toHaveBeenCalledWith({
      workspaceId: "ws",
      limit: 10,
      sinceMs: undefined,
    });
    expect(textOf(listed)).toContain("Found 2 session(s):");
    expect(textOf(listed)).toContain("s1 | Hello |");
    expect(textOf(listed)).toContain("s2 | (untitled) | created=?");
  });

  it("formats transcript messages including tools and empty bodies", async () => {
    const [, get] = createSessionSummaryTools(svc);
    getSessionMessages.mockResolvedValueOnce([]);
    expect(textOf(await exec(get, { sessionId: "s1" }))).toBe("No messages found.");

    getSessionMessages.mockResolvedValueOnce([
      {
        role: "user",
        text: "hi",
        createdAt: Date.UTC(2026, 0, 1, 12),
        toolNames: [],
      },
      {
        role: "assistant",
        text: "  ",
        createdAt: Date.UTC(2026, 0, 1, 13),
        toolNames: ["bash", "read"],
      },
    ]);
    const out = await exec(get, { sessionId: "s1", limit: 20 });
    expect(getSessionMessages).toHaveBeenCalledWith({ sessionId: "s1", limit: 20 });
    const body = textOf(out);
    expect(body).toContain("USER: hi");
    expect(body).toContain("ASSISTANT [tools: bash, read]: (empty)");
  });

  it("searchSessionTranscript reuses message formatting", async () => {
    const [, , searchTranscript] = createSessionSummaryTools(svc);
    searchSessionTranscript.mockResolvedValueOnce([
      {
        role: "user",
        text: "find me",
        createdAt: Date.UTC(2026, 5, 1),
        toolNames: [],
      },
    ]);
    const out = await exec(searchTranscript, {
      sessionId: "s1",
      query: "find",
      limit: 5,
    });
    expect(searchSessionTranscript).toHaveBeenCalledWith({
      sessionId: "s1",
      query: "find",
      limit: 5,
    });
    expect(textOf(out)).toContain("USER: find me");
  });

  // wave-228 residual
  it("forwards sinceMs to searchRecentSessions and returns details.sessions", async () => {
    const [search] = createSessionSummaryTools(svc);
    searchRecentSessions.mockResolvedValueOnce([
      {
        sessionId: "s-since",
        title: "T",
        createdAt: 10,
        messageCount: 1,
        lastMessageAt: 20,
      },
    ]);
    const out = await exec(search, { limit: 3, sinceMs: 1_700_000_000_000 });
    expect(searchRecentSessions).toHaveBeenCalledWith({
      workspaceId: undefined,
      limit: 3,
      sinceMs: 1_700_000_000_000,
    });
    expect(out.details).toEqual({
      sessions: [
        expect.objectContaining({ sessionId: "s-since", title: "T" }),
      ],
    });
    expect(textOf(out)).toContain("Found 1 session(s):");
  });

  it("transcript search empty matches yields No messages found", async () => {
    const [, , searchTranscript] = createSessionSummaryTools(svc);
    searchSessionTranscript.mockResolvedValueOnce([]);
    const out = await exec(searchTranscript, { sessionId: "s1", query: "none" });
    expect(textOf(out)).toBe("No messages found.");
    expect(out.details).toEqual({ matches: [] });
  });
});
