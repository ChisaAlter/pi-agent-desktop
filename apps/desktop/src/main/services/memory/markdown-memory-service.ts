/**
 * markdown-memory-service.ts — Primary memory service: markdown files on disk
 * + SQLite FTS5 index for search.
 *
 * Architecture (ported from MiMo Code's `memory/service.ts`):
 *
 *   - **Primary storage**: markdown files under `<userData>/memory/`.
 *     Human-readable, git-trackable, editable outside the app.
 *
 *   - **Search index**: SQLite FTS5 external-content table (see
 *     `markdown-index.ts`). Reconciled from disk before each search
 *     (gated by `reconcileOnSearch` setting, default true).
 *
 *   - **No `memory_write` tool**: writes go through the standard `write`/`edit`
 *     tools, gated by `memory-path-guard` (see `memory-path-guard.ts`).
 *     The guard is wired into:
 *       - The interceptor's edit-family branch (`approval/interceptor.ts:159`, via `InterceptorDeps.memoryGuard`)
 *       - The subagent `memory_write` tool (`subagent/tools/memory-tools.ts:190`, called directly)
 *
 *   - **Search flow** (mirrors MiMo Code `service.ts:52-133`):
 *       1. (optional) reconcile disk ↔ index
 *       2. build FTS query from user string (`buildFtsQuery`)
 *       3. query FTS5 with BM25 + snippet
 *       4. over-fetch 3× (cap 50), apply RELATIVE score floor, slice to limit
 *
 *   - **Settings** (existing `LongHorizonSettings.memory`):
 *       `enabled`           — gate the whole service
 *       `ccIndex`           — opt-in CC root walking (currently logged but
 *                             not implemented; mimo-only until added)
 *       `reconcileOnSearch` — run reconcile before each search (default true)
 *       `searchScoreFloor`  — relative BM25 floor (default 0.15)
 *
 * This service does NOT replace `MemoryService` from `long-horizon/` — that
 * service still handles tasks/goals/history (which remain SQLite-backed).
 * This service is the **memory search layer** for the `memory` tool and the
 * dream/distill/checkpoint-writer subagents.
 *
 * ## `enabled` Gate Contract
 *
 * The `settings.enabled` master toggle gates every public method that reads
 * from or writes to the SQLite index / disk memory root:
 *
 *   - **Gated** (return early with empty/zero result when `enabled=false`):
 *       `search`, `read`, `reconcile`, `listIndexed`, `listDiskFiles`
 *     Rationale: these methods either mutate the SQLite index (reconcile) or
 *     surface memory contents to the caller (search/read/list*). Honoring
 *     `enabled=false` prevents unwanted disk/index side effects and keeps
 *     the user's "memory is off" intent intact.
 *
 *   - **Not gated** (operate regardless of `enabled`, see JSDoc on each):
 *       `buildMemoryPath`, `parseMemoryPath`, `resolveProjectId`
 *     Rationale: these are pure path-computation helpers with no I/O and no
 *     SQLite access. Dream/distill/checkpoint-writer subagents use them to
 *     decide where a future write *would* go, even when the service is
 *     disabled — gating them would break path planning without providing
 *     any safety benefit (no state is mutated).
 */

import { app } from "electron";
import type { MemoryLocator } from "./paths";
import { buildPath, parsePath, resolveProjectId, walkMemoryDir } from "./paths";
import { buildFtsQuery } from "./fts-query";
import {
    reconcileMemory,
    type ReconcileDatabase,
    type ReconcileResult,
} from "./reconcile";
import {
    MarkdownIndex,
    type MemorySearchFilters,
    type MemorySearchHit,
    type MemorySearchOptions,
} from "./markdown-index";
import { markdownIndexDbPath, memoryRootPath } from "./memory-path-guard";

export interface MarkdownMemorySettings {
    /** Master toggle — when false, search returns []. */
    enabled: boolean;
    /** Opt-in CC root walking. Currently logged but not implemented. */
    ccIndex: boolean;
    /** Run reconcile before each search. Default true. */
    reconcileOnSearch: boolean;
    /** Relative BM25 score floor in [0, 1]. Default 0.15. */
    searchScoreFloor: number;
}

export const DEFAULT_MEMORY_SETTINGS: MarkdownMemorySettings = {
    enabled: true,
    ccIndex: false,
    reconcileOnSearch: true,
    searchScoreFloor: 0.15,
};

export interface MemoryReadResult {
    locator: MemoryLocator;
    path: string;
    body: string;
}

export interface ReconcileAndSearchOptions extends MemorySearchOptions {
    /** Override the reconcileOnSearch setting for this call only. */
    forceReconcile?: boolean;
    /** Skip reconcile for this call only (overrides setting). */
    skipReconcile?: boolean;
}

export class MarkdownMemoryService {
    private readonly index: MarkdownIndex;
    private readonly settings: MarkdownMemorySettings;
    private readonly rootDir: string;
    private readonly dbPath: string;
    private reconcileInFlight: Promise<ReconcileResult> | null = null;

    constructor(opts: {
        settings?: Partial<MarkdownMemorySettings>;
        /** Override userData (testing). Defaults to app.getPath("userData"). */
        userData?: string;
        /** Override DB path (testing). Defaults to <userData>/memory/index.sqlite. */
        dbPath?: string;
    }) {
        this.settings = { ...DEFAULT_MEMORY_SETTINGS, ...opts.settings };
        const userData = opts.userData ?? app.getPath("userData");
        this.rootDir = memoryRootPath(userData);
        this.dbPath = opts.dbPath ?? markdownIndexDbPath(userData);
        this.index = new MarkdownIndex({ dbPath: this.dbPath });
    }

    get memoryRoot(): string {
        return this.rootDir;
    }

    get settingsSnapshot(): Readonly<MarkdownMemorySettings> {
        return this.settings;
    }

    /** Underlying FTS5 index — exposed for diagnostics + direct testing. */
    getIndex(): MarkdownIndex {
        return this.index;
    }

    /**
     * Build the absolute path for a memory file. Used by dream/distill/
     * checkpoint-writer to know where to write.
     *
     * Note: bypasses enabled gate (pure path computation). No SQLite or disk
     * side effect — callers use this to plan where a future write would land
     * even when the service is disabled.
     */
    buildMemoryPath(locator: MemoryLocator): string {
        return buildPath(this.rootDir, locator);
    }

    /**
     * Parse an absolute path back to a locator. Returns null when the path is
     * not under the memory root or doesn't match the layout.
     *
     * Note: bypasses enabled gate (pure path computation). Read-only lookup
     * against the in-memory rootDir string; touches neither SQLite nor disk.
     */
    parseMemoryPath(absolutePath: string): MemoryLocator | null {
        return parsePath(this.rootDir, absolutePath);
    }

    /**
     * Compute the projectId for a workspace path. Pi Desktop uses sha256
     * (deterministic, no file writes); MiMo Code uses UUID-in-file.
     *
     * Note: bypasses enabled gate (pure path computation). Deterministic sha256
     * digest over the input string — no I/O, no state mutation.
     */
    resolveProjectId(workspacePath: string): string {
        return resolveProjectId(workspacePath);
    }

    // ─── Reconcile ─────────────────────────────────────────────────────────

    /**
     * Run reconcile: sync disk markdown files with the FTS5 index.
     *
     * Idempotent — running twice in succession is a no-op the second time
     * (fingerprints unchanged → all skipped). Concurrent calls share the
     * same in-flight promise to avoid double-work during rapid searches.
     *
     * Gated by `settings.enabled`: when false, returns the zero-count
     * result `{ indexed: 0, pruned: 0, skipped: 0 }` and performs no
     * SQLite writes. This prevents external callers (e.g. dream/distill
     * subagents, scheduled reconcile jobs) from mutating the index while
     * the user has explicitly disabled the memory service.
     */
    async reconcile(): Promise<ReconcileResult> {
        if (!this.settings.enabled) {
            return { indexed: 0, pruned: 0, skipped: 0 };
        }
        if (this.reconcileInFlight) return this.reconcileInFlight;
        const promise = this.runReconcile().finally(() => {
            this.reconcileInFlight = null;
        });
        this.reconcileInFlight = promise;
        return promise;
    }

    private async runReconcile(): Promise<ReconcileResult> {
        // CC root is currently not implemented — log and proceed mimo-only.
        // The setting continues to exist so the UI toggle works; full CC
        // support (walkCcRoot + parseCcPath + frontmatter type detection)
        // will be added in a future slice.
        if (this.settings.ccIndex) {
            // Intentionally not throwing — the setting is respected (logged)
            // but doesn't break search. This matches MiMo Code's pattern of
            // gracefully degrading when CC is unavailable.
            console.warn(
                "[MarkdownMemoryService] ccIndex=true is not yet implemented — proceeding with mimo root only",
            );
        }
        return reconcileMemory(this.rootDir, this.index satisfies ReconcileDatabase);
    }

    // ─── Search ────────────────────────────────────────────────────────────

    /**
     * Search memory files via FTS5 BM25.
     *
     * Flow:
     *   1. (gated by `reconcileOnSearch` or `forceReconcile`) sync disk → index
     *   2. build FTS query from raw user string
     *   3. query index with filters + score floor
     *
     * Returns [] when:
     *   - service is disabled
     *   - query is empty / produces no FTS tokens
     *   - no matches found
     */
    async search(
        rawQuery: string,
        filters: MemorySearchFilters = {},
        options: ReconcileAndSearchOptions = {},
    ): Promise<MemorySearchHit[]> {
        if (!this.settings.enabled) return [];

        // Reconcile gate: default follows setting; forceReconcile/skipReconcile
        // override per-call. Skip when query is empty — nothing to match.
        const shouldReconcile =
            !!rawQuery.trim() &&
            (options.forceReconcile ??
                (!options.skipReconcile && this.settings.reconcileOnSearch));
        if (shouldReconcile) {
            await this.reconcile();
        }

        const ftsQuery = buildFtsQuery(rawQuery);
        if (!ftsQuery) return [];

        return this.index.search(ftsQuery, filters, {
            limit: options.limit,
            scoreFloor: options.scoreFloor ?? this.settings.searchScoreFloor,
        });
    }

    /**
     * Read a single memory file's full body. Returns null when the file
     * isn't indexed. The caller can use this to fetch the full content of a
     * search hit (search returns only a snippet).
     */
    async read(absolutePath: string): Promise<MemoryReadResult | null> {
        if (!this.settings.enabled) return null;
        const row = await this.index.getByPath(absolutePath);
        if (!row) return null;
        const locator = this.parseMemoryPath(absolutePath);
        if (!locator) return null;
        return {
            locator,
            path: absolutePath,
            body: row.body,
        };
    }

    /**
     * List all indexed memory paths. Useful for diagnostics and the
     * dream/distill "what's in memory?" workflow.
     *
     * Gated by `settings.enabled`: when false, returns `[]` without
     * touching the SQLite index. Keeps "memory is off" intent intact for
     * callers that enumerate indexed paths to plan subsequent reads.
     */
    async listIndexed(): Promise<string[]> {
        if (!this.settings.enabled) return [];
        const map = await this.index.loadIndexedPaths();
        return Array.from(map.keys());
    }

    /**
     * Walk the disk memory dir directly (no index). Used by dream/distill
     * to enumerate memory files regardless of index state.
     *
     * Gated by `settings.enabled`: when false, returns `[]` without
     * walking the disk memory root. Honoring the gate here keeps
     * "memory is off" semantics consistent across all list* / read paths,
     * even though this method reads disk (not SQLite). Callers that need
     * raw disk enumeration regardless of the toggle should call
     * `walkMemoryDir(this.memoryRoot)` directly.
     */
    listDiskFiles(): string[] {
        if (!this.settings.enabled) return [];
        return walkMemoryDir(this.rootDir);
    }

    close(): void {
        this.index.close();
    }
}
