/**
 * chat-memory-markdown-bridge.test.ts — Integration test for Follow-up A
 * (enforce-completion-standards spec).
 *
 * Verifies that the renderer-facing `pi:memory-search` / `pi:memory-list-recent`
 * IPC handlers and the prompt-submission user-intent write path all share the
 * same on-disk markdown data source as the subagent `memory_write` tool.
 *
 * Three contract properties:
 *   1. A memory entry written via the subagent `memory_write` tool path is
 *      discoverable by `pi:memory-search` (renderer side) — no more
 *      SQLite/markdown data-source mismatch.
 *   2. After a prompt is submitted via `pi:send`, the recent-user-intent
 *      entry written by the user-intent `put` block is discoverable by
 *      `pi:memory-search`.
 *   3. When `markdownMemoryService` is absent but `memoryService` (legacy
 *      SQLite) is present, the legacy search path still returns results
 *      (backward compat for users who haven't enabled the new architecture).
 *
 * Electron's `app.getPath("userData")` is bypassed via MarkdownMemoryService
 * constructor opts — the test points at a temp dir so disk + SQLite state is
 * hermetic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LongHorizonMemoryRecord } from "@shared";

// ── Mock electron: capture ipcMain.handle registrations ──────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();
const { execFileSyncMock, rmSyncMock } = vi.hoisted(() => ({
    execFileSyncMock: vi.fn(),
    rmSyncMock: vi.fn(),
}));

vi.mock("electron", () => ({
    app: {
        getPath: vi.fn(() => ""),
        isReady: vi.fn(() => true),
    },
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
            listeners.set(channel, listener);
        }),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => [
            {
                isDestroyed: () => false,
                webContents: { send: webContentsSend },
            },
        ]),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock("child_process", () => ({
    execFileSync: execFileSyncMock,
}));

// Override `rmSync` so the chat IPC handler's `rmSync` import doesn't touch
// real disk; everything else from "fs" (incl. `statSync`) is the real impl.
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return {
        ...actual,
        rmSync: rmSyncMock,
    };
});

import { setupChatIpc } from "../chat.ipc";
import { MarkdownMemoryService } from "../../services/memory/markdown-memory-service";
import { createMemoryTools } from "../../services/subagent/tools/memory-tools";
import type { MemoryService } from "../../services/long-horizon/memory-service";

// ── Test fixtures ────────────────────────────────────────────────────

let tempRoot: string;
let dbPath: string;
let markdownService: MarkdownMemoryService;

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "chat-mem-bridge-"));
    dbPath = join(tempRoot, "index.sqlite");
    markdownService = new MarkdownMemoryService({ userData: tempRoot, dbPath });
    handlers.clear();
    listeners.clear();
    webContentsSend.mockClear();
    execFileSyncMock.mockReset();
    rmSyncMock.mockReset();
});

afterEach(() => {
    markdownService.close();
    rmSync(tempRoot, { recursive: true, force: true });
});

const WORKSPACE_ID = "ws_test";
const WORKSPACE_PATH = "C:/projects/chat-mem-bridge-demo";
const SESSION_ID = "sess-test";

/** Minimal ChatIpcDeps shape — only the fields the memory IPC handlers touch. */
function buildChatDeps(opts: {
    markdownMemoryService?: MarkdownMemoryService;
    memoryService?: MemoryService;
}): Parameters<typeof setupChatIpc>[0] {
    return {
        registry: {
            get: vi.fn(async () => ({
                session: { prompt: vi.fn(async () => undefined), abort: vi.fn() },
            })),
            has: vi.fn(() => true),
        } as never,
        getWorkspace: (id: string) =>
            id === WORKSPACE_ID
                ? { id: WORKSPACE_ID, name: "demo", path: WORKSPACE_PATH }
                : undefined,
        getDefaultWorkspace: () => undefined,
        pendingEdits: { autoApprove: false } as never,
        markdownMemoryService: opts.markdownMemoryService,
        memoryService: opts.memoryService,
    } as never;
}

/** Build the legacy MemoryService mock — only `search` / `listRecent` / `put` are exercised. */
function createLegacyMock(): {
    service: MemoryService;
    searchMock: ReturnType<typeof vi.fn>;
    listRecentMock: ReturnType<typeof vi.fn>;
    putMock: ReturnType<typeof vi.fn>;
} {
    const searchMock = vi.fn(async (): Promise<(LongHorizonMemoryRecord & { score: number })[]> => [
        {
            id: "legacy-record-1",
            scope: "project",
            layer: "project_memory",
            kind: "note",
            text: "legacy sqlite record body",
            workspaceId: WORKSPACE_ID,
            tags: ["legacy"],
            createdAt: Date.now(),
            score: 0.42,
        },
    ]);
    const listRecentMock = vi.fn(async (): Promise<LongHorizonMemoryRecord[]> => [
        {
            id: "legacy-recent-1",
            scope: "project",
            layer: "project_memory",
            kind: "note",
            text: "legacy recent body",
            workspaceId: WORKSPACE_ID,
            tags: [],
            createdAt: Date.now(),
        },
    ]);
    const putMock = vi.fn(async (input: { scope: string; kind: string; text: string; tags?: string[] }) => ({
        id: `legacy-put-${Date.now()}`,
        scope: input.scope as LongHorizonMemoryRecord["scope"],
        layer: "project_memory" as const,
        kind: input.kind as LongHorizonMemoryRecord["kind"],
        text: input.text,
        workspaceId: WORKSPACE_ID,
        tags: input.tags,
        createdAt: Date.now(),
    }));
    const service = {
        search: searchMock,
        listRecent: listRecentMock,
        put: putMock,
    } as unknown as MemoryService;
    return { service, searchMock, listRecentMock, putMock };
}

/** Invoke a subagent tool's execute() with the standard 5-arg call shape. */
async function callExecute(
    tool: { execute: (id: string, params: unknown, ...rest: unknown[]) => Promise<unknown> },
    params: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; details: { record: LongHorizonMemoryRecord } }> {
    const result = await tool.execute("test-call-id", params, undefined, undefined, {});
    return result as { content: Array<{ type: string; text: string }>; details: { record: LongHorizonMemoryRecord } };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("chat IPC ↔ markdown memory bridge (Follow-up A)", () => {
    it("subagent memory_write → pi:memory-search returns the written entry", async () => {
        // 1. Write a memory entry via the subagent `memory_write` tool path.
        //   This is what /dream, /distill, and checkpoint-writer subagents do.
        const { service: legacy } = createLegacyMock();
        const tools = createMemoryTools(
            legacy,
            {
                workspaceId: WORKSPACE_ID,
                workspacePath: WORKSPACE_PATH,
                sessionId: SESSION_ID,
                subagentType: "dream",
            },
            undefined,
            markdownService,
        );
        const writeTool = tools[1]; // [searchTool, writeTool]
        // Use a single alphanumeric token so FTS5's trigram tokenizer produces
        // a contiguous match — multi-token queries return windowed snippets
        // that may not contain the full original phrase.
        const uniqueToken = "zqxvsubagentwrotebridge";
        await callExecute(writeTool, {
            text: `Decided to adopt a hexagonal architecture for the new module. Key context: ${uniqueToken}.`,
            kind: "note",
        });

        // 2. Wire chat IPC with the same markdownMemoryService instance —
        //   simulates the renderer side calling `pi:memory-search` after
        //   a subagent has written to the project's MEMORY.md.
        setupChatIpc(buildChatDeps({ markdownMemoryService: markdownService }));

        // 3. Invoke the renderer's `pi:memory-search` handler.
        const searchHandler = handlers.get("pi:memory-search");
        expect(searchHandler).toBeTruthy();
        const results = (await searchHandler?.(
            {},
            { workspaceId: WORKSPACE_ID, sessionId: SESSION_ID, query: uniqueToken, limit: 8 },
        )) as Array<LongHorizonMemoryRecord & { score: number }>;

        // 4. The written entry must appear — confirming the renderer and the
        //   subagent now share the same on-disk data source. The snippet
        //   returned by FTS5 wraps matched tokens in `<<`/`>>` markers but
        //   the original token remains a substring of the snippet text.
        expect(results.length).toBeGreaterThan(0);
        const match = results.find((r) => r.text.includes(uniqueToken));
        expect(match, `expected a hit containing "${uniqueToken}"`).toBeTruthy();
        expect(match!.scope).toBe("project");
        expect(match!.kind).toBe("note");
        expect(match!.layer).toBe("project_memory");
        expect(typeof match!.score).toBe("number");
    });

    it("pi:send prompt submission → pi:memory-search returns the recent-user-intent entry", async () => {
        setupChatIpc(buildChatDeps({ markdownMemoryService: markdownService }));

        // 1. Submit a prompt via pi:send — the user-intent put block writes
        //   a YAML-frontmatter section to projects/<projectId>/MEMORY.md
        //   tagged `recent-user-intent`, origin `main`.
        const sendHandler = handlers.get("pi:send");
        expect(sendHandler).toBeTruthy();
        const intentToken = "zqxvuserintentflowabc";
        await sendHandler?.({}, WORKSPACE_ID, `Please explain the ${intentToken} in detail.`);

        // 2. Invoke the renderer's `pi:memory-search` with a query that
        //   matches the just-written intent.
        const searchHandler = handlers.get("pi:memory-search");
        const results = (await searchHandler?.(
            {},
            { workspaceId: WORKSPACE_ID, sessionId: SESSION_ID, query: intentToken, limit: 8 },
        )) as Array<LongHorizonMemoryRecord & { score: number }>;

        // 3. The recent-user-intent entry must appear in results.
        expect(results.length).toBeGreaterThan(0);
        const match = results.find((r) => r.text.includes(intentToken));
        expect(match, `expected a hit containing "${intentToken}"`).toBeTruthy();
        expect(match!.scope).toBe("project");
        expect(match!.kind).toBe("note");
    });

    it("falls back to legacy memoryService when markdownMemoryService is absent (backward compat)", async () => {
        // No markdownMemoryService provided — simulates a user who hasn't
        // enabled the new markdown architecture. The legacy SQLite-backed
        // memoryService must still serve search results.
        const { service: legacy, searchMock, listRecentMock } = createLegacyMock();
        setupChatIpc(buildChatDeps({ memoryService: legacy }));

        // pi:memory-search → legacy search path returns the synthetic record.
        const searchHandler = handlers.get("pi:memory-search");
        expect(searchHandler).toBeTruthy();
        const searchResults = (await searchHandler?.(
            {},
            { workspaceId: WORKSPACE_ID, query: "anything", limit: 8 },
        )) as Array<LongHorizonMemoryRecord & { score: number }>;
        expect(searchMock).toHaveBeenCalledTimes(1);
        expect(searchResults.length).toBeGreaterThan(0);
        expect(searchResults[0].text).toBe("legacy sqlite record body");

        // pi:memory-list-recent → legacy listRecent path returns the synthetic record.
        const listHandler = handlers.get("pi:memory-list-recent");
        expect(listHandler).toBeTruthy();
        const listResults = (await listHandler?.(
            {},
            { workspaceId: WORKSPACE_ID, limit: 10 },
        )) as LongHorizonMemoryRecord[];
        expect(listRecentMock).toHaveBeenCalledTimes(1);
        expect(listResults.length).toBeGreaterThan(0);
        expect(listResults[0].text).toBe("legacy recent body");
    });
});
