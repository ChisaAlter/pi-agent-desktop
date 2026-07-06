/**
 * markdown-memory-service.test.ts — Tests for the integrated memory service.
 *
 * Verifies the end-to-end flow:
 *   - search() runs reconcile first (gated by setting)
 *   - search() builds FTS query + applies score floor
 *   - settings.ccIndex / reconcileOnSearch / searchScoreFloor all honoured
 *   - read() returns full body for a search hit
 *   - settings.enabled=false short-circuits all operations
 *
 * Uses temp dirs for both the memory root (markdown files) and the SQLite
 * index. Electron's `app.getPath("userData")` is bypassed via constructor opts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MarkdownMemoryService } from "../markdown-memory-service";
import type { MarkdownMemorySettings } from "../markdown-memory-service";

// Mock electron — only `app.getPath` is imported, and we bypass it via opts.
// The mock satisfies the import; the actual userData comes from temp dir.
vi.mock("electron", () => ({
    app: {
        getPath: vi.fn(() => ""),
        isReady: vi.fn(() => true),
    },
}));

let tempRoot: string;
let memoryRoot: string;
let dbPath: string;
let service: MarkdownMemoryService;

function makeService(settings?: Partial<MarkdownMemorySettings>): MarkdownMemoryService {
    return new MarkdownMemoryService({
        settings,
        userData: tempRoot,
        dbPath,
    });
}

function writeMemoryFile(relPath: string, body: string): string {
    const abs = join(memoryRoot, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body, "utf8");
    return abs;
}

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "md-svc-"));
    memoryRoot = join(tempRoot, "memory");
    dbPath = join(tempRoot, "index.sqlite");
    service = makeService();
});

afterEach(() => {
    service.close();
    rmSync(tempRoot, { recursive: true, force: true });
});

describe("MarkdownMemoryService — basic plumbing", () => {
    it("exposes memoryRoot pointing at <userData>/memory", () => {
        expect(service.memoryRoot).toBe(memoryRoot);
    });

    it("buildMemoryPath builds absolute path from locator", () => {
        const path = service.buildMemoryPath({
            scope: "projects",
            scopeId: "abc",
            type: "memory",
            filename: "MEMORY",
        });
        expect(path).toBe(join(memoryRoot, "projects", "abc", "MEMORY.md"));
    });

    it("parseMemoryPath round-trips buildMemoryPath", () => {
        const locator = {
            scope: "sessions" as const,
            scopeId: "sess1",
            type: "checkpoint" as const,
            filename: "checkpoint",
        };
        const abs = service.buildMemoryPath(locator);
        const parsed = service.parseMemoryPath(abs);
        expect(parsed).toEqual(locator);
    });

    it("parseMemoryPath returns null for paths outside memory root", () => {
        expect(service.parseMemoryPath("/tmp/something.md")).toBeNull();
        expect(service.parseMemoryPath(join(tempRoot, "other.md"))).toBeNull();
    });

    it("resolveProjectId is deterministic (sha256-derived)", () => {
        const id1 = service.resolveProjectId("C:/projects/myapp");
        const id2 = service.resolveProjectId("C:/projects/myapp");
        const id3 = service.resolveProjectId("C:/projects/other");
        expect(id1).toBe(id2);
        expect(id1).not.toBe(id3);
        expect(id1).toHaveLength(12);
    });
});

describe("MarkdownMemoryService — reconcile", () => {
    it("reconcile syncs disk files into the FTS index", async () => {
        writeMemoryFile("global/MEMORY.md", "Global preferences: TypeScript, Chinese UI.");
        writeMemoryFile("projects/abc/MEMORY.md", "Architecture: Electron + React 19.");

        const result = await service.reconcile();
        expect(result.indexed).toBe(2);
        expect(result.pruned).toBe(0);

        const indexed = await service.listIndexed();
        expect(indexed).toHaveLength(2);
    });

    it("reconcile prunes index entries when disk files are deleted", async () => {
        const file1 = writeMemoryFile("global/MEMORY.md", "first version");
        writeMemoryFile("projects/abc/MEMORY.md", "project memory");

        await service.reconcile();
        expect(await service.listIndexed()).toHaveLength(2);

        // Delete one file from disk, reconcile again
        rmSync(file1, { force: true });
        const result = await service.reconcile();
        expect(result.pruned).toBe(1);
        expect(await service.listIndexed()).toHaveLength(1);
    });

    it("reconcile is idempotent — running twice skips unchanged files", async () => {
        writeMemoryFile("global/MEMORY.md", "stable content");

        const first = await service.reconcile();
        expect(first.indexed).toBe(1);

        const second = await service.reconcile();
        expect(second.indexed).toBe(0);
        expect(second.skipped).toBe(1);
    });

    it("concurrent reconcile calls share a single in-flight promise", async () => {
        writeMemoryFile("global/MEMORY.md", "content");

        const p1 = service.reconcile();
        const p2 = service.reconcile();
        const [r1, r2] = await Promise.all([p1, p2]);
        // Both promises resolve to the same result (shared work)
        expect(r1).toEqual(r2);
    });
});

describe("MarkdownMemoryService — search with reconcile", () => {
    beforeEach(() => {
        writeMemoryFile("global/MEMORY.md", "User prefers TypeScript and Chinese UI.");
        writeMemoryFile("projects/abc/MEMORY.md", "Architecture: Electron + React 19. Memory: Zustand.");
        writeMemoryFile("sessions/sess1/notes.md", "Remember to verify FTS5 triggers.");
    });

    it("search runs reconcile first when reconcileOnSearch=true (default)", async () => {
        const hits = await service.search("TypeScript");
        expect(hits.length).toBeGreaterThan(0);
        // After search, index should be populated
        expect(await service.listIndexed()).toHaveLength(3);
    });

    it("search skips reconcile when reconcileOnSearch=false", async () => {
        service.close();
        service = makeService({ reconcileOnSearch: false });

        // Index is empty (no reconcile yet)
        expect(await service.listIndexed()).toHaveLength(0);

        // Search returns [] because index is empty
        const hits = await service.search("TypeScript");
        expect(hits).toHaveLength(0);

        // Index should still be empty (reconcile was skipped)
        expect(await service.listIndexed()).toHaveLength(0);
    });

    it("search honours forceReconcile override", async () => {
        service.close();
        service = makeService({ reconcileOnSearch: false });

        // forceReconcile overrides the setting
        const hits = await service.search("TypeScript", {}, { forceReconcile: true });
        expect(hits.length).toBeGreaterThan(0);
    });

    it("search honours skipReconcile override", async () => {
        // skipReconcile overrides the default-true setting
        const hits = await service.search("TypeScript", {}, { skipReconcile: true });
        // Index wasn't populated → no hits
        expect(hits).toHaveLength(0);
    });

    it("search returns BM25-ranked hits with score and snippet", async () => {
        const hits = await service.search("TypeScript");
        expect(hits.length).toBeGreaterThan(0);
        const hit = hits[0];
        expect(hit.path).toBeTruthy();
        expect(hit.scope).toBe("global");
        expect(typeof hit.score).toBe("number");
        expect(hit.snippet).toBeDefined();
    });

    it("search respects scope filter", async () => {
        const hits = await service.search("TypeScript", { scope: "global" });
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) {
            expect(hit.scope).toBe("global");
        }
    });

    it("search respects scopeId filter", async () => {
        const hits = await service.search("Zustand", { scope: "projects", scopeId: "abc" });
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) {
            expect(hit.scope).toBe("projects");
            expect(hit.scopeId).toBe("abc");
        }
    });

    it("search applies searchScoreFloor from settings", async () => {
        service.close();
        service = makeService({ searchScoreFloor: 0.99 }); // very aggressive
        const hits = await service.search("memory");
        // Top hit always kept even with aggressive floor
        expect(hits.length).toBeGreaterThanOrEqual(1);
    });

    it("search respects per-call scoreFloor override", async () => {
        const hits = await service.search("memory", {}, { scoreFloor: 0 });
        // floor=0 keeps all matches
        const hitsWithFloor = await service.search("memory", {}, { scoreFloor: 0.99 });
        // Aggressive floor may drop some, but top hit survives
        expect(hitsWithFloor.length).toBeLessThanOrEqual(hits.length);
        expect(hitsWithFloor.length).toBeGreaterThanOrEqual(1);
    });

    it("search returns [] for empty query", async () => {
        expect(await service.search("")).toEqual([]);
        expect(await service.search("   ")).toEqual([]);
    });

    it("search respects limit option", async () => {
        const hits = await service.search("memory", {}, { limit: 1 });
        expect(hits.length).toBeLessThanOrEqual(1);
    });
});

describe("MarkdownMemoryService — settings.enabled gate", () => {
    it("enabled=false short-circuits search", async () => {
        service.close();
        service = makeService({ enabled: false });

        writeMemoryFile("global/MEMORY.md", "should not be searched");
        const hits = await service.search("should");
        expect(hits).toEqual([]);
    });

    it("enabled=false short-circuits read", async () => {
        service.close();
        service = makeService({ enabled: false });

        const result = await service.read("/tmp/anything.md");
        expect(result).toBeNull();
    });

    it("reconcile() returns zero-count result when enabled=false", async () => {
        service.close();
        service = makeService({ enabled: false });

        writeMemoryFile("global/MEMORY.md", "should not be indexed");
        writeMemoryFile("projects/abc/MEMORY.md", "also should not be indexed");

        const result = await service.reconcile();
        expect(result).toEqual({ indexed: 0, pruned: 0, skipped: 0 });

        // Verify no SQLite writes happened: spin up a separate enabled=true
        // service pointing at the same dbPath. If reconcile had written,
        // listIndexed() would return the written paths.
        const verifier = new MarkdownMemoryService({
            settings: { enabled: true },
            userData: tempRoot,
            dbPath,
        });
        try {
            const indexed = await verifier.listIndexed();
            expect(indexed).toEqual([]);
        } finally {
            verifier.close();
        }
    });

    it("listIndexed() returns [] when enabled=false", async () => {
        // First populate the index via the default enabled service so we know
        // SQLite actually has entries.
        writeMemoryFile("global/MEMORY.md", "content");
        await service.reconcile();
        expect(await service.listIndexed()).toHaveLength(1); // sanity check

        // Now swap to a disabled service pointing at the same dbPath.
        service.close();
        service = makeService({ enabled: false });

        // listIndexed() should return [] despite SQLite having one entry.
        const indexed = await service.listIndexed();
        expect(indexed).toEqual([]);
    });

    it("listDiskFiles() returns [] when enabled=false", async () => {
        service.close();
        service = makeService({ enabled: false });

        // Files exist on disk, but listDiskFiles() should still return [].
        writeMemoryFile("global/MEMORY.md", "exists on disk");
        writeMemoryFile("projects/abc/MEMORY.md", "also on disk");

        const files = service.listDiskFiles();
        expect(files).toEqual([]);
    });

    it("buildMemoryPath() still works when enabled=false (pure path computation)", () => {
        service.close();
        service = makeService({ enabled: false });

        // Pure path helpers are NOT gated by enabled — they have no I/O
        // and no SQLite side effect. They must continue to work so that
        // dream/distill/checkpoint-writer subagents can plan paths even
        // when the memory service is disabled.
        const path = service.buildMemoryPath({
            scope: "projects",
            scopeId: "abc",
            type: "memory",
            filename: "MEMORY",
        });
        expect(path).toBe(join(memoryRoot, "projects", "abc", "MEMORY.md"));

        // parseMemoryPath should also still work (round-trip).
        const parsed = service.parseMemoryPath(path);
        expect(parsed).toEqual({
            scope: "projects",
            scopeId: "abc",
            type: "memory",
            filename: "MEMORY",
        });

        // resolveProjectId should also still work (deterministic sha256).
        const id = service.resolveProjectId("C:/projects/myapp");
        expect(id).toHaveLength(12);
    });
});

describe("MarkdownMemoryService — read", () => {
    it("read returns full body + locator for indexed file", async () => {
        const abs = writeMemoryFile("global/MEMORY.md", "full body content");
        await service.reconcile();

        const result = await service.read(abs);
        expect(result).not.toBeNull();
        expect(result!.body).toBe("full body content");
        expect(result!.path).toBe(abs);
        expect(result!.locator.scope).toBe("global");
        expect(result!.locator.type).toBe("memory");
    });

    it("read returns null for unknown path", async () => {
        await service.reconcile();
        const result = await service.read("/tmp/nonexistent.md");
        expect(result).toBeNull();
    });
});

describe("MarkdownMemoryService — ccIndex setting", () => {
    it("ccIndex=true logs warning but does not throw (CC not yet implemented)", async () => {
        service.close();
        service = makeService({ ccIndex: true });

        // Mock console.warn to verify it's called
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        writeMemoryFile("global/MEMORY.md", "content");
        await service.reconcile();

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("ccIndex=true is not yet implemented"),
        );
        warnSpy.mockRestore();
    });

    it("ccIndex=false does not log warning", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        await service.reconcile();
        expect(warnSpy).not.toHaveBeenCalledWith(
            expect.stringContaining("ccIndex"),
        );
        warnSpy.mockRestore();
    });
});

describe("MarkdownMemoryService — listDiskFiles", () => {
    it("listDiskFiles walks the memory dir directly (no index)", () => {
        writeMemoryFile("global/MEMORY.md", "a");
        writeMemoryFile("projects/abc/MEMORY.md", "b");
        writeMemoryFile("sessions/sess1/notes.md", "c");

        const files = service.listDiskFiles();
        expect(files).toHaveLength(3);
        // All paths should be absolute and end with .md
        for (const f of files) {
            expect(f.endsWith(".md")).toBe(true);
        }
    });

    it("listDiskFiles returns [] for empty memory root", () => {
        const files = service.listDiskFiles();
        expect(files).toEqual([]);
    });
});
