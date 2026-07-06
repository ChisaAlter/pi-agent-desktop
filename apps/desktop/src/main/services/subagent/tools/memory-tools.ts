import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { Type } from "typebox";
import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { LongHorizonMemoryLayer, LongHorizonMemoryRecord, SubagentTypeID } from "@shared";
import type { MemoryService } from "../../long-horizon/memory-service";
import type { MemoryScope } from "../../long-horizon/database";
import type { MarkdownMemoryService } from "../../memory/markdown-memory-service";
import type { MemorySearchHit } from "../../memory/markdown-index";
import type { MemoryLocator } from "../../memory/paths";
import { assertMemoryWriteAllowed } from "../../memory/memory-path-guard";

/**
 * Memory custom tools — Phase E Task 4 (markdown architecture).
 *
 * Two tools injected into every subagent so they can both recall durable
 * memory and persist new notes.
 *
 *  - `memory_search` — FTS5 BM25 search across markdown memory files. Backed
 *    by `MarkdownMemoryService` (markdown-primary + SQLite FTS5 index, MiMo
 *    Code's architecture). Honours `LongHorizonSettings.memory.{enabled,
 *    ccIndex, reconcileOnSearch, searchScoreFloor}`.
 *
 *  - `memory_write`  — persists a note by APPENDING a new section to the
 *    target markdown memory file (MEMORY.md / notes.md / global/MEMORY.md),
 *    gated by `memory-path-guard`. Both read and write hit the same
 *    markdown backend → search returns what write just wrote (no more
 *    SQLite/markdown data-source mismatch). Falls back to the legacy
 *    SQLite-backed `MemoryService.put` only when `markdownMemoryService` is
 *    unavailable (e.g. memory disabled at the global settings level).
 *
 * Scope policy (spec.md "Subagent Memory Access"):
 *   - `explore` → `scope: "session"` (ephemeral).
 *   - `dream` / `distill` → `scope: "project"` + `kind: "note"` (durable).
 *
 * Workspace + sessionId are bound at construction time (from the spawn
 * context) so subagents cannot escape their own workspace.
 */

// ── Schemas ──────────────────────────────────────────────────────

const searchSchema = Type.Object({
    query: Type.String({ description: "Free-form query. Tokenized + FTS5 BM25-ranked." }),
    limit: Type.Optional(Type.Number({
        description: "(optional) Max results. Default 8.",
    })),
});

const writeSchema = Type.Object({
    text: Type.String({ description: "The note body. Keep it dense and high-signal." }),
    kind: Type.Optional(Type.String({
        description: "(optional) Memory kind. Default 'note'. One of: note | checkpoint | task-progress | summary.",
    })),
    tags: Type.Optional(Type.Array(Type.String(), {
        description: "(optional) Tags for later filtering. The scope-policy tag is auto-appended.",
    })),
});

interface SearchDetails {
    hits: Array<{
        path: string;
        scope: string;
        scopeId: string;
        type: string;
        snippet: string;
        score: number;
    }>;
}
interface WriteDetails { record: LongHorizonMemoryRecord }

// ── Scope policy ─────────────────────────────────────────────────

/**
 * Resolves the `scope` for `memory_write` based on the spawning subagent's
 * type. Per spec.md "Subagent Memory Access":
 *   - dream / distill write durable project memory.
 *   - explore write only ephemeral session memory.
 */
export type SubagentMemoryPolicy = (subagentType: SubagentTypeID) => MemoryScope;

export const DEFAULT_SUBAGENT_MEMORY_POLICY: SubagentMemoryPolicy = (subagentType) => {
    return subagentType === "dream" || subagentType === "distill" ? "project" : "session";
};

// ── Factory ─────────────────────────────────────────────────────

export interface MemoryToolsContext {
    /** Workspace the subagent runs in. Bound to every write/read. */
    workspaceId: string;
    /**
     * Absolute path of the workspace root. Used to compute the deterministic
     * `projectId` (sha256[:12]) for the markdown memory layout
     * (`projects/<projectId>/MEMORY.md`).
     */
    workspacePath: string;
    /** The subagent's own ephemeral session id. Used for `scope: "session"`. */
    sessionId: string;
    /** The subagent's type — drives scope policy. */
    subagentType: SubagentTypeID;
}

/**
 * Build memory tools for a subagent.
 *
 * @param legacyMemoryService  SQLite-backed MemoryService (for `memory_write`).
 * @param markdownMemoryService Markdown-primary search service (for `memory_search`).
 *                                May be omitted to fall back to the legacy
 *                                SQLite-backed search on MemoryService.
 * @param ctx                  Spawn context (workspaceId/sessionId/subagentType).
 * @param policy               Scope policy (default = DEFAULT_SUBAGENT_MEMORY_POLICY).
 */
export function createMemoryTools(
    legacyMemoryService: MemoryService,
    ctx: MemoryToolsContext,
    policy: SubagentMemoryPolicy = DEFAULT_SUBAGENT_MEMORY_POLICY,
    markdownMemoryService?: MarkdownMemoryService,
): ToolDefinition[] {
    const scope = policy(ctx.subagentType);

    const searchTool = defineTool({
        name: "memory_search",
        label: "Memory Search",
        description:
            "Full-text BM25 search across project / session / global memory markdown files. " +
            "Use to recall prior decisions, patterns, or context. Returns snippets with paths.",
        parameters: searchSchema,
        async execute(_id, params): Promise<AgentToolResult<SearchDetails>> {
            const limit = params.limit ?? 8;

            // Prefer the new markdown-primary service when available — it
            // honours LongHorizonSettings.memory.{enabled, ccIndex,
            // reconcileOnSearch, searchScoreFloor} and searches markdown
            // files on disk via FTS5.
            if (markdownMemoryService) {
                const hits = await markdownMemoryService.search(
                    params.query,
                    {}, // scope filter derived from session/project at spawn time, not user-controlled
                    { limit },
                );
                return {
                    content: [{ type: "text", text: formatMarkdownHits(hits) }],
                    details: { hits: hits.map(serializeHit) },
                };
            }

            // Fallback: legacy SQLite-backed search.
            const records = await legacyMemoryService.search(params.query, {
                workspaceId: ctx.workspaceId,
                limit,
            });
            return {
                content: [{ type: "text", text: formatLegacyResults(records.map(stripScore)) }],
                details: { hits: [] }, // legacy fallback produces no markdown hits
            };
        },
    });

    const writeTool = defineTool({
        name: "memory_write",
        label: "Memory Write",
        description:
            "Persist a note to memory. Scope is decided by the spawning subagent's type: " +
            "dream/distill write durable project notes (MEMORY.md); explore writes ephemeral " +
            "session notes (notes.md). Notes are appended to the markdown memory file and are " +
            "searchable via memory_search.",
        parameters: writeSchema,
        async execute(_id, params): Promise<AgentToolResult<WriteDetails>> {
            const tags = appendScopeTag(params.tags ?? [], ctx.subagentType);
            const kind = kindOrDefault(params.kind);
            const createdAt = new Date();
            const createdAtMs = createdAt.getTime();

            // Markdown-primary path: write directly to MEMORY.md / notes.md.
            // Subagent tools bypass the Pi CLI write/edit interceptor, so we
            // pre-validate with `assertMemoryWriteAllowed` to enforce the
            // same memory-path-guard rules (project isolation, scope rules,
            // checkpoint-writer reservations) here too.
            if (markdownMemoryService) {
                const projectId = markdownMemoryService.resolveProjectId(ctx.workspacePath);
                const locator = buildLocatorForScope(scope, projectId, ctx.sessionId);
                const targetPath = markdownMemoryService.buildMemoryPath(locator);

                // Pre-flight guard — throws on violation (e.g. dream agent
                // trying to write under projects/<other-pid>/).
                assertMemoryWriteAllowed({
                    target: targetPath,
                    agentName: ctx.subagentType,
                    memoryRoot: markdownMemoryService.memoryRoot,
                    projectId,
                    sessionId: ctx.sessionId,
                });

                const section = formatMemorySection({
                    scope,
                    scopeId: locator.scopeId ?? "",
                    kind,
                    tags,
                    origin: ctx.subagentType,
                    createdAt: createdAt.toISOString(),
                    text: params.text,
                });
                await mkdir(dirname(targetPath), { recursive: true });
                // Append mode — multiple writes accumulate as separate
                // YAML-frontmatter sections in the same file (MiMo Code
                // memory file format).
                await writeFile(targetPath, section, { flag: "a" });

                const record: LongHorizonMemoryRecord = {
                    id: randomUUID(),
                    scope,
                    layer: deriveLayer(scope, kind),
                    kind,
                    text: params.text,
                    workspaceId: ctx.workspaceId,
                    sessionId: scope === "session" ? ctx.sessionId : undefined,
                    tags,
                    createdAt: createdAtMs,
                    updatedAt: createdAtMs,
                };
                return {
                    content: [{ type: "text", text: `Wrote memory to ${targetPath} (scope=${scope}, kind=${kind}).` }],
                    details: { record },
                };
            }

            // Fallback: legacy SQLite-backed MemoryService.put (when
            // markdownMemoryService is unavailable, e.g. memory disabled).
            const record = await legacyMemoryService.put({
                scope,
                kind,
                text: params.text,
                workspaceId: ctx.workspaceId,
                sessionId: scope === "session" ? ctx.sessionId : undefined,
                tags,
            });
            return {
                content: [{ type: "text", text: `Wrote memory ${record.id} (scope=${scope}, kind=${record.kind}).` }],
                details: { record },
            };
        },
    });

    return [searchTool, writeTool];
}

// ── markdown write helpers ──────────────────────────────────────

/**
 * Map the legacy `MemoryScope` ("project" | "session" | "global") to the
 * markdown-memory `MemoryLocator` form ("projects" | "sessions" | "global")
 * and pick the canonical filename (MEMORY.md for project/global, notes.md
 * for session — mirrors MiMo Code's memory file conventions).
 */
function buildLocatorForScope(
    scope: MemoryScope,
    projectId: string,
    sessionId: string,
): MemoryLocator {
    switch (scope) {
        case "project":
            return { scope: "projects", scopeId: projectId, type: "memory", filename: "MEMORY" };
        case "session":
            return { scope: "sessions", scopeId: sessionId, type: "notes", filename: "notes" };
        case "global":
            return { scope: "global", type: "memory", filename: "MEMORY" };
    }
}

/**
 * Compose the markdown section to append to a memory file. Mirrors MiMo
 * Code's per-entry layout: YAML frontmatter + body paragraph.
 *
 * Multiple appends produce a file with multiple frontmatter sections —
 * `MarkdownMemoryService.reconcile()` splits on the frontmatter delimiter
 * and indexes each section independently.
 *
 * Exported so the chat IPC user-intent write path (and any future callers
 * outside the subagent tool surface) can produce the same on-disk layout
 * without duplicating the format.
 */
export function formatMemorySection(input: {
    scope: MemoryScope;
    scopeId: string;
    kind: string;
    tags: string[];
    /**
     * Origin agent name. `SubagentTypeID` literal for dream/distill/explore/
     * checkpoint-writer subagents, or "main" for the renderer-side prompt
     * submission path. Kept as `string` so non-subagent callers don't have
     * to construct a `SubagentTypeID` literal.
     */
    origin: string;
    createdAt: string;
    text: string;
}): string {
    const tagsYaml = input.tags.length > 0 ? `[${input.tags.join(", ")}]` : "[]";
    return [
        "---",
        `scope: ${input.scope}`,
        `scope_id: ${input.scopeId}`,
        `type: ${input.kind}`,
        `tags: ${tagsYaml}`,
        `origin: ${input.origin}`,
        `created_at: ${input.createdAt}`,
        "---",
        input.text,
        "",
        "", // trailing blank line separates consecutive sections
    ].join("\n");
}

/**
 * Derive the LongHorizonMemoryLayer from (scope, kind). Mirrors
 * `long-horizon/database.ts:deriveLayer` so the synthesized record in the
 * markdown write path matches what the legacy SQLite path would have stored.
 */
function deriveLayer(scope: MemoryScope, kind: string): LongHorizonMemoryLayer {
    if (kind === "checkpoint") return "checkpoints";
    if (kind === "history") return "history";
    if (scope === "session") return "session_memory";
    if (scope === "global") return "global_memory";
    return "project_memory";
}

// ── helpers ──────────────────────────────────────────────────────

function appendScopeTag(tags: string[], subagentType: SubagentTypeID): string[] {
    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const stampTag = `${subagentType}:${stamp}`;
    return tags.includes(stampTag) ? tags : [...tags, stampTag];
}

function kindOrDefault(kind?: string): "note" | "checkpoint" | "task-progress" | "summary" {
    switch (kind) {
        case "note":
        case "checkpoint":
        case "task-progress":
        case "summary":
            return kind;
        default:
            return "note";
    }
}

type RecordWithoutScore = Omit<LongHorizonMemoryRecord, "score">;

function stripScore(record: LongHorizonMemoryRecord & { score?: number }): RecordWithoutScore {
    const { score: _score, ...rest } = record;
    void _score;
    return rest;
}

function serializeHit(hit: MemorySearchHit) {
    return {
        path: hit.path,
        scope: hit.scope,
        scopeId: hit.scopeId,
        type: hit.type,
        snippet: hit.snippet,
        score: hit.score,
    };
}

// ── Formatters ───────────────────────────────────────────────────

function formatMarkdownHits(hits: MemorySearchHit[]): string {
    if (hits.length === 0) {
        return "No memory files matched. Try broader terms, or use read/glob/grep on the memory dir directly.";
    }
    const lines = hits.map((h) => {
        const score = h.score.toFixed(3);
        const snippet = h.snippet.length > 200 ? h.snippet.slice(0, 200) + "..." : h.snippet;
        return `- [${h.scope}${h.scopeId ? `/${h.scopeId}` : ""}] score=${score} ${h.path}\n  ${snippet}`;
    });
    return [`Found ${hits.length} memory file(s):`, ...lines].join("\n");
}

function formatLegacyResults(records: RecordWithoutScore[]): string {
    if (records.length === 0) {
        return "No memory records matched.";
    }
    const lines = records.map((r) => {
        const tags = r.tags?.length ? ` tags=[${r.tags.join(",")}]` : "";
        return `- ${r.id} | scope=${r.scope} kind=${r.kind}${tags} | ${r.text.length > 200 ? r.text.slice(0, 200) + "..." : r.text}`;
    });
    return [`Found ${records.length} record(s):`, ...lines].join("\n");
}
