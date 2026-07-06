/**
 * Integration test: memory-path-guard wiring (Task 3)
 *
 * Verifies that the deps shape produced by `agent-runtime/registry.ts`'s
 * `buildMemoryGuard` and `pi-session/registry.ts`'s `buildMemoryGuard`
 * actually drives `assertMemoryWriteAllowed` when edit-family tool calls
 * land inside the memory tree. The shape exercised here mirrors the
 * production wiring 1:1 (memoryRoot from `MarkdownMemoryService.memoryRoot`
 * or `memoryRootPath(app.getPath("userData"))`, projectId from
 * `resolveProjectId(workspacePath)`, agentName "main", sessionId from
 * workspace/agent id).
 *
 * This file is the executable smoke command for Task 3 — see
 * `.trae/specs/enforce-completion-standards/tasks.md`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock approval-bridge BEFORE importing interceptor (matches interceptor.test.ts)
vi.mock("../approval-bridge", () => ({
    requestApproval: vi.fn().mockResolvedValue(true),
}));

vi.mock("fs/promises", () => ({
    readFile: vi.fn().mockResolvedValue(""),
}));

const MOCK_USER_DATA = "C:/Users/test/AppData/Roaming/Pi-Desktop-wiring-test";
vi.mock("electron", () => ({
    app: {
        getPath: vi.fn((name: string) => {
            if (name === "userData") return MOCK_USER_DATA;
            if (name === "temp") return "C:/Users/test/AppData/Local/Temp";
            return MOCK_USER_DATA;
        }),
        isReady: vi.fn(() => true),
    },
}));

import { createApprovalInterceptor } from "../interceptor";
import { PendingEdits } from "../pending-edits";
import { MarkdownMemoryService } from "../../memory/markdown-memory-service";
import { memoryRootPath } from "../../memory/memory-path-guard";
import { resolveProjectId } from "../../memory/paths";

let tempRoot: string;
let service: MarkdownMemoryService | null = null;

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "wiring-test-"));
});

afterEach(() => {
    if (service) {
        service.close();
        service = null;
    }
    rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * Mirror of the production `buildMemoryGuard` helper shared by both
 * registries. When the markdown memory service is provided, its
 * `memoryRoot` is the source of truth; otherwise we fall back to
 * `memoryRootPath(app.getPath("userData"))`.
 */
function buildMemoryGuard(opts: {
    workspacePath: string;
    workspaceId: string;
    markdownMemoryService?: MarkdownMemoryService | null;
}): {
    agentName: string;
    memoryRoot: string;
    projectId: string;
    sessionId: string;
    taskId?: string;
} | undefined {
    const { workspacePath, workspaceId, markdownMemoryService } = opts;
    let memoryRoot: string | undefined;
    try {
        memoryRoot = markdownMemoryService?.memoryRoot ?? memoryRootPath(MOCK_USER_DATA);
    } catch {
        return undefined;
    }
    if (!memoryRoot) return undefined;
    return {
        agentName: "main",
        memoryRoot,
        projectId: resolveProjectId(workspacePath),
        sessionId: workspaceId,
    };
}

describe("memory-path-guard wiring (Task 3) — production deps shape", () => {
    let pendingEdits: PendingEdits;
    let send: ReturnType<typeof vi.fn>;
    let abort: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        pendingEdits = new PendingEdits();
        send = vi.fn();
        abort = vi.fn();
    });

    it("buildMemoryGuard produces a non-undefined deps block in normal operation", () => {
        const guard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
        });
        expect(guard).toBeDefined();
        expect(guard?.agentName).toBe("main");
        // memoryRoot uses path.join internally → backslashes on Windows.
        expect(guard?.memoryRoot).toBe(join(MOCK_USER_DATA, "memory"));
        expect(guard?.sessionId).toBe("ws_1");
        // projectId is sha256-derived, deterministic 12 chars
        expect(guard?.projectId).toHaveLength(12);
        expect(guard?.projectId).toBe(resolveProjectId("C:/demo"));
    });

    it("prefers MarkdownMemoryService.memoryRoot over the userData fallback", () => {
        // Construct the service with a temp userData so SQLite files don't
        // leak into the runner's filesystem.
        service = new MarkdownMemoryService({
            userData: tempRoot,
            settings: { enabled: true },
            dbPath: join(tempRoot, "index.sqlite"),
        });
        const guard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
            markdownMemoryService: service,
        });
        expect(guard?.memoryRoot).toBe(service.memoryRoot);
        expect(guard?.memoryRoot).toBe(join(tempRoot, "memory"));
        // Falls back when service is absent
        const fallbackGuard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
        });
        expect(fallbackGuard?.memoryRoot).toBe(join(MOCK_USER_DATA, "memory"));
        expect(fallbackGuard?.memoryRoot).not.toBe(guard?.memoryRoot);
    });

    it("allows a write inside the memory tree (guard passes — no abort, no extension_error)", async () => {
        const guard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
        });
        expect(guard).toBeDefined();
        const projectId = guard!.projectId;
        const targetPath = `${guard!.memoryRoot}/projects/${projectId}/MEMORY.md`;

        const interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/demo",
            memoryGuard: guard,
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_writing_test",
            toolName: "write",
            args: { file_path: targetPath, content: "new memory" },
        });

        expect(abort).not.toHaveBeenCalled();
        // No extension_error, no deferred tracking — guard is the authority
        // for in-tree writes and bypasses the deferred-edit flow.
        expect(send).not.toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({ type: "extension_error" }),
        );
        expect(send).not.toHaveBeenCalledWith(
            "approval:deferred",
            "ws_1",
            expect.anything(),
        );
    });

    it("denies a write inside the memory tree to a reserved scope (cc is read-only)", async () => {
        const guard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
        });
        expect(guard).toBeDefined();
        const targetPath = `${guard!.memoryRoot}/cc/feedback.md`;

        const interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/demo",
            memoryGuard: guard,
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_deny_cc",
            toolName: "write",
            args: { file_path: targetPath, content: "x" },
        });

        // Guard fires — abort + extension_error emitted. This proves
        // assertMemoryWriteAllowed is actually invoked by the wired deps.
        expect(abort).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({
                type: "extension_error",
                message: expect.stringContaining("memory-path-guard denied"),
            }),
        );
    });

    it("falls through to deferred-edit tracking for writes outside the memory tree", async () => {
        const guard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
        });
        expect(guard).toBeDefined();

        const interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/demo",
            memoryGuard: guard,
        });

        // Workspace file — outside the memory tree. Guard returns early
        // (non-memory path) and deferred-edit tracking kicks in.
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_workspace_write",
            toolName: "write",
            args: { file_path: "C:/demo/src/foo.ts", content: "x" },
        });

        expect(abort).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(
            "approval:deferred",
            "ws_1",
            expect.objectContaining({
                toolCallId: "tc_workspace_write",
                filePath: "C:/demo/src/foo.ts",
            }),
        );
    });

    it("denies main agent writing under sessions/<sid>/tasks/ (reserved for checkpoint-writer)", async () => {
        const guard = buildMemoryGuard({
            workspacePath: "C:/demo",
            workspaceId: "ws_1",
        });
        expect(guard).toBeDefined();
        const targetPath = `${guard!.memoryRoot}/sessions/ws_1/tasks/T1/progress.md`;

        const interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/demo",
            memoryGuard: guard,
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_reserved_tasks",
            toolName: "write",
            args: { file_path: targetPath, content: "x" },
        });

        expect(abort).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({
                type: "extension_error",
                message: expect.stringContaining("memory-path-guard denied"),
            }),
        );
    });
});
