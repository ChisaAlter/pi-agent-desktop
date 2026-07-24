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

    it("forwards automatic retry diagnostics", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = {
            type: "auto_retry_start",
            attempt: 1,
            maxAttempts: 3,
            delayMs: 2000,
            errorMessage: "429 Too Many Requests",
        } as const;
        bridge.handleEvent(event);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
    });

    it("forwards SDK session and thinking state changes", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);

        bridge.handleEvent({ type: "turn_start" });
        bridge.handleEvent({ type: "thinking_level_changed", level: "xhigh" });
        bridge.handleEvent({ type: "session_info_changed", name: "Release audit" });

        expect(send).toHaveBeenNthCalledWith(1, "pi:event", "ws_1", { type: "turn_start" });
        expect(send).toHaveBeenNthCalledWith(2, "pi:event", "ws_1", { type: "thinking_level_changed", level: "xhigh" });
        expect(send).toHaveBeenNthCalledWith(3, "pi:event", "ws_1", { type: "session_info_changed", name: "Release audit" });
    });

    it("preserves the complete compaction result payload", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = {
            type: "compaction_end",
            reason: "overflow",
            result: { summary: "kept" },
            aborted: false,
            willRetry: true,
        } as const;

        bridge.handleEvent(event);

        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
    });

    it("ignores unknown events", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "future_sdk_event" } as any);
        expect(send).not.toHaveBeenCalled();
    });

    // wave-95 residual
    it("forwards tool_execution_update and extension_error", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const update = {
            type: "tool_execution_update",
            toolCallId: "tc1",
            toolName: "bash",
            partialResult: "out",
        } as const;
        const err = {
            type: "extension_error",
            error: "watchdog timeout",
        } as const;
        bridge.handleEvent(update as never);
        bridge.handleEvent(err as never);
        expect(send).toHaveBeenNthCalledWith(1, "pi:event", "ws_1", update);
        expect(send).toHaveBeenNthCalledWith(2, "pi:event", "ws_1", err);
    });

    it("normalizes custom message_end with missing fields to safe defaults", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({
            type: "message_end",
            message: { role: "custom" },
        } as never);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "custom_message",
            customType: "",
            content: "",
            display: true,
            details: undefined,
        });
    });

    it("does not rewrite non-custom message_end", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        const event = {
            type: "message_end",
            message: { role: "assistant", content: "hi" },
        } as const;
        bridge.handleEvent(event as never);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", event);
    });



  // wave-306 residual
  describe("event-bridge residual (wave-306)", () => {
    it("normalizeCustomMessageEvent maps custom role message_end with non-string fields to safe defaults", async () => {
      const { normalizeCustomMessageEvent } = await import("../event-bridge");
      const details = { op: 1 };
      expect(
        normalizeCustomMessageEvent({
          type: "message_end",
          message: {
            role: "custom",
            customType: 42,
            content: { nested: true },
            display: "yes",
            details,
          },
        } as never),
      ).toEqual({
        type: "custom_message",
        customType: "",
        content: "",
        display: true,
        details,
      });
      // explicit false display is preserved (typeof boolean)
      expect(
        normalizeCustomMessageEvent({
          type: "message_end",
          message: {
            role: "custom",
            customType: "x",
            content: "body",
            display: false,
          },
        } as never),
      ).toEqual({
        type: "custom_message",
        customType: "x",
        content: "body",
        display: false,
        details: undefined,
      });
    });

    it("normalizeCustomMessageEvent is identity for non-message_end and non-custom roles", async () => {
      const { normalizeCustomMessageEvent } = await import("../event-bridge");
      const turn = { type: "turn_start" } as const;
      expect(normalizeCustomMessageEvent(turn as never)).toBe(turn);
      const plain = {
        type: "message_end",
        message: { role: "user", content: "hi" },
      } as const;
      expect(normalizeCustomMessageEvent(plain as never)).toBe(plain);
      const noMsg = { type: "message_end" } as const;
      expect(normalizeCustomMessageEvent(noMsg as never)).toBe(noMsg);
      const nullMsg = { type: "message_end", message: null } as const;
      expect(normalizeCustomMessageEvent(nullMsg as never)).toBe(nullMsg);
    });

    it("createEventBridge forwards known lifecycle types; onTurnEnd only on turn_end after send", () => {
      const send = vi.fn();
      const onTurnEnd = vi.fn();
      const bridge = createEventBridge("ws-306", send, { onTurnEnd });
      for (const type of [
        "turn_start",
        "agent_end",
        "compaction_start",
        "compaction_end",
        "auto_retry_start",
        "auto_retry_end",
        "session_info_changed",
        "thinking_level_changed",
        "usage_update",
        "context_update",
        "queue_update",
      ] as const) {
        bridge.handleEvent({ type } as never);
      }
      expect(send).toHaveBeenCalledTimes(11);
      expect(onTurnEnd).not.toHaveBeenCalled();
      bridge.handleEvent({ type: "turn_end" } as never);
      expect(send).toHaveBeenLastCalledWith("pi:event", "ws-306", { type: "turn_end" });
      expect(onTurnEnd).toHaveBeenCalledTimes(1);
      expect(onTurnEnd).toHaveBeenCalledWith("ws-306");
      const sendOrder = send.mock.invocationCallOrder[send.mock.invocationCallOrder.length - 1];
      const hookOrder = onTurnEnd.mock.invocationCallOrder[0];
      expect(sendOrder).toBeLessThan(hookOrder);
    });
  });

});
