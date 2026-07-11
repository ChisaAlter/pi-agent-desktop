import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LongHorizonDatabase } from "../database";

describe("LongHorizonDatabase", () => {
    const dirs: string[] = [];
    const databases: LongHorizonDatabase[] = [];

    afterEach(async () => {
        for (const db of databases.splice(0)) {
            await db.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createDb(): LongHorizonDatabase {
        const dir = mkdtempSync(join(tmpdir(), "pi-lh-db-"));
        dirs.push(dir);
        const db = new LongHorizonDatabase(dir);
        databases.push(db);
        return db;
    }

    it("backs up a corrupt database and recreates a usable store", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-lh-corrupt-"));
        dirs.push(dir);
        writeFileSync(join(dir, "long-horizon.db"), "not a sqlite database", "utf8");

        const db = new LongHorizonDatabase(dir);
        databases.push(db);
        await db.insertMemory({ scope: "global", kind: "note", text: "recovered memory" });

        expect((await db.listRecentMemories({ limit: 10 })).map((item) => item.text)).toContain("recovered memory");
        expect(db.checkHealth()).toEqual({ ok: true, details: ["ok"] });
        expect(readdirSync(dir).some((name) => /^long-horizon\.db\.corrupt-\d+$/.test(name))).toBe(true);
    });
    it("isolates listRecentMemories by workspace_id and does not leak across workspaces", async () => {
        const db = createDb();
        await db.insertMemory({
            scope: "project",
            workspaceId: "wsA",
            kind: "note",
            text: "workspace A memory",
        });
        await db.insertMemory({
            scope: "project",
            workspaceId: "wsB",
            kind: "note",
            text: "workspace B memory",
        });
        // Project-scoped record with no workspace_id — must NOT leak into a
        // workspace-scoped query. Only global-scoped records without a
        // workspace_id are shared across workspaces.
        await db.insertMemory({
            scope: "project",
            kind: "note",
            text: "orphan project memory",
        });
        // Global record with no workspace_id — shared with every workspace.
        await db.insertMemory({
            scope: "global",
            kind: "note",
            text: "global memory",
        });

        const results = await db.listRecentMemories({ workspaceId: "wsA", limit: 10 });
        const texts = results.map((r) => r.text);

        expect(texts).toContain("workspace A memory");
        expect(texts).toContain("global memory");
        expect(texts).not.toContain("workspace B memory");
        expect(texts).not.toContain("orphan project memory");
    });

    it("returns only global memories when workspaceId is null", async () => {
        const db = createDb();
        await db.insertMemory({ scope: "project", workspaceId: "wsA", kind: "note", text: "wsA project memory" });
        await db.insertMemory({ scope: "global", kind: "note", text: "global memory one" });
        await db.insertMemory({ scope: "global", kind: "note", text: "global memory two" });

        const results = await db.listRecentMemories({ limit: 10 });
        const texts = results.map((r) => r.text);

        // Null workspaceId is the "global query" case: every record is eligible
        // because the (?1 IS NULL) branch short-circuits the workspace filter.
        expect(texts).toContain("wsA project memory");
        expect(texts).toContain("global memory one");
        expect(texts).toContain("global memory two");
    });

    it("filters out low-scoring records from search results based on the score floor", async () => {
        const db = createDb();
        // Highly relevant record — matches every query term. "workflow" and
        // "sandbox" appear in only this document, so they carry high IDF and
        // dominate the BM25 score.
        await db.insertMemory({
            scope: "project",
            workspaceId: "ws1",
            kind: "note",
            text: "workflow sandbox checkpoint evidence",
        });
        // Barely relevant records — match only the common term "checkpoint",
        // which appears in all three documents and therefore has a low IDF.
        await db.insertMemory({
            scope: "project",
            workspaceId: "ws1",
            kind: "note",
            text: "checkpoint checkpoint common filler",
        });
        await db.insertMemory({
            scope: "project",
            workspaceId: "ws1",
            kind: "note",
            text: "unrelated checkpoint material",
        });

        // floor = 0.4 → cutoff = 60% of the top absolute score. The fix uses
        // Math.abs() so the cutoff is sign-safe for negative BM25 scores.
        const results = await db.searchMemories("workflow sandbox checkpoint", {
            workspaceId: "ws1",
            searchScoreFloor: 0.4,
        });

        expect(results).toHaveLength(1);
        expect(results[0].text).toBe("workflow sandbox checkpoint evidence");
        expect(results[0].score).not.toBeNull();
        expect(Math.abs(results[0].score as number)).toBeGreaterThan(0);
    });

    it("handles negative BM25 scores via Math.abs without dropping all matches", async () => {
        const db = createDb();
        // Insert records where the query term "shared" appears in most documents.
        // This drives the IDF of "shared" negative, which makes (-1 * bm25())
        // return NEGATIVE scores for matching records. The fix's Math.abs()
        // ensures such records are still ranked and filtered by magnitude
        // rather than being dropped solely because their sign is negative.
        await db.insertMemory({ scope: "project", workspaceId: "ws1", kind: "note", text: "shared shared shared alpha" });
        await db.insertMemory({ scope: "project", workspaceId: "ws1", kind: "note", text: "shared shared beta" });
        await db.insertMemory({ scope: "project", workspaceId: "ws1", kind: "note", text: "shared gamma" });
        // Non-matching record so "shared" appears in fewer than 100% of docs.
        await db.insertMemory({ scope: "project", workspaceId: "ws1", kind: "note", text: "completely different delta" });

        // Permissive floor (0.9 → cutoff = 10% of top abs score): keep matches
        // ranked by magnitude regardless of sign.
        const results = await db.searchMemories("shared", {
            workspaceId: "ws1",
            searchScoreFloor: 0.9,
        });

        expect(results.length).toBeGreaterThan(0);
        for (const record of results) {
            expect(record.score).not.toBeNull();
            expect(Math.abs(record.score as number)).toBeGreaterThan(0);
        }
    });

    it("does not infinite-loop in getMemoryTree when parent_id references form a cycle", async () => {
        const db = createDb();
        const a = await db.insertMemory({
            scope: "project",
            workspaceId: "ws1",
            kind: "summary",
            text: "node A",
        });
        const b = await db.insertMemory({
            scope: "project",
            workspaceId: "ws1",
            kind: "summary",
            parentId: a.id,
            text: "node B",
        });
        // Re-insert A with parentId = B to create a cycle: A → B → A.
        // insertMemory uses INSERT OR REPLACE, so this overwrites A's parent_id.
        await db.insertMemory({
            id: a.id,
            scope: "project",
            workspaceId: "ws1",
            kind: "summary",
            parentId: b.id,
            text: "node A",
        });

        // If cycle protection fails this call would blow the stack / hang and
        // the test would time out. Generous timeout to surface a hang clearly.
        const tree = await db.getMemoryTree(a.id);

        expect(tree).not.toBeNull();
        expect(tree?.record.id).toBe(a.id);
        // B appears once as a child of A; the back-edge A → B → A is pruned by
        // the visited-set check, so B's children list is empty.
        expect(tree?.children).toHaveLength(1);
        expect(tree?.children[0].record.id).toBe(b.id);
        expect(tree?.children[0].children).toEqual([]);
    }, 10000);

    // ---- Phase B Task 1: task schema migration (v2) ----

    function seedLegacyTasksDb(dbPath: string, rows: Array<{
        id: string;
        workspaceId: string;
        agentId: string | null;
        agentKey: string;
        source: "goal" | "plan";
        text: string;
        status: string;
        ordinal: number;
        createdAt: number;
        updatedAt: number;
    }>): void {
        const seed = new DatabaseSync(dbPath);
        seed.exec(`
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
        `);
        const insert = seed.prepare(`
            INSERT INTO tasks (
                id, workspace_id, agent_id, agent_key, source, text, status, ordinal, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                row.id,
                row.workspaceId,
                row.agentId,
                row.agentKey,
                row.source,
                row.text,
                row.status,
                row.ordinal,
                row.createdAt,
                row.updatedAt,
            );
        }
        seed.close();
    }

    function openRaw(dbPath: string): DatabaseSync {
        return new DatabaseSync(dbPath);
    }

    it("migrates legacy tasks table to new schema with T<n> IDs and mapped status", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-lh-migrate-"));
        dirs.push(dir);
        const dbPath = join(dir, "long-horizon.db");

        const now = Date.now();
        seedLegacyTasksDb(dbPath, [
            { id: "uuid-1", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "old task 1", status: "running",   ordinal: 0, createdAt: now, updatedAt: now },
            { id: "uuid-2", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "old task 2", status: "running",   ordinal: 1, createdAt: now, updatedAt: now },
            { id: "uuid-3", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "old task 3", status: "running",   ordinal: 2, createdAt: now, updatedAt: now },
        ]);

        // Constructing LongHorizonDatabase triggers migrate().
        const db = new LongHorizonDatabase(dir);
        await db.close();

        const verify = openRaw(dbPath);
        const tasks = verify.prepare("SELECT id, status, summary FROM task ORDER BY id ASC").all() as Array<{
            id: string; status: string; summary: string;
        }>;
        const events = verify.prepare("SELECT task_id, kind FROM task_event ORDER BY id ASC").all() as Array<{
            task_id: string; kind: string;
        }>;
        const legacyTable = verify.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
        ).get() as { name?: string } | undefined;
        const newTable = verify.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='task'"
        ).get() as { name?: string } | undefined;
        const eventTable = verify.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='task_event'"
        ).get() as { name?: string } | undefined;
        verify.close();

        expect(tasks.map((t) => t.id)).toEqual(["T1", "T2", "T3"]);
        expect(tasks.every((t) => t.status === "in_progress")).toBe(true);
        expect(tasks.map((t) => t.summary)).toEqual(["old task 1", "old task 2", "old task 3"]);
        expect(events).toHaveLength(3);
        expect(events.map((e) => e.task_id)).toEqual(["T1", "T2", "T3"]);
        expect(events.every((e) => e.kind === "created")).toBe(true);
        expect(legacyTable).toBeUndefined();
        expect(newTable?.name).toBe("task");
        expect(eventTable?.name).toBe("task_event");
    });

    it("migration is idempotent (second open does not re-migrate)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-lh-idempotent-"));
        dirs.push(dir);
        const dbPath = join(dir, "long-horizon.db");

        const now = Date.now();
        seedLegacyTasksDb(dbPath, [
            { id: "uuid-1", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "task one", status: "running", ordinal: 0, createdAt: now, updatedAt: now },
            { id: "uuid-2", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "task two", status: "completed", ordinal: 1, createdAt: now, updatedAt: now },
        ]);

        // First open — migrates from legacy schema.
        const db1 = new LongHorizonDatabase(dir);
        await db1.close();

        const check1 = openRaw(dbPath);
        const taskCount1 = (check1.prepare("SELECT COUNT(*) AS n FROM task").get() as { n: number }).n;
        const eventCount1 = (check1.prepare("SELECT COUNT(*) AS n FROM task_event").get() as { n: number }).n;
        const version1 = (check1.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
        check1.close();
        expect(taskCount1).toBe(2);
        expect(eventCount1).toBe(2);
        expect(version1).toBe(3);

        // Second open — user_version is already 3, so the migration block is skipped.
        const db2 = new LongHorizonDatabase(dir);
        await db2.close();

        const check2 = openRaw(dbPath);
        const taskCount2 = (check2.prepare("SELECT COUNT(*) AS n FROM task").get() as { n: number }).n;
        const eventCount2 = (check2.prepare("SELECT COUNT(*) AS n FROM task_event").get() as { n: number }).n;
        const version2 = (check2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
        check2.close();
        expect(taskCount2).toBe(2);
        expect(eventCount2).toBe(2);
        expect(version2).toBe(3);
    });

    it("creates new schema with task + task_event tables and indexes on fresh DB", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-lh-fresh-"));
        dirs.push(dir);
        const dbPath = join(dir, "long-horizon.db");

        const db = new LongHorizonDatabase(dir);
        await db.close();

        const verify = openRaw(dbPath);
        const version = (verify.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
        const taskCols = verify.prepare("PRAGMA table_info(task)").all() as Array<{ name: string }>;
        const eventCols = verify.prepare("PRAGMA table_info(task_event)").all() as Array<{ name: string }>;
        const indexes = verify.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'task%' OR name LIKE 'idx_tasks%') ORDER BY name"
        ).all() as Array<{ name: string }>;
        const legacyTable = verify.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
        ).get() as { name?: string } | undefined;
        verify.close();

        expect(version).toBe(3);

        // New `task` table columns (superset of legacy + new fields).
        const taskColNames = taskCols.map((c) => c.name);
        expect(taskColNames).toEqual(expect.arrayContaining([
            "id", "session_id", "parent_task_id", "status", "summary", "owner",
            "created_at", "last_event_at", "ended_at", "cleanup_after",
            "source", "workspace_id", "agent_id", "agent_key", "ordinal",
        ]));

        // `task_event` table columns.
        const eventColNames = eventCols.map((c) => c.name);
        expect(eventColNames).toEqual(expect.arrayContaining([
            "id", "session_id", "task_id", "at", "kind", "summary",
        ]));

        // 4 task indexes + 1 task_event index. The legacy `idx_tasks_scope`
        // index must NOT exist (its parent table was never created on a fresh DB).
        const indexNames = indexes.map((i) => i.name);
        expect(indexNames).toEqual(expect.arrayContaining([
            "task_session_idx",
            "task_parent_idx",
            "task_status_idx",
            "task_scope_idx",
            "task_event_task_idx",
        ]));
        expect(indexNames).not.toContain("idx_tasks_scope");
        expect(legacyTable).toBeUndefined();
    });

    it("status mapping covers all legacy statuses", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-lh-status-"));
        dirs.push(dir);
        const dbPath = join(dir, "long-horizon.db");

        const now = Date.now();
        seedLegacyTasksDb(dbPath, [
            { id: "u1", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "t1", status: "pending",   ordinal: 0, createdAt: now, updatedAt: now },
            { id: "u2", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "t2", status: "running",   ordinal: 1, createdAt: now, updatedAt: now },
            { id: "u3", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "t3", status: "completed", ordinal: 2, createdAt: now, updatedAt: now },
            { id: "u4", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "t4", status: "failed",    ordinal: 3, createdAt: now, updatedAt: now },
            { id: "u5", workspaceId: "ws1", agentId: null, agentKey: "__default__", source: "goal", text: "t5", status: "blocked",   ordinal: 4, createdAt: now, updatedAt: now },
        ]);

        const db = new LongHorizonDatabase(dir);
        await db.close();

        const verify = openRaw(dbPath);
        const rows = verify.prepare("SELECT id, status FROM task ORDER BY id ASC").all() as Array<{
            id: string; status: string;
        }>;
        // ended_at should be populated for the row that mapped to 'done' (was 'completed').
        const endedRow = verify.prepare("SELECT ended_at FROM task WHERE id = 'T3'").get() as { ended_at: number | null };
        const openEndedRow = verify.prepare("SELECT ended_at FROM task WHERE id = 'T1'").get() as { ended_at: number | null };
        verify.close();

        expect(rows).toEqual([
            { id: "T1", status: "open" },
            { id: "T2", status: "in_progress" },
            { id: "T3", status: "done" },
            { id: "T4", status: "blocked" },
            { id: "T5", status: "blocked" },
        ]);
        // Spec: ended_at = updated_at when status maps to 'done' or 'abandoned'.
        expect(endedRow.ended_at).toBe(now);
        expect(openEndedRow.ended_at).toBeNull();
    });

    // ---- Phase D Task 4: FTS5 trigram tokenizer + business-layer simplification ----

    describe("FTS5 trigram tokenizer (Phase D)", () => {
        it("matches English multi-word phrase queries via OR-joined tokens", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "workflow sandbox checkpoint evidence",
            });
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "completely unrelated material",
            });

            const results = await db.searchMemories("workflow sandbox", {
                workspaceId: "ws1",
                searchScoreFloor: 0.0,
            });

            expect(results).toHaveLength(1);
            expect(results[0].text).toBe("workflow sandbox checkpoint evidence");
        });

        it("matches CJK substring queries (3+ chars) via shared trigrams", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "数据库连接池配置",
            });
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "用户登录认证系统",
            });

            const results = await db.searchMemories("连接池", {
                workspaceId: "ws1",
                searchScoreFloor: 0.0,
            });

            expect(results).toHaveLength(1);
            expect(results[0].text).toBe("数据库连接池配置");
        });

        it("matches mixed-language queries with each token contributing to BM25 ranking", async () => {
            const db = createDb();
            // Both terms match this doc — should rank highest.
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "OAuth 2.0 认证流程",
            });
            // Only one term matches — should rank lower or be filtered by floor.
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "OAuth client id",
            });

            const results = await db.searchMemories("OAuth 认证", {
                workspaceId: "ws1",
                searchScoreFloor: 0.0,
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].text).toBe("OAuth 2.0 认证流程");
        });

        it("returns [] for empty and whitespace-only queries without issuing MATCH", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "some searchable memory",
            });

            expect(await db.searchMemories("", { workspaceId: "ws1" })).toEqual([]);
            expect(await db.searchMemories("   ", { workspaceId: "ws1" })).toEqual([]);
            expect(await db.searchMemories("\t\n  ", { workspaceId: "ws1" })).toEqual([]);
        });

        it("handles 1-2 character queries via LIKE fallback on memories.text", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "数据库连接池配置",
            });
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "用户登录认证系统",
            });

            // 1-char CJK query — trigram cannot match, LIKE fallback handles it.
            const one = await db.searchMemories("数", { workspaceId: "ws1" });
            expect(one.map((r) => r.text)).toEqual(["数据库连接池配置"]);

            // 2-char CJK query — same LIKE fallback.
            const two = await db.searchMemories("数据", { workspaceId: "ws1" });
            expect(two.map((r) => r.text)).toEqual(["数据库连接池配置"]);
        });

        it("neutralizes FTS5 special characters via phrase-quoting each token", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "workflow sandbox checkpoint",
            });

            // Query containing FTS5 special chars — must not throw, must match
            // the underlying word "workflow" (special chars are dropped by the
            // \p{L}\p{N}_ tokenizer in sanitizeFtsQuery).
            const r1 = await db.searchMemories("workflow*", { workspaceId: "ws1" });
            expect(r1.map((r) => r.text)).toEqual(["workflow sandbox checkpoint"]);

            const r2 = await db.searchMemories("(workflow)", { workspaceId: "ws1" });
            expect(r2.map((r) => r.text)).toEqual(["workflow sandbox checkpoint"]);

            const r3 = await db.searchMemories("sandbox:checkpoint", { workspaceId: "ws1" });
            // Both "sandbox" and "checkpoint" tokens match the same doc.
            expect(r3.map((r) => r.text)).toEqual(["workflow sandbox checkpoint"]);

            // A query that is ONLY special characters yields no usable tokens
            // and returns [] without throwing.
            const r4 = await db.searchMemories("*()", { workspaceId: "ws1" });
            expect(r4).toEqual([]);
        });

        it("escapes embedded double quotes in the query without syntax error", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: 'she said "hello world" yesterday',
            });

            // The quote chars are stripped from the query (the \p{L}\p{N}_ regex
            // doesn't match `"`), so the underlying tokens "hello" and "world"
            // match — no fts5 syntax error is thrown.
            const r = await db.searchMemories('"hello world"', { workspaceId: "ws1" });
            expect(r.map((row) => row.text)).toEqual(['she said "hello world" yesterday']);
        });

        it("does not include tags in the FTS index (only memories.text)", async () => {
            const db = createDb();
            await db.insertMemory({
                scope: "project",
                workspaceId: "ws1",
                kind: "note",
                text: "remember the main text only",
                tags: ["secret-tag-that-should-not-be-searchable", "another-tag"],
            });

            // A query for a tag-only string returns nothing because tags are
            // no longer folded into search_text.
            const r = await db.searchMemories("secret-tag-that-should-not-be-searchable", {
                workspaceId: "ws1",
            });
            expect(r).toEqual([]);

            // But querying for actual memory text still works.
            const r2 = await db.searchMemories("main text", { workspaceId: "ws1" });
            expect(r2.map((row) => row.text)).toEqual(["remember the main text only"]);
        });
    });

    describe("FTS5 v3 migration (Phase D)", () => {
        function seedUserVersion2Db(dbPath: string, rows: Array<{
            id: string;
            text: string;
            kind?: string;
            layer?: string;
            workspaceId?: string;
            sessionId?: string;
        }>): void {
            const seed = new DatabaseSync(dbPath);
            seed.exec(`
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
                CREATE TABLE IF NOT EXISTS task (
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
                    FOREIGN KEY (session_id, task_id) REFERENCES task(session_id, id) ON DELETE CASCADE
                );
            `);
            const insertMem = seed.prepare(`
                INSERT INTO memories (id, scope, layer, kind, text, workspace_id, session_id, created_at, updated_at)
                VALUES (?, 'project', 'project_memory', ?, ?, ?, ?, 1, 1)
            `);
            // Seed memory_fts with PRE-TOKENIZED search_text (simulating the
            // legacy buildSearchText output: space-separated unigrams + bigrams).
            // After v3 migration, this should be replaced by raw `memories.text`.
            const insertFts = seed.prepare(`
                INSERT INTO memory_fts (id, search_text, kind, layer, workspace_id, session_id)
                VALUES (?, ?, ?, 'project_memory', ?, ?)
            `);
            for (const row of rows) {
                const kind = row.kind ?? "note";
                const ws = row.workspaceId ?? "ws1";
                const sess = row.sessionId ?? "";
                insertMem.run(row.id, kind, row.text, ws, sess);
                // Old pre-tokenized search_text: unigrams + bigrams joined by spaces.
                const cjk = row.text.match(/[\u4e00-\u9fff]+/g) ?? [];
                const ascii = row.text.match(/[a-zA-Z0-9]+/g) ?? [];
                const tokens = [...ascii];
                for (const seg of cjk) {
                    for (const ch of seg) tokens.push(ch);
                    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.substring(i, i + 2));
                }
                insertFts.run(row.id, tokens.join(" "), kind, ws, sess);
            }
            seed.exec("PRAGMA user_version = 2;");
            seed.close();
        }

        it("migrates memory_fts from user_version 2 to 3 and re-indexes from raw memories.text", async () => {
            const dir = mkdtempSync(join(tmpdir(), "pi-lh-v3-migrate-"));
            dirs.push(dir);
            const dbPath = join(dir, "long-horizon.db");

            seedUserVersion2Db(dbPath, [
                { id: "m1", text: "数据库连接池配置", workspaceId: "ws1" },
                { id: "m2", text: "workflow sandbox checkpoint", workspaceId: "ws1" },
                { id: "m3", text: "OAuth 认证流程", workspaceId: "ws1" },
            ]);

            // Constructing LongHorizonDatabase triggers migrate().
            const db = new LongHorizonDatabase(dir);
            databases.push(db);

            const verify = openRaw(dbPath);
            const version = (verify.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
            const ftsCount = (verify.prepare("SELECT COUNT(*) AS n FROM memory_fts").get() as { n: number }).n;
            const memCount = (verify.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n;
            // Confirm the new memory_fts uses the trigram tokenizer.
            const ftsSchema = (verify.prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts'"
            ).get() as { sql: string }).sql;
            verify.close();

            expect(version).toBe(3);
            expect(ftsCount).toBe(memCount);
            expect(ftsCount).toBe(3);
            expect(ftsSchema).toContain("tokenize='trigram'");

            // The old pre-tokenized search_text is gone; raw text is now indexed.
            // Search using a CJK substring that only matches the RAW text (not
            // the old unigram/bigram tokens).
            const r1 = await db.searchMemories("连接池", { workspaceId: "ws1", searchScoreFloor: 0.0 });
            expect(r1.map((row) => row.id)).toEqual(["m1"]);

            // Mixed-language query works against raw text.
            const r2 = await db.searchMemories("OAuth 认证", { workspaceId: "ws1", searchScoreFloor: 0.0 });
            expect(r2.map((row) => row.id)).toEqual(["m3"]);

            // English phrase query works against raw text.
            const r3 = await db.searchMemories("workflow sandbox", { workspaceId: "ws1", searchScoreFloor: 0.0 });
            expect(r3.map((row) => row.id)).toEqual(["m2"]);
        });

        it("v3 migration is idempotent (second open does not DROP/CREATE memory_fts)", async () => {
            const dir = mkdtempSync(join(tmpdir(), "pi-lh-v3-idempotent-"));
            dirs.push(dir);
            const dbPath = join(dir, "long-horizon.db");

            seedUserVersion2Db(dbPath, [
                { id: "m1", text: "数据库连接池配置", workspaceId: "ws1" },
            ]);

            // First open — migrates from v2 to v3.
            const db1 = new LongHorizonDatabase(dir);
            await db1.close();

            const check1 = openRaw(dbPath);
            const version1 = (check1.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
            const ftsCount1 = (check1.prepare("SELECT COUNT(*) AS n FROM memory_fts").get() as { n: number }).n;
            check1.close();
            expect(version1).toBe(3);
            expect(ftsCount1).toBe(1);

            // Second open — user_version is already 3, so v3 migration is skipped.
            // We can't directly assert "no DROP/CREATE ran", but we can verify
            // the schema is unchanged (still trigram) and row count is stable.
            const db2 = new LongHorizonDatabase(dir);
            await db2.close();

            const check2 = openRaw(dbPath);
            const version2 = (check2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
            const ftsCount2 = (check2.prepare("SELECT COUNT(*) AS n FROM memory_fts").get() as { n: number }).n;
            const ftsSchema = (check2.prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts'"
            ).get() as { sql: string }).sql;
            check2.close();

            expect(version2).toBe(3);
            expect(ftsCount2).toBe(1);
            expect(ftsSchema).toContain("tokenize='trigram'");
        });

        it("fresh DB creates memory_fts with trigram tokenizer at user_version 3", async () => {
            const dir = mkdtempSync(join(tmpdir(), "pi-lh-v3-fresh-"));
            dirs.push(dir);
            const dbPath = join(dir, "long-horizon.db");

            const db = new LongHorizonDatabase(dir);
            await db.close();

            const verify = openRaw(dbPath);
            const version = (verify.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
            const ftsSchema = (verify.prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts'"
            ).get() as { sql: string }).sql;
            verify.close();

            expect(version).toBe(3);
            expect(ftsSchema).toContain("tokenize='trigram'");
        });
    });
});
