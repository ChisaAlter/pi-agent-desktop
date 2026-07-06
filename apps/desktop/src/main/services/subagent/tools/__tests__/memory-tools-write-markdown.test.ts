/**
 * memory-tools-write-markdown.test.ts — Integration test for the markdown
 * architecture migration of `memory_write` (Phase E Task 4).
 *
 * Verifies the four contract properties required by the spec:
 *   1. `memory_write` with `markdownMemoryService` present creates the file
 *      at `<memoryRoot>/projects/<projectId>/MEMORY.md`.
 *   2. After writing, `memory_search` returns the just-written content (the
 *      data source is now consistent — both read and write hit markdown).
 *   3. A dream agent bound to projectId="A" attempting to write under
 *      `projects/<B>/MEMORY.md` is rejected by `assertMemoryWriteAllowed`.
 *   4. When `markdownMemoryService` is omitted, `memory_write` falls back
 *      to `legacyMemoryService.put` (legacy SQLite path still works).
 *
 * Electron's `app.getPath("userData")` is bypassed via constructor opts —
 * the test points at a temp dir so disk + SQLite state is hermetic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MarkdownMemoryService } from "../../../memory/markdown-memory-service";
import { createMemoryTools } from "../memory-tools";
import type { MemoryService } from "../../../long-horizon/memory-service";
import type { LongHorizonMemoryRecord } from "@shared";

// Mock electron — only `app.getPath` is imported, and we bypass it via opts.
vi.mock("electron", () => ({
    app: {
        getPath: vi.fn(() => ""),
        isReady: vi.fn(() => true),
    },
}));

// ── Test fixtures ────────────────────────────────────────────────

let tempRoot: string;
let memoryRoot: string;
let dbPath: string;
let markdownService: MarkdownMemoryService;

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "mem-tools-md-"));
    memoryRoot = join(tempRoot, "memory");
    dbPath = join(tempRoot, "index.sqlite");
    markdownService = new MarkdownMemoryService({
        userData: tempRoot,
        dbPath,
    });
});

afterEach(() => {
    markdownService.close();
    rmSync(tempRoot, { recursive: true, force: true });
});

/** Build the legacy MemoryService mock — only `put` is exercised in fallback. */
function createLegacyMock(): {
    service: MemoryService;
    putMock: ReturnType<typeof vi.fn>;
} {
    const putMock = vi.fn(async (input: {
        scope: "project" | "session" | "global";
        kind: string;
        text: string;
        workspaceId?: string;
        sessionId?: string;
        tags?: string[];
    }): Promise<LongHorizonMemoryRecord> => {
        const now = Date.now();
        return {
            id: `legacy-${now}`,
            scope: input.scope,
            layer: input.scope === "session"
                ? "session_memory"
                : input.scope === "global"
                    ? "global_memory"
                    : "project_memory",
            kind: input.kind as LongHorizonMemoryRecord["kind"],
            text: input.text,
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            tags: input.tags,
            createdAt: now,
            updatedAt: now,
        };
    });
    const service = { put: putMock } as unknown as MemoryService;
    return { service, putMock };
}

/** Invoke a tool's execute() with the standard 5-arg call shape. */
async function callExecute(
    tool: { execute: (id: string, params: unknown, ...rest: unknown[]) => Promise<unknown> },
    params: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; details: { record: LongHorizonMemoryRecord } }> {
    const result = await tool.execute("test-call-id", params, undefined, undefined, {});
    return result as { content: Array<{ type: string; text: string }>; details: { record: LongHorizonMemoryRecord } };
}

const WORKSPACE_PATH = "C:/projects/demo-app";
const SESSION_ID = "sess-xyz";

// ── Tests ────────────────────────────────────────────────────────

describe("memory_write — markdown architecture", () => {
    it("writes to projects/<projectId>/MEMORY.md when markdownMemoryService is present", async () => {
        const { service: legacy } = createLegacyMock();
        const tools = createMemoryTools(
            legacy,
            {
                workspaceId: "ws1",
                workspacePath: WORKSPACE_PATH,
                sessionId: SESSION_ID,
                subagentType: "dream",
            },
            undefined,
            markdownService,
        );

        const writeTool = tools.find((t) => t.name === "memory_write")!;
        const result = await callExecute(writeTool, {
            text: "Decided to use Electron 41 + React 19 for the desktop shell.",
            kind: "note",
            tags: ["architecture"],
        });

        // Verify the synthesized record.
        expect(result.details.record.scope).toBe("project");
        expect(result.details.record.kind).toBe("note");
        expect(result.details.record.text).toContain("Electron 41");

        // Verify the file was actually written at the expected path.
        const projectId = markdownService.resolveProjectId(WORKSPACE_PATH);
        const expectedPath = join(memoryRoot, "projects", projectId, "MEMORY.md");
        expect(existsSync(expectedPath)).toBe(true);

        const fileContent = readFileSync(expectedPath, "utf8");
        // Frontmatter fields.
        expect(fileContent).toContain("scope: project");
        expect(fileContent).toContain(`scope_id: ${projectId}`);
        expect(fileContent).toContain("type: note");
        expect(fileContent).toContain("origin: dream");
        expect(fileContent).toContain("tags: [architecture, dream:");
        // Body.
        expect(fileContent).toContain("Electron 41 + React 19");

        // Output message points at the markdown path (not a SQLite id).
        expect(result.content[0].text).toContain(expectedPath);
    });

    it("write then search — written content appears in memory_search results", async () => {
        const { service: legacy } = createLegacyMock();
        const tools = createMemoryTools(
            legacy,
            {
                workspaceId: "ws1",
                workspacePath: WORKSPACE_PATH,
                sessionId: SESSION_ID,
                subagentType: "dream",
            },
            undefined,
            markdownService,
        );

        const writeTool = tools.find((t) => t.name === "memory_write")!;
        const searchTool = tools.find((t) => t.name === "memory_search")!;

        // Write a distinctive note that should be FTS5-findable.
        await callExecute(writeTool, {
            text: "LongHorizon settings: dream runs every 4 hours, distill every 12 hours.",
            kind: "note",
        });

        // Search must find what was just written — the core data-source
        // consistency guarantee. Default settings run reconcile before search.
        const searchResult = await callExecute(searchTool as never, {
            query: "LongHorizon",
            limit: 5,
        }) as { content: Array<{ type: string; text: string }> };

        const searchOutput = searchResult.content[0].text;
        // Search found at least one hit (proves write+search share the same
        // markdown backend — the data-source consistency property).
        expect(searchOutput).toContain("Found 1 memory file(s)");
        expect(searchOutput).not.toContain("No memory files matched");
        // The hit points at the MEMORY.md we just wrote (proves the write
        // was the source of the search hit, not some pre-existing record).
        const projectId = markdownService.resolveProjectId(WORKSPACE_PATH);
        const expectedPath = join(memoryRoot, "projects", projectId, "MEMORY.md");
        expect(searchOutput).toContain(expectedPath);
        // Snippet contains FTS5 highlight markers around the matched term.
        // Trigram tokenizer may truncate the highlight (e.g. `<<LongH>>`),
        // so we only assert that markers are present, not the full word.
        expect(searchOutput).toContain("<<");
        expect(searchOutput).toContain(">>");
    });

    it("rejects a dream agent writing to a different projectId (memory-path-guard)", async () => {
        // Construct a MarkdownMemoryService backed by a DIFFERENT temp root
        // so the projectId computed from WORKSPACE_PATH points elsewhere
        // while we attempt to write under a foreign projectId's directory.
        // We simulate this by overriding the workspacePath the subagent is
        // bound to, while writing the path that buildMemoryPath() computes
        // for that workspace.
        //
        // Strategy: bind the subagent to projectId-A (via workspacePath=A),
        // then manually craft a targetPath that lands under projects/<B>/.
        // The guard rejects this with a projectId mismatch.
        //
        // The simplest way to exercise the guard is to construct a
        // context whose workspacePath resolves to a projectId that DOES NOT
        // match the projectId of an external pre-existing directory. We
        // pre-create `projects/other-pid/MEMORY.md` on disk and then call
        // memory_write — but since the tool itself computes targetPath
        // from the bound workspacePath, the guard is exercised implicitly
        // via the bound projectId.
        //
        // To make the test direct: bind the subagent to workspacePath-A,
        // and call the tool. The tool computes projectId-A and writes to
        // projects/<projectId-A>/MEMORY.md — which IS allowed (matches).
        // To test rejection, we need to construct a scenario where the
        // computed projectId does NOT match. The simplest way is to use a
        // DIFFERENT markdownMemoryService whose memoryRoot is shared but
        // whose workspacePath resolves differently. But the projectId
        // comes from `markdownMemoryService.resolveProjectId(ctx.workspacePath)`,
        // so the only way to get a mismatch is if the guard's `projectId`
        // parameter is computed from one path while the targetPath is
        // constructed from another. This is exactly what the guard defends
        // against in the interceptor path.
        //
        // For memory_write (which always uses its own bound workspacePath
        // for both computations), the guard cannot be tricked into a
        // mismatch — the bound workspacePath is single-sourced. The test
        // therefore simulates a malicious subagent by directly invoking
        // assertMemoryWriteAllowed with a foreign projectId, mirroring
        // the inline check the tool performs.
        const { assertMemoryWriteAllowed } = await import("../../../memory/memory-path-guard");
        const boundProjectId = markdownService.resolveProjectId(WORKSPACE_PATH);
        const foreignProjectId = markdownService.resolveProjectId("C:/projects/ATTACKED-app");
        expect(foreignProjectId).not.toBe(boundProjectId); // sanity: distinct ids

        const foreignTarget = markdownService.buildMemoryPath({
            scope: "projects",
            scopeId: foreignProjectId,
            type: "memory",
            filename: "MEMORY",
        });

        // Subagent bound to boundProjectId tries to write under foreignProjectId.
        expect(() =>
            assertMemoryWriteAllowed({
                target: foreignTarget,
                agentName: "dream",
                memoryRoot: markdownService.memoryRoot,
                projectId: boundProjectId,
                sessionId: SESSION_ID,
            }),
        ).toThrow(/projectId mismatch/);
    });

    it("falls back to legacyMemoryService.put when markdownMemoryService is omitted", async () => {
        const { service: legacy, putMock } = createLegacyMock();
        // Note: markdownMemoryService argument omitted.
        const tools = createMemoryTools(
            legacy,
            {
                workspaceId: "ws1",
                workspacePath: WORKSPACE_PATH,
                sessionId: SESSION_ID,
                subagentType: "distill",
            },
            undefined,
            // No markdownMemoryService — fallback path.
        );

        const writeTool = tools.find((t) => t.name === "memory_write")!;
        const result = await callExecute(writeTool, {
            text: "Distilled workflow note for fallback path.",
            kind: "summary",
        });

        // legacyMemoryService.put was called once with the expected input.
        expect(putMock).toHaveBeenCalledTimes(1);
        const callArg = putMock.mock.calls[0][0] as {
            scope: string;
            kind: string;
            text: string;
            workspaceId: string;
            sessionId?: string;
            tags?: string[];
        };
        expect(callArg.scope).toBe("project"); // distill → project scope
        expect(callArg.kind).toBe("summary");
        expect(callArg.text).toContain("Distilled workflow note");
        expect(callArg.workspaceId).toBe("ws1");
        expect(callArg.tags).toBeDefined();
        // distill:<date> stamp auto-appended.
        expect(callArg.tags!.some((t) => t.startsWith("distill:"))).toBe(true);

        // Output message uses the legacy SQLite id (no markdown path).
        expect(result.content[0].text).toContain("Wrote memory legacy-");
        // Record reflects what the legacy service returned.
        expect(result.details.record.id).toMatch(/^legacy-/);
    });
});
