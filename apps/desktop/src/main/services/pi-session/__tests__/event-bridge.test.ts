import { describe, it, expect, vi } from "vitest";
import { createEventBridge } from "../event-bridge";

describe("EventBridge", () => {
    it("forwards message_update text_delta as the original PiEvent", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = {
            type: "message_update",
            subtype: "text_delta",
            delta: "hello",
        } as const;
        bridge.handleEvent(event as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
    });

    it("forwards lifecycle events needed by the renderer stream hook", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "agent_start" } as any);
        bridge.handleEvent({ type: "message_start" } as any);
        bridge.handleEvent({ type: "message_end" } as any);

        expect(send).toHaveBeenNthCalledWith(1, "pi:event", "ws_1", { type: "agent_start" });
        expect(send).toHaveBeenNthCalledWith(2, "pi:event", "ws_1", { type: "message_start" });
        expect(send).toHaveBeenNthCalledWith(3, "pi:event", "ws_1", { type: "message_end" });
    });

    it("forwards tool_execution_start as the original PiEvent", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = {
            type: "tool_execution_start",
            toolCallId: "tc_1",
            toolName: "bash",
            args: { command: "ls" },
        } as const;
        bridge.handleEvent(event as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
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

    it("forwards thinking_delta as the original PiEvent", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = {
            type: "message_update",
            subtype: "thinking_delta",
            delta: "thinking...",
        } as const;
        bridge.handleEvent(event as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
    });

    it("ignores unknown events", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "queue_update", steering: [], followUp: [] } as any);
        expect(send).not.toHaveBeenCalled();
    });
});
