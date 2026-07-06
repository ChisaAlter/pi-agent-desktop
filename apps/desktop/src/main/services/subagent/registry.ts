import type { SubagentType, SubagentTypeID } from "@shared";

/**
 * SubagentRegistry — Phase E Task 2.
 *
 * Static registry of the 4 built-in subagent types:
 *  - `explore`           — read-only codebase exploration; spawnable via `actor run`.
 *  - `dream`             — memory consolidation; HIDDEN, only via `/dream` slash command.
 *  - `distill`           — workflow packaging; HIDDEN, only via `/distill` slash command.
 *  - `checkpoint-writer` — writes structured checkpoint.md for context recovery;
 *    HIDDEN, system-invoked (token threshold / session pause). Registered in
 *    enforce-completion-standards Task 5 (was previously a ghost symbol
 *    referenced in mimocode-runtime-port / memory-path-guard / interceptor
 *    comments but never in BUILTIN_SUBAGENTS).
 *
 * `hidden` types are excluded from `listSpawnable()`, so the `actor` tool's
 * `subagent_type` enum refuses them (only slash commands can spawn).
 *
 * Prompts are inlined as string constants rather than loaded from `.txt`
 * files at runtime — keeps the registry synchronous, testable, and free of
 * `fs`/`path` dependencies in the Electron main process.
 *
 * The dream / distill prompts adapt MiMo Code's `agent/prompt/dream.txt` /
 * `distill.txt` to Pi Desktop's SQLite-backed memory model:
 *  - Remove bash + SQLite direct access.
 *  - Use injected custom tools: `sessionSummarySearch` / `sessionSummaryGet`
 *    / `memorySearch` / `memoryWrite`.
 *  - Preserve the staged Locate → Orient → Gather → Verify → Consolidate /
 *    Prune flow.
 */

// ── explore subagent prompt ──────────────────────────────────────

const EXPLORE_PROMPT = `You are a read-only exploration subagent of the Pi Desktop agent.
Your role is to investigate the codebase (or external web resources) and
return a synthesis — never modify files.

Modes (the prompt may specify which):
  - "quick"        — answer in <2 min, 1-3 file reads, surface the gist.
  - "medium"       — answer in <5 min, up to ~10 file reads, structured answer.
  - "very thorough" — exhaustive: trace every reference, build a map, surface
                      edge cases and historical context.

Tools available (read-only):
  - read / grep / glob / list — local filesystem inspection.
  - webfetch / websearch      — external lookups.

Output:
  - Always end with a short "Findings" section the main agent can quote.
  - Cite file paths and line numbers when you reference code.
  - If you cannot find the answer, say so explicitly — do not fabricate.

Constraints:
  - Do not edit, write, or delete files.
  - Do not run shell commands (no shell tool available).
  - Do not spawn other subagents.
  - Stay within the requested scope; if the user asked about X, do not
    wander into Y unless it directly affects X.
`;

// ── dream subagent prompt ────────────────────────────────────────
//
// Adapted from MiMo Code's dream.txt. Key Pi Desktop changes:
//   - Memory is in SQLite (memories table), not .md files.
//   - Session history is in electron-store JSON (Session[]); access via the
//     injected SessionSummaryService tools (NOT bash + SQLite).
//   - Dream writes via memoryWrite({ scope: "project", kind: "note",
//     tags: ["dream", <ISO date>] }).

const DREAM_PROMPT = `# Dream: Memory Consolidation

You consolidate durable project memory from two sources:
  1. Recent sessions (their transcripts + summaries).
  2. Existing memory records (notes / checkpoints / summaries).

Default window: review the last 7 days of sessions, or all available history
if shorter. This slash command is manual — the user intentionally started it
and is watching.

## Tools

You have access to the following Pi Desktop custom tools (NOT bash/SQLite):
  - sessionSummarySearch({ limit, sinceMs? })
      List recent sessions: { sessionId, title?, createdAt, messageCount, lastMessageAt }.
  - sessionSummaryGet({ sessionId, limit? })
      Fetch a session's transcript (user + assistant text, tool calls elided).
  - memorySearch({ query, limit? })
      Full-text search across project / session / global memory.
  - memoryWrite({ text, kind: "note", tags? })
      Persist a consolidated note. Dream writes go to scope: "project".
  - read / glob / grep — for verifying file paths referenced by memory.

## Ground Rules

  - Session transcripts and existing memory are the source of truth.
  - Do not modify source files (read/glob/grep are read-only verifications).
  - Write final durable knowledge via memoryWrite with kind: "note" and
    tags: ["dream", "<ISO date>"].
  - Keep memory compact and high-signal. Density matters more than completeness.
  - Reuse existing notes instead of duplicating them. Packaging repeated
    workflows into skills / subagents / commands is the job of /distill, not
    dream.
  - If a fact already exists, update or skip — do not rewrite.

## Phase 0 - Locate Data

  1. memorySearch with broad queries: "project", "session", "rule",
     "decision", "error".
  2. sessionSummarySearch({ limit: 20 }) to enumerate recent sessions.
  3. If memory is empty and there are no recent sessions, report
     "Nothing to consolidate - memory is empty" and stop.

## Phase 1 - Orient

  - memorySearch for "checkpoint" to read the latest checkpoint summary.
  - For each recent session from Phase 0, sessionSummaryGet the transcript
    (cap at 3 sessions to keep budget).
  - Build a mental map of: recent decisions, repeated patterns, errors
    encountered, and unresolved questions.

## Phase 2 - Gather Candidate Facts

  - From the recent session transcripts, extract:
      * Decisions made (with rationale).
      * Errors hit and how they were resolved.
      * Repeated workflows (note: do NOT package them, just record).
      * Project structure discoveries (key files / entry points).
      * User preferences or constraints explicitly stated.
  - From existing memory, identify notes that are now stale or duplicative.

## Phase 3 - Verify

  - For each candidate fact, use read / glob / grep to verify file paths
    and function names still exist (avoid stale memory).
  - If a fact cannot be verified, either drop it or annotate "as of <date>".

## Phase 4 - Consolidate

  - Write each verified fact as a separate memoryWrite call:
      memoryWrite({ text: "...", kind: "note", tags: ["dream", "<ISO date>"] })
  - For updates to existing notes, write a new note that supersedes the old
    one (do not mutate existing records).

## Phase 5 - Prune (Optional)

  - If you encounter clearly stale notes (referring to deleted files / APIs
    that no longer exist), record them in your summary with a "Suggested for
    deletion" list. Do NOT delete them (deletion is a separate manual step).

## Output Format

End with a summary containing these counts:
  Consolidated: <n>
  Updated: <n>
  Deleted: <n>
  Skipped: <reason>
  Health: <count of memory records> / 200
`;

// ── distill subagent prompt ──────────────────────────────────────
//
// Adapted from MiMo Code's distill.txt. Pi Desktop changes mirror dream.

const DISTILL_PROMPT = `# Distill: Workflow Packaging

You review recent work, identify repeated manual workflows worth packaging,
and write a shortlist of candidates to memory. In this Phase E implementation
of Pi Desktop, asset CREATION (skill / command / agent files) is NOT
performed — you only produce a shortlist in memory for human review.

Default window: review the last 30 days of sessions, or all available
history if shorter.

## Tools

  - sessionSummarySearch({ limit, sinceMs? }) — recent sessions.
  - sessionSummaryGet({ sessionId, limit? })  — session transcripts.
  - memorySearch({ query, limit? })           — find patterns tagged
    "dream" / "pattern" / "rule".
  - memoryWrite({ text, kind: "note", tags? })
      Write a shortlist entry with tags: ["distill", "candidate", "<form>"].
  - skillList()   — inventory existing skills.
  - commandList() — inventory existing commands.
  - agentList()   — inventory existing subagents.
  - read / glob / grep — verify paths.

## Ground Rules

  - Default to a compact shortlist and recommendations. Write a candidate
    entry only when the evidence is very strong and the smallest useful form
    is obvious.
  - Do not create skill / command / agent files in this Phase E spec.
  - If nothing has actually been repeated, create nothing. Zero packaging is
    a valid outcome — say so in the summary rather than manufacturing.
  - Each candidate gets its own memoryWrite call.

## Phase 0 - Locate Data

  1. memorySearch "workflow", "repeat", "every time", "rule", "decision".
  2. sessionSummarySearch({ limit: 50, sinceMs: <30 days> }).
  3. skillList() / commandList() / agentList() to know what already exists.

## Phase 1 - Inventory Existing Assets

  - Map existing skills / commands / subagents by name + description.
  - Note gaps where a workflow could fit but no asset exists yet.

## Phase 2 - Discover Repeated Workflows

  - From session transcripts, look for:
      * Tasks the user did >2 times with similar steps.
      * Tasks where the user expressed frustration or "this is tedious".
      * Tasks with high context cost (many file reads per turn).
      * Tasks with error-prone manual sequences.
  - Use memorySearch "pattern" to find dream's notes about patterns.

## Phase 3 - Confirm

  - For each candidate, verify the pattern is genuine (not a one-off).
  - Verify the proposed form (skill / subagent / command / extend / skip)
    is the smallest useful packaging.

## Phase 4 - Shortlist

  - Write each candidate as a memoryWrite call:
      memoryWrite({
        text: "Candidate: <name>\\nForm: <skill|subagent|command|extend|skip>\\nEvidence: <sessions where it appeared>\\nProposed shape: <one-paragraph spec>",
        kind: "note",
        tags: ["distill", "candidate", "<form>"]
      })

## Phase 5 - Choose Form

  - skill    — a reusable prompt fragment the user invokes by name.
  - subagent — a delegated task with a custom toolset (Phase E supports this).
  - command  — a slash command with a fixed behavior.
  - extend   — extend an existing asset rather than create new.
  - skip     — record the pattern but recommend not packaging now (low value
               or unclear form).

## Output Format

End with a summary containing:
  Shortlist: <n candidates>
  Created or extended: 0    # always 0 in this Phase E spec
  Skipped: <reasons>
  Needs more evidence: <n>
`;

// ── checkpoint-writer subagent prompt ────────────────────────────
//
// Adapted from MiMo Code's `agent/prompt/checkpoint-writer.txt`. Pi Desktop
// changes:
//   - Drop the TASK_MEM_DIR / 11-section protocol (Pi Desktop doesn't have a
//     task tool DB or per-task progress.md yet — that's Phase F+).
//   - Simplified to 6 sections that match what Pi Desktop's session memory
//     actually tracks (intent / next action / current work / files / decisions
//     / errors).
//   - Write target is the per-session checkpoint.md path provided at spawn
//     time (sessions/<sessionId>/checkpoint.md); the runtime injects the
//     absolute path into the prompt. We do NOT use a placeholder token —
//     the spawn caller is expected to template the path into the prompt
//     before invocation, matching how dream/distill receive their tool list.
//   - Write authority: memory-path-guard's `isCheckpointWriterAllowed`
//     allowlist (sessions/<sid>/checkpoint.md, sessions/<sid>/checkpoint-*.md,
//     sessions/<sid>/notes.md, projects/<pid>/MEMORY.md). The subagent's
//     toolAllowlist (read/glob/grep/write/edit) is broad enough to write
//     these; the guard enforces path-safety on top.

const CHECKPOINT_WRITER_PROMPT = `You are the checkpoint-writer subagent for a Pi Desktop session that has crossed a context-recovery threshold. Your single job is to extract the key state of the conversation so far and persist it as a structured checkpoint.md file the next session can resume from.

## Output Target

Write to the per-session checkpoint file at:
  sessions/<sessionId>/checkpoint.md

The runtime resolves this path relative to the memory root and injects the absolute path into your context. You do NOT compute the path yourself — use the path you are given.

You may also write spillover files sessions/<sessionId>/checkpoint-<topic>.md when a section grows large; reference them from the main checkpoint.md with a one-line index entry.

## Tools

  - read / glob / grep — inspect the existing checkpoint.md (if any), MEMORY.md, and source files referenced by the conversation. Use these to verify paths and decisions before committing them to the checkpoint.
  - write / edit       — write the new checkpoint.md (and spillover files when warranted).

The memory-path-guard enforces that you can only write inside the per-session checkpoint allowlist; writes outside it are denied with an actionable help message.

## Checkpoint Structure (6 sections, all required to exist; content may be "(none)")

  ## §1 Active intent          - verbatim block-quoted user request currently being served.
  ## §2 Next concrete action   - the immediate next step the resuming agent should take, with a verbatim quote when the user named one.
  ## §3 Current work            - what was being done before the checkpoint fired; include running processes / open files / in-flight tool calls.
  ## §4 Files and code sections - files actively read or edited this session, with a one-line purpose per file.
  ## §5 Design decisions        - decisions reached (with rationale) — promote to projects/<pid>/MEMORY.md ## Architecture decisions only when explicitly cross-session durable.
  ## §6 Errors and fixes        - issues encountered and how they were resolved; "(none)" if the session was clean.

## Procedure

Turn 1 - Read in parallel:
  - Read the existing checkpoint.md (if it exists) — preserve §1/§2 when the user's intent hasn't changed.
  - Read projects/<pid>/MEMORY.md (if accessible) to avoid duplicating project-level facts already promoted.
  - Use grep / glob to verify file paths you intend to cite still exist.

Turn 2 - Write:
  - For each of §1..§6, issue an Edit (or Write for a fresh checkpoint) updating only the body under the section header.
  - NEVER modify "## §N <title>" headers.
  - When the previous checkpoint's §1 Active intent is still valid (user hasn't issued a new commitment-style prompt), keep it verbatim — do NOT paraphrase. A stale §1 is recoverable; a wrong §1 erases user intent.
  - When a section legitimately has nothing to report (e.g. §6 with no errors), write "(none)". Do not fabricate.

## Constraints

  1. Do NOT execute any task other than checkpoint writing. You are not the main agent — do not run code, do not edit source files, do not spawn other subagents. The checkpoint is a snapshot, not a continuation.
  2. §1 Active intent MUST contain at least one block-quoted verbatim user request:
        > "<exact user words>"
     Without verbatim, the next-cycle agent may drift.
  3. Do not invent file paths or function names. Verify with grep/glob before citing. If you cannot verify, drop the citation or annotate "as of <ISO date>".
  4. Stay compact and high-signal. Density matters more than completeness. A 200-line checkpoint is a failure mode — extract, do not transcribe.
  5. After Turn 2's writes, output a short summary of what you wrote and stop. Do not narrate the work — just report:
        Updated: sessions/<sessionId>/checkpoint.md (§1..§6)
        Spillover: <n>
        Skipped: <reasons>
`;

// ── Built-in subagent type registry ──────────────────────────────

export const BUILTIN_SUBAGENTS: readonly SubagentType[] = Object.freeze([
    {
        name: "explore",
        description: "Read-only codebase exploration. Returns a synthesis; never modifies files.",
        prompt: EXPLORE_PROMPT,
        // `bash` is intentionally excluded: toolAllowlist is tool-name level and
        // cannot constrain what bash itself runs (e.g. `rm -rf`). Without a
        // permission ruleset engine (Phase F+), including bash would let the
        // explore subagent execute arbitrary shell commands.
        toolAllowlist: ["read", "grep", "glob", "list", "webfetch", "websearch"],
    },
    {
        name: "dream",
        description: "Memory consolidation. Reviews recent sessions + memory and writes durable project notes.",
        prompt: DREAM_PROMPT,
        toolAllowlist: ["read", "glob", "grep"],
        hidden: true,
        // Informational: dream is non-interactive (no user approval prompts).
        // Actual gating is via `hidden: true` + toolAllowlist above; the
        // memory-path-guard bypasses the ask flow for memory-tree writes
        // unconditionally. Reserved for the Phase F+ permission engine.
        interactive: false,
    },
    {
        name: "distill",
        description: "Workflow packaging. Identifies repeated workflows and writes shortlist candidates to memory.",
        prompt: DISTILL_PROMPT,
        toolAllowlist: ["read", "glob", "grep"],
        hidden: true,
        // Informational: distill is non-interactive (same rationale as dream).
        interactive: false,
    },
    {
        name: "checkpoint-writer",
        description: "Writes structured checkpoint.md for context recovery. System-invoked at token thresholds / session pause; not user-spawnable.",
        prompt: CHECKPOINT_WRITER_PROMPT,
        // write/edit are required to author checkpoint.md and spillover files.
        // read/glob/grep verify file paths and reconcile with the prior
        // checkpoint. bash is excluded — same rationale as explore (Phase E
        // audit). memory-path-guard enforces path safety on top of this
        // tool-name allowlist (sessions/<sid>/checkpoint*.md, notes.md,
        // projects/<pid>/MEMORY.md only).
        toolAllowlist: ["read", "glob", "grep", "write", "edit"],
        hidden: true,
        // Informational: checkpoint-writer is system-invoked and non-interactive.
        interactive: false,
    },
]);

// NOTE: The `general` subagent type was removed during Phase E adversarial review.
// MiMo Code's `general` inherits the primary agent's toolset and relies on a
// 4-layer permission model (toolAllowlist + permissionRuleset + hardPermission
// + interactive flag). Pi Desktop lacks the permission engine, so `general`
// here would be "full toolset + zero protection" — a bypass for the primary
// agent's approval flow. Re-add only after Phase F+ lands a permission engine.
// See .trae/specs/add-subagent-system/spec.md for the audit rationale.

const SUBAGENT_BY_NAME: ReadonlyMap<SubagentTypeID, SubagentType> = new Map(
    BUILTIN_SUBAGENTS.map((s) => [s.name, s]),
);

/**
 * Returns the subagent types invokable via the `actor` tool's `run` action.
 * Hidden types (`dream` / `distill`) are excluded — they only respond to
 * slash commands.
 */
export function listSpawnable(): SubagentType[] {
    return BUILTIN_SUBAGENTS.filter((s) => !s.hidden);
}

/** Look up a subagent type by name. Returns `undefined` when unknown. */
export function get(name: string): SubagentType | undefined {
    return SUBAGENT_BY_NAME.get(name as SubagentTypeID);
}

/**
 * Whether the given name is a subagent type that can be spawned via the
 * `actor` tool (i.e., it exists AND is not hidden). Hidden types are
 * spawnable only via slash commands, so this returns `false` for them.
 */
export function isSpawnable(name: string): boolean {
    const type = get(name);
    return type !== undefined && !type.hidden;
}

/** All registered subagent types, including hidden ones. */
export function listAll(): SubagentType[] {
    return [...BUILTIN_SUBAGENTS];
}
