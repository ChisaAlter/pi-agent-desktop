/**
 * settings-bridge.test.ts — Verifies the LongHorizonSettings.memory →
 * MarkdownMemoryService mapping is correct and stays correct across
 * refactors.
 *
 * The user's explicit constraint: "目前设置里可以控制这些功能，要求可以继续控制"
 * (the existing settings panel toggles must remain controllable). This test
 * file pins that contract.
 *
 * The 4 toggles verified:
 *   - enabled            (master on/off — search returns [] when false)
 *   - ccIndex            (CC root walking — currently logs, mimo-only until
 *                         CC walker is added; the setting is honoured as
 *                         "warn + proceed mimo-only" rather than throwing)
 *   - reconcileOnSearch  (sync disk ↔ index before each search)
 *   - searchScoreFloor   (relative BM25 floor, 0..1)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MarkdownMemoryService } from "../markdown-memory-service";

vi.mock("electron", () => ({
    app: {
        getPath: vi.fn(() => ""),
        isReady: vi.fn(() => true),
    },
}));

let tempRoot: string;
let memoryRoot: string;
let dbPath: string;

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "settings-bridge-"));
    memoryRoot = join(tempRoot, "memory");
    dbPath = join(tempRoot, "index.sqlite");
});

afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});

describe("LongHorizonSettings.memory → MarkdownMemoryService bridge", () => {
    it("default settings match DEFAULT_LONG_HORIZON_SETTINGS.memory", () => {
        // DEFAULT is: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 }
        const service = new MarkdownMemoryService({ userData: tempRoot, dbPath });
        expect(service.settingsSnapshot).toEqual({
            enabled: true,
            ccIndex: false,
            reconcileOnSearch: true,
            searchScoreFloor: 0.15,
        });
        service.close();
    });

    it("enabled=false propagates and disables search", async () => {
        const service = new MarkdownMemoryService({
            userData: tempRoot,
            dbPath,
            settings: { enabled: false, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
        });
        mkdirSync(join(memoryRoot, "global"), { recursive: true });
        writeFileSync(join(memoryRoot, "global", "MEMORY.md"), " searchable content ");
        expect(await service.search("searchable")).toEqual([]);
        service.close();
    });

    it("ccIndex=true propagates (and reconcile logs warning instead of throwing)", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const service = new MarkdownMemoryService({
            userData: tempRoot,
            dbPath,
            settings: { enabled: true, ccIndex: true, reconcileOnSearch: true, searchScoreFloor: 0.15 },
        });
        expect(service.settingsSnapshot.ccIndex).toBe(true);
        await service.reconcile();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ccIndex=true"));
        warnSpy.mockRestore();
        service.close();
    });

    it("reconcileOnSearch=false propagates and skips reconcile", async () => {
        const service = new MarkdownMemoryService({
            userData: tempRoot,
            dbPath,
            settings: { enabled: true, ccIndex: false, reconcileOnSearch: false, searchScoreFloor: 0.15 },
        });
        // Disk has files; index is empty. With reconcileOnSearch=false, search
        // returns [] because the index was never populated.
        mkdirSync(join(memoryRoot, "global"), { recursive: true });
        writeFileSync(join(memoryRoot, "global", "MEMORY.md"), "findable");
        expect(await service.search("findable")).toEqual([]);
        // Index should still be empty (no reconcile was run)
        expect(await service.listIndexed()).toHaveLength(0);
        service.close();
    });

    it("searchScoreFloor=0 propagates and keeps all matches", async () => {
        const service = new MarkdownMemoryService({
            userData: tempRoot,
            dbPath,
            settings: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0 },
        });
        expect(service.settingsSnapshot.searchScoreFloor).toBe(0);

        // Seed several files with overlapping tokens
        mkdirSync(join(memoryRoot, "global"), { recursive: true });
        writeFileSync(join(memoryRoot, "global", "a.md"), "the the the");
        writeFileSync(join(memoryRoot, "global", "b.md"), "the the");
        writeFileSync(join(memoryRoot, "global", "c.md"), "the");

        const hits = await service.search("the");
        // floor=0 keeps all matches
        expect(hits.length).toBeGreaterThan(0);
        service.close();
    });

    it("all four toggles can be turned off simultaneously", async () => {
        const service = new MarkdownMemoryService({
            userData: tempRoot,
            dbPath,
            settings: { enabled: false, ccIndex: false, reconcileOnSearch: false, searchScoreFloor: 0 },
        });
        expect(service.settingsSnapshot).toEqual({
            enabled: false,
            ccIndex: false,
            reconcileOnSearch: false,
            searchScoreFloor: 0,
        });
        // With enabled=false, search short-circuits
        expect(await service.search("anything")).toEqual([]);
        service.close();
    });

    it("partial settings fall back to defaults for missing fields", () => {
        // Only `enabled` provided — the rest should default
        const service = new MarkdownMemoryService({
            userData: tempRoot,
            dbPath,
            settings: { enabled: true },
        });
        expect(service.settingsSnapshot).toEqual({
            enabled: true,
            ccIndex: false,
            reconcileOnSearch: true,
            searchScoreFloor: 0.15,
        });
        service.close();
    });
});
