// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { usePiStatusStore } from "../../stores/pi-status-store";
import { usePlanStore } from "../../stores/plan-store";
import { ChatView } from "./ChatView";

const clearError = vi.fn();
const startStreaming = vi.fn(async () => undefined);
const stopStreaming = vi.fn();
let mockedStreamError: string | null = "上一轮错误";

vi.mock("../../hooks/usePiStream", () => ({
  usePiStream: () => ({
    isStreaming: false,
    isConnected: true,
    streamingMessageId: null,
    startStreaming,
    stopStreaming,
    clearError,
    error: mockedStreamError,
    currentThinking: "",
    currentText: "",
    toolCalls: new Map(),
  }),
}));

vi.mock("./ChatInput", () => ({
  ChatInput: ({ onSend }: { onSend: (message: string) => Promise<void> }) => (
    <div data-testid="chat-input-shell">
      <button type="button" data-testid="chat-input" onClick={() => void onSend("draft hello")}>
        send
      </button>
    </div>
  ),
}));

vi.mock("./MessageBubble", () => ({
  MessageBubble: ({
    message,
    onPlanAction,
  }: {
    message: { id: string; content: string; planAction?: { status?: string } };
    onPlanAction?: (message: { id: string; content: string; planAction?: { status?: string } }, action: "execute" | "pause" | "resume" | "cancel" | "refine") => Promise<void>;
  }) => (
    <div data-testid="message-bubble">
      {message.content}
      {message.planAction?.status === "pending" && (
        <button type="button" onClick={() => void onPlanAction?.(message, "execute")}>
          execute-plan
        </button>
      )}
      {message.planAction?.status === "executing" && (
        <button type="button" onClick={() => void onPlanAction?.(message, "pause")}>
          pause-plan
        </button>
      )}
    </div>
  ),
}));

describe("ChatView", () => {
  beforeEach(() => {
    clearError.mockClear();
    startStreaming.mockClear();
    stopStreaming.mockClear();
    mockedStreamError = "上一轮错误";
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollTo = vi.fn();
    Object.defineProperty(window, "piAPI", {
      value: {},
      configurable: true,
    });
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws1",
          name: "repo",
          path: "C:/ai/pi-agent-desktop",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
        },
      ],
      currentWorkspaceId: "ws1",
    });
    usePiStatusStore.setState({
      install: vi.fn(),
      isOperating: false,
      progress: null,
    });
    usePlanStore.getState().reset();
    Object.defineProperty(window, "piAPI", {
      value: {
        createSession: vi.fn(async (workspaceId: string, title?: string, id?: string) => ({
          id: id ?? "s_created",
          title: title ?? "未命名会话",
          workspaceId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        })),
        renameSession: vi.fn(async () => undefined),
      },
      configurable: true,
    });
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "Session 1",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          messages: [
            {
              id: "u1",
              role: "user",
              content: "hello",
              timestamp: new Date(0),
            },
          ],
        },
        {
          id: "s2",
          title: "Session 2",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          messages: [],
        },
      ],
    });
  });

  it("clears stale stream errors when the active session changes", async () => {
    const { rerender } = render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => expect(clearError).toHaveBeenCalled());
    const initialCalls = clearError.mock.calls.length;

    await act(async () => {
      useSessionStore.setState({ currentSessionId: "s2" });
      rerender(
        <I18nProvider>
          <ChatView />
        </I18nProvider>,
      );
    });

    await waitFor(() => {
      expect(clearError.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("does not render the legacy floating plan card", () => {
    mockedStreamError = null;

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.queryByTestId("plan-card")).toBeNull();
  });

  it("keeps the input outside the scroll region and the message region as the only scroller", () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                ...session.messages,
                ...Array.from({ length: 20 }, (_, index) => ({
                  id: `a${index}`,
                  role: "assistant" as const,
                  content: `long assistant line ${index}\n${"body ".repeat(120)}`,
                  timestamp: new Date(index + 1),
                })),
              ],
            }
          : session
      )),
    }));

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    const root = screen.getByTestId("chat-view-root");
    const scrollRegion = screen.getByTestId("chat-scroll-region");
    const inputShell = screen.getByTestId("chat-input-shell");
    const log = screen.getByRole("log");

    expect(root.className).toContain("overflow-hidden");
    expect(scrollRegion.className).toContain("flex-1");
    expect(scrollRegion.className).toContain("min-h-0");
    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(log.className).not.toContain("justify-end");
    expect(scrollRegion.contains(inputShell)).toBe(false);
    expect(root.lastElementChild?.contains(inputShell)).toBe(true);
  });

  it("auto-scrolls only the chat scroll region instead of the outer document", () => {
    mockedStreamError = null;
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.HTMLElement.prototype.scrollTo = scrollTo;

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalled();
  });

  it("does not create a session just by opening an empty draft", async () => {
    useSessionStore.setState({ sessions: [], currentSessionId: null });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-input")).toBeTruthy());
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it("creates the draft session only when the first message is sent", async () => {
    useSessionStore.setState({ sessions: [], currentSessionId: null });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId("chat-input"));

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
    expect(useSessionStore.getState().currentSessionId).toBeTruthy();
    await waitFor(() => expect(startStreaming).toHaveBeenCalledWith("ws1", "draft hello"));
  });

  it("shows an inline error when continuing a read-only session fails", async () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1" ? { ...session, readOnly: true } : session
      )),
    }));
    window.piAPI!.createSession = vi.fn(async () => ({
      code: "ipcErrors.sessions.createFailed",
      fallback: "创建会话失败: disk full",
    })) as unknown as Window["piAPI"]["createSession"];

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "从此会话继续" }));

    expect((await screen.findByRole("alert")).textContent).toContain("继续会话失败: 创建会话失败: disk full");
    expect(useSessionStore.getState().currentSessionId).toBe("s1");
  });

  it("does not expose per-message continue actions", async () => {
    mockedStreamError = null;

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.queryByText("continue-from-message")).toBeNull();
    expect(useSessionStore.getState().currentSessionId).toBe("s1");
  });

  it("collapses adjacent cumulative assistant thinking updates into one visible bubble", () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                {
                  id: "u-plan",
                  role: "user",
                  content: "做一个 pi agent 的测试计划",
                  timestamp: new Date(0),
                },
                {
                  id: "a-snapshot-1",
                  role: "assistant",
                  content: "Let me first understand the pi agent project.",
                  thinking: "第一轮思考",
                  timestamp: new Date(1),
                },
                {
                  id: "a-snapshot-2",
                  role: "assistant",
                  content: "Let me first understand the pi agent project. Now let me look at key files.",
                  thinking: "第二轮思考",
                  timestamp: new Date(2),
                },
                {
                  id: "a-snapshot-3",
                  role: "assistant",
                  content: "Let me first understand the pi agent project. Now let me look at key files. Now I have a plan.",
                  thinking: "第三轮思考",
                  timestamp: new Date(3),
                },
              ],
            }
          : session
      )),
    }));

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    const bubbles = screen.getAllByTestId("message-bubble");
    expect(bubbles).toHaveLength(2);
    expect(screen.getByText(/Now I have a plan/)).toBeTruthy();
    expect(screen.queryByText("Let me first understand the pi agent project.")).toBeNull();
  });

  it("executes a plan through a hidden command while showing a clean user-facing message", async () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                {
                  id: "plan-message",
                  role: "assistant",
                  content: "- 检查\n- 修改",
                  timestamp: new Date(0),
                  planAction: {
                    id: "plan_action_test",
                    title: "测试计划",
                    filename: "test-plan.md",
                    status: "pending",
                  },
                },
              ],
            }
          : session
      )),
    }));

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText("execute-plan"));

    await waitFor(() => {
      expect(startStreaming).toHaveBeenCalledWith("ws1", "/execute_plan test-plan.md", {
        visibleContent: "执行计划：test-plan.md",
      });
    });
  });

  it("pauses an executing plan through stopStreaming", async () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                {
                  id: "plan-message-running",
                  role: "assistant",
                  content: "- 检查\n- 修改",
                  timestamp: new Date(0),
                  planAction: {
                    id: "plan_action_running",
                    title: "测试计划",
                    filename: "test-plan.md",
                    status: "executing",
                  },
                },
              ],
            }
          : session
      )),
    }));
    usePlanStore.setState({
      activeExecution: {
        activePlanId: "plan_action_running",
        title: "测试计划",
        filename: "test-plan.md",
        sourceMessageId: "plan-message-running",
        phase: "executing",
      },
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText("pause-plan"));
    expect(stopStreaming).toHaveBeenCalledWith("ws1");
  });
});
