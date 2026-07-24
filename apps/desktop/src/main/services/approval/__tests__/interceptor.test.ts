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
            "pi:event",
            "ws_1",
            expect.objectContaining({
                type: "extension_error",
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

    it("allows read-only shell tools in plan mode when SDK sends input instead of args", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_read_input",
            toolName: "bash",
            input: { command: "rg --files" },
        } as never);

        expect(abort).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("allows read-only shell tools in plan mode when SDK sends arguments as JSON", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_read_json",
            toolName: "bash",
            arguments: "{\"command\":\"rg --files\"}",
        } as never);

        expect(abort).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("blocks shell tools in plan mode when command args cannot be parsed", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_unknown_bash",
            toolName: "bash",
            args: "not json",
        } as never);

        expect(abort).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({
                type: "extension_error",
                message: expect.stringContaining("Plan 模式禁止"),
            }),
        );
    });

    it("blocks mutating shell tools in plan mode when SDK sends args as JSON", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_mutating_json",
            toolName: "bash",
            args: "{\"command\":\"git clean -fd\"}",
        } as never);

        expect(abort).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({
                type: "extension_error",
                message: expect.stringContaining("Plan 模式禁止"),
            }),
        );
    });

    it("uses prior toolcall_start args when plan-mode tool_execution_start omits args", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_plan_cached_read",
                toolName: "bash",
                args: { command: "rg --files" },
            },
        });
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_cached_read",
            toolName: "bash",
            args: {},
        });

        expect(abort).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("emits a structured plan card when plan_write is announced via toolcall_start", async () => {
        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_plan_card",
                toolName: "plan_write",
                args: {
                    title: "聊天输入框改版计划",
                    content: "- 盘点当前交互\n- 调整模式切换",
                    filename: ".pi/plans/chat-input.md",
                },
            },
        });

        expect(send).toHaveBeenCalledWith(
            "plan:card",
            "ws_1",
            expect.objectContaining({
                id: "tc_plan_card",
                title: "聊天输入框改版计划",
                content: "- 盘点当前交互\n- 调整模式切换",
                filename: ".pi/plans/chat-input.md",
            }),
        );
    });

    it("emits a structured plan card when only tool_execution_start is available", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_exec_card",
            toolName: "plan_write",
            args: {
                title: "执行期计划",
                content: "- 仅执行事件",
            },
        });

        expect(send).toHaveBeenCalledWith(
            "plan:card",
            "ws_1",
            expect.objectContaining({
                id: "tc_plan_exec_card",
                title: "执行期计划",
                content: "- 仅执行事件",
            }),
        );
    });

    it("does not emit duplicate plan cards when toolcall_start and tool_execution_start both arrive", async () => {
        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_plan_dupe",
                toolName: "plan_write",
                args: {
                    title: "去重计划",
                    content: "- 唯一一次",
                },
            },
        });
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_dupe",
            toolName: "plan_write",
            args: {
                title: "去重计划",
                content: "- 唯一一次",
            },
        });

        expect(send.mock.calls.filter((call) => call[0] === "plan:card")).toHaveLength(1);
    });

    it("allows pi-openplan plan_write filename-only calls in plan mode", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_slug",
            toolName: "plan_write",
            args: {
                filename: "create-plan-probe",
                title: "创建并验证 plan_probe.txt",
                content: "- 写入 plan_probe.txt",
            },
        });

        expect(abort).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(
            "plan:card",
            "ws_1",
            expect.objectContaining({
                id: "tc_plan_slug",
                title: "创建并验证 plan_probe.txt",
                filename: "create-plan-probe",
            }),
        );
    });

    it("blocks prior mutating toolcall_start args when plan-mode tool_execution_start omits args", async () => {
        interceptor = createApprovalInterceptor("ws_1", {
            abort,
            pendingEdits,
            send,
            workspacePath: "C:/workspace",
            getMode: () => "plan",
        });

        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_plan_cached_mutating",
                toolName: "bash",
                args: { command: "git clean -fd" },
            },
        });
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_plan_cached_mutating",
            toolName: "bash",
            args: {},
        });

        expect(abort).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({
                type: "extension_error",
                message: expect.stringContaining("Plan 模式禁止"),
            }),
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

    it("skips deferred tracking when autoApprove is true", async () => {
        pendingEdits.autoApprove = true;
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_auto",
            toolName: "write",
            args: { file_path: "src/auto.ts", content: "x" },
        });
        expect(pendingEdits.list()).toHaveLength(0);
        expect(send).not.toHaveBeenCalled();
        expect(abort).not.toHaveBeenCalled();
    });

    it("does not track edit-risk tools with empty file path", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_empty_path",
            toolName: "write",
            args: { content: "no-path" },
        });
        expect(pendingEdits.list()).toHaveLength(0);
        expect(send).not.toHaveBeenCalled();
    });

    it("tracks edit via path alias keys (path/filePath)", async () => {
        await interceptor.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_path_alias",
            toolName: "edit",
            args: { path: "src/alias.ts", old_string: "a", new_string: "b" },
        });
        expect(pendingEdits.list()).toHaveLength(1);
        expect(pendingEdits.list()[0].filePath).toBe("src/alias.ts");
        expect(send).toHaveBeenCalledWith(
            "approval:deferred",
            "ws_1",
            expect.objectContaining({ toolCallId: "tc_path_alias", filePath: "src/alias.ts" }),
        );
    });

    it("clears plan-card dedupe on turn_end so same toolCallId can emit again", async () => {
        const args = {
            title: "回合计划",
            content: "- step",
            filename: ".pi/plans/turn.md",
        };
        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_reuse",
                toolName: "plan_write",
                args,
            },
        });
        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_reuse",
                toolName: "plan_write",
                args,
            },
        });
        expect(send.mock.calls.filter((call: unknown[]) => call[0] === "plan:card")).toHaveLength(1);

        await interceptor.handleEvent({ type: "turn_end" } as never);
        await interceptor.handleEvent({
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc_reuse",
                toolName: "plan_write",
                args,
            },
        });
        expect(send.mock.calls.filter((call: unknown[]) => call[0] === "plan:card")).toHaveLength(2);
    });

    it("generateUnifiedDiff handles add/remove/equal lines", async () => {
        const { generateUnifiedDiff } = await import("../interceptor");
        const diff = generateUnifiedDiff("a\nb\n", "a\nc\n", "src/x.ts");
        expect(diff).toContain("--- a/x.ts");
        expect(diff).toContain("+++ b/x.ts");
        expect(diff).toContain(" a");
        expect(diff).toContain("-b");
        expect(diff).toContain("+c");

        const addOnly = generateUnifiedDiff("", "only\n", "new.md");
        expect(addOnly).toContain("+only");
        const removeOnly = generateUnifiedDiff("gone\n", "", "old.md");
        expect(removeOnly).toContain("-gone");
    });



    // wave-306 residual
    it("generateUnifiedDiff residual: basename from path, header counts, equal lines space-prefixed", async () => {
        const { generateUnifiedDiff } = await import("../interceptor");
        // product: split keeps trailing empty segment for trailing newline
        // "a\\n" -> ["a", ""] length 2
        const win = generateUnifiedDiff("a\n", "a\n", "C:\\repo\\src\\file.ts");
        expect(win.startsWith("--- a/file.ts\n+++ b/file.ts\n")).toBe(true);
        expect(win).toContain("@@ -1,2 +1,2 @@");
        expect(win).toContain(" a");

        // no trailing newline -> length 1 equal line
        const single = generateUnifiedDiff("only", "only", "path/to/only.txt");
        expect(single).toContain("--- a/only.txt");
        expect(single).toContain("@@ -1,1 +1,1 @@");
        expect(single).toContain(" only");

        const multi = generateUnifiedDiff("x\ny\nz", "x\nY\nz", "dir/sub/name.md");
        expect(multi).toContain("--- a/name.md");
        expect(multi).toContain("@@ -1,3 +1,3 @@");
        expect(multi).toContain(" x");
        expect(multi).toContain("-y");
        expect(multi).toContain("+Y");
        expect(multi).toContain(" z");

        // empty both sides: split gives [""] length 1
        const empty = generateUnifiedDiff("", "", "empty.txt");
        expect(empty).toContain("--- a/empty.txt");
        expect(empty).toContain("@@ -1,1 +1,1 @@");
        expect(empty.endsWith(" " + String.fromCharCode(10))).toBe(true);

        // longer new side only-add tail
        const grow = generateUnifiedDiff("1", "1\n2\n3", "grow.txt");
        expect(grow).toContain(" 1");
        expect(grow).toContain("+2");
        expect(grow).toContain("+3");
        expect(grow).toContain("@@ -1,1 +1,3 @@");

        // bare filename has no path separator -> pop keeps full string
        const bare = generateUnifiedDiff("a", "b", "readme");
        expect(bare).toContain("--- a/readme");
        expect(bare).toContain("+++ b/readme");
        expect(bare).toContain("-a");
        expect(bare).toContain("+b");
    });

});
