/**
 * markdown-index.ts — SQLite FTS5 external-content index for markdown memory files.
 *
 * Architecture (ported from MiMo Code with one deliberate divergence):
 *
 *   1. Main table `memory_fts` holds the canonical row: (path, scope, scope_id,
 *      type, body, fingerprint, last_indexed_at). Path is UNIQUE so reconcile
 *      can upsert by path.
 *
 *   2. FTS5 virtual table `memory_fts_idx` is external-content mode
 *      (`content='memory_fts'`, `content_rowid='id'`). The virtual table holds
 *      NO data of its own — it's an inverted index pointing back at the main
 *      table's `body` column. Three triggers (ai/ad/au) keep them in sync.
 *
 *   3. Tokenizer: **trigram** (NOT unicode61 like MiMo Code). Trigram is
 *      essential for CJK — Chinese text has no word boundaries that unicode61
 *      can split on, so unicode61 would treat a whole paragraph as one token.
 *      Trigram tokenises into 3-char sliding windows, giving substring match
 *      for Chinese (and any language).
 *
 *   4. Triggers use the `'delete'` magic command for DELETE/UPDATE on the
 *      vtab. This is the **external-content mode** syntax (NOT the contentless
 *      mode `DELETE FROM vtab WHERE rowid=...`). The v6.1 fix in MiMo Code
 *      `migration/20260521020000_memory_fts_triggers/migration.sql` is the
 *      reference — older versions used the wrong syntax and corrupted the
 *      index over time.
 *
 *   5. Search SQL mirrors MiMo Code's `service.ts:102-117`:
 *        - `bm25(memory_fts_idx)` returns lower=better (negative); we negate
 *          so higher=better for callers.
 *        - `snippet(memory_fts_idx, 0, '<<', '>>', '...', 32)` for highlighted
 *          context windows.
 *        - Over-fetch 3x (cap 50), apply RELATIVE score floor (topScore × ratio,
 *          top hit always kept), then slice to `limit`. The relative floor is
 *          required because BM25 magnitudes depend on corpus size — an absolute
 *          floor would starve small corpora.
 *
 * `MarkdownIndex` implements `ReconcileDatabase` so it slots directly into
 * `reconcileMemory()`. It also exposes `search()` and `getByPath()` for the
 * memory service.
 *
 * Uses `node:sqlite` `DatabaseSync` (synchronous) — same driver as the
 * existing `LongHorizonDatabase`. All async methods `await yieldToEventLoop()`
 * first to keep the event loop responsive during bulk reconcile.
 */

import { mkdirSync } from "fs";
import { dirname } from "path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryLocator } from "./paths";
import type { ReconcileDatabase } from "./reconcile";

export interface MarkdownIndexOptions {
    /** Absolute path to the SQLite index file (will be created if missing). */
    dbPath: string;
}

export interface MemorySearchHit {
    /** Absolute path of the markdown file on disk. */
    path: string;
    scope: MemoryLocator["scope"];
    scopeId: string;
    type: MemoryLocator["type"];
    /** Highlighted context window from FTS5 snippet(). */
    snippet: string;
    /** BM25 score, negated so higher = better. */
    score: number;
}

export interface MemorySearchFilters {
    scope?: MemoryLocator["scope"];
    scopeId?: string;
    type?: MemoryLocator["type"];
}

export interface MemorySearchOptions {
    /** Maximum number of results to return (after score-floor filtering). */
    limit?: number;
    /**
     * Relative BM25 score floor in [0, 1]. Results scoring below
     * `topScore * scoreFloor` are dropped, EXCEPT the top hit which is always
     * kept. Set 0 to disable. Default 0.15 (matches MiMo Code).
     */
    scoreFloor?: number;
}

export interface IndexedMemoryRow {
    path: string;
    scope: MemoryLocator["scope"];
    scopeId: string;
    type: MemoryLocator["type"];
    body: string;
    fingerprint: string;
    lastIndexedAt: number;
}

interface SearchRow {
    path: string;
    scope: string;
    scope_id: string;
    type: string;
    snippet: string;
    score: number;
}

interface IndexedRow {
    path: string;
    scope: string;
    scope_id: string;
    type: string;
    body: string;
    fingerprint: string;
    last_indexed_at: number;
}

const DEFAULT_SCORE_FLOOR = 0.15;
const SNIPPET_TOKENS = 32;
const OVERFETCH_MULTIPLIER = 3;
const OVERFETCH_CAP = 50;

export class MarkdownIndex implements ReconcileDatabase {
    private readonly db: DatabaseSync;

    constructor(opts: MarkdownIndexOptions) {
        mkdirSync(dirname(opts.dbPath), { recursive: true });
        this.db = new DatabaseSync(opts.dbPath);
        this.migrate();
    }

    private async yieldToEventLoop(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    close(): void {
        this.db.close();
    }

    getDb(): DatabaseSync {
        return this.db;
    }

    private migrate(): void {
        // Main table — canonical row for each indexed markdown file.
        // `path` is UNIQUE so reconcile can upsert by path. `scope_id` defaults
        // to '' because global scope has no scopeId.
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memory_fts (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                scope TEXT NOT NULL,
                scope_id TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL,
                body TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                last_indexed_at INTEGER NOT NULL
            );
        `);
        this.db.exec(
            `CREATE INDEX IF NOT EXISTS memory_fts_scope_idx ON memory_fts (scope, scope_id);`,
        );
        this.db.exec(
            `CREATE INDEX IF NOT EXISTS memory_fts_type_idx ON memory_fts (type);`,
        );

        // FTS5 virtual table — external-content mode pointing at memory_fts.
        // Trigram tokenizer (CJK-friendly). content_rowid='id' wires the
        // vtab's rowid to the main table's primary key.
        this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts_idx USING fts5(
                body,
                content='memory_fts',
                content_rowid='id',
                tokenize='trigram'
            );
        `);

        // Triggers — DROP IF EXISTS first because we may re-run migrate() on
        // an existing DB and CREATE TRIGGER IF NOT EXISTS would skip the
        // update if the trigger body changed in a new release.
        //
        // CRITICAL: DELETE/UPDATE use the 'delete' magic command (the first
        // column of the values clause is the literal string 'delete'). This
        // is the external-content mode syntax. Using `DELETE FROM
        // memory_fts_idx WHERE rowid=...` is the contentless mode syntax and
        // WILL corrupt the index over time (tokens accumulate but the row
        // disappears, so subsequent 'delete' commands can't find the row to
        // remove). MiMo Code's v6.1 fix in
        // `migration/20260521020000_memory_fts_triggers/migration.sql` is the
        // reference.
        this.db.exec(`
            DROP TRIGGER IF EXISTS memory_fts_ai;
            DROP TRIGGER IF EXISTS memory_fts_ad;
            DROP TRIGGER IF EXISTS memory_fts_au;

            CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory_fts BEGIN
                INSERT INTO memory_fts_idx(rowid, body) VALUES (NEW.id, NEW.body);
            END;
            CREATE TRIGGER memory_fts_ad AFTER DELETE ON memory_fts BEGIN
                INSERT INTO memory_fts_idx(memory_fts_idx, rowid, body)
                    VALUES ('delete', OLD.id, OLD.body);
            END;
            CREATE TRIGGER memory_fts_au AFTER UPDATE ON memory_fts BEGIN
                INSERT INTO memory_fts_idx(memory_fts_idx, rowid, body)
                    VALUES ('delete', OLD.id, OLD.body);
                INSERT INTO memory_fts_idx(rowid, body) VALUES (NEW.id, NEW.body);
            END;
        `);
    }

    // ─── ReconcileDatabase implementation ──────────────────────────────────

    async loadIndexedPaths(): Promise<Map<string, string>> {
        await this.yieldToEventLoop();
        const rows = this.db
            .prepare("SELECT path, fingerprint FROM memory_fts")
            .all() as unknown as Array<{ path: string; fingerprint: string }>;
        const map = new Map<string, string>();
        for (const row of rows) {
            map.set(row.path, row.fingerprint);
        }
        return map;
    }

    async upsertIndex(input: {
        path: string;
        scope: MemoryLocator["scope"];
        scopeId?: string;
        type: MemoryLocator["type"];
        body: string;
        fingerprint: string;
    }): Promise<void> {
        await this.yieldToEventLoop();
        // INSERT ... ON CONFLICT(path) DO UPDATE — the AFTER INSERT trigger
        // populates the FTS vtab for new rows; the AFTER UPDATE trigger
        // swaps the vtab content for updated rows. We never touch
        // memory_fts_idx directly.
        this.db
            .prepare(
                `INSERT INTO memory_fts (path, scope, scope_id, type, body, fingerprint, last_indexed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(path) DO UPDATE SET
                     scope = excluded.scope,
                     scope_id = excluded.scope_id,
                     type = excluded.type,
                     body = excluded.body,
                     fingerprint = excluded.fingerprint,
                     last_indexed_at = excluded.last_indexed_at`,
            )
            .run(
                input.path,
                input.scope,
                input.scopeId ?? "",
                input.type,
                input.body,
                input.fingerprint,
                Date.now(),
            );
    }

    async deleteIndex(path: string): Promise<void> {
        await this.yieldToEventLoop();
        // DELETE from the main table; the AFTER DELETE trigger removes the
        // vtab tokens via the 'delete' magic command.
        this.db.prepare("DELETE FROM memory_fts WHERE path = ?").run(path);
    }

    // ─── Search ────────────────────────────────────────────────────────────

    /**
     * Search indexed memory bodies via FTS5 BM25.
     *
     * Flow (mirrors MiMo Code `service.ts:102-133`):
     *   1. Build WHERE clause from filters (scope/scopeId/type)
     *   2. Over-fetch 3× limit (capped at 50) to give the relative floor
     *      room to drop noise without starving the result list
     *   3. ORDER BY bm25(memory_fts_idx) ASC — FTS5 bm25 is negative, lower
     *      = better match
     *   4. Negate scores so higher = better for callers
     *   5. Apply RELATIVE score floor: drop rows scoring below
     *      `topScore * scoreFloor`, but always keep the top hit
     *   6. Slice to `limit`
     *
     * `ftsQuery` must already be a valid FTS5 MATCH expression — use
     * `buildFtsQuery()` to build it from a free-form user string. Pass
     * `null`/empty to short-circuit (returns []).
     */
    async search(
        ftsQuery: string | null,
        filters: MemorySearchFilters,
        options: MemorySearchOptions = {},
    ): Promise<MemorySearchHit[]> {
        await this.yieldToEventLoop();
        if (!ftsQuery || !ftsQuery.trim()) return [];

        const limit = Math.max(1, options.limit ?? 10);
        const scoreFloor =
            options.scoreFloor === undefined
                ? DEFAULT_SCORE_FLOOR
                : Math.max(0, options.scoreFloor);

        const conditions: string[] = [];
        const params: Array<string | number> = [ftsQuery];

        if (filters.scope) {
            conditions.push("memory_fts.scope = ?");
            params.push(filters.scope);
        }
        if (filters.scopeId !== undefined) {
            conditions.push("memory_fts.scope_id = ?");
            params.push(filters.scopeId);
        }
        if (filters.type) {
            conditions.push("memory_fts.type = ?");
            params.push(filters.type);
        }
        const whereClause =
            conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

        // Over-fetch so the relative floor has room to drop noise.
        const fetchLimit = Math.min(limit * OVERFETCH_MULTIPLIER, OVERFETCH_CAP);
        params.push(fetchLimit);

        const sql = `
            SELECT memory_fts.path        AS path,
                   memory_fts.scope      AS scope,
                   memory_fts.scope_id    AS scope_id,
                   memory_fts.type        AS type,
                   snippet(memory_fts_idx, 0, '<<', '>>', '...', ${SNIPPET_TOKENS}) AS snippet,
                   bm25(memory_fts_idx)   AS score
            FROM memory_fts_idx
            JOIN memory_fts ON memory_fts.id = memory_fts_idx.rowid
            WHERE memory_fts_idx MATCH ?
            ${whereClause}
            ORDER BY score
            LIMIT ?
        `;

        const rows = this.db.prepare(sql).all(...params) as unknown as SearchRow[];

        // FTS5 bm25() returns negative; lower = better. Negate so higher = better.
        const mapped: MemorySearchHit[] = rows.map((r) => ({
            path: r.path,
            scope: r.scope as MemoryLocator["scope"],
            scopeId: r.scope_id,
            type: r.type as MemoryLocator["type"],
            snippet: r.snippet ?? "",
            score: -r.score,
        }));

        if (mapped.length === 0) return [];

        // Relative floor: top hit is always kept; drop rows below
        // topScore * floorRatio. floor=0 disables (keeps all). The relative
        // floor is required because BM25 magnitudes depend on corpus size —
        // an absolute floor would starve small corpora.
        const topScore = mapped[0].score;
        const cutoff = scoreFloor > 0 ? topScore * scoreFloor : -Infinity;
        return mapped
            .filter((r, i) => i === 0 || r.score >= cutoff)
            .slice(0, limit);
    }

    // ─── Read ──────────────────────────────────────────────────────────────

    /** Fetch a single indexed row by path. Returns null if not indexed. */
    async getByPath(path: string): Promise<IndexedMemoryRow | null> {
        await this.yieldToEventLoop();
        const row = this.db
            .prepare(
                `SELECT path, scope, scope_id, type, body, fingerprint, last_indexed_at
                 FROM memory_fts WHERE path = ?`,
            )
            .get(path) as unknown as IndexedRow | undefined;
        if (!row) return null;
        return {
            path: row.path,
            scope: row.scope as MemoryLocator["scope"],
            scopeId: row.scope_id,
            type: row.type as MemoryLocator["type"],
            body: row.body,
            fingerprint: row.fingerprint,
            lastIndexedAt: row.last_indexed_at,
        };
    }

    /** Count indexed entries (useful for diagnostics). */
    async count(): Promise<number> {
        await this.yieldToEventLoop();
        const row = this.db
            .prepare("SELECT COUNT(*) AS count FROM memory_fts")
            .get() as unknown as { count: number };
        return row.count;
    }
}
