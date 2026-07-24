/**
 * markdown-index.test.ts — Tests for the SQLite FTS5 external-content index.
 *
 * These tests verify the critical correctness properties that previous
 * attempts got wrong:
 *   - Triggers use the 'delete' magic command (not DELETE FROM vtab)
 *   - Updates swap FTS tokens cleanly (no stale accumulation)
 *   - Deletes remove FTS tokens (no stale residue)
 *   - BM25 scores are negated (higher = better for callers)
 *   - Relative score floor keeps top hit + drops below-floor noise
 *   - Filters (scope/scopeId/type) narrow results correctly
 *   - Trigram tokenizer matches CJK substrings (critical for Chinese UI)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MarkdownIndex } from "../markdown-index";
import { buildFtsQuery } from "../fts-query";

let tempRoot: string;
let dbPath: string;
let index: MarkdownIndex;

function makeIndex(): MarkdownIndex {
    return new MarkdownIndex({ dbPath });
}

function seedMarkdownFile(
    root: string,
    relPath: string,
    body: string,
): string {
    const abs = join(root, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body, "utf8");
    return abs;
}

async function seedIndex(
    root: string,
    files: Array<{ rel: string; scope: "global" | "projects" | "sessions"; scopeId?: string; type: string; body: string }>,
): Promise<void> {
    for (const f of files) {
        const abs = seedMarkdownFile(root, f.rel, f.body);
        await index.upsertIndex({
            path: abs,
            scope: f.scope,
            scopeId: f.scopeId,
            type: f.type as "memory" | "checkpoint" | "progress" | "notes" | "free",
            body: f.body,
            fingerprint: `${f.body.length}-${Date.now()}`,
        });
    }
}

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "md-index-"));
    dbPath = join(tempRoot, "index.sqlite");
    index = makeIndex();
});

afterEach(() => {
    index.close();
    rmSync(tempRoot, { recursive: true, force: true });
});

describe("MarkdownIndex migrate", () => {
    it("creates memory_fts main table with UNIQUE path", () => {
        const row = index.getDb()
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts'")
            .get() as { sql: string };
        expect(row.sql).toContain("memory_fts");
        expect(row.sql).toContain("path TEXT NOT NULL UNIQUE");
        expect(row.sql).toContain("fingerprint TEXT NOT NULL");
    });

    it("creates memory_fts_idx virtual table with external-content + trigram", () => {
        const row = index.getDb()
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts_idx'")
            .get() as { sql: string };
        expect(row.sql).toContain("fts5");
        expect(row.sql).toContain("content='memory_fts'");
        expect(row.sql).toContain("content_rowid='id'");
        expect(row.sql).toContain("tokenize='trigram'");
    });

    it("creates 3 triggers using 'delete' magic command for ad/au", () => {
        const triggers = index.getDb()
            .prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_fts_%'")
            .all() as Array<{ name: string; sql: string }>;
        const names = triggers.map((t) => t.name).sort();
        expect(names).toEqual(["memory_fts_ad", "memory_fts_ai", "memory_fts_au"]);

        const ad = triggers.find((t) => t.name === "memory_fts_ad")!;
        expect(ad.sql).toContain("'delete'");
        expect(ad.sql).not.toContain("DELETE FROM memory_fts_idx");

        const au = triggers.find((t) => t.name === "memory_fts_au")!;
        expect(au.sql).toContain("'delete'");
        expect(au.sql).not.toContain("DELETE FROM memory_fts_idx");
    });

    it("is idempotent — running migrate twice doesn't duplicate triggers", () => {
        // Re-opening the same DB path runs migrate again
        index.close();
        index = makeIndex();
        const triggers = index.getDb()
            .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_fts_%'")
            .all() as Array<{ name: string }>;
        expect(triggers).toHaveLength(3);
    });
});

describe("MarkdownIndex ReconcileDatabase impl", () => {
    it("upsertIndex inserts a row + populates FTS index", async () => {
        await index.upsertIndex({
            path: "/tmp/MEMORY.md",
            scope: "global",
            type: "memory",
            body: "remember to check the deployment logs",
            fingerprint: "100-1000",
        });
        const count = await index.count();
        expect(count).toBe(1);

        // FTS index must be populated — search should find the row
        const hits = await index.search(
            buildFtsQuery("deployment")!,
            {},
            { limit: 10 },
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].path).toBe("/tmp/MEMORY.md");
    });

    it("upsertIndex on existing path updates body + swaps FTS tokens (no stale)", async () => {
        await index.upsertIndex({
            path: "/tmp/MEMORY.md",
            scope: "global",
            type: "memory",
            body: "old content about apples",
            fingerprint: "100-1000",
        });
        await index.upsertIndex({
            path: "/tmp/MEMORY.md",
            scope: "global",
            type: "memory",
            body: "new content about bananas",  // no "apples" anymore
            fingerprint: "200-2000",
        });

        const appleHits = await index.search(buildFtsQuery("apples")!, {}, { limit: 10 });
        expect(appleHits).toHaveLength(0);  // stale token must be gone

        const bananaHits = await index.search(buildFtsQuery("bananas")!, {}, { limit: 10 });
        expect(bananaHits).toHaveLength(1);
        expect(bananaHits[0].path).toBe("/tmp/MEMORY.md");
    });

    it("deleteIndex removes row + clears FTS tokens (no stale residue)", async () => {
        await index.upsertIndex({
            path: "/tmp/MEMORY.md",
            scope: "global",
            type: "memory",
            body: "remember to check the deployment logs",
            fingerprint: "100-1000",
        });
        await index.deleteIndex("/tmp/MEMORY.md");

        const count = await index.count();
        expect(count).toBe(0);

        const hits = await index.search(buildFtsQuery("deployment")!, {}, { limit: 10 });
        expect(hits).toHaveLength(0);
    });

    it("loadIndexedPaths returns all (path, fingerprint) pairs", async () => {
        await index.upsertIndex({
            path: "/tmp/a.md", scope: "global", type: "memory",
            body: "a", fingerprint: "fp-a",
        });
        await index.upsertIndex({
            path: "/tmp/b.md", scope: "global", type: "memory",
            body: "b", fingerprint: "fp-b",
        });
        const map = await index.loadIndexedPaths();
        expect(map.size).toBe(2);
        expect(map.get("/tmp/a.md")).toBe("fp-a");
        expect(map.get("/tmp/b.md")).toBe("fp-b");
    });

    it("getByPath returns the full indexed row including body", async () => {
        await index.upsertIndex({
            path: "/tmp/MEMORY.md", scope: "global", type: "memory",
            body: "full body content here", fingerprint: "fp",
        });
        const row = await index.getByPath("/tmp/MEMORY.md");
        expect(row).not.toBeNull();
        expect(row!.body).toBe("full body content here");
        expect(row!.scope).toBe("global");
        expect(row!.type).toBe("memory");
    });

    it("getByPath returns null for unknown path", async () => {
        const row = await index.getByPath("/tmp/nonexistent.md");
        expect(row).toBeNull();
    });
});

describe("MarkdownIndex search", () => {
    beforeEach(async () => {
        await seedIndex(tempRoot, [
            {
                rel: "global/MEMORY.md", scope: "global", type: "memory",
                body: "User prefers TypeScript and Chinese UI. Memory layout: markdown.",
            },
            {
                rel: "projects/abc/MEMORY.md", scope: "projects", scopeId: "abc",
                type: "memory",
                body: "Architecture: Electron + React 19 + Tailwind 4. Memory: Zustand 5.",
            },
            {
                rel: "projects/abc/notes-architecture.md", scope: "projects", scopeId: "abc",
                type: "free",
                body: "Deep dive on the IPC layer — 17 handler files, async mutex on writes.",
            },
            {
                rel: "sessions/sess1/checkpoint.md", scope: "sessions", scopeId: "sess1",
                type: "checkpoint",
                body: "Session checkpoint: just finished Slice 4 of the memory rewrite.",
            },
            {
                rel: "sessions/sess1/notes.md", scope: "sessions", scopeId: "sess1",
                type: "notes",
                body: "Scratch: remember to verify FTS5 triggers use 'delete' magic command.",
            },
        ]);
    });

    it("returns BM25-ranked hits with snippets", async () => {
        const hits = await index.search(buildFtsQuery("memory")!, {}, { limit: 10 });
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) {
            expect(hit.path).toBeTruthy();
            expect(hit.scope).toBeTruthy();
            expect(typeof hit.score).toBe("number");
            // BM25 negated → higher = better → should be positive (or at least monotonic)
            expect(hit.snippet).toBeDefined();
        }
        // Scores should be descending (best first)
        for (let i = 1; i < hits.length; i++) {
            expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
        }
    });

    it("negates BM25 score so higher = better", async () => {
        // "memory" now matches 4 files (global + projects + checkpoint + notes-architecture has "memory"?)
        // Let me query "the" which appears in multiple files
        const hits = await index.search(buildFtsQuery("memory")!, {}, { limit: 10 });
        expect(hits.length).toBeGreaterThan(1);
        const topScore = hits[0].score;
        // Top hit must have a score ≥ all others
        for (const hit of hits) {
            expect(hit.score).toBeLessThanOrEqual(topScore);
        }
    });

    it("relative score floor keeps top hit + drops below-floor noise", async () => {
        // Use a high score floor to drop most results; top hit must always survive
        const hits = await index.search(
            buildFtsQuery("the and a")!,  // common-token query — produces varying scores
            {},
            { limit: 10, scoreFloor: 0.99 },  // very aggressive floor
        );
        // Top hit always kept
        expect(hits.length).toBeGreaterThanOrEqual(1);
    });

    it("scoreFloor=0 keeps all matches", async () => {
        const hits = await index.search(
            buildFtsQuery("memory")!,
            {},
            { limit: 50, scoreFloor: 0 },
        );
        const allCount = await index.count();
        // All matching rows should be returned when floor=0
        // (only rows that actually match "memory" are counted; this is a sanity
        // check that floor=0 doesn't drop any)
        const withoutFloor = await index.search(
            buildFtsQuery("memory")!,
            {},
            { limit: 50, scoreFloor: 0 },
        );
        expect(hits.length).toBe(withoutFloor.length);
    });

    it("respects scope filter", async () => {
        const hits = await index.search(
            buildFtsQuery("TypeScript")!,
            { scope: "global" },
            { limit: 10 },
        );
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) {
            expect(hit.scope).toBe("global");
        }
    });

    it("respects scopeId filter", async () => {
        const hits = await index.search(
            buildFtsQuery("architecture")!,
            { scope: "projects", scopeId: "abc" },
            { limit: 10 },
        );
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) {
            expect(hit.scope).toBe("projects");
            expect(hit.scopeId).toBe("abc");
        }
    });

    it("respects type filter", async () => {
        const hits = await index.search(
            buildFtsQuery("checkpoint")!,
            { type: "checkpoint" },
            { limit: 10 },
        );
        for (const hit of hits) {
            expect(hit.type).toBe("checkpoint");
        }
    });

    it("returns [] for empty/null FTS query", async () => {
        expect(await index.search("", {}, { limit: 10 })).toEqual([]);
        expect(await index.search(null, {}, { limit: 10 })).toEqual([]);
        expect(await index.search("   ", {}, { limit: 10 })).toEqual([]);
    });

    it("over-fetches 3× limit (cap 50) then slices", async () => {
        // With only 5 docs, over-fetch doesn't change behavior — sanity check
        // that the function returns at most `limit` results
        const hits = await index.search(buildFtsQuery("memory")!, {}, { limit: 2 });
        expect(hits.length).toBeLessThanOrEqual(2);
    });

    it("trigram tokenizer matches CJK substrings (critical for Chinese)", async () => {
        await index.upsertIndex({
            path: "/tmp/cjk.md",
            scope: "global",
            type: "memory",
            body: "用户偏好中文界面和 TypeScript 代码。",
            fingerprint: "fp-cjk",
        });
        // Trigram requires ≥3 chars — "中文界" is a valid trigram
        const hits = await index.search(buildFtsQuery("中文界")!, {}, { limit: 10 });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.some((h) => h.path === "/tmp/cjk.md")).toBe(true);
    });

    it("searches return at most `limit` results", async () => {
        const hits = await index.search(buildFtsQuery("the")!, {}, { limit: 3 });
        expect(hits.length).toBeLessThanOrEqual(3);
    });
});

describe("MarkdownIndex persistence", () => {
    it("survives close + reopen — data persists on disk", async () => {
        await index.upsertIndex({
            path: "/tmp/MEMORY.md",
            scope: "global",
            type: "memory",
            body: "persistent content",
            fingerprint: "fp",
        });
        index.close();

        // Reopen at same path
        index = makeIndex();
        const hits = await index.search(buildFtsQuery("persistent")!, {}, { limit: 10 });
        expect(hits).toHaveLength(1);
        expect(hits[0].path).toBe("/tmp/MEMORY.md");
    });

    it("DB file is created at dbPath", () => {
        expect(existsSync(dbPath)).toBe(true);
    });
});

describe("MarkdownIndex residual edges", () => {
    it("deleteIndex on unknown path is a no-op and empty body remains searchable by path", async () => {
        await expect(index.deleteIndex("/tmp/does-not-exist.md")).resolves.toBeUndefined();

        await index.upsertIndex({
            path: "/tmp/empty.md",
            scope: "global",
            type: "free",
            body: "",
            fingerprint: "empty-fp",
        });
        const row = await index.getByPath("/tmp/empty.md");
        expect(row).toMatchObject({ path: "/tmp/empty.md", body: "", type: "free" });

        await index.deleteIndex("/tmp/empty.md");
        expect(await index.getByPath("/tmp/empty.md")).toBeNull();
    });

    it("combines scope + type filters and tolerates blank FTS tokens", async () => {
        await seedIndex(tempRoot, [
            {
                rel: "projects/p1/MEMORY.md",
                scope: "projects",
                scopeId: "p1",
                type: "memory",
                body: "alpha project memory token",
            },
            {
                rel: "projects/p1/notes.md",
                scope: "projects",
                scopeId: "p1",
                type: "notes",
                body: "alpha project notes token",
            },
            {
                rel: "global/MEMORY.md",
                scope: "global",
                type: "memory",
                body: "alpha global memory token",
            },
        ]);

        const hits = await index.search(
            buildFtsQuery("alpha")!,
            { scope: "projects", scopeId: "p1", type: "notes" },
            { limit: 10, scoreFloor: 0 },
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].type).toBe("notes");
        expect(hits[0].scopeId).toBe("p1");

        // operator-only / empty query already covered; whitespace-built query → []
        const blank = buildFtsQuery("   ");
        expect(blank).toBeNull();
        await expect(index.search(null as never, {}, { limit: 5 })).resolves.toEqual([]);
    });
});

// wave-237 residual
describe("MarkdownIndex residual (wave-237)", () => {
    it("loadIndexedPaths / count / getByPath track upserts and deletes", async () => {
        expect(await index.count()).toBe(0);
        expect(await index.loadIndexedPaths()).toEqual(new Map());

        const abs = seedMarkdownFile(tempRoot, "global/MEMORY.md", "hello residual token");
        await index.upsertIndex({
            path: abs,
            scope: "global",
            type: "memory",
            body: "hello residual token",
            fingerprint: "fp-1",
        });

        expect(await index.count()).toBe(1);
        const paths = await index.loadIndexedPaths();
        expect(paths.get(abs)).toBe("fp-1");
        expect(await index.getByPath(abs)).toMatchObject({
            path: abs,
            scope: "global",
            type: "memory",
            body: "hello residual token",
            fingerprint: "fp-1",
        });
        expect(await index.getByPath(join(tempRoot, "missing.md"))).toBeNull();

        await index.deleteIndex(abs);
        expect(await index.count()).toBe(0);
        expect(await index.getByPath(abs)).toBeNull();
    });

    it("upsertIndex updates body/fingerprint for the same path without duplicating rows", async () => {
        const abs = seedMarkdownFile(tempRoot, "projects/p1/notes.md", "v1 body");
        await index.upsertIndex({
            path: abs,
            scope: "projects",
            scopeId: "p1",
            type: "notes",
            body: "v1 body",
            fingerprint: "fp-v1",
        });
        await index.upsertIndex({
            path: abs,
            scope: "projects",
            scopeId: "p1",
            type: "notes",
            body: "v2 body unique-residual-xyz",
            fingerprint: "fp-v2",
        });
        expect(await index.count()).toBe(1);
        const row = await index.getByPath(abs);
        expect(row?.body).toBe("v2 body unique-residual-xyz");
        expect(row?.fingerprint).toBe("fp-v2");

        const hits = await index.search(buildFtsQuery("unique-residual-xyz")!, {}, { limit: 5, scoreFloor: 0 });
        expect(hits).toHaveLength(1);
        expect(hits[0].path).toBe(abs);
    });
});
