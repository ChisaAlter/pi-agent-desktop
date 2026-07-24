import { describe, it, expect } from "vitest";
import type { PiEvent, PiTextDeltaEvent, PiToolStartEvent, PiToolExecutionStart } from "./events";
import type { RiskLevel, ApprovalRequest } from "./approval";

describe("Pi events", () => {
    it("text_delta has delta string", () => {
        const e: PiTextDeltaEvent = {
            type: "message_update",
            subtype: "text_delta",
            delta: "hello",
        };
        expect(e.delta).toBe("hello");
    });

    it("tool_execution_start has toolCallId and toolName", () => {
        const e: PiToolExecutionStart = {
            type: "tool_execution_start",
            toolCallId: "call_1",
            toolName: "write",
            args: { file_path: "/x", content: "y" },
        };
        expect(e.toolName).toBe("write");
    });

    it("PiEvent is a discriminated union by type", () => {
        const e: PiEvent = { type: "turn_end" };
        expect(e.type).toBe("turn_end");
    });

    it("toolcall_start subtype has toolCallId and toolName", () => {
        const e: PiToolStartEvent = {
            type: "message_update",
            subtype: "toolcall_start",
            toolCallId: "call_1",
            toolName: "bash",
            args: { command: "ls" },
        };
        expect(e.toolName).toBe("bash");
    });
});

describe("Approval types", () => {
    it("RiskLevel is one of three values", () => {
        const r: RiskLevel = "high";
        expect(["high", "edit", "read"]).toContain(r);
    });

    it("ApprovalRequest has requestId", () => {
        const r: ApprovalRequest = {
            requestId: "abc",
            method: "confirm",
            title: "Allow?",
        };
        expect(r.requestId).toBe("abc");
    });

    // wave-115 residual
    it("covers all RiskLevel literals used by the classifier", () => {
        const levels: RiskLevel[] = ["high", "edit", "read"];
        expect(new Set(levels).size).toBe(3);
    });
});

describe("Pi events residual", () => {
    // wave-115 residual
    it("tool_execution_start keeps args object identity for consumers", () => {
        const args = { command: "ls -la" };
        const e: PiToolExecutionStart = {
            type: "tool_execution_start",
            toolCallId: "c1",
            toolName: "bash",
            args,
        };
        expect(e.args).toBe(args);
        expect(e.args.command).toBe("ls -la");
    });

    it("text_delta subtype is nested under message_update", () => {
        const e: PiTextDeltaEvent = {
            type: "message_update",
            subtype: "text_delta",
            delta: "",
        };
        expect(e.subtype).toBe("text_delta");
        expect(e.delta).toBe("");
    });

    // wave-145 residual
    it("covers lifecycle and tool end event shapes used by queue-store", () => {
        const lifecycle: PiEvent[] = [
            { type: "agent_start" },
            { type: "agent_end" },
            { type: "turn_start" },
            { type: "turn_end" },
            {
                type: "auto_retry_start",
                attempt: 1,
                maxAttempts: 3,
                delayMs: 1000,
                errorMessage: "timeout",
            },
            { type: "auto_retry_end", success: false, attempt: 1, finalError: "still failing" },
            { type: "extension_error" },
        ];
        expect(lifecycle.map((e) => e.type)).toEqual([
            "agent_start",
            "agent_end",
            "turn_start",
            "turn_end",
            "auto_retry_start",
            "auto_retry_end",
            "extension_error",
        ]);
    });

    it("tool_execution_end and queue_update keep consumer fields", () => {
        const end: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "tc1",
            toolName: "Read",
            isError: true,
        };
        const queue: PiEvent = {
            type: "queue_update",
            steering: ["a"],
            followUp: ["b"],
        };
        if (end.type === "tool_execution_end") {
            expect(end.isError).toBe(true);
            expect(end.toolName).toBe("Read");
        }
        if (queue.type === "queue_update") {
            expect(queue.steering).toEqual(["a"]);
            expect(queue.followUp).toEqual(["b"]);
        }
    });

    // wave-151 residual
    it("auto_retry_end success true still carries attempt without finalError required", () => {
        const ok: PiEvent = { type: "auto_retry_end", success: true, attempt: 2 };
        if (ok.type === "auto_retry_end") {
            expect(ok.success).toBe(true);
            expect(ok.attempt).toBe(2);
        }
    });

    it("queue_update accepts empty steering/followUp arrays", () => {
        const queue: PiEvent = { type: "queue_update", steering: [], followUp: [] };
        if (queue.type === "queue_update") {
            expect(queue.steering).toEqual([]);
            expect(queue.followUp).toEqual([]);
        }
    });

    // wave-160 residual
    it("agent_start/turn_start/agent_end/turn_end are distinct lifecycle types", () => {
        const events: PiEvent[] = [
            { type: "agent_start" },
            { type: "turn_start" },
            { type: "turn_end" },
            { type: "agent_end" },
        ];
        expect(events.map((e) => e.type)).toEqual([
            "agent_start",
            "turn_start",
            "turn_end",
            "agent_end",
        ]);
    });

    it("auto_retry_start carries attempt and reason fields", () => {
        const start: PiEvent = {
            type: "auto_retry_start",
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1000,
            errorMessage: "rate limited",
        };
        if (start.type === "auto_retry_start") {
            expect(start.attempt).toBe(1);
            expect(start.maxAttempts).toBe(3);
            expect(start.delayMs).toBe(1000);
            expect(start.errorMessage).toBe("rate limited");
        }
    });

    it("compaction_start accepts known reason literals", () => {
        const reasons = ["manual", "threshold", "overflow"] as const;
        for (const reason of reasons) {
            const ev: PiEvent = { type: "compaction_start", reason };
            if (ev.type === "compaction_start") {
                expect(ev.reason).toBe(reason);
            }
        }
    });

    // wave-180 residual
    it("thinking_level_changed accepts all PiThinkingLevel literals", () => {
        const levels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
        for (const level of levels) {
            const ev: PiEvent = { type: "thinking_level_changed", level };
            if (ev.type === "thinking_level_changed") {
                expect(ev.level).toBe(level);
            }
        }
    });

    it("tool_execution_end requires isError and carries optional result", () => {
        const ok: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "c1",
            toolName: "bash",
            isError: false,
            result: "ok",
        };
        const err: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "c2",
            toolName: "bash",
            isError: true,
        };
        if (ok.type === "tool_execution_end") {
            expect(ok.isError).toBe(false);
            expect(ok.result).toBe("ok");
        }
        if (err.type === "tool_execution_end") {
            expect(err.isError).toBe(true);
            expect(err.result).toBeUndefined();
        }
    });

    it("session_info_changed allows undefined name; extension_error is bare type", () => {
        const renamed: PiEvent = { type: "session_info_changed", name: undefined };
        const ext: PiEvent = { type: "extension_error" };
        if (renamed.type === "session_info_changed") {
            expect(renamed.name).toBeUndefined();
        }
        expect(ext.type).toBe("extension_error");
    });

    // wave-187 residual
    it("turn_end carries optional message/toolResults; agent_end optional messages/willRetry", () => {
        const bare: PiEvent = { type: "turn_end" };
        const full: PiEvent = { type: "turn_end", message: { role: "assistant" }, toolResults: [] };
        const agentBare: PiEvent = { type: "agent_end" };
        const agentFull: PiEvent = { type: "agent_end", messages: [], willRetry: true };
        if (bare.type === "turn_end") {
            expect(bare.message).toBeUndefined();
            expect(bare.toolResults).toBeUndefined();
        }
        if (full.type === "turn_end") {
            expect(full.toolResults).toEqual([]);
        }
        if (agentBare.type === "agent_end") {
            expect(agentBare.messages).toBeUndefined();
            expect(agentBare.willRetry).toBeUndefined();
        }
        if (agentFull.type === "agent_end") {
            expect(agentFull.willRetry).toBe(true);
            expect(agentFull.messages).toEqual([]);
        }
    });

    it("message_update SDK text_delta keeps delta; compaction_end optional fields", () => {
        const mu: PiEvent = {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "hi" },
        };
        const compact: PiEvent = {
            type: "compaction_end",
            reason: "threshold",
            aborted: false,
            willRetry: false,
        };
        if (mu.type === "message_update") {
            expect(mu.assistantMessageEvent.type).toBe("text_delta");
            if (mu.assistantMessageEvent.type === "text_delta") {
                expect(mu.assistantMessageEvent.delta).toBe("hi");
            }
        }
        if (compact.type === "compaction_end") {
            expect(compact.reason).toBe("threshold");
            expect(compact.aborted).toBe(false);
            expect(compact.willRetry).toBe(false);
        }
    });

    // wave-197 residual
    it("tool_execution_update / message_start / message_end carry optional payload fields", () => {
        const update: PiEvent = {
            type: "tool_execution_update",
            toolCallId: "c1",
            toolName: "bash",
            args: { command: "ls" },
            partialResult: "partial",
        };
        const start: PiEvent = { type: "message_start", message: { role: "assistant" } };
        const end: PiEvent = { type: "message_end" };
        if (update.type === "tool_execution_update") {
            expect(update.partialResult).toBe("partial");
            expect(update.toolCallId).toBe("c1");
        }
        if (start.type === "message_start") {
            expect(start.message).toEqual({ role: "assistant" });
        }
        expect(end.type).toBe("message_end");
    });

    it("usage_update / context_update / custom_message accept open extra fields", () => {
        const usage: PiEvent = { type: "usage_update", tokens: 12, cost: 0.01 };
        const context: PiEvent = { type: "context_update", window: 128000 };
        const custom: PiEvent = { type: "custom_message", kind: "note", text: "hi" };
        expect(usage.type).toBe("usage_update");
        expect((usage as { tokens?: number }).tokens).toBe(12);
        expect(context.type).toBe("context_update");
        expect((context as { window?: number }).window).toBe(128000);
        expect(custom.type).toBe("custom_message");
        expect((custom as { kind?: string }).kind).toBe("note");
    });

    // wave-203 residual
    it("tool_execution_start / agent_end / queue_update carry required discriminators", () => {
        const start: PiEvent = {
            type: "tool_execution_start",
            toolCallId: "t1",
            toolName: "read",
            args: { path: "a.ts" },
        };
        const end: PiEvent = { type: "agent_end" };
        const queue: PiEvent = { type: "queue_update", steering: [], followUp: [] };
        if (start.type === "tool_execution_start") {
            expect(start.toolCallId).toBe("t1");
            expect(start.toolName).toBe("read");
        }
        expect(end.type).toBe("agent_end");
        if (queue.type === "queue_update") {
            expect(queue.steering).toEqual([]);
            expect(queue.followUp).toEqual([]);
        }
    });

    it("auto_retry_start / auto_retry_end and tool_execution_end accept payload fields", () => {
        const retryStart: PiEvent = {
            type: "auto_retry_start",
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1000,
            errorMessage: "timeout",
        };
        const retryEnd: PiEvent = { type: "auto_retry_end", success: true, attempt: 1 };
        const toolEnd: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "t1",
            toolName: "bash",
            result: "ok",
            isError: false,
        };
        if (retryStart.type === "auto_retry_start") {
            expect(retryStart.attempt).toBe(1);
            expect(retryStart.maxAttempts).toBe(3);
            expect(retryStart.delayMs).toBe(1000);
            expect(retryStart.errorMessage).toBe("timeout");
        }
        if (retryEnd.type === "auto_retry_end") {
            expect(retryEnd.success).toBe(true);
            expect(retryEnd.attempt).toBe(1);
        }
        if (toolEnd.type === "tool_execution_end") {
            expect(toolEnd.isError).toBe(false);
            expect(toolEnd.result).toBe("ok");
        }
    });

    // wave-212 residual
    it("agent_start/agent_end/turn_start/turn_end are discriminant-only events", () => {
        const events: PiEvent[] = [
            { type: "agent_start" },
            { type: "agent_end" },
            { type: "turn_start" },
            { type: "turn_end" },
        ];
        expect(events.map((e) => e.type)).toEqual([
            "agent_start",
            "agent_end",
            "turn_start",
            "turn_end",
        ]);
    });

    it("tool_execution_update and queue_update accept nested payloads", () => {
        const toolUp: PiEvent = {
            type: "tool_execution_update",
            toolCallId: "t2",
            toolName: "read",
            args: { path: "a.ts" },
        };
        const queue: PiEvent = {
            type: "queue_update",
            steering: ["s1"],
            followUp: ["f1"],
        };
        if (toolUp.type === "tool_execution_update") {
            expect(toolUp.toolCallId).toBe("t2");
            expect(toolUp.toolName).toBe("read");
            expect(toolUp.args).toEqual({ path: "a.ts" });
        }
        if (queue.type === "queue_update") {
            expect(queue.steering).toEqual(["s1"]);
            expect(queue.followUp).toEqual(["f1"]);
        }
    });

    // wave-218 residual
    it("auto_retry_start/end and compaction_end carry attempt/success/reason fields", () => {
        const start: PiEvent = {
            type: "auto_retry_start",
            attempt: 1,
            maxAttempts: 3,
            delayMs: 500,
            errorMessage: "timeout",
        };
        const end: PiEvent = {
            type: "auto_retry_end",
            success: false,
            attempt: 3,
            finalError: "gave up",
        };
        const compact: PiEvent = {
            type: "compaction_end",
            reason: "threshold",
            aborted: false,
            willRetry: true,
            errorMessage: undefined,
        };
        if (start.type === "auto_retry_start") {
            expect(start.attempt).toBe(1);
            expect(start.maxAttempts).toBe(3);
            expect(start.delayMs).toBe(500);
            expect(start.errorMessage).toBe("timeout");
        }
        if (end.type === "auto_retry_end") {
            expect(end.success).toBe(false);
            expect(end.finalError).toBe("gave up");
        }
        if (compact.type === "compaction_end") {
            expect(compact.reason).toBe("threshold");
            expect(compact.willRetry).toBe(true);
        }
    });

    it("session_info_changed and thinking_level_changed are narrow discriminant events", () => {
        const info: PiEvent = { type: "session_info_changed", name: undefined };
        const thinking: PiEvent = { type: "thinking_level_changed", level: "xhigh" };
        if (info.type === "session_info_changed") {
            expect(info.name).toBeUndefined();
        }
        if (thinking.type === "thinking_level_changed") {
            expect(thinking.level).toBe("xhigh");
        }
        const unit: PiEvent = { type: "extension_error" };
        expect(unit.type).toBe("extension_error");
    });

    // wave-225 residual
    it("message_update subtypes cover text/thinking/toolcall start+end discriminants", () => {
        const text: PiEvent = { type: "message_update", subtype: "text_delta", delta: "x" };
        const thinking: PiEvent = { type: "message_update", subtype: "thinking_delta", delta: "t" };
        const start: PiEvent = {
            type: "message_update",
            subtype: "toolcall_start",
            toolCallId: "c1",
            toolName: "read",
            args: { path: "a" },
        };
        const end: PiEvent = {
            type: "message_update",
            subtype: "toolcall_end",
            toolCallId: "c1",
            toolName: "read",
            result: "ok",
        };
        if (text.type === "message_update" && text.subtype === "text_delta") {
            expect(text.delta).toBe("x");
        }
        if (thinking.type === "message_update" && thinking.subtype === "thinking_delta") {
            expect(thinking.delta).toBe("t");
        }
        if (start.type === "message_update" && start.subtype === "toolcall_start") {
            expect(start.toolName).toBe("read");
        }
        if (end.type === "message_update" && end.subtype === "toolcall_end") {
            expect(end.result).toBe("ok");
        }
    });

    it("queue_update requires steering/followUp arrays; tool_execution_end requires isError", () => {
        const queue: PiEvent = {
            type: "queue_update",
            steering: ["a"],
            followUp: [],
        };
        const toolEnd: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "t1",
            toolName: "bash",
            isError: true,
            result: "boom",
        };
        if (queue.type === "queue_update") {
            expect(queue.steering).toEqual(["a"]);
            expect(queue.followUp).toEqual([]);
        }
        if (toolEnd.type === "tool_execution_end") {
            expect(toolEnd.isError).toBe(true);
        }
        const unit: PiEvent[] = [
            { type: "agent_start" },
            { type: "turn_start" },
            { type: "compaction_start", reason: "manual" },
            { type: "extension_error" },
        ];
        expect(unit.map((e) => e.type)).toEqual([
            "agent_start",
            "turn_start",
            "compaction_start",
            "extension_error",
        ]);
    });

    // wave-241 residual
    it("PiMessageUpdateSdk assistantMessageEvent covers text/thinking/tool discriminants", () => {
        const text: PiEvent = {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "hi" },
        };
        const thinking: PiEvent = {
            type: "message_update",
            assistantMessageEvent: { type: "thinking_delta", delta: "..." },
        };
        const toolStart: PiEvent = {
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_start",
                toolCallId: "tc1",
                toolName: "read",
                args: { path: "a.ts" },
            },
        };
        const toolEnd: PiEvent = {
            type: "message_update",
            assistantMessageEvent: {
                type: "toolcall_end",
                toolCallId: "tc1",
                toolName: "read",
                result: { ok: true },
            },
        };
        if (text.type === "message_update") {
            expect(text.assistantMessageEvent.type).toBe("text_delta");
            if (text.assistantMessageEvent.type === "text_delta") {
                expect(text.assistantMessageEvent.delta).toBe("hi");
            }
        }
        if (thinking.type === "message_update" && thinking.assistantMessageEvent.type === "thinking_delta") {
            expect(thinking.assistantMessageEvent.delta).toBe("...");
        }
        if (toolStart.type === "message_update" && toolStart.assistantMessageEvent.type === "toolcall_start") {
            expect(toolStart.assistantMessageEvent.toolName).toBe("read");
            expect(toolStart.assistantMessageEvent.args).toEqual({ path: "a.ts" });
        }
        if (toolEnd.type === "message_update" && toolEnd.assistantMessageEvent.type === "toolcall_end") {
            expect(toolEnd.assistantMessageEvent.result).toEqual({ ok: true });
        }
    });

    it("thinking levels include off through xhigh; unit lifecycle events are tag-only", () => {
        const levels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
        for (const level of levels) {
            const ev: PiEvent = { type: "thinking_level_changed", level };
            if (ev.type === "thinking_level_changed") expect(ev.level).toBe(level);
        }
        const lifecycle: PiEvent[] = [
            { type: "agent_end" },
            { type: "turn_end" },
            { type: "compaction_end" },
            { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: "e" },
            { type: "auto_retry_end", success: false, attempt: 1, finalError: "e" },
        ];
        expect(lifecycle.map((e) => e.type)).toEqual([
            "agent_end",
            "turn_end",
            "compaction_end",
            "auto_retry_start",
            "auto_retry_end",
        ]);
    });

    // wave-252 residual
    it("queue_update and tool_execution_end carry structured payloads", () => {
        const queue: PiEvent = {
            type: "queue_update",
            steering: ["s1"],
            followUp: ["f1", "f2"],
        };
        if (queue.type === "queue_update") {
            expect(queue.steering).toEqual(["s1"]);
            expect(queue.followUp).toHaveLength(2);
        }
        const toolEnd: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "tc-x",
            toolName: "bash",
            result: { exitCode: 1 },
            isError: true,
        };
        if (toolEnd.type === "tool_execution_end") {
            expect(toolEnd.isError).toBe(true);
            expect(toolEnd.result).toEqual({ exitCode: 1 });
        }
    });

    it("compaction_end reasons and session_info_changed name optional", () => {
        for (const reason of ["manual", "threshold", "overflow"] as const) {
            const start: PiEvent = { type: "compaction_start", reason };
            if (start.type === "compaction_start") expect(start.reason).toBe(reason);
            const end: PiEvent = {
                type: "compaction_end",
                reason,
                aborted: reason === "manual",
                willRetry: false,
            };
            if (end.type === "compaction_end") {
                expect(end.reason).toBe(reason);
            }
        }
        const named: PiEvent = { type: "session_info_changed", name: "My session" };
        const cleared: PiEvent = { type: "session_info_changed", name: undefined };
        if (named.type === "session_info_changed") expect(named.name).toBe("My session");
        if (cleared.type === "session_info_changed") expect(cleared.name).toBeUndefined();
    });

    // wave-260 residual
    it("queue_update and message_update text_delta shapes; tool_execution_start ids", () => {
        const q: PiEvent = { type: "queue_update", steering: [], followUp: ["next"] };
        expect(q.type).toBe("queue_update");
        if (q.type === "queue_update") {
            expect(q.steering).toEqual([]);
            expect(q.followUp).toEqual(["next"]);
        }

        const d: PiTextDeltaEvent = {
            type: "message_update",
            subtype: "text_delta",
            delta: "hi",
        };
        expect(d.delta).toBe("hi");

        const start: PiEvent = {
            type: "tool_execution_start",
            toolCallId: "tc1",
            toolName: "bash",
            args: { command: "ls" },
        };
        if (start.type === "tool_execution_start") {
            expect(start.toolCallId).toBe("tc1");
            expect(start.toolName).toBe("bash");
        }
    });

    it("turn_end and agent_end structural shapes; message_start role", () => {
        const turn: PiEvent = { type: "turn_end" };
        expect(turn.type).toBe("turn_end");
        const agentEnd: PiEvent = { type: "agent_end", messages: [] };
        expect(agentEnd.type).toBe("agent_end");
        const msg: PiEvent = {
            type: "message_start",
            message: { role: "user", content: "x" } as never,
        };
        expect(msg.type).toBe("message_start");
    });


    // wave-266 residual
    it("message_update toolcall_start/end shapes; compaction_end reason optional", () => {
        const start: PiToolStartEvent = {
            type: "message_update",
            subtype: "toolcall_start",
            toolCallId: "c1",
            toolName: "read",
            args: { path: "a.ts" },
        };
        expect(start.subtype).toBe("toolcall_start");
        expect(start.toolName).toBe("read");

        // product reason union is manual|threshold|overflow only
        const end: PiEvent = {
            type: "compaction_end",
            reason: "threshold",
            willRetry: false,
        };
        if (end.type === "compaction_end") {
            expect(end.reason).toBe("threshold");
            expect(end.willRetry).toBe(false);
        }
    });

    it("session_info_changed name optional clear; queue_update empty arrays", () => {
        const named: PiEvent = { type: "session_info_changed", name: "N" };
        if (named.type === "session_info_changed") expect(named.name).toBe("N");
        const cleared: PiEvent = { type: "session_info_changed", name: undefined };
        if (cleared.type === "session_info_changed") expect(cleared.name).toBeUndefined();
        const q: PiEvent = { type: "queue_update", steering: [], followUp: [] };
        if (q.type === "queue_update") {
            expect(q.steering).toEqual([]);
            expect(q.followUp).toEqual([]);
        }
    });

    // wave-272 residual
    it("compaction_start reasons manual/threshold/overflow; tool_execution_end isError optional", () => {
        for (const reason of ["manual", "threshold", "overflow"] as const) {
            const start: PiEvent = { type: "compaction_start", reason };
            if (start.type === "compaction_start") expect(start.reason).toBe(reason);
        }
        const end: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "t1",
            toolName: "bash",
            isError: true,
            result: "fail",
        };
        if (end.type === "tool_execution_end") {
            expect(end.isError).toBe(true);
            expect(end.toolName).toBe("bash");
        }
    });

    it("thinking_level_changed accepts product levels; auto_retry_end optional finalError", () => {
        for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"] as const) {
            const ev: PiEvent = { type: "thinking_level_changed", level };
            if (ev.type === "thinking_level_changed") expect(ev.level).toBe(level);
        }
        const retry: PiEvent = {
            type: "auto_retry_end",
            success: false,
            attempt: 2,
            finalError: "timeout",
        };
        if (retry.type === "auto_retry_end") {
            expect(retry.success).toBe(false);
            expect(retry.finalError).toBe("timeout");
        }
    });


    // wave-278 residual
    it("agent_start/turn_start/extension_error are typed; turn_end optional fields", () => {
        const start: PiEvent = { type: "agent_start" };
        expect(start.type).toBe("agent_start");
        const turnStart: PiEvent = { type: "turn_start" };
        expect(turnStart.type).toBe("turn_start");
        const ext: PiEvent = { type: "extension_error" };
        expect(ext.type).toBe("extension_error");
        const turn: PiEvent = { type: "turn_end", message: { role: "assistant" }, toolResults: [] };
        if (turn.type === "turn_end") {
            expect(turn.message).toEqual({ role: "assistant" });
            expect(turn.toolResults).toEqual([]);
        }
    });

    it("agent_end optional willRetry; session_info_changed name can be undefined", () => {
        const end: PiEvent = { type: "agent_end", willRetry: true, messages: [] };
        if (end.type === "agent_end") {
            expect(end.willRetry).toBe(true);
            expect(end.messages).toEqual([]);
        }
        const info: PiEvent = { type: "session_info_changed", name: undefined };
        if (info.type === "session_info_changed") expect(info.name).toBeUndefined();
    });



    // wave-287 residual
    it("auto_retry_start required fields; tool_execution_start/update/end shapes", () => {
        const retry: PiEvent = {
            type: "auto_retry_start",
            attempt: 1,
            maxAttempts: 3,
            delayMs: 500,
            errorMessage: "rate limit",
        };
        if (retry.type === "auto_retry_start") {
            expect(retry.attempt).toBe(1);
            expect(retry.maxAttempts).toBe(3);
            expect(retry.delayMs).toBe(500);
            expect(retry.errorMessage).toBe("rate limit");
        }

        const start: PiEvent = {
            type: "tool_execution_start",
            toolCallId: "c1",
            toolName: "read",
            args: { path: "a.ts" },
        };
        if (start.type === "tool_execution_start") {
            expect(start.toolCallId).toBe("c1");
            expect(start.args).toEqual({ path: "a.ts" });
        }

        const update: PiEvent = {
            type: "tool_execution_update",
            toolCallId: "c1",
            toolName: "read",
            args: { path: "a.ts" },
            partialResult: "chunk",
        };
        if (update.type === "tool_execution_update") {
            expect(update.partialResult).toBe("chunk");
        }

        const end: PiEvent = {
            type: "tool_execution_end",
            toolCallId: "c1",
            toolName: "read",
            isError: false,
            result: "ok",
        };
        if (end.type === "tool_execution_end") {
            expect(end.isError).toBe(false);
            expect(end.result).toBe("ok");
        }
    });

    it("message_start/end optional message; compaction_end optionals; usage/context/custom index signatures", () => {
        const ms: PiEvent = { type: "message_start" };
        expect(ms.type).toBe("message_start");
        const me: PiEvent = { type: "message_end", message: { role: "user" } };
        if (me.type === "message_end") expect(me.message).toEqual({ role: "user" });

        const comp: PiEvent = {
            type: "compaction_end",
            reason: "overflow",
            aborted: true,
            willRetry: true,
            errorMessage: "too large",
        };
        if (comp.type === "compaction_end") {
            expect(comp.reason).toBe("overflow");
            expect(comp.aborted).toBe(true);
            expect(comp.willRetry).toBe(true);
            expect(comp.errorMessage).toBe("too large");
        }

        const usage: PiEvent = { type: "usage_update", tokens: 12 };
        expect(usage.type).toBe("usage_update");
        const ctx: PiEvent = { type: "context_update", size: 1 };
        expect(ctx.type).toBe("context_update");
        const custom: PiEvent = { type: "custom_message", payload: "x" };
        expect(custom.type).toBe("custom_message");
    });

});
