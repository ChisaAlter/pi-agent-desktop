/**
 * memory-path-guard.ts — Pure-function write guard for the memory tree.
 *
 * Ported from MiMo Code's `tool/memory-path-guard.ts:95-161` with Pi Desktop's
 * path conventions. The guard is invoked by:
 *   - The interceptor's edit-family branch (`apps/desktop/src/main/services/approval/interceptor.ts:159`)
 *   - The subagent `memory_write` tool (`apps/desktop/src/main/services/subagent/tools/memory-tools.ts:190`)
 * Both call sites use `assertMemoryWriteAllowed()` to enforce project isolation,
 * scope rules, and checkpoint-writer reservations.
 *
 * Design (mirrors MiMo Code):
 *
 *   - **Non-memory paths**: return early (no throw). The guard only enforces
 *     writes INSIDE the memory tree. Outside, write/edit permission rulesets
 *     apply as usual.
 *
 *   - **Inside the memory tree**: validate scope + agent + write target.
 *
 *       scope must be one of `global`/`projects`/`sessions` (CC is NOT
 *       writable — it's read-only index source).
 *
 *       `checkpoint-writer` agent has its own allowlist (writes checkpoint.md,
 *       MEMORY.md, notes.md, tasks/<TID>/*.md). Other agents can write free
 *       keys under projects/sessions but NOT under sessions/<sid>/tasks/
 *       (reserved for checkpoint-writer + task-bound subagents).
 *
 *       Task-bound subagents (those carrying a `taskId`) can write
 *       sessions/<sid>/tasks/<ownTID>/*.md.
 *
 *   - **Errors include a help string** explaining where the agent IS allowed
 *     to write — this gives dream/distill/checkpoint-writer actionable
 *     guidance instead of an opaque denial.
 *
 * This module is **pure** — no fs reads, no Electron, no side effects. It
 * takes a `memoryRoot` and a `target` (both absolute paths) and either
 * returns normally (allow) or throws (deny). Unit-testable without any I/O.
 */

import { join, relative } from "path";

/** Agent names recognised by the guard. */
export type MemoryAgentName =
    | "checkpoint-writer"
    | "dream"
    | "distill"
    | "main"
    | "build"
    | "plan"
    | "compose"
    | "explore"
    | "max"
    | string; // accept unknown agent names — they fall through to the general rule

/** Task ID regex — matches `T1`, `T2.1`, `T10.3.2`, etc. */
const TASK_ID_RE = /^T\d+(\.\d+)*$/;

/** Scopes the guard considers writable. `cc` is intentionally NOT here. */
const WRITABLE_SCOPES = ["global", "projects", "sessions"] as const;
type WritableScope = (typeof WRITABLE_SCOPES)[number];

export interface AssertMemoryWriteInput {
    /** Absolute path of the file being written/edited. */
    target: string;
    /** Agent requesting the write (e.g. "dream", "checkpoint-writer", "main"). */
    agentName: string;
    /** Absolute path of the memory root (e.g. `<userData>/memory`). */
    memoryRoot: string;
    /** Project ID (sha256-derived in Pi Desktop). */
    projectId: string;
    /** Session ID (required for `sessions/` scope writes). */
    sessionId: string;
    /** Task ID, if the agent is bound to a task (task-bound subagent flow). */
    taskId?: string;
}

/**
 * Assert that a write to `target` is allowed under the memory-path-guard rules.
 *
 * Throws `Error` with an actionable help message when denied. Returns
 * `void` (no exception) when allowed.
 *
 * The guard is intentionally a pure function — it does not touch the
 * filesystem, so it can be unit-tested without mocks and called
 * synchronously from the write-tool execute path.
 */
export function assertMemoryWriteAllowed(input: AssertMemoryWriteInput): void {
    const { target, agentName, memoryRoot, projectId, sessionId, taskId } = input;

    // Normalise separators so the prefix check works on both Windows (\) and
    // POSIX (/). We compare on the forward-slash form throughout.
    const normalizedRoot = ensureTrailingSep(toForward(memoryRoot));
    const normalizedTarget = toForward(target);

    // Non-memory paths: early return — the guard has no opinion. The caller
    // (write-tool execute path) continues with its normal permission flow.
    //
    // Edge case: when target === memoryRoot (writing to the root itself),
    // normalizedTarget lacks the trailing separator and `startsWith` returns
    // false. We catch this by also checking the unslash-stripped forms —
    // a write to exactly the memory root is denied (it's a directory, not a
    // .md file).
    const rootNoTrailing = normalizedRoot.replace(/\/$/, "");
    if (normalizedTarget !== rootNoTrailing && !normalizedTarget.startsWith(normalizedRoot)) {
        return;
    }

    const rel = relative(normalizedRoot, normalizedTarget).replace(/\\/g, "/");
    const parts = rel.split("/");

    // Need at least `<scope>/<file>.md` — anything shorter is the memory root
    // itself or a directory, neither of which is a valid write target.
    if (parts.length < 2) {
        throw new Error(
            formatHelp(
                "target is the memory root or a scope directory — write to a .md file inside",
                agentName,
                projectId,
                sessionId,
            ),
        );
    }

    const scope = parts[0];
    if (!isWritableScope(scope)) {
        throw new Error(
            formatHelp(
                `scope "${scope}" is not writable (CC scope is read-only; use global/projects/sessions)`,
                agentName,
                projectId,
                sessionId,
            ),
        );
    }

    // Project isolation: when writing under `projects/<pid>/...`, the path's
    // projectId (parts[1]) must match the caller's `projectId`. This prevents
    // a dream agent bound to projectId="abc" from writing to
    // `projects/<another-pid>/MEMORY.md` and bypassing project isolation.
    // `global/...` and `sessions/<sid>/...` are not project-scoped, so they
    // bypass this check.
    //
    // Safe to access parts[1] here: the `parts.length < 2` guard above
    // already threw for paths shorter than `<scope>/<file>`.
    if (scope === "projects" && parts[1] !== projectId) {
        throw new Error(
            formatHelp(
                `projectId mismatch: expected=${projectId}, actual=${parts[1]} (agent bound to projectId="${projectId}" cannot write under projects/<${parts[1]}>/)`,
                agentName,
                projectId,
                sessionId,
            ),
        );
    }

    // checkpoint-writer has its own allowlist — check it before the general
    // rule. This agent is the only one allowed to write to sessions/<sid>/tasks/.
    if (agentName === "checkpoint-writer") {
        if (!isCheckpointWriterAllowed(parts, sessionId, projectId)) {
            throw new Error(
                formatHelp(
                    "checkpoint-writer may only write projects/<pid>/MEMORY.md, sessions/<sid>/{checkpoint,notes}.md, or sessions/<sid>/tasks/<TID>/*.md",
                    agentName,
                    projectId,
                    sessionId,
                ),
            );
        }
        return;
    }

    // sessions/<sid>/tasks/ is reserved for checkpoint-writer + task-bound
    // subagents. The general rule (dream/distill/main) cannot write there.
    if (isReservedForCheckpointWriter(parts)) {
        // Exception: a task-bound subagent may write under its OWN task dir.
        if (taskId && isTaskBoundWrite(parts, sessionId, taskId)) {
            return;
        }
        throw new Error(
            formatHelp(
                "sessions/<sid>/tasks/ is reserved for checkpoint-writer and task-bound subagents — write to projects/<pid>/MEMORY.md or sessions/<sid>/notes.md instead",
                agentName,
                projectId,
                sessionId,
            ),
        );
    }

    // General rule: any free key under a writable scope is allowed. The
    // path-safety check (no `..`, no absolute components) is the
    // responsibility of the caller (paths.ts buildPath already enforces
    // this for the write tool's target resolution).
}

function isWritableScope(scope: string): scope is WritableScope {
    return (WRITABLE_SCOPES as readonly string[]).includes(scope);
}

/**
 * checkpoint-writer's allowlist (mirrors MiMo Code `memory-path-guard.ts:20-45`).
 *
 *   projects/<pid>/MEMORY.md              — allowed (pid must match expectedProjectId)
 *   projects/<pid>/memory-<topic>.md      — allowed (case-insensitive `memory-` prefix; pid must match)
 *   sessions/<sid>/checkpoint.md           — allowed
 *   sessions/<sid>/checkpoint-<topic>.md  — allowed
 *   sessions/<sid>/notes.md                — allowed
 *   sessions/<sid>/tasks/<TID>/<any>.md   — allowed (TID must match TASK_ID_RE)
 *
 * `parts` is the relative path split by `/`, e.g. `["sessions", "sid1", "tasks", "T1", "progress.md"]`.
 *
 * `expectedProjectId` is checked for `projects/<pid>/...` paths as a
 * defense-in-depth measure — the caller (`assertMemoryWriteAllowed`) already
 * throws with a specific mismatch error before reaching this function, but
 * verifying here too keeps the helper self-contained and reusable.
 */
function isCheckpointWriterAllowed(
    parts: string[],
    expectedSessionId: string,
    expectedProjectId: string,
): boolean {
    if (parts.length < 3) return false;

    if (parts[0] === "projects") {
        if (parts[1] !== expectedProjectId) return false;
        if (parts.length !== 3) return false;
        const file = parts[2];
        if (!file.endsWith(".md")) return false;
        // case-insensitive: bridges legacy memory.md and renamed MEMORY.md
        const lower = file.toLowerCase();
        return lower === "memory.md" || lower.startsWith("memory-");
    }

    if (parts[0] === "sessions") {
        // sessions/<sid>/<file>.md  OR  sessions/<sid>/tasks/<TID>/<file>.md
        if (parts[1] !== expectedSessionId) return false;
        const rest = parts.slice(2);

        // sessions/<sid>/<file>.md
        if (rest.length === 1) {
            const file = rest[0];
            if (!file.endsWith(".md")) return false;
            return (
                file === "checkpoint.md" ||
                file === "notes.md" ||
                file.startsWith("checkpoint-")
            );
        }

        // sessions/<sid>/tasks/<TID>/<any>.md
        if (rest.length === 3 && rest[0] === "tasks") {
            return TASK_ID_RE.test(rest[1]) && rest[2].endsWith(".md");
        }

        return false;
    }

    return false;
}

/**
 * Returns true when the path is under `sessions/<sid>/tasks/` — the subtree
 * reserved for checkpoint-writer and task-bound subagents.
 */
function isReservedForCheckpointWriter(parts: string[]): boolean {
    if (parts[0] !== "sessions") return false;
    if (parts.length < 4) return false; // sessions/<sid>/tasks/<file>
    return parts[2] === "tasks";
}

/**
 * Returns true when the write is a task-bound subagent writing to its own
 * task's directory: `sessions/<sid>/tasks/<ownTID>/<any>.md`.
 */
function isTaskBoundWrite(
    parts: string[],
    expectedSessionId: string,
    taskId: string,
): boolean {
    if (parts[0] !== "sessions") return false;
    if (parts[1] !== expectedSessionId) return false;
    if (parts.length < 5) return false; // sessions/<sid>/tasks/<TID>/<file>.md
    if (parts[2] !== "tasks") return false;
    if (parts[3] !== taskId) return false;
    if (!TASK_ID_RE.test(taskId)) return false;
    const last = parts[parts.length - 1];
    return last.endsWith(".md");
}

function ensureTrailingSep(p: string): string {
    return p.endsWith("/") ? p : `${p}/`;
}

function toForward(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Build an actionable help message — tells the agent where it IS allowed to
 * write. Mirrors MiMo Code's `formatMainAgentHelp` pattern.
 */
function formatHelp(
    reason: string,
    agentName: string,
    projectId: string,
    sessionId: string,
): string {
    const memoryFile = `projects/${projectId}/MEMORY.md`;
    const notesFile = `sessions/${sessionId}/notes.md`;
    const checkpointFile = `sessions/${sessionId}/checkpoint.md`;
    return [
        `memory-path-guard denied write for agent "${agentName}": ${reason}`,
        "",
        "Writable targets under the memory root:",
        `  ${memoryFile}        (project-level durable memory)`,
        `  ${notesFile}                 (per-session scratch notes)`,
        `  ${checkpointFile}       (per-session checkpoint, written by checkpoint-writer)`,
        `  global/MEMORY.md             (cross-project user preferences)`,
        `  global/<free-key>.md         (free-form global notes)`,
    ].join("\n");
}

/**
 * Returns true when `target` is inside the memory tree rooted at `memoryRoot`.
 *
 * Mirrors the early-return check inside `assertMemoryWriteAllowed` — exposed
 * as a helper so callers (e.g. the approval interceptor) can decide whether
 * to invoke the guard at all without duplicating the path-normalisation
 * logic. Pure: no fs reads, no side effects.
 */
export function isInsideMemoryTree(target: string, memoryRoot: string): boolean {
    const normalizedRoot = ensureTrailingSep(toForward(memoryRoot));
    const normalizedTarget = toForward(target);
    const rootNoTrailing = normalizedRoot.replace(/\/$/, "");
    return normalizedTarget === rootNoTrailing || normalizedTarget.startsWith(normalizedRoot);
}

/**
 * Convenience: build the absolute memory root path. Centralised here so
 * callers don't hardcode `join(userData, "memory")` in multiple places.
 */
export function memoryRootPath(userData: string): string {
    return join(userData, "memory");
}

/**
 * Convenience: build the absolute markdown index DB path. Co-located with
 * the memory root for discoverability — `<userData>/memory/index.sqlite`.
 */
export function markdownIndexDbPath(userData: string): string {
    return join(userData, "memory", "index.sqlite");
}
