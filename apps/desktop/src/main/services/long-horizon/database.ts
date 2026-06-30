import { existsSync, mkdirSync, readFileSync, renameSync, createReadStream } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import type {
    GoalState,
    LongHorizonMemoryLayer,
    LongHorizonMemoryRecord,
    LongHorizonTaskListInput,
    LongHorizonTaskRecord,
} from "@shared";

export type MemoryScope = "project" | "session" | "global";
export type MemoryKind = "note" | "checkpoint" | "task-progress" | "summary" | "history";

export interface MemoryInput {
    scope: MemoryScope;
    kind: MemoryKind;
    text: string;
    parentId?: string;
    workspaceId?: string;
    sessionId?: string;
    tags?: string[];
    id?: string;
    createdAt?: number;
}

export interface MemorySearchOptions {
    workspaceId?: string;
    sessionId?: string;
    limit?: number;
    searchScoreFloor?: number;
    includeHistoryFallback?: boolean;
}

export interface RecentMemoryOptions {
    workspaceId?: string;
    sessionId?: string;
    limit?: number;
}

export interface HistoryMessageInput {
    workspaceId?: string;
    sessionId?: string;
    messageId: string;
    role: string;
    content: string;
    thinking?: string;
}

function agentKey(agentId?: string): string {
    return agentId ?? "__default__";
}

function deriveLayer(scope: MemoryScope, kind: MemoryKind): LongHorizonMemoryLayer {
    if (kind === "checkpoint") return "checkpoints";
    if (kind === "history") return "history";
    if (scope === "session") return "session_memory";
    if (scope === "global") return "global_memory";
    return "project_memory";
}

function tokenize(text: string): string[] {
    const tokens: string[] = [];
    const ascii = text.match(/[a-zA-Z0-9]+/g) || [];
    tokens.push(...ascii);
    const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) || [];
    for (const segment of cjk) {
        for (const ch of segment) tokens.push(ch);  // unigram
        for (let i = 0; i < segment.length - 1; i++) {
            tokens.push(segment.substring(i, i + 2));  // bigram
        }
    }
    return tokens;
}

function buildSearchText(text: string, tags?: string[]): string {
    return tokenize(`${text} ${(tags ?? []).join(" ")}`).join(" ");
}

function rowToMemory(row: Record<string, unknown>): LongHorizonMemoryRecord {
    return {
        id: String(row.id),
        scope: row.scope as MemoryScope,
        layer: row.layer as LongHorizonMemoryLayer,
        kind: row.kind as MemoryKind,
        text: String(row.text),
        parentId: typeof row.parent_id === "string" && row.parent_id ? row.parent_id : undefined,
        workspaceId: typeof row.workspace_id === "string" && row.workspace_id ? row.workspace_id : undefined,
        sessionId: typeof row.session_id === "string" && row.session_id ? row.session_id : undefined,
        tags: typeof row.tags_json === "string" && row.tags_json
            ? JSON.parse(row.tags_json) as string[]
            : undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at ?? row.created_at),
        score: typeof row.score === "number" ? row.score : undefined,
    };
}

function rowToTask(row: Record<string, unknown>): LongHorizonTaskRecord {
    return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        agentId: typeof row.agent_id === "string" && row.agent_id ? row.agent_id : undefined,
        source: row.source as "goal" | "plan",
        text: String(row.text),
        status: row.status as LongHorizonTaskRecord["status"],
        ordinal: Number(row.ordinal),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}

export class LongHorizonDatabase {
    private readonly db: DatabaseSync;
    private readonly dbPath: string;

    constructor(rootDir: string) {
        mkdirSync(rootDir, { recursive: true });
        this.dbPath = join(rootDir, "long-horizon.db");
        mkdirSync(dirname(this.dbPath), { recursive: true });
        this.db = new DatabaseSync(this.dbPath);
        this.migrate();
    }

    private async yieldToEventLoop(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    async close(): Promise<void> {
        await this.yieldToEventLoop();
        this.db.close();
    }

    get path(): string {
        return this.dbPath;
    }

    async migrateLegacyMemoryJsonl(jsonlPath: string): Promise<void> {
        await this.yieldToEventLoop();
        if (!existsSync(jsonlPath)) return;
        const countRow = this.db.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number };
        if ((countRow?.count ?? 0) > 0) return;
        const rl = readline.createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
        const batch: MemoryInput[] = [];
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const record = JSON.parse(line) as MemoryInput;
                batch.push(record);
            } catch {
                // Skip invalid legacy lines.
            }
            if (batch.length >= 100) {
                this.insertBatch(batch);
                batch.length = 0;
                await this.yieldToEventLoop();
            }
        }
        if (batch.length > 0) this.insertBatch(batch);
        renameSync(jsonlPath, `${jsonlPath}.migrated`);
    }

    async migrateLegacyGoalsFile(goalsPath: string): Promise<void> {
        await this.yieldToEventLoop();
        if (!existsSync(goalsPath)) return;
        const countRow = this.db.prepare("SELECT COUNT(*) AS count FROM goals").get() as { count: number };
        if ((countRow?.count ?? 0) > 0) return;
        try {
            const parsed = JSON.parse(readFileSync(goalsPath, "utf8")) as { goals?: GoalState[] };
            for (const goal of parsed.goals ?? []) {
                if (!goal.workspaceId || goal.status === "cleared") continue;
                await this.upsertGoal(goal);
            }
            renameSync(goalsPath, `${goalsPath}.migrated`);
        } catch {
            // Ignore unreadable legacy files.
        }
    }

    async insertMemory(input: MemoryInput): Promise<LongHorizonMemoryRecord> {
        await this.yieldToEventLoop();
        const timestamp = input.createdAt ?? Date.now();
        const record: LongHorizonMemoryRecord = {
            id: input.id ?? randomUUID(),
            scope: input.scope,
            layer: deriveLayer(input.scope, input.kind),
            kind: input.kind,
            text: input.text,
            parentId: input.parentId,
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            tags: input.tags,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const tagsJson = record.tags?.length ? JSON.stringify(record.tags) : null;
        const searchText = buildSearchText(record.text, record.tags);
        this.db.prepare(`
            INSERT OR REPLACE INTO memories (
                id, scope, layer, kind, text, parent_id, workspace_id, session_id, tags_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.id,
            record.scope,
            record.layer,
            record.kind,
            record.text,
            record.parentId ?? null,
            record.workspaceId ?? null,
            record.sessionId ?? null,
            tagsJson,
            timestamp,
            timestamp,
        );
        this.db.prepare(`
            INSERT OR REPLACE INTO memory_fts (id, search_text, kind, layer, workspace_id, session_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            record.id,
            searchText,
            record.kind,
            record.layer,
            record.workspaceId ?? "",
            record.sessionId ?? "",
        );
        return record;
    }

    async upsertHistoryMessage(input: HistoryMessageInput): Promise<LongHorizonMemoryRecord | null> {
        await this.yieldToEventLoop();
        const text = [input.role, input.content.trim(), input.thinking?.trim() ?? ""]
            .filter(Boolean)
            .join("\n");
        if (!text.trim()) return null;
        return this.insertMemory({
            id: `history:${input.sessionId ?? "workspace"}:${input.messageId}`,
            scope: input.sessionId ? "session" : "project",
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            kind: "history",
            text,
            tags: ["history", input.role],
            createdAt: Date.now(),
        });
    }

    async searchMemories(query: string, options: MemorySearchOptions = {}): Promise<LongHorizonMemoryRecord[]> {
        await this.yieldToEventLoop();
        const terms = tokenize(query);
        if (terms.length === 0) return [];
        const memoryHits = this.searchLayered(terms, options, false);
        if (memoryHits.length > 0 || !options.includeHistoryFallback) return memoryHits;
        return this.searchLayered(terms, options, true);
    }

    async listRecentMemories(options: RecentMemoryOptions = {}): Promise<LongHorizonMemoryRecord[]> {
        await this.yieldToEventLoop();
        const rows = this.db.prepare(`
            SELECT *
            FROM memories
            WHERE (?1 IS NULL OR workspace_id = ?1 OR (scope = 'global' AND workspace_id IS NULL))
            ORDER BY created_at DESC
            LIMIT ?2
        `).all(
            options.workspaceId ?? null,
            Math.max(1, options.limit ?? 10),
        ) as Array<Record<string, unknown>>;
        return rows.map(rowToMemory);
    }

    async getMemoryTree(rootId: string): Promise<{ record: LongHorizonMemoryRecord; children: Array<{ record: LongHorizonMemoryRecord; children: unknown[] }> } | null> {
        await this.yieldToEventLoop();
        const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(rootId) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.buildTree(rowToMemory(row));
    }

    async setSourceTasks(
        workspaceId: string,
        agentId: string | undefined,
        source: "goal" | "plan",
        items: Array<Pick<LongHorizonTaskRecord, "id" | "text" | "status">>,
    ): Promise<void> {
        await this.yieldToEventLoop();
        const now = Date.now();
        this.db.exec("BEGIN");
        try {
            this.db.prepare("DELETE FROM tasks WHERE workspace_id = ? AND agent_key = ? AND source = ?")
                .run(workspaceId, agentKey(agentId), source);
            const insert = this.db.prepare(`
                INSERT INTO tasks (
                    id, workspace_id, agent_id, agent_key, source, text, status, ordinal, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const [index, item] of items.entries()) {
                insert.run(
                    item.id,
                    workspaceId,
                    agentId ?? null,
                    agentKey(agentId),
                    source,
                    item.text,
                    item.status,
                    index,
                    now,
                    now,
                );
            }
            this.db.exec("COMMIT");
        } catch (err) {
            this.db.exec("ROLLBACK");
            throw err;
        }
    }

    async listTasks(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord[]> {
        await this.yieldToEventLoop();
        const rows = this.db.prepare(`
            SELECT *
            FROM tasks
            WHERE workspace_id = ?1
              AND (agent_key = ?2 OR (?3 = 1 AND agent_key = '__default__'))
            ORDER BY CASE source WHEN 'goal' THEN 0 ELSE 1 END, ordinal ASC, updated_at DESC
        `).all(
            input.workspaceId,
            agentKey(input.agentId),
            input.agentId ? 0 : 1,
        ) as Array<Record<string, unknown>>;
        return rows.map(rowToTask);
    }

    async getActiveTask(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord | null> {
        await this.yieldToEventLoop();
        const tasks = await this.listTasks(input);
        const active = tasks.find((task) => task.status === "running" || task.status === "waiting" || task.status === "pending");
        return active ?? null;
    }

    async upsertGoal(goal: GoalState): Promise<GoalState> {
        await this.yieldToEventLoop();
        const createdAt = goal.createdAt ?? Date.now();
        this.db.prepare(`
            INSERT OR REPLACE INTO goals (
                workspace_id, agent_id, agent_key, id, condition, status, reason, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            goal.workspaceId,
            goal.agentId ?? null,
            agentKey(goal.agentId),
            goal.id,
            goal.condition,
            goal.status,
            goal.reason ?? null,
            createdAt,
            goal.updatedAt,
        );
        return { ...goal, createdAt };
    }

    async getGoal(workspaceId: string, agentId?: string): Promise<GoalState | null> {
        await this.yieldToEventLoop();
        const direct = this.selectGoal(workspaceId, agentId);
        if (direct) return direct;
        if (agentId) return this.selectGoal(workspaceId, undefined);
        return null;
    }

    async clearGoal(workspaceId: string, agentId?: string): Promise<GoalState | null> {
        await this.yieldToEventLoop();
        const existing = await this.getGoal(workspaceId, agentId);
        if (!existing) return null;
        const targetKey = this.selectGoal(workspaceId, agentId)?.agentId ?? existing.agentId;
        this.db.prepare("DELETE FROM goals WHERE workspace_id = ? AND agent_key = ?").run(workspaceId, agentKey(targetKey));
        return existing;
    }

    private insertBatch(records: MemoryInput[]): void {
        this.db.exec("BEGIN");
        try {
            const insertMemoryStmt = this.db.prepare(`
                INSERT OR REPLACE INTO memories (
                    id, scope, layer, kind, text, parent_id, workspace_id, session_id, tags_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertFtsStmt = this.db.prepare(`
                INSERT OR REPLACE INTO memory_fts (id, search_text, kind, layer, workspace_id, session_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (const input of records) {
                const timestamp = input.createdAt ?? Date.now();
                const record: LongHorizonMemoryRecord = {
                    id: input.id ?? randomUUID(),
                    scope: input.scope,
                    layer: deriveLayer(input.scope, input.kind),
                    kind: input.kind,
                    text: input.text,
                    parentId: input.parentId,
                    workspaceId: input.workspaceId,
                    sessionId: input.sessionId,
                    tags: input.tags,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                };
                const tagsJson = record.tags?.length ? JSON.stringify(record.tags) : null;
                const searchText = buildSearchText(record.text, record.tags);
                insertMemoryStmt.run(
                    record.id,
                    record.scope,
                    record.layer,
                    record.kind,
                    record.text,
                    record.parentId ?? null,
                    record.workspaceId ?? null,
                    record.sessionId ?? null,
                    tagsJson,
                    timestamp,
                    timestamp,
                );
                insertFtsStmt.run(
                    record.id,
                    searchText,
                    record.kind,
                    record.layer,
                    record.workspaceId ?? "",
                    record.sessionId ?? "",
                );
            }
            this.db.exec("COMMIT");
        } catch (err) {
            this.db.exec("ROLLBACK");
            throw err;
        }
    }

    private buildTree(
        record: LongHorizonMemoryRecord,
        depth = 0,
        visited = new Set<string>(),
    ): { record: LongHorizonMemoryRecord; children: Array<{ record: LongHorizonMemoryRecord; children: unknown[] }> } | null {
        const maxDepth = 16;
        if (visited.has(record.id) || depth > maxDepth) return null;
        visited.add(record.id);
        const rows = this.db.prepare("SELECT * FROM memories WHERE parent_id = ? ORDER BY created_at ASC").all(record.id) as Array<Record<string, unknown>>;
        const children = rows
            .map((row) => this.buildTree(rowToMemory(row), depth + 1, visited))
            .filter((child): child is { record: LongHorizonMemoryRecord; children: Array<{ record: LongHorizonMemoryRecord; children: unknown[] }> } => child !== null);
        return {
            record,
            children,
        };
    }

    private searchLayered(terms: string[], options: MemorySearchOptions, historyOnly: boolean): LongHorizonMemoryRecord[] {
        const limit = Math.max(1, Math.min((options.limit ?? 8) * 3, 50));
        const query = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
        const rows = this.db.prepare(`
            SELECT
                m.*,
                (-1 * bm25(memory_fts)) AS score
            FROM memory_fts
            JOIN memories m ON m.id = memory_fts.id
            WHERE memory_fts.search_text MATCH ?1
              AND (?2 IS NULL OR m.workspace_id = ?2 OR m.workspace_id IS NULL OR m.workspace_id = '')
              AND (?3 IS NULL OR m.session_id = ?3 OR m.session_id IS NULL OR m.session_id = '')
              AND (CASE WHEN ?4 = 1 THEN m.kind = 'history' ELSE m.kind <> 'history' END)
            ORDER BY score DESC, m.created_at DESC
            LIMIT ?5
        `).all(
            query,
            options.workspaceId ?? null,
            options.sessionId ?? null,
            historyOnly ? 1 : 0,
            limit,
        ) as Array<Record<string, unknown>>;
        if (rows.length === 0) return [];
        const mapped = rows.map(rowToMemory);
        const floor = options.searchScoreFloor ?? 0.15;
        const withScores = mapped.filter(
            (record): record is LongHorizonMemoryRecord & { score: number } =>
                record.score != null && Math.abs(record.score) > 0,
        );
        if (withScores.length === 0) return [];
        const topScore = Math.max(...withScores.map((record) => Math.abs(record.score)));
        const cutoff = topScore * (1 - floor);
        return withScores
            .filter((record) => Math.abs(record.score) >= cutoff)
            .slice(0, options.limit ?? 8);
    }

    private selectGoal(workspaceId: string, agentId?: string): GoalState | null {
        const row = this.db.prepare(`
            SELECT *
            FROM goals
            WHERE workspace_id = ? AND agent_key = ?
        `).get(workspaceId, agentKey(agentId)) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            id: String(row.id),
            workspaceId: String(row.workspace_id),
            agentId: typeof row.agent_id === "string" && row.agent_id ? row.agent_id : undefined,
            condition: String(row.condition),
            status: row.status as GoalState["status"],
            reason: typeof row.reason === "string" && row.reason ? row.reason : undefined,
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
        };
    }

    private migrate(): void {
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                layer TEXT NOT NULL,
                kind TEXT NOT NULL,
                text TEXT NOT NULL,
                parent_id TEXT,
                workspace_id TEXT,
                session_id TEXT,
                tags_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(workspace_id, session_id, kind, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memories_parent ON memories(parent_id);
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                id UNINDEXED,
                search_text,
                kind UNINDEXED,
                layer UNINDEXED,
                workspace_id UNINDEXED,
                session_id UNINDEXED
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                agent_id TEXT,
                agent_key TEXT NOT NULL,
                source TEXT NOT NULL,
                text TEXT NOT NULL,
                status TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks(workspace_id, agent_key, source, ordinal);
            CREATE TABLE IF NOT EXISTS goals (
                workspace_id TEXT NOT NULL,
                agent_id TEXT,
                agent_key TEXT NOT NULL,
                id TEXT NOT NULL,
                condition TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (workspace_id, agent_key)
            );
        `);
    }
}
