// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";

const mockedSignals = vi.hoisted(() => ({
  playCompleteSound: vi.fn(),
  notifyTaskComplete: vi.fn(),
  canNotify: vi.fn(() => true),
}));

vi.mock("../../utils/sounds", () => ({
  playCompleteSound: mockedSignals.playCompleteSound,
}));

vi.mock("../../utils/notifications", () => ({
  canNotify: mockedSignals.canNotify,
  notifyTaskComplete: mockedSignals.notifyTaskComplete,
}));

import { usePiStream } from "../usePiStream";
import { useSessionStore } from "../../stores/session-store";
import { usePlanStore } from "../../stores/plan-store";
import { useAgentStore } from "../../stores/agent-store";
import { useAgentModeStore } from "../../stores/agent-mode-store";

let emitPiEvent: ((event: PiEvent) => void) | null = null;

describe("usePiStream completion signals", () => {
  beforeEach(() => {
    emitPiEvent = null;
    mockedSignals.playCompleteSound.mockReset();
    mockedSignals.notifyTaskComplete.mockReset();
    mockedSignals.canNotify.mockReset();
    mockedSignals.canNotify.mockReturnValue(true);

    (globalThis as { window: unknown }).window = {
      dispatchEvent: vi.fn(),
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (id: number) => clearTimeout(id),
      setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
      clearInterval: (id: number) => clearInterval(id),
      piAPI: {
        getStatus: vi.fn(async () => ({
          installed: true,
          localVersion: "0.0.0",
          latestVersion: "0.0.0",
          updateAvailable: false,
          executablePath: "pi",
          installMethod: "test",
          configExists: true,
          defaultProvider: "test",
          defaultModel: "test",
        })),
        onEvent: vi.fn((cb: (event: PiEvent) => void) => {
          emitPiEvent = cb;
          return vi.fn();
        }),
        onAgentEvent: vi.fn(() => vi.fn()),
        sendPrompt: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        renameSession: vi.fn(async () => undefined),
      },
    };

    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "Session",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          messages: [],
        },
      ],
    });
    usePlanStore.setState({
      enabled: false,
      activeCard: null,
      decisionRequest: null,
      pendingPlanClarification: null,
      steps: [],
      status: "idle",
    });
    useAgentStore.setState({
      agents: [],
      currentAgentId: null,
      messagesByAgent: {},
      runtimeByAgent: {},
      initialized: false,
    });
    useAgentModeStore.setState({
      byWorkspace: {},
    });
  });

  it("does not emit completion sound or notification for a tool-only turn", async () => {
    renderHook(() => usePiStream());

    await act(async () => {
      emitPiEvent?.({ type: "agent_start" });
      emitPiEvent?.({
        type: "tool_execution_start",
        toolCallId: "tool_1",
        toolName: "shell",
        args: {},
      } as PiEvent);
      emitPiEvent?.({
        type: "tool_execution_end",
        toolCallId: "tool_1",
        isError: false,
      } as PiEvent);
      emitPiEvent?.({ type: "agent_end" });
    });

    expect(mockedSignals.playCompleteSound).not.toHaveBeenCalled();
    expect(mockedSignals.notifyTaskComplete).not.toHaveBeenCalled();
  });

  it("emits completion sound and notification when assistant text was produced", async () => {
    renderHook(() => usePiStream());

    await act(async () => {
      emitPiEvent?.({ type: "agent_start" });
      emitPiEvent?.({ type: "message_start" });
      emitPiEvent?.({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "完成了",
        },
      } as PiEvent);
      emitPiEvent?.({ type: "agent_end" });
    });

    expect(mockedSignals.playCompleteSound).toHaveBeenCalledTimes(1);
    expect(mockedSignals.notifyTaskComplete).toHaveBeenCalledTimes(1);
  });
});
