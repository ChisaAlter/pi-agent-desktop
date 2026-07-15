import type {
    Session,
    SessionListItem,
    SessionMessage,
    SessionSearchInput,
    SessionSearchResult,
    SessionSummary,
} from "@shared";

/**
 * SessionSummaryService — Phase E Task 4.
 *
 * Read-only adapter over the SQLite-backed SessionRepository. The legacy
 * callback form remains only as a lightweight unit-test seam.
 *
 * Methods:
 *  - searchRecentSessions({ workspaceId?, limit, sinceMs? }) — list recent
 *    sessions with title / createdAt / messageCount / lastMessageAt.
 *  - getSessionMessages({ sessionId, limit }) — transcript (user + assistant
 *    text only); tool calls collapse to `[tool: <name>]` single lines.
 *  - searchSessionTranscript({ sessionId, query, limit }) — LIKE substring
 *    filter over message content. Returns matching messages (same shape as
 *    `getSessionMessages`).
 */

export interface SessionSource {
    /** Returns the live Session[] snapshot. Called on every query. */
    (): Session[];
}

export interface SessionSummaryRepositorySource {
    listSessionSummaries(): Promise<SessionListItem[]>;
    getSession(id: string): Promise<Session | undefined>;
    searchSessionMessages(input: SessionSearchInput): Promise<SessionSearchResult[]>;
}

export interface SearchRecentSessionsOptions {
    workspaceId?: string;
    limit?: number;
    sinceMs?: number;
}

export interface GetSessionMessagesOptions {
    sessionId: string;
    /** Default 50. Caps the transcript length to keep subagent budget sane. */
    limit?: number;
}

export interface SearchSessionTranscriptOptions {
    sessionId: string;
    query: string;
    /** Default 20. */
    limit?: number;
}

/** Default transcript cap (spec SubTask 4.3). */
const DEFAULT_TRANSCRIPT_LIMIT = 50;
/** Default search-result cap (spec SubTask 4.4). */
const DEFAULT_SEARCH_LIMIT = 20;
/** Default recent-sessions cap. */
const DEFAULT_RECENT_LIMIT = 20;

export class SessionSummaryService {
    private readonly source: SessionSource | SessionSummaryRepositorySource;

    constructor(source: SessionSource | SessionSummaryRepositorySource) {
        this.source = source;
    }

    private repositorySource(): SessionSummaryRepositorySource | null {
        return typeof this.source === "function" ? null : this.source;
    }

    private arraySource(): SessionSource | null {
        return typeof this.source === "function" ? this.source : null;
    }

    /**
     * List recent sessions, newest first. Optionally filtered by workspace
     * and a `sinceMs` epoch-ms floor.
     */
    async searchRecentSessions(opts: SearchRecentSessionsOptions = {}): Promise<SessionSummary[]> {
        const limit = clampPositive(opts.limit, DEFAULT_RECENT_LIMIT);
        const since = opts.sinceMs ?? 0;
        const repository = this.repositorySource();
        if (repository) {
            const summaries = await repository.listSessionSummaries();
            return summaries
                .filter((session) => !opts.workspaceId || session.workspaceId === opts.workspaceId)
                .filter((session) => !since || session.createdAt >= since)
                .map(toRepositorySummary)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, limit);
        }
        const sessions = this.arraySource()?.() ?? [];
        const out: SessionSummary[] = [];
        for (const s of sessions) {
            if (opts.workspaceId && s.workspaceId !== opts.workspaceId) continue;
            if (since && s.createdAt < since) continue;
            out.push(toSummary(s));
        }
        out.sort((a, b) => b.createdAt - a.createdAt);
        return out.slice(0, limit);
    }

    /**
     * Fetch a session's transcript as flat `SessionMessage[]`. Tool calls are
     * elided: each message records `toolNames` (deduped, in original order)
     * so the subagent sees "this turn had bash + edit" without I/O detail.
     */
    async getSessionMessages(opts: GetSessionMessagesOptions): Promise<SessionMessage[]> {
        const limit = clampPositive(opts.limit, DEFAULT_TRANSCRIPT_LIMIT);
        const repository = this.repositorySource();
        const session = repository
            ? await repository.getSession(opts.sessionId)
            : this.arraySource()?.().find((s) => s.id === opts.sessionId);
        if (!session) return [];
        const messages = session.messages;
        const start = Math.max(0, messages.length - limit);
        return messages.slice(start).map(toSessionMessage);
    }

    /**
     * Substring search over a session's message contents. Case-insensitive.
     * Returns up to `limit` (default 20) matches in chronological order.
     */
    async searchSessionTranscript(opts: SearchSessionTranscriptOptions): Promise<SessionMessage[]> {
        const limit = clampPositive(opts.limit, DEFAULT_SEARCH_LIMIT);
        const needle = opts.query.trim().toLowerCase();
        if (!needle) return [];
        const repository = this.repositorySource();
        if (repository) {
            const results = await repository.searchSessionMessages({
                query: needle,
                limit,
            });
            return results
                .filter((result) => result.sessionId === opts.sessionId)
                .slice(0, limit)
                .map((result) => ({
                    role: result.messageRole,
                    text: result.messageContent,
                    createdAt: result.timestamp,
                }));
        }
        const session = this.arraySource()?.().find((s) => s.id === opts.sessionId);
        if (!session) return [];
        const out: SessionMessage[] = [];
        for (const msg of session.messages) {
            if (!matchesQuery(msg.content, needle) && !matchesQuery(msg.thinking ?? "", needle)) continue;
            out.push(toSessionMessage(msg));
            if (out.length >= limit) break;
        }
        return out;
    }
}

// ── helpers ──────────────────────────────────────────────────────

function toSummary(s: Session): SessionSummary {
    const messageCount = s.messages.length;
    const lastMessageAt = messageCount > 0
        ? toEpochMs(s.messages[s.messages.length - 1].timestamp)
        : s.updatedAt;
    return {
        sessionId: s.id,
        workspaceId: s.workspaceId,
        title: s.title || undefined,
        createdAt: s.createdAt,
        lastMessageAt,
        messageCount,
    };
}

function toRepositorySummary(session: SessionListItem): SessionSummary {
    return {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        title: session.title || undefined,
        createdAt: session.createdAt,
        lastMessageAt: session.updatedAt,
        messageCount: session.messageCount,
    };
}

function toSessionMessage(msg: Session["messages"][number]): SessionMessage {
    const toolNames = msg.toolCalls?.length
        ? dedupeInOrder(msg.toolCalls.map((tc) => tc.name))
        : undefined;
    return {
        role: msg.role,
        text: msg.content,
        createdAt: toEpochMs(msg.timestamp),
        toolNames,
    };
}

function dedupeInOrder(values: string[]): string[] | undefined {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out.length > 0 ? out : undefined;
}

function toEpochMs(value: string | Date | number): number {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function matchesQuery(haystack: string, needleLower: string): boolean {
    return haystack.length > 0 && haystack.toLowerCase().includes(needleLower);
}

function clampPositive(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
}
