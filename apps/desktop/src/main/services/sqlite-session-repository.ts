import {
    copyFileSync,
    existsSync,
    mkdirSync,
    renameSync,
} from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import type {
    Message,
    Session,
    SessionListItem,
    SessionSearchInput,
    SessionSearchResult,
    ToolCall,
} from "@shared";
import type {
    SessionMetadataUpdates,
    SessionRepository,
    SessionRepositoryHealth,
    SessionRepositoryStats,
} from "./session-repository";

type DbRow = Record<string, unknown>;

function toEpochMs(value: string | Date | number | undefined): number | null {
    if (value == null) return null;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string" || value.length === 0) return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function json(value: unknown): string | null {
    return value == null ? null : JSON.stringify(value);
}

function normalizeMessage(message: Message): Message {
    return JSON.parse(JSON.stringify(message)) as Message;
}

function toolCallCount(message: Message): number {
    return Array.isArray(message.toolCalls) ? message.toolCalls.length : 0;
}

function collectText(value: unknown, out: string[], depth = 0): void {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") {
        if (value.trim()) out.push(value.trim());
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectText(item, out, depth + 1);
        return;
    }
    if (typeof value === "object") {
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (key === "id" || key === "kind" || key === "version") continue;
            collectText(item, out, depth + 1);
        }
    }
}

function searchableContent(message: Message): string {
    const parts = [message.content];
    collectText(message.generatedUi, parts);
    return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join("\n");
}

function sanitizeFtsQuery(raw: string): string | null {
    const tokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map((token) => token.trim()).filter(Boolean) ?? [];
    if (tokens.length === 0) return null;
    return tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" OR ");
}

export class SqliteSessionRepository implements SessionRepository {
    private readonly dbPath: string;
    private readonly backupPath: string;
    private readonly db: DatabaseSync;
    private closed = false;

    constructor(rootDir: string) {
        mkdirSync(rootDir, { recursive: true });
        this.dbPath = join(rootDir, "sessions.db");
        this.backupPath = join(rootDir, "sessions.backup.db");
        this.db = this.openHealthyDatabase();
        this.migrate();
    }

    private openHealthyDatabase(): DatabaseSync {
        let candidate: DatabaseSync | undefined;
        try {
            candidate = new DatabaseSync(this.dbPath);
            const health = candidate.prepare("PRAGMA quick_check;").all() as DbRow[];
            if (health.some((row) => row.quick_check !== "ok")) throw new Error("sessions.db quick_check failed");
            return candidate;
        } catch {
            try { candidate?.close(); } catch { /* best effort */ }
            this.quarantineDatabase();
            if (existsSync(this.backupPath) && this.backupIsHealthy()) {
                copyFileSync(this.backupPath, this.dbPath);
            }
            return new DatabaseSync(this.dbPath);
        }
    }

    private backupIsHealthy(): boolean {
        let backup: DatabaseSync | undefined;
        try {
            backup = new DatabaseSync(this.backupPath, { readOnly: true });
            const rows = backup.prepare("PRAGMA quick_check;").all() as DbRow[];
            return rows.length > 0 && rows.every((row) => row.quick_check === "ok");
        } catch {
            return false;
        } finally {
            try { backup?.close(); } catch { /* best effort */ }
        }
    }

    private quarantineDatabase(): void {
        const suffix = `.corrupt-${Date.now()}`;
        for (const extension of ["", "-wal", "-shm"]) {
            const source = `${this.dbPath}${extension}`;
            if (existsSync(source)) renameSync(source, `${this.dbPath}${suffix}${extension}`);
        }
    }

    private migrate(): void {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA foreign_keys = ON;");
        this.db.exec("PRAGMA synchronous = NORMAL;");
        this.db.exec("PRAGMA wal_autocheckpoint = 1000;");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                favorite INTEGER NOT NULL DEFAULT 0,
                read_only INTEGER NOT NULL DEFAULT 0,
                last_opened_at INTEGER,
                summary TEXT,
                tags_json TEXT,
                last_output_paths_json TEXT,
                usage_json TEXT,
                tool_permissions_json TEXT,
                parent_session_id TEXT,
                forked_from_message_id TEXT,
                forked_at INTEGER,
                message_count INTEGER NOT NULL DEFAULT 0,
                tool_call_count INTEGER NOT NULL DEFAULT 0,
                first_user_preview TEXT
            );
            CREATE INDEX IF NOT EXISTS sessions_activity_idx ON sessions(COALESCE(last_opened_at, updated_at) DESC);
            CREATE INDEX IF NOT EXISTS sessions_workspace_idx ON sessions(workspace_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                thinking TEXT,
                timestamp INTEGER NOT NULL,
                parent_id TEXT,
                payload_json TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                UNIQUE(session_id, ordinal)
            );
            CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, ordinal);
            CREATE INDEX IF NOT EXISTS messages_parent_idx ON messages(parent_id);
            CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
                message_id UNINDEXED,
                session_id UNINDEXED,
                content,
                thinking,
                tokenize='trigram'
            );
            CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
                INSERT INTO message_fts(message_id, session_id, content, thinking)
                VALUES (new.id, new.session_id, new.content, COALESCE(new.thinking, ''));
            END;
            CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
                DELETE FROM message_fts WHERE message_id = old.id;
                INSERT INTO message_fts(message_id, session_id, content, thinking)
                VALUES (new.id, new.session_id, new.content, COALESCE(new.thinking, ''));
            END;
            CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
                DELETE FROM message_fts WHERE message_id = old.id;
            END;
            INSERT OR REPLACE INTO session_meta(key, value) VALUES ('schema_version', '1');
        `);
    }

    private transaction<T>(operation: () => T): T {
        this.db.exec("BEGIN IMMEDIATE;");
        try {
            const result = operation();
            this.db.exec("COMMIT;");
            return result;
        } catch (error) {
            try { this.db.exec("ROLLBACK;"); } catch { /* preserve original */ }
            throw error;
        }
    }

    private requireSessionRow(id: string): DbRow {
        const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as DbRow | undefined;
        if (!row) throw new Error(`Session not found: ${id}`);
        return row;
    }

    private rowToSummary(row: DbRow): SessionListItem {
        return {
            id: String(row.id),
            workspaceId: String(row.workspace_id),
            title: String(row.title),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
            archived: Boolean(row.archived),
            favorite: Boolean(row.favorite),
            readOnly: Boolean(row.read_only),
            lastOpenedAt: row.last_opened_at == null ? undefined : Number(row.last_opened_at),
            summary: typeof row.summary === "string" && row.summary ? row.summary : undefined,
            tags: parseJson<string[]>(row.tags_json, []),
            lastOutputPaths: parseJson<string[] | undefined>(row.last_output_paths_json, undefined),
            usage: parseJson<Session["usage"]>(row.usage_json, undefined),
            toolPermissions: parseJson<Session["toolPermissions"]>(row.tool_permissions_json, undefined),
            parentSessionId: typeof row.parent_session_id === "string" && row.parent_session_id ? row.parent_session_id : undefined,
            forkedFromMessageId: typeof row.forked_from_message_id === "string" && row.forked_from_message_id ? row.forked_from_message_id : undefined,
            forkedAt: row.forked_at == null ? undefined : Number(row.forked_at),
            messageCount: Number(row.message_count),
            toolCallCount: Number(row.tool_call_count),
            firstUserMessagePreview: typeof row.first_user_preview === "string" && row.first_user_preview ? row.first_user_preview : undefined,
        };
    }

    async listSessionSummaries(): Promise<SessionListItem[]> {
        const rows = this.db.prepare(`
            SELECT * FROM sessions
            ORDER BY COALESCE(last_opened_at, updated_at) DESC, created_at DESC
        `).all() as DbRow[];
        return rows.map((row) => this.rowToSummary(row));
    }

    async getSession(id: string): Promise<Session | undefined> {
        const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as DbRow | undefined;
        if (!row) return undefined;
        const messages = this.db.prepare("SELECT payload_json FROM messages WHERE session_id = ? ORDER BY ordinal").all(id) as DbRow[];
        return { ...this.rowToSummary(row), messages: messages.map((message) => parseJson<Message>(message.payload_json, {} as Message)) };
    }

    async listSessions(): Promise<Session[]> {
        const summaries = await this.listSessionSummaries();
        const sessions = await Promise.all(summaries.map((summary) => this.getSession(summary.id)));
        return sessions.filter((session): session is Session => Boolean(session));
    }

    async createSession(workspaceId: string, title?: string, id?: string): Promise<Session> {
        const now = Date.now();
        const sessionId = id ?? `s_${now}_${Math.random().toString(36).slice(2, 6)}`;
        this.db.prepare(`
            INSERT INTO sessions(id, workspace_id, title, created_at, updated_at, last_opened_at, tags_json)
            VALUES (?, ?, ?, ?, ?, ?, '[]')
        `).run(sessionId, workspaceId, title?.trim() || "未命名会话", now, now, now);
        return (await this.getSession(sessionId))!;
    }

    async renameSession(id: string, title: string): Promise<Session> {
        const current = this.requireSessionRow(id);
        this.db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
            .run(title.trim() || String(current.title), Date.now(), id);
        return (await this.getSession(id))!;
    }

    async deleteSession(id: string): Promise<void> {
        this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    }

    async archiveSession(id: string, archived: boolean): Promise<Session> {
        this.requireSessionRow(id);
        this.db.prepare("UPDATE sessions SET archived = ?, updated_at = ? WHERE id = ?")
            .run(archived ? 1 : 0, Date.now(), id);
        return (await this.getSession(id))!;
    }

    async updateSessionMetadata(id: string, updates: SessionMetadataUpdates): Promise<Session> {
        this.requireSessionRow(id);
        const columns: string[] = [];
        const values: Array<string | number | null> = [];
        const set = (column: string, value: string | number | null): void => { columns.push(`${column} = ?`); values.push(value); };
        if (typeof updates.summary === "string") set("summary", updates.summary);
        if (Array.isArray(updates.lastOutputPaths)) set("last_output_paths_json", json(updates.lastOutputPaths));
        if (typeof updates.favorite === "boolean") set("favorite", updates.favorite ? 1 : 0);
        if (Array.isArray(updates.tags)) set("tags_json", json([...new Set(updates.tags.map((tag) => tag.trim()).filter(Boolean))]));
        if (typeof updates.archived === "boolean") set("archived", updates.archived ? 1 : 0);
        if (typeof updates.readOnly === "boolean") set("read_only", updates.readOnly ? 1 : 0);
        if (typeof updates.lastOpenedAt === "number") set("last_opened_at", updates.lastOpenedAt);
        if (updates.usage) set("usage_json", json(updates.usage));
        if (updates.toolPermissions) set("tool_permissions_json", json(updates.toolPermissions));
        if (typeof updates.parentSessionId === "string") set("parent_session_id", updates.parentSessionId);
        if (typeof updates.forkedFromMessageId === "string") set("forked_from_message_id", updates.forkedFromMessageId);
        if (typeof updates.forkedAt === "number") set("forked_at", updates.forkedAt);
        set("updated_at", Date.now());
        this.db.prepare(`UPDATE sessions SET ${columns.join(", ")} WHERE id = ?`).run(...values, id);
        return (await this.getSession(id))!;
    }

    async appendMessage(sessionId: string, message: Message): Promise<void> {
        this.transaction(() => {
            this.requireSessionRow(sessionId);
            const exists = this.db.prepare("SELECT 1 AS found FROM messages WHERE id = ?").get(message.id);
            if (exists) return;
            const ordinalRow = this.db.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM messages WHERE session_id = ?")
                .get(sessionId) as { ordinal: number };
            const normalized = normalizeMessage(message);
            this.db.prepare(`
                INSERT INTO messages(id, session_id, ordinal, role, content, thinking, timestamp, parent_id, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                normalized.id,
                sessionId,
                Number(ordinalRow.ordinal),
                normalized.role,
                searchableContent(normalized),
                normalized.thinking ?? null,
                toEpochMs(normalized.timestamp) ?? Date.now(),
                normalized.parentId ?? null,
                JSON.stringify(normalized),
            );
            this.db.prepare(`
                UPDATE sessions SET
                    updated_at = ?,
                    message_count = message_count + 1,
                    tool_call_count = tool_call_count + ?,
                    first_user_preview = CASE
                        WHEN ? = 'user' AND first_user_preview IS NULL THEN substr(?, 1, 240)
                        ELSE first_user_preview
                    END
                WHERE id = ?
            `).run(Date.now(), toolCallCount(normalized), normalized.role, normalized.content, sessionId);
        });
    }

    async updateMessage(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void> {
        this.transaction(() => {
            this.requireSessionRow(sessionId);
            const row = this.db.prepare("SELECT payload_json FROM messages WHERE id = ? AND session_id = ?")
                .get(messageId, sessionId) as DbRow | undefined;
            if (!row) throw new Error(`Message not found: ${messageId} in session ${sessionId}`);
            const previous = parseJson<Message>(row.payload_json, {} as Message);
            const merged = normalizeMessage({ ...previous, ...updates, id: previous.id, role: previous.role, timestamp: previous.timestamp });
            const delta = toolCallCount(merged) - toolCallCount(previous);
            this.db.prepare(`
                UPDATE messages SET content = ?, thinking = ?, parent_id = ?, payload_json = ?
                WHERE id = ? AND session_id = ?
            `).run(searchableContent(merged), merged.thinking ?? null, merged.parentId ?? null, JSON.stringify(merged), messageId, sessionId);
            this.db.prepare("UPDATE sessions SET updated_at = ?, tool_call_count = tool_call_count + ? WHERE id = ?")
                .run(Date.now(), delta, sessionId);
        });
    }

    async updateToolCall(
        sessionId: string,
        messageId: string,
        toolCallId: string,
        updates: Partial<ToolCall>,
    ): Promise<void> {
        const row = this.db.prepare("SELECT payload_json FROM messages WHERE id = ? AND session_id = ?")
            .get(messageId, sessionId) as DbRow | undefined;
        if (!row) throw new Error(`Message not found: ${messageId} in session ${sessionId}`);
        const message = parseJson<Message>(row.payload_json, {} as Message);
        const index = message.toolCalls?.findIndex((toolCall) => toolCall.id === toolCallId) ?? -1;
        if (index < 0 || !message.toolCalls) throw new Error(`ToolCall not found: ${toolCallId} in message ${messageId}`);
        const toolCalls = [...message.toolCalls];
        toolCalls[index] = { ...toolCalls[index], ...updates };
        await this.updateMessage(sessionId, messageId, { toolCalls });
    }

    async searchSessionMessages(input: SessionSearchInput): Promise<SessionSearchResult[]> {
        const query = input.query.trim();
        if (!query) return [];
        const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 20), 100));
        const params: Array<string | number> = [];
        let sql: string;
        const ftsQuery = query.length >= 3 ? sanitizeFtsQuery(query) : null;
        if (ftsQuery) {
            sql = `
                SELECT m.id, m.session_id, m.role, m.content, m.timestamp, s.title, s.workspace_id
                FROM message_fts
                JOIN messages m ON m.id = message_fts.message_id
                JOIN sessions s ON s.id = m.session_id
                WHERE message_fts MATCH ?
            `;
            params.push(ftsQuery);
        } else {
            sql = `
                SELECT m.id, m.session_id, m.role, m.content, m.timestamp, s.title, s.workspace_id
                FROM messages m JOIN sessions s ON s.id = m.session_id
                WHERE (lower(m.content) LIKE ? OR lower(COALESCE(m.thinking, '')) LIKE ?)
            `;
            params.push(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`);
        }
        if (input.workspaceId) {
            sql += " AND s.workspace_id = ?";
            params.push(input.workspaceId);
        }
        sql += " ORDER BY m.timestamp DESC LIMIT ?";
        params.push(limit);
        const rows = this.db.prepare(sql).all(...params) as DbRow[];
        const needle = query.toLowerCase();
        return rows.map((row) => {
            const content = String(row.content);
            const matchIndex = Math.max(0, content.toLowerCase().indexOf(needle));
            return {
                sessionId: String(row.session_id),
                sessionTitle: String(row.title),
                workspaceId: String(row.workspace_id),
                messageId: String(row.id),
                messageContent: content,
                messageRole: row.role as Message["role"],
                timestamp: Number(row.timestamp),
                matchIndex,
                matchLength: query.length,
            };
        });
    }

    async getStats(): Promise<SessionRepositoryStats> {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS session_count, COALESCE(SUM(message_count), 0) AS message_count FROM sessions
        `).get() as DbRow;
        return { sessionCount: Number(row.session_count), messageCount: Number(row.message_count) };
    }

    checkHealth(): SessionRepositoryHealth {
        try {
            const rows = this.db.prepare("PRAGMA quick_check;").all() as DbRow[];
            const details = rows.map((row) => String(row.quick_check ?? "unknown"));
            return { ok: details.length > 0 && details.every((detail) => detail === "ok"), details };
        } catch (error) {
            return { ok: false, details: [error instanceof Error ? error.message : String(error)] };
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* best effort */ }
        this.db.close();
        try { copyFileSync(this.dbPath, this.backupPath); } catch { /* best effort */ }
    }
}
