// @vitest-environment jsdom

// 回归测试: 会话切换丢流 (H1) + 停止后尾随事件 (ghost 消息) + 误报"无内容"错误。
// 旧实现按"当前视图 agent"过滤事件 — 运行中 agent 的流在切走会话后永久丢失
// (消息截断 + isStreaming 卡死); 修复后事件绑定到"固定 agent"(pinned)。

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";

import { usePiStream } from "../usePiStream";
import { useSessionStore } from "../../stores/session-store";
import { usePlanStore } from "../../stores/plan-store";
import { useAgentStore } from "../../stores/agent-store";
import { useAgentModeStore } from "../../stores/agent-mode-store";

let emitAgentEvent: ((payload: { agentId: string; workspaceId: string; event: PiEvent }) => void) | null = null;
let emitPiEvent: ((event: PiEvent) => void) | null = null;
const agentsAbortMock = vi.fn(async () => undefined);

function seedStores(): void {
  useSessionStore.setState({
    currentSessionId: "s1",
    sessions: [
      { id: "s1", title: "Viewed B", workspaceId: "ws1", createdAt: new Date(0), updatedAt: new Date(0), messages: [] },
      { id: "sA", title: "Agent A session", workspaceId: "ws1", createdAt: new Date(0), updatedAt: new Date(0), messages: [] },
    ],
  });
  usePlanStore.setState({ enabled: false, activeCard: null, decisionRequest: null, pendingPlanClarification: null, steps: [], status: "idle" });
  useAgentStore.setState({
    agents: [
      { id: "agentA", workspaceId: "ws1", sessionId: "sA", title: "A", status: "idle", createdAt: 0, updatedAt: 0 },
      { id: "agentB", workspaceId: "ws1", sessionId: "s1", title: "B", status: "idle", createdAt: 0, updatedAt: 0 },
    ],
    currentAgentId: null,
    messagesByAgent: {},
    runtimeByAgent: {},
    initialized: true,
  });
  useAgentModeStore.setState({ byWorkspace: {} });
}

function mockWindow(): void {
  (globalThis as { window: unknown }).window = {
    dispatchEvent: vi.fn(),
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (id: number) => clearInterval(id),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    piAPI: {
      getStatus: vi.fn(async () => ({
        installed: true, localVersion: "0.0.0", latestVersion: "0.0.0", updateAvailable: false,
        executablePath: "pi", installMethod: "test", configExists: true, defaultProvider: "test", defaultModel: "test",
      })),
      onEvent: vi.fn((cb: (event: PiEvent) => void) => {
        emitPiEvent = cb;
        return vi.fn();
      }),
      onAgentEvent: vi.fn((cb: (payload: { agentId: string; workspaceId: string; event: PiEvent }) => void) => {
        emitAgentEvent = cb;
        return vi.fn();
      }),
      agentsPrompt: vi.fn(async () => undefined),
      agentsAbort: agentsAbortMock,
      sendPrompt: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      appendMessage: vi.fn(async () => undefined),
      updateMessage: vi.fn(async () => undefined),
      updateToolCall: vi.fn(async () => undefined),
    },
  };
}

describe("usePiStream pinned agent (session-switch no-drop)", () => {
  beforeEach(() => {
    emitAgentEvent = null;
    emitPiEvent = null;
    agentsAbortMock.mockReset();
    agentsAbortMock.mockResolvedValue(undefined);
    mockWindow();
    seedStores();
  });

  it("keeps processing the pinned agent's events after the view switches away", async () => {
    const { result } = renderHook(() => usePiStream("agentB"));

    // 用户在 A 中发送 → pinned=agentA (即使 prop 是 agentB, 视图随后切到 B)。
    await act(async () => {
      await result.current.startStreaming("ws1", "hello", { agentId: "agentA" });
    });

    await act(async () => {
      emitAgentEvent?.({ agentId: "agentA", workspaceId: "ws1", event: { type: "agent_start" } });
      emitAgentEvent?.({ agentId: "agentA", workspaceId: "ws1", event: { type: "message_start" } });
      emitAgentEvent?.({
        agentId: "agentA", workspaceId: "ws1",
        event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "后台内容" } } as PiEvent,
      });
      emitAgentEvent?.({ agentId: "agentA", workspaceId: "ws1", event: { type: "agent_end" } });
    });

    // 流结束, 状态不被卡死。
    expect(result.current.isStreaming).toBe(false);
    // 内容写入 A 的会话 (sA), 而不是当前视图 B 的会话 (s1)。
    const sessionA = useSessionStore.getState().sessions.find((s) => s.id === "sA");
    expect(sessionA?.messages.some((m) => m.role === "assistant" && m.content === "后台内容")).toBe(true);
    const sessionB = useSessionStore.getState().sessions.find((s) => s.id === "s1");
    expect(sessionB?.messages.some((m) => m.content === "后台内容")).toBe(false);
  });

  it("stopStreaming aborts the pinned (running) agent, not the viewed one", async () => {
    const { result } = renderHook(() => usePiStream("agentB"));
    await act(async () => {
      await result.current.startStreaming("ws1", "hello", { agentId: "agentA" });
    });

    result.current.stopStreaming("ws1");
    await act(async () => {
      await vi.waitFor(() => expect(agentsAbortMock).toHaveBeenCalled());
    });

    // 停止目标是运行中的 agentA, 而不是当前视图的 agentB。
    expect(agentsAbortMock).toHaveBeenCalledWith("agentA");
    expect(result.current.isStreaming).toBe(false);
  });

  it("drops trailing events of a stopped run (no ghost messages into the next run)", async () => {
    const { result } = renderHook(() => usePiStream("agentB"));
    await act(async () => {
      await result.current.startStreaming("ws1", "hello", { agentId: "agentA" });
    });

    result.current.stopStreaming("ws1");
    await act(async () => {
      await vi.waitFor(() => expect(agentsAbortMock).toHaveBeenCalled());
    });

    // 被中止运行的尾随事件: agent_end / text_delta 在下一轮 agent_start 前
    // 必须被丢弃, 不能创建新的 assistant 消息。
    await act(async () => {
      emitAgentEvent?.({ agentId: "agentA", workspaceId: "ws1", event: { type: "agent_end" } });
      emitAgentEvent?.({
        agentId: "agentA", workspaceId: "ws1",
        event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "幽灵内容" } } as PiEvent,
      });
    });

    const sessionA = useSessionStore.getState().sessions.find((s) => s.id === "sA");
    expect(sessionA?.messages.some((m) => m.content === "幽灵内容")).toBe(false);
    expect(result.current.isStreaming).toBe(false);
  });

  it("keeps the stop control alive when a plan card arrives mid-turn (plan mode stop regression)", async () => {
    useAgentModeStore.getState().setMode("ws1", "plan");
    const { result } = renderHook(() => usePiStream("agentB"));
    await act(async () => {
      await result.current.startStreaming("ws1", "为聊天输入框制定改版计划", { agentId: "agentA" });
    });

    await act(async () => {
      emitAgentEvent?.({ agentId: "agentA", workspaceId: "ws1", event: { type: "agent_start" } });
      emitAgentEvent?.({
        agentId: "agentA", workspaceId: "ws1",
        event: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "正在制定计划" } } as PiEvent,
      });
      // plan_write toolcall_start → plan:card 在 turn 进行中到达。
      usePlanStore.getState().setCard({
        id: "plan_tool_1",
        title: "测试计划",
        content: "- 检查\n- 修改",
        createdAt: Date.now(),
      });
    });

    // 回归: 计划卡片到达不得强制结束可见流式状态 — 底层 agent 可能仍在运行,
    // 否则停止按钮消失, 计划模式下"发送消息无法停止"。
    expect(result.current.isStreaming).toBe(true);

    result.current.stopStreaming("ws1");
    await act(async () => {
      await vi.waitFor(() => expect(agentsAbortMock).toHaveBeenCalled());
    });
    expect(agentsAbortMock).toHaveBeenCalledWith("agentA");
    await act(async () => {
      await vi.waitFor(() => expect(result.current.isStreaming).toBe(false));
    });
  });

  it("does not report a false 'no content' error for a UI-card-only turn", async () => {
    const { result } = renderHook(() => usePiStream());

    await act(async () => {
      emitPiEvent?.({ type: "agent_start" });
      emitPiEvent?.({
        type: "custom_message",
        customType: "generated-ui",
        ui: { kind: "table", title: "统计", columns: ["a"], rows: [["1"]] },
      } as unknown as PiEvent);
      emitPiEvent?.({ type: "agent_end" });
    });

    expect(result.current.error).toBeNull();
  });
});
