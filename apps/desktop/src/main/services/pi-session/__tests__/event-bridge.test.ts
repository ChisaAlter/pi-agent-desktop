import { describe, it, expect, vi } from "vitest";
import { createEventBridge } from "../event-bridge";

describe("EventBridge", () => {
    it("forwards text_delta as pi:event", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({
            type: "message_update",
            subtype: "text_delta",
            delta: "hello",
        } as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "text_delta",
            text: "hello",
        });
    });

    it("forwards tool_execution_start as pi:event", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_1",
            toolName: "bash",
            args: { command: "ls" },
        } as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "toolcall_start",
            id: "tc_1",
            tool: "bash",
            input: { command: "ls" },
        });
    });

    it("forwards turn_end", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "turn_end" } as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", { type: "turn_end" });
    });

    it("forwards agent_end", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "agent_end" } as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", { type: "agent_end" });
    });

    it("forwards thinking_delta", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({
            type: "message_update",
            subtype: "thinking_delta",
            delta: "thinking...",
        } as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "thinking_delta",
            text: "thinking...",
        });
    });

    it("ignores unknown events", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "queue_update", steering: [], followUp: [] } as any);
        expect(send).not.toHaveBeenCalled();
    });
});
