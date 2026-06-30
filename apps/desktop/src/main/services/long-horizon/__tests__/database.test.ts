import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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
});
