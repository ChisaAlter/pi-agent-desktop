import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock approval-bridge BEFORE importing interceptor
vi.mock("../approval-bridge", () => ({
    requestApproval: vi.fn().mockResolvedValue(true),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
    readFile: vi.fn().mockResolvedValue("new content"),
}));

import { createApprovalInterceptor } from "../interceptor";
import { requestApproval } from "../approval-bridge";
import { PendingEdits } from "../pending-edits";

describe("createApprovalInterceptor", () => {
    let pendingEdits: PendingEdits;
    let send: any;
    let abort: any;
    let interceptor: ReturnType<typeof createApprovalInterceptor>;

    beforeEach(() => {
        vi.clearAllMocks();
        pendingEdits = new PendingEdits();
        send = vi.fn();
        abort = vi.fn();
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
        });
    });

    it("returns an object with handleEvent", () => {
        expect(typeof interceptor.handleEvent).toBe("function");
    });

    it("does nothing for read-only tool execution", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_1",
            toolName: "read",
            args: { file_path: "foo" },
        });
        expect(abort).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("does not ask or abort on high-risk tools; pi-permission-system owns runtime decisions", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_1",
            toolName: "bash",
            args: { command: "rm -rf /" },
        });
        expect(requestApproval).not.toHaveBeenCalled();
        expect(abort).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("leaves high-risk approval to the bundled permission extension", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_1",
            toolName: "bash",
            args: { command: "rm -rf /" },
        });
        expect(requestApproval).not.toHaveBeenCalled();
        expect(abort).not.toHaveBeenCalled();
    });

    it("tracks file_edit in pending-edits, no abort, no approval request", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_2",
            toolName: "write",
            args: { file_path: "src/foo.ts", content: "x" },
        });
        expect(requestApproval).not.toHaveBeenCalled();
        expect(abort).not.toHaveBeenCalled();
        expect(pendingEdits.list().length).toBe(1);
        expect(send).toHaveBeenCalledWith(
            "approval:deferred",
            "ws_1",
            expect.objectContaining({ toolCallId: "tc_2", filePath: "src/foo.ts" })
        );
    });

    it("aborts non-plan-file writes while plan mode is active", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_block",
            toolName: "write",
            args: { file_path: "src/app.ts", content: "x" },
        });

        expect(abort).toHaveBeenCalledTimes(1);
        expect(pendingEdits.list()).toHaveLength(0);
        expect(send).toHaveBeenCalledWith(
            "permission:update",
            "ws_1",
            expect.objectContaining({
                type: "error",
                message: expect.stringContaining("Plan 模式禁止"),
            }),
        );
    });

    it("allows plan-file writes while plan mode is active", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_allow",
            toolName: "write",
            args: { file_path: ".pi/plans/input.md", content: "x" },
        });

        expect(abort).not.toHaveBeenCalled();
        expect(pendingEdits.list()).toHaveLength(1);
        expect(send).toHaveBeenCalledWith(
            "approval:deferred",
            "ws_1",
            expect.objectContaining({ toolCallId: "tc_plan_allow", filePath: ".pi/plans/input.md" }),
        );
    });

    it("on tool_execution_end for write/edit, reads file and sends review", async () => {
        // 先 track 一个 edit
        const changeId = pendingEdits.track("tc_3", "write", "src/bar.ts", { content: "old" });
        await interceptor.handleEvent({
            type: "tool_execution_end",
            toolCallId: "tc_3",
            toolName: "write",
            args: { file_path: "src/bar.ts" },
            result: {},
            isError: false,
        });
        expect(send).toHaveBeenCalledWith(
            "approval:review",
            "ws_1",
            expect.objectContaining({
                changeId,
                filePath: "src/bar.ts",
                newContent: "new content",
            })
        );
        const change = pendingEdits.get(changeId);
        // diff 含 basename
        expect(change?.diff).toContain("bar.ts");
        expect(change?.diff).toContain("+new content");
    });

    it("ignores non-write/edit tool_execution_end", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_end",
            toolCallId: "tc_4",
            toolName: "bash",
            args: {},
            result: {},
            isError: false,
        });
        expect(send).not.toHaveBeenCalled();
    });

    it("ignores null/undefined event", async () => {
        await interceptor.handleEvent(null);
        await interceptor.handleEvent(undefined);
        expect(abort).not.toHaveBeenCalled();
    });
});
