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

    it("normalizes custom-role message_end events for renderer custom message handling", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const details = {
            operation: "upsert",
            card: { version: "v2", id: "overview", sections: [] },
        };

        bridge.handleEvent({
            type: "message_end",
            message: {
                role: "custom",
                customType: "generated-ui",
                content: "",
                display: true,
                details,
            },
        } as any);

        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "custom_message",
            customType: "generated-ui",
            content: "",
            display: true,
            details,
        });
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

    // ---- Phase C Task 3: stop-gate hook -------------------------------------

    it("invokes the onTurnEnd hook AFTER forwarding turn_end to the renderer", () => {
        const send = vi.fn();
        const onTurnEnd = vi.fn();
        const bridge = createEventBridge("ws_1", send, { onTurnEnd });

        bridge.handleEvent({ type: "turn_end" } as any);

        // Renderer payload is always forwarded, regardless of the hook.
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", { type: "turn_end" });
        // Hook fires with the workspace id (the only thing the bridge knows —
        // Pi's turn_end event carries no agent/message ids).
        expect(onTurnEnd).toHaveBeenCalledTimes(1);
        expect(onTurnEnd).toHaveBeenCalledWith("ws_1");
        // Order: send first, then the hook (so the UI flips streaming state
        // before GoalService kicks off the judge LLM call).
        const sendOrder = send.mock.invocationCallOrder[0];
        const hookOrder = onTurnEnd.mock.invocationCallOrder[0];
        expect(sendOrder).toBeLessThan(hookOrder);
    });

    it("does not throw when onTurnEnd is not wired (backward compatible)", () => {
        const send = vi.fn();
        // No deps argument — legacy callers still work.
        const bridge = createEventBridge("ws_1", send);

        expect(() => bridge.handleEvent({ type: "turn_end" } as any)).not.toThrow();
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", { type: "turn_end" });
    });

    it("does not invoke onTurnEnd for non-turn_end events", () => {
        const send = vi.fn();
        const onTurnEnd = vi.fn();
        const bridge = createEventBridge("ws_1", send, { onTurnEnd });

        bridge.handleEvent({ type: "agent_start" } as any);
        bridge.handleEvent({ type: "message_end" } as any);
        bridge.handleEvent({ type: "agent_end" } as any);

        expect(onTurnEnd).not.toHaveBeenCalled();
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

    it("forwards queue_update so renderer can show steer and follow-up queues", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = { type: "queue_update", steering: ["adjust"], followUp: ["test"] } as const;
        bridge.handleEvent(event as any);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
    });

    it("ignores unknown events", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "auto_retry_start" } as any);
        expect(send).not.toHaveBeenCalled();
    });
});
