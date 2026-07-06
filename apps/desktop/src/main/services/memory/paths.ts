import { createHash } from "crypto";
import { readdirSync, statSync } from "fs";
import { join, resolve } from "path";

/**
 * Memory file path resolution for the "markdown files + FTS5 index" architecture
 * (Slice 5 rewrite, inspired by MiMo Code's memory layout).
 *
 * File layout under <userData>/memory/:
 *   global/MEMORY.md                       (cross-project user preferences)
 *   global/<key>.md                        (free-form)
 *   projects/<projectId>/MEMORY.md         (project-level memory)
 *   projects/<projectId>/memory-<topic>.md (spillover)
 *   sessions/<sessionId>/checkpoint.md     (session checkpoint)
 *   sessions/<sessionId>/notes.md           (scratch)
 *   sessions/<sessionId>/tasks/<taskId>/progress.md  (sub-agent progress)
 *
 * This module is pure Node.js — no SQLite, no Electron. Path manipulation only.
 */

export type MemoryScope = "global" | "projects" | "sessions";
export type MemoryType = "memory" | "checkpoint" | "progress" | "notes" | "free";

export interface MemoryLocator {
    scope: MemoryScope;
    /** projectId for "projects", sessionId for "sessions". Undefined for "global". */
    scopeId?: string;
    type: MemoryType;
    /**
     * File path relative to <scope>[/<scopeId>], without the `.md` extension.
     * Single segment for top-level files (e.g. "MEMORY", "checkpoint");
     * may contain slashes for nested files (e.g. "tasks/T1/progress").
     */
    filename: string;
}

/**
 * Filename → type classification rules.
 *
 * - `MEMORY.md` (case-insensitive)        → "memory"
 * - `memory-*.md` or `memory_*.md`         → "memory"
 * - `checkpoint.md` or `checkpoint-*.md`  → "checkpoint"
 * - `notes.md`                             → "notes"
 * - `progress.md` or `progress-*.md`      → "progress"
 * - anything else                          → "free"
 *
 * Patterns test against the basename (last path segment) so nested files like
 * "tasks/<taskId>/progress" classify by their final segment "progress".
 */
const TYPE_PATTERNS: ReadonlyArray<{ match: RegExp; type: MemoryType }> = [
    // MEMORY.md is the only case-insensitive match — it bridges legacy
    // memory.md and the renamed MEMORY.md during migration. Other filenames
    // are exact-case to catch writer drift early.
    { match: /^memory$/i, type: "memory" },
    { match: /^memory[-_]/i, type: "memory" },
    { match: /^checkpoint$/, type: "checkpoint" },
    { match: /^checkpoint-/, type: "checkpoint" },
    { match: /^notes$/, type: "notes" },
    { match: /^progress$/, type: "progress" },
    { match: /^progress-/, type: "progress" },
];

function detectType(filename: string): MemoryType {
    // Type detection uses the basename so nested paths like
    // "tasks/<taskId>/progress" classify by their final segment.
    const slashIdx = filename.lastIndexOf("/");
    const basename = slashIdx >= 0 ? filename.slice(slashIdx + 1) : filename;
    for (const p of TYPE_PATTERNS) {
        if (p.match.test(basename)) return p.type;
    }
    return "free";
}

/**
 * Reject path components that could escape the memory root: any segment equal
 * to "..", an empty segment (collapsing `//`), or a leading separator (which
 * would make the component absolute). Slashes inside the value are allowed —
 * nested filenames like "tasks/T1/progress" are valid.
 */
function assertSafeComponent(value: string | undefined, field: string): void {
    if (value === undefined) return;
    if (value.startsWith("/") || value.startsWith("\\")) {
        throw new Error(`buildPath: ${field} must not start with a path separator: ${value}`);
    }
    for (const segment of value.split(/[/\\]/)) {
        if (segment === "..") {
            throw new Error(`buildPath: ${field} contains a ".." segment: ${value}`);
        }
        if (segment === "") {
            throw new Error(`buildPath: ${field} contains an empty segment: ${value}`);
        }
    }
}

/**
 * Build an absolute memory file path from a locator.
 *
 * Example:
 *   buildPath("/data/memory", { scope: "projects", scopeId: "abc123",
 *                               type: "memory", filename: "MEMORY" })
 *   → "/data/memory/projects/abc123/MEMORY.md"
 *
 * For nested files, pass a multi-segment filename:
 *   buildPath("/data/memory", { scope: "sessions", scopeId: "sess1",
 *                               type: "progress", filename: "tasks/T1/progress" })
 *   → "/data/memory/projects/sess1/tasks/T1/progress.md"
 */
export function buildPath(rootDir: string, locator: MemoryLocator): string {
    if (locator.scope !== "global" && !locator.scopeId) {
        throw new Error(
            `buildPath: scopeId is required for scope "${locator.scope}"`,
        );
    }
    assertSafeComponent(locator.scopeId, "scopeId");
    assertSafeComponent(locator.filename, "filename");

    const parts: string[] = [rootDir, locator.scope];
    if (locator.scope !== "global") {
        parts.push(locator.scopeId as string);
    }
    parts.push(`${locator.filename}.md`);
    return resolve(...parts);
}

/** Normalize a path to forward slashes for cross-platform prefix comparison. */
function normalizeSep(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Parse an absolute memory file path back into a locator.
 *
 * Returns `null` when the path is not under `rootDir`, doesn't end in `.md`,
 * doesn't match one of the three scope conventions, or contains a `..`
 * segment that would escape the memory root.
 *
 * Handles Windows backslash paths by normalizing before comparison.
 */
export function parsePath(rootDir: string, filePath: string): MemoryLocator | null {
    const normalizedRoot = normalizeSep(resolve(rootDir));
    const normalizedFile = normalizeSep(resolve(filePath));

    // Must be strictly under rootDir (a `+ "/"` separator avoids matching
    // the root itself or a sibling directory that shares a prefix).
    if (!normalizedFile.startsWith(normalizedRoot + "/")) return null;

    const rel = normalizedFile.slice(normalizedRoot.length + 1);
    const segments = rel.split("/");
    if (segments.length < 2) return null;

    const scope = segments[0];
    if (scope !== "global" && scope !== "projects" && scope !== "sessions") {
        return null;
    }

    const last = segments[segments.length - 1];
    if (!last.endsWith(".md")) return null;
    const lastStem = last.slice(0, -3);
    if (lastStem === "") return null; // ".md" with no name — reject

    let scopeId: string | undefined;
    let filename: string;
    let intermediateStart: number;

    if (scope === "global") {
        // global/<filename>.md — no scopeId
        intermediateStart = 1;
        const middle = segments.slice(1, -1);
        filename = middle.length === 0 ? lastStem : `${middle.join("/")}/${lastStem}`;
    } else {
        // projects/<projectId>/<filename>.md
        // sessions/<sessionId>/<filename>.md
        if (segments.length < 3) return null;
        scopeId = segments[1];
        if (scopeId === ".." || scopeId === "") return null;
        intermediateStart = 2;
        const middle = segments.slice(2, -1);
        filename = middle.length === 0 ? lastStem : `${middle.join("/")}/${lastStem}`;
    }

    // Reject path traversal in intermediate segments — guards against
    // ../../etc/passwd.md style escapes that would otherwise parse cleanly.
    for (let i = intermediateStart; i < segments.length - 1; i++) {
        if (segments[i] === ".." || segments[i] === "") return null;
    }

    return {
        scope: scope as MemoryScope,
        scopeId,
        type: detectType(filename),
        filename,
    };
}

/**
 * Compute a deterministic 12-char projectId from an absolute workspace path.
 * Uses sha256(absoluteWorkspacePath).slice(0, 12) so the same workspace always
 * maps to the same id, regardless of which process asks.
 */
export function resolveProjectId(workspacePath: string): string {
    return createHash("sha256").update(workspacePath).digest("hex").slice(0, 12);
}

/**
 * Recursively walk the memory directory and return absolute paths of all
 * `.md` files. Skips hidden entries (names starting with `.`) and any
 * non-`.md` files. Directories are traversed depth-first.
 *
 * Returns `[]` when `rootDir` doesn't exist or isn't a directory — callers
 * treat an empty result as "nothing to index yet".
 */
export function walkMemoryDir(rootDir: string): string[] {
    const results: string[] = [];

    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return; // dir missing or unreadable — nothing to walk
        }
        for (const entry of entries) {
            // Skip hidden files AND directories (a `.git` style dir would
            // otherwise be traversed and pollute the result set).
            if (entry.startsWith(".")) continue;
            const full = join(dir, entry);
            let stat;
            try {
                stat = statSync(full);
            } catch {
                continue; // race between readdir and stat — skip
            }
            if (stat.isDirectory()) {
                walk(full);
            } else if (stat.isFile() && entry.endsWith(".md")) {
                results.push(full);
            }
        }
    };

    walk(rootDir);
    return results;
}
