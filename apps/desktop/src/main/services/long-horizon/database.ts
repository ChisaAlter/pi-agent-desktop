import { existsSync, mkdirSync, readFileSync, renameSync, createReadStream } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import log from "electron-log/main";
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

// Build an FTS5 MATCH expression from a free-form user query.
//
// Splits the query into Unicode word tokens (contiguous runs of letters,
// numbers, and underscore), phrase-quotes each token (neutralizing FTS5
// special characters like `*`, `(`, `)`, `:`, `"`, etc.), and OR-joins them
// so BM25 can rank by how many/how-rare the matched tokens are.
//
// Returns `null` when no usable tokens are extracted. Callers must treat
// `null` as "empty query, no results" without sending the query to MATCH
// (an empty MATCH expression is a syntax error).
function sanitizeFtsQuery(raw: string): string | null {
    const tokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map((t) => t.trim()).filter(Boolean) ?? [];
    if (tokens.length === 0) return null;
    return tokens.map((t) => `"${t.replaceAll('"', "")}"`).join(" OR ");
}

function rowToMemory(row: Record<string, unknown>): LongHorizonMemoryRecord {
    let tags: string[] | undefined;
    if (typeof row.tags_json === "string" && row.tags_json) {
        try {
            tags = JSON.parse(row.tags_json) as string[];
        } catch {
            // Corrupt tags_json — fall back to undefined rather than throwing
            // and dropping the rest of the record.
            tags = undefined;
        }
    }
    return {
        id: String(row.id),
        scope: row.scope as MemoryScope,
        layer: row.layer as LongHorizonMemoryLayer,
        kind: row.kind as MemoryKind,
        text: String(row.text),
        parentId: typeof row.parent_id === "string" && row.parent_id ? row.parent_id : undefined,
        workspaceId: typeof row.workspace_id === "string" && row.workspace_id ? row.workspace_id : undefined,
        sessionId: typeof row.session_id === "string" && row.session_id ? row.session_id : undefined,
        tags,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at ?? row.created_at),
        score: typeof row.score === "number" ? row.score : undefined,
    };
}

function mapStatusDbToLegacy(status: string): LongHorizonTaskRecord["status"] {
    switch (status) {
        case "open": return "pending";
        case "in_progress": return "running";
        case "blocked": return "blocked";
        case "done": return "completed";
        case "abandoned": return "failed";
        default: return status as LongHorizonTaskRecord["status"];
    }
}

function mapStatusLegacyToDb(status: LongHorizonTaskRecord["status"]): string {
    switch (status) {
        case "pending": return "open";
        case "running": return "in_progress";
        case "completed": return "done";
        case "failed": return "abandoned";
        case "waiting": return "blocked";
        case "blocked": return "blocked";
        default: return status;
    }
}

function rowToTask(row: Record<string, unknown>): LongHorizonTaskRecord {
    return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        agentId: typeof row.agent_id === "string" && row.agent_id ? row.agent_id : undefined,
        source: row.source as "goal" | "plan",
        text: String(row.summary),
        status: mapStatusDbToLegacy(String(row.status)),
        ordinal: Number(row.ordinal),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.last_event_at),
    };
}

export class LongHorizonDatabase {
    private readonly db: DatabaseSync;
    private readonly dbPath: string;

    constructor(rootDir: string) {
        mkdirSync(rootDir, { recursive: true });
        this.dbPath = join(rootDir, "long-horizon.db");
        mkdirSync(dirname(this.dbPath), { recursive: true });
        this.db = this.openHealthyDatabase();
        this.migrate();
    }

    private openHealthyDatabase(): DatabaseSync {
        let candidate: DatabaseSync | undefined;
        try {
            candidate = new DatabaseSync(this.dbPath);
            const rows = candidate.prepare("PRAGMA quick_check;").all() as Array<{ quick_check?: unknown }>;
            if (rows.length === 0 || rows.some((row) => row.quick_check !== "ok")) {
                throw new Error(`SQLite quick_check failed: ${JSON.stringify(rows)}`);
            }
            return candidate;
        } catch (error) {
            try {
                candidate?.close();
            } catch {
                // Best effort: the invalid handle may already be unusable.
            }
            const backupPath = this.backupCorruptDatabase();
            log.error("[long-horizon] corrupt database recovered:", {
                databasePath: this.dbPath,
                backupPath,
                error,
            });
            return new DatabaseSync(this.dbPath);
        }
    }

    private backupCorruptDatabase(): string {
        let timestamp = Date.now();
        let backupPath = `${this.dbPath}.corrupt-${timestamp}`;
        while (existsSync(backupPath)) {
            timestamp += 1;
            backupPath = `${this.dbPath}.corrupt-${timestamp}`;
        }
        for (const suffix of ["", "-wal", "-shm"]) {
            const source = `${this.dbPath}${suffix}`;
            if (existsSync(source)) renameSync(source, `${backupPath}${suffix}`);
        }
        return backupPath;
    }

    private async yieldToEventLoop(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    async close(): Promise<void> {
        await this.yieldToEventLoop();
        try {
            this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch {
            // Database may be in a bad state; ignore checkpoint failure so
            // close() still best-effort releases the handle.
        }
        this.db.close();
    }

    get path(): string {
        return this.dbPath;
    }

    /**
     * Returns the underlying DatabaseSync handle. Exposed so sibling services
     * (e.g. TaskRegistry) can run their own transactions against the same
     * connection without re-opening the file.
     */
    getDb(): DatabaseSync {
        return this.db;
    }

    checkHealth(): { ok: boolean; details: string[] } {
        try {
            const rows = this.db.prepare("PRAGMA quick_check;").all() as Array<Record<string, unknown>>;
            const details = rows.map((row) => String(row.quick_check ?? Object.values(row)[0] ?? "unknown"));
            return { ok: details.length > 0 && details.every((item) => item === "ok"), details };
        } catch (error) {
            return { ok: false, details: [error instanceof Error ? error.message : String(error)] };
        }
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
        // FTS5 trigram tokenizer handles raw text directly — no pre-tokenization.
        // Tags remain in `memories.tags_json` for structured access only.
        const searchText = record.text;
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
        const trimmed = query.trim();
        if (!trimmed) return [];
        const memoryHits = this.searchLayered(trimmed, options, false);
        if (memoryHits.length > 0 || !options.includeHistoryFallback) return memoryHits;
        return this.searchLayered(trimmed, options, true);
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
            this.db.prepare("DELETE FROM task WHERE workspace_id = ? AND agent_key = ? AND source = ?")
                .run(workspaceId, agentKey(agentId), source);
            const insert = this.db.prepare(`
                INSERT INTO task (
                    id, session_id, parent_task_id, status, summary, owner,
                    created_at, last_event_at, ended_at, cleanup_after,
                    source, workspace_id, agent_id, agent_key, ordinal
                ) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
            `);
            for (const [index, item] of items.entries()) {
                insert.run(
                    item.id,
                    workspaceId,
                    mapStatusLegacyToDb(item.status),
                    item.text,
                    now,
                    now,
                    source,
                    workspaceId,
                    agentId ?? null,
                    agentKey(agentId),
                    index,
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
            FROM task
            WHERE workspace_id = ?1
              AND (agent_key = ?2 OR (?3 = 1 AND agent_key = '__default__'))
            ORDER BY CASE source WHEN 'goal' THEN 0 ELSE 1 END, ordinal ASC, last_event_at DESC
        `).all(
            input.workspaceId,
            agentKey(input.agentId),
            input.agentId ? 0 : 1,
        ) as Array<Record<string, unknown>>;
        return rows.map(rowToTask);
    }

    async getActiveTask(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord | null> {
        await this.yieldToEventLoop();
        // Direct LIMIT 1 query instead of loading all tasks and filtering in JS.
        // DB statuses are normalized via mapStatusLegacyToDb on write; the
        // legacy "running"/"pending" map to "in_progress"/"open". "waiting"
        // and the raw legacy values are included defensively in case any
        // caller bypassed the normalizer. Ordering matches listTasks so the
        // "first" active task is the same one find() would have returned.
        const row = this.db.prepare(`
            SELECT *
            FROM task
            WHERE workspace_id = ?1
              AND (agent_key = ?2 OR (?3 = 1 AND agent_key = '__default__'))
              AND status IN ('in_progress', 'open', 'running', 'pending', 'waiting')
            ORDER BY CASE source WHEN 'goal' THEN 0 ELSE 1 END, ordinal ASC, last_event_at DESC
            LIMIT 1
        `).get(
            input.workspaceId,
            agentKey(input.agentId),
            input.agentId ? 0 : 1,
        ) as Record<string, unknown> | undefined;
        return row ? rowToTask(row) : null;
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
                // FTS5 trigram tokenizer handles raw text directly — no pre-tokenization.
                const searchText = record.text;
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

        // Single recursive CTE fetches the entire subtree in one query (was
        // N+1: one query per node). The tree_depth column limits recursion to
        // maxDepth levels, preventing infinite loops on cyclic parent_id
        // references. The visited set (populated above and during assembly
        // below) prunes back-edges so each node appears at most once in the
        // assembled tree — matching the previous recursive behavior.
        const rows = this.db.prepare(`
            WITH RECURSIVE tree AS (
                SELECT *, 0 AS tree_depth FROM memories WHERE id = ?
                UNION ALL
                SELECT m.*, t.tree_depth + 1 FROM memories m
                JOIN tree t ON m.parent_id = t.id
                WHERE t.tree_depth < ?
            )
            SELECT * FROM tree ORDER BY tree_depth ASC, created_at ASC
        `).all(record.id, maxDepth) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
            return { record, children: [] };
        }

        // Build parentId → children[] map from the flat CTE result. Dedupe
        // children by id since UNION ALL can emit duplicates when cycles
        // exist (the depth cap stops recursion, but duplicate parent→child
        // edges may still appear in the flat set).
        const childrenByParent = new Map<string, LongHorizonMemoryRecord[]>();
        for (const row of rows) {
            const rec = rowToMemory(row);
            if (!rec.parentId) continue;
            const siblings = childrenByParent.get(rec.parentId);
            if (siblings) {
                if (!siblings.some((s) => s.id === rec.id)) {
                    siblings.push(rec);
                }
            } else {
                childrenByParent.set(rec.parentId, [rec]);
            }
        }

        // Assemble the tree in JS from the flat map, using visited to guard
        // against cycles (a node already seen under another branch is pruned).
        const assemble = (
            node: LongHorizonMemoryRecord,
        ): { record: LongHorizonMemoryRecord; children: Array<{ record: LongHorizonMemoryRecord; children: unknown[] }> } => {
            const childRecords = childrenByParent.get(node.id) ?? [];
            const children = childRecords
                .filter((child) => {
                    if (visited.has(child.id)) return false;
                    visited.add(child.id);
                    return true;
                })
                .map((child) => assemble(child));
            return { record: node, children };
        };

        return assemble(record);
    }

    private searchLayered(query: string, options: MemorySearchOptions, historyOnly: boolean): LongHorizonMemoryRecord[] {
        const limit = Math.max(1, Math.min((options.limit ?? 8) * 3, 50));
        const ftsQuery = sanitizeFtsQuery(query);
        if (ftsQuery === null) return [];

        const wsFilter = options.workspaceId ?? null;
        const sessFilter = options.sessionId ?? null;
        const historyFlag = historyOnly ? 1 : 0;

        // The trigram tokenizer cannot match queries shorter than 3 characters.
        // Fall back to a LIKE substring scan on `memories.text` so short CJK
        // queries (e.g. "数", "数据") still return results. LIKE results carry
        // a constant score (1.0); the relative score-floor filter below treats
        // them uniformly.
        let rows: Array<Record<string, unknown>>;
        if (query.length < 3) {
            const escaped = query.replace(/[%_\\]/g, "\\$&");
            rows = this.db.prepare(`
                SELECT m.*, 1.0 AS score
                FROM memories m
                WHERE m.text LIKE ?1 ESCAPE '\\'
                  AND (?2 IS NULL OR m.workspace_id = ?2 OR m.workspace_id IS NULL OR m.workspace_id = '')
                  AND (?3 IS NULL OR m.session_id = ?3 OR m.session_id IS NULL OR m.session_id = '')
                  AND (CASE WHEN ?4 = 1 THEN m.kind = 'history' ELSE m.kind <> 'history' END)
                ORDER BY m.created_at DESC
                LIMIT ?5
            `).all(`%${escaped}%`, wsFilter, sessFilter, historyFlag, limit) as Array<Record<string, unknown>>;
        } else {
            rows = this.db.prepare(`
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
            `).all(ftsQuery, wsFilter, sessFilter, historyFlag, limit) as Array<Record<string, unknown>>;
        }

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
        // PRAGMAs that affect connection behavior — must be outside transactions.
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA foreign_keys = ON;");
        // Bound WAL growth without taking an exclusive checkpoint lock during startup.
        // close() still performs a best-effort TRUNCATE checkpoint on clean shutdown.
        this.db.exec("PRAGMA wal_autocheckpoint = 1000;");

        // Base schema (memories / goals) — always created, idempotent.
        this.db.exec(`
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

        // user_version gates incremental schema migrations.
        const versionRow = this.db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
        const userVersion = Number(versionRow?.user_version ?? 0);

        // ---- v2: task schema rewrite ----
        if (userVersion < 2) {
        this.db.exec("BEGIN;");
        try {
            // Stage the new task + task_event tables under temporary names so the
            // legacy `tasks` table can keep serving reads until cutover. The FK on
            // task_event targets `task_new` (pre-rename); after `ALTER TABLE ...
            // RENAME TO task` SQLite updates the reference automatically when
            // foreign_keys is ON.
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS task_new (
                    id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    parent_task_id TEXT,
                    status TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    owner TEXT,
                    created_at INTEGER NOT NULL,
                    last_event_at INTEGER NOT NULL,
                    ended_at INTEGER,
                    cleanup_after INTEGER,
                    source TEXT,
                    workspace_id TEXT,
                    agent_id TEXT,
                    agent_key TEXT,
                    ordinal INTEGER,
                    PRIMARY KEY (session_id, id)
                );
                CREATE TABLE IF NOT EXISTS task_event (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    at INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    summary TEXT,
                    FOREIGN KEY (session_id, task_id) REFERENCES task_new(session_id, id) ON DELETE CASCADE
                );
            `);

            // Migrate legacy `tasks` rows if present. Each (workspace_id, source,
            // ordinal) becomes ('T' || (ordinal+1)) keyed by session_id=workspace_id.
            // INSERT OR IGNORE handles cross-source T<n> collisions (e.g. goal-T1 +
            // plan-T1 in the same workspace) by keeping the first row encountered.
            const legacy = this.db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
            ).get() as { name?: string } | undefined;

            if (legacy?.name === "tasks") {
                this.db.exec(`
                    INSERT OR IGNORE INTO task_new (
                        id, session_id, parent_task_id, status, summary, owner,
                        created_at, last_event_at, ended_at, cleanup_after,
                        source, workspace_id, agent_id, agent_key, ordinal
                    )
                    SELECT
                        'T' || (ordinal + 1),
                        workspace_id,
                        NULL,
                        CASE status
                            WHEN 'pending' THEN 'open'
                            WHEN 'running' THEN 'in_progress'
                            WHEN 'completed' THEN 'done'
                            WHEN 'failed' THEN 'blocked'
                            WHEN 'blocked' THEN 'blocked'
                            ELSE 'open'
                        END,
                        text,
                        NULL,
                        created_at,
                        updated_at,
                        CASE
                            WHEN CASE status
                                WHEN 'pending' THEN 'open'
                                WHEN 'running' THEN 'in_progress'
                                WHEN 'completed' THEN 'done'
                                WHEN 'failed' THEN 'blocked'
                                WHEN 'blocked' THEN 'blocked'
                                ELSE 'open'
                            END IN ('done', 'abandoned')
                            THEN updated_at
                            ELSE NULL
                        END,
                        NULL,
                        source,
                        workspace_id,
                        agent_id,
                        agent_key,
                        ordinal
                    FROM tasks
                    ORDER BY workspace_id, source, ordinal;

                    INSERT INTO task_event (session_id, task_id, at, kind, summary)
                    SELECT session_id, id, created_at, 'created', summary
                    FROM task_new
                    WHERE source IS NOT NULL;

                    DROP TABLE IF EXISTS tasks;
                `);
            }

            this.db.exec("ALTER TABLE task_new RENAME TO task;");

            this.db.exec(`
                CREATE INDEX IF NOT EXISTS task_session_idx ON task(session_id);
                CREATE INDEX IF NOT EXISTS task_parent_idx ON task(session_id, parent_task_id);
                CREATE INDEX IF NOT EXISTS task_status_idx ON task(status);
                CREATE INDEX IF NOT EXISTS task_scope_idx ON task(workspace_id, agent_key, source, ordinal);
                CREATE INDEX IF NOT EXISTS task_event_task_idx ON task_event(session_id, task_id, at);
            `);

            // Verify FK integrity post-rename (read-only PRAGMA, safe in-transaction).
            const fkViolations = this.db.prepare("PRAGMA foreign_key_check;").all();
            if (fkViolations.length > 0) {
                throw new Error(
                    `Foreign key violations detected after task schema migration: ${JSON.stringify(fkViolations)}`
                );
            }

            this.db.exec("COMMIT;");
        } catch (err) {
            try {
                this.db.exec("ROLLBACK;");
            } catch {
                // Ignore rollback failure — original error is more important.
            }
            throw err;
        }

        // PRAGMA user_version must be issued outside a transaction.
        this.db.exec("PRAGMA user_version = 2;");
        }

        // ---- v3: FTS5 trigram tokenizer ----
        // Replaces the legacy `memory_fts` (default unicode61 + hand-written
        // pre-tokenized `search_text`) with a trigram-tokenizer table populated
        // from raw `memories.text`. DROP + CREATE is required because tokenizer
        // is fixed at table-creation time. Re-indexing all existing rows from
        // `memories` preserves searchability.
        if (userVersion < 3) {
            this.db.exec("BEGIN;");
            try {
                this.db.exec("DROP TABLE IF EXISTS memory_fts;");
                this.db.exec(`
                    CREATE VIRTUAL TABLE memory_fts USING fts5(
                        id UNINDEXED,
                        search_text,
                        kind UNINDEXED,
                        layer UNINDEXED,
                        workspace_id UNINDEXED,
                        session_id UNINDEXED,
                        tokenize='trigram'
                    );
                `);
                this.db.exec(`
                    INSERT INTO memory_fts (id, search_text, kind, layer, workspace_id, session_id)
                    SELECT id, text, kind, layer, COALESCE(workspace_id, ''), COALESCE(session_id, '')
                    FROM memories;
                `);
                this.db.exec("COMMIT;");
            } catch (err) {
                try {
                    this.db.exec("ROLLBACK;");
                } catch {
                    // Ignore rollback failure — original error is more important.
                }
                throw err;
            }
            // PRAGMA user_version must be issued outside a transaction.
            this.db.exec("PRAGMA user_version = 3;");
        }
    }
}
