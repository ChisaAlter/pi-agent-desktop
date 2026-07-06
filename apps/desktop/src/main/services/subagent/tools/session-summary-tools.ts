import { Type } from "typebox";
import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SessionMessage, SessionSummary } from "@shared";
import type { SessionSummaryService } from "../session-summary-service";

/**
 * Session-summary custom tools — Phase E Task 4 SubTask 4.5.
 *
 * Three read-only Pi CLI tools injected into `dream` / `distill` subagents
 * so they can review persisted conversations without touching electron-store
 * or SQLite directly.
 *
 *  - `session_summary_search` — list recent sessions ({ limit, sinceMs?, workspaceId? })
 *  - `session_summary_get`    — fetch a session's transcript ({ sessionId, limit? })
 *  - `session_transcript_search` — substring search over a session
 *
 * Schema uses TypeBox (matching `actor-tool.ts` and `workflow-tool.ts`) rather
 * than the spec's "Zod" — Pi Desktop's existing tool codegen is TypeBox-based.
 *
 * Result shape: text content with a compact human-readable summary. Details
 * field carries the structured payload for the runtime / UI.
 */

// ── Schemas ──────────────────────────────────────────────────────

const searchSchema = Type.Object({
    limit: Type.Optional(Type.Number({
        description: "(optional) Max sessions to return. Default 20.",
    })),
    sinceMs: Type.Optional(Type.Number({
        description: "(optional) Epoch-ms floor; only sessions created after this are returned.",
    })),
    workspaceId: Type.Optional(Type.String({
        description: "(optional) Restrict to a workspace. Omit to search across all workspaces.",
    })),
});

const getSchema = Type.Object({
    sessionId: Type.String({ description: "Session id from `session_summary_search`." }),
    limit: Type.Optional(Type.Number({
        description: "(optional) Max messages to return, newest. Default 50.",
    })),
});

const searchTranscriptSchema = Type.Object({
    sessionId: Type.String({ description: "Session id whose transcript to search." }),
    query: Type.String({ description: "Substring to match (case-insensitive) in user / assistant / system messages." }),
    limit: Type.Optional(Type.Number({
        description: "(optional) Max matches. Default 20.",
    })),
});

interface SearchDetails { sessions: SessionSummary[] }
interface GetDetails { messages: SessionMessage[] }
interface SearchTranscriptDetails { matches: SessionMessage[] }

// ── Factory ─────────────────────────────────────────────────────

export function createSessionSummaryTools(svc: SessionSummaryService): ToolDefinition[] {
    const searchTool = defineTool({
        name: "session_summary_search",
        label: "Session Summary Search",
        description:
            "List recent sessions (conversations) with title, createdAt, messageCount, lastMessageAt. " +
            "Used by dream / distill to find work to review.",
        parameters: searchSchema,
        async execute(_id, params): Promise<AgentToolResult<SearchDetails>> {
            const sessions = await svc.searchRecentSessions({
                workspaceId: params.workspaceId,
                limit: params.limit,
                sinceMs: params.sinceMs,
            });
            return {
                content: [{ type: "text", text: formatSessions(sessions) }],
                details: { sessions },
            };
        },
    });

    const getTool = defineTool({
        name: "session_summary_get",
        label: "Session Summary Get",
        description:
            "Fetch a session's transcript (user + assistant + system text). Tool calls are elided " +
            "to a `[tool: <name>]` line. Default 50 most-recent messages.",
        parameters: getSchema,
        async execute(_id, params): Promise<AgentToolResult<GetDetails>> {
            const messages = await svc.getSessionMessages({
                sessionId: params.sessionId,
                limit: params.limit,
            });
            return {
                content: [{ type: "text", text: formatMessages(messages) }],
                details: { messages },
            };
        },
    });

    const searchTranscriptTool = defineTool({
        name: "session_transcript_search",
        label: "Session Transcript Search",
        description:
            "Substring search inside one session's transcript (case-insensitive). Returns matching " +
            "messages in chronological order. Useful for finding prior decisions / errors / patterns.",
        parameters: searchTranscriptSchema,
        async execute(_id, params): Promise<AgentToolResult<SearchTranscriptDetails>> {
            const matches = await svc.searchSessionTranscript({
                sessionId: params.sessionId,
                query: params.query,
                limit: params.limit,
            });
            return {
                content: [{ type: "text", text: formatMessages(matches) }],
                details: { matches },
            };
        },
    });

    return [searchTool, getTool, searchTranscriptTool];
}

// ── Formatters ───────────────────────────────────────────────────

function formatSessions(sessions: SessionSummary[]): string {
    if (sessions.length === 0) {
        return "No sessions found.";
    }
    const lines = sessions.map((s) => {
        const title = s.title ?? "(untitled)";
        return `- ${s.sessionId} | ${title} | created=${iso(s.createdAt)} | msgs=${s.messageCount} | last=${iso(s.lastMessageAt)}`;
    });
    return [`Found ${sessions.length} session(s):`, ...lines].join("\n");
}

function formatMessages(messages: SessionMessage[]): string {
    if (messages.length === 0) {
        return "No messages found.";
    }
    const lines = messages.map((m) => {
        const tools = m.toolNames?.length ? ` [tools: ${m.toolNames.join(", ")}]` : "";
        const body = m.text.trim().length > 0 ? m.text : "(empty)";
        return `[${iso(m.createdAt)}] ${m.role.toUpperCase()}${tools}: ${body}`;
    });
    return lines.join("\n");
}

function iso(epoch: number): string {
    if (!epoch || epoch <= 0) return "?";
    try {
        return new Date(epoch).toISOString();
    } catch {
        return String(epoch);
    }
}
