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
});
