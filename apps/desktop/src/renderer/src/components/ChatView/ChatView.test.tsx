// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { usePiStatusStore } from "../../stores/pi-status-store";
import { usePlanStore } from "../../stores/plan-store";
import { useAgentStore } from "../../stores/agent-store";
import { useAgentModeStore } from "../../stores/agent-mode-store";
import { MINIMAX_CHROME_ICON_BUTTON_CLASSNAME } from "../MiniMaxCode/chromeButton";
import { ChatView } from "./ChatView";

const clearError = vi.fn();
const startStreaming = vi.fn(async () => undefined);
const stopStreaming = vi.fn();
let mockedStreamError: string | null = "上一轮错误";
let mockedIsStreaming = false;

vi.mock("../../hooks/usePiStream", () => ({
  usePiStream: () => ({
    isStreaming: mockedIsStreaming,
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
  ChatInput: ({ agentId, onSend }: { agentId?: string | null; onSend: (message: string) => Promise<void> }) => (
    <div data-testid="chat-input-shell" data-agent-id={agentId ?? ""}>
      <button type="button" data-testid="chat-input" onClick={() => void onSend("draft hello")}>
        send
      </button>
    </div>
  ),
}));

vi.mock("../ModelSelector/ModelSelector", () => ({
  ModelSelector: () => <div data-testid="external-model-selector">external model selector</div>,
}));

vi.mock("./MessageBubble", () => ({
  MessageBubble: ({
    message,
    onPlanAction,
    isSearchTarget,
  }: {
    message: { id: string; content: string; planAction?: { status?: string } };
    onPlanAction?: (message: { id: string; content: string; planAction?: { status?: string } }, action: "execute" | "pause" | "resume" | "cancel" | "refine") => Promise<void>;
    isSearchTarget?: boolean;
  }) => (
    <div data-testid="message-bubble" data-message-id={message.id} data-search-target={String(Boolean(isSearchTarget))}>
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
    mockedIsStreaming = false;
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
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentStore.setState({
      agents: [],
      currentAgentId: null,
      messagesByAgent: {},
      runtimeByAgent: {},
      initialized: true,
    });
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
        appendMessage: vi.fn(async () => undefined),
        agentsCreate: vi.fn(async (input: { workspaceId: string; title?: string; sessionId?: string }) => ({
          id: `agent_${input.sessionId ?? input.workspaceId}`,
          workspaceId: input.workspaceId,
          title: input.title ?? "Agent",
          status: "idle",
          sessionId: input.sessionId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
        planMaterialize: vi.fn(async () => ({
          filename: "inline-plan.md",
          path: "C:/ai/pi-agent-desktop/.pi/plans/inline-plan.md",
        })),
        planSetEnabled: vi.fn(async () => undefined),
        agentsMessages: vi.fn(async () => []),
        agentsRuntimeState: vi.fn(async (agentId: string) => ({ agentId, status: "idle", isStreaming: false })),
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

  it("keeps generated ui only assistant messages visible in the message list", async () => {
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
            {
              id: "a-generated",
              role: "assistant",
              content: "",
              timestamp: new Date(1),
              generatedUi: {
                version: "v1",
                id: "ui-1",
                title: "生成式卡片",
                sections: [{ id: "summary", kind: "summary", content: "完成" }],
              },
            },
          ],
        },
      ],
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("message-bubble")).toHaveLength(2);
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

  it("does not duplicate the composer running strip with a centered running placeholder", () => {
    mockedStreamError = null;
    mockedIsStreaming = true;

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.queryByRole("status", { name: "Pi 正在思考..." })).toBeNull();
    expect(screen.queryByText("任务运行中 · 新输入会作为追加指令进入当前会话")).toBeNull();
    expect(screen.getByRole("status", { name: "运行中" })).toBeTruthy();
  });

  it("waits for the current stream to finish before surfacing a pending execute-plan card", async () => {
    mockedStreamError = null;
    mockedIsStreaming = true;
    usePlanStore.setState({
      activeCard: {
        id: "card_1",
        title: "测试计划",
        filename: "test-plan.md",
        content: "- 检查\n- 修改",
        createdAt: Date.now(),
      },
      renderedPlanCardIds: [],
      decisionRequest: null,
      activeExecution: null,
      steps: [],
      status: "idle",
    });

    const { rerender } = render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.queryByText("execute-plan")).toBeNull();

    mockedIsStreaming = false;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: "assistant-plan-summary",
                  role: "assistant",
                  content: "计划已保存至 `.pi/plans/test-plan.md`。\n\n使用 `/execute_plan` 执行该计划，或 `/plan` 退出计划模式。",
                  timestamp: new Date(1),
                },
              ],
            }
          : session
      )),
    }));
    rerender(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("execute-plan")).toBeTruthy();
    });
  });

  it("surfaces the structured execute-plan card even when the assistant summary omits slash-command text", async () => {
    mockedStreamError = null;
    usePlanStore.setState({
      activeCard: {
        id: "card_wait_execute",
        title: "测试计划",
        filename: "test-plan.md",
        content: "- 创建 plan_probe.txt\n- 验证文件存在",
        createdAt: Date.now(),
      },
      renderedPlanCardIds: [],
      decisionRequest: null,
      activeExecution: null,
      steps: [],
      status: "idle",
    });
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: "assistant-plan-summary-no-slash",
                  role: "assistant",
                  content: "计划已生成：test-plan.md（草稿）。两个步骤：创建 plan_probe.txt，然后验证文件存在。等待执行。",
                  timestamp: new Date(1),
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

    await waitFor(() => {
      expect(screen.getByText("execute-plan")).toBeTruthy();
    });
  });

  it("surfaces a fallback execute-plan card after plan_write fails but the structured plan payload exists", async () => {
    mockedStreamError = null;
    usePlanStore.setState({
      activeCard: {
        id: "failed_card_1",
        title: "探针计划",
        filename: "probe-plan",
        content: "---\ntitle: 探针计划\ntype: chore\n---\n\n1. 创建 `plan_probe.txt`，内容为 `PLAN_OK`\n2. 验证文件存在且内容正确\n",
        createdAt: Date.now(),
      },
      renderedPlanCardIds: [],
      decisionRequest: null,
      activeExecution: null,
      steps: [],
      status: "idle",
    });
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: "assistant-plan-write-error",
                  role: "assistant",
                  content: "",
                  timestamp: new Date(1),
                  toolCalls: [
                    {
                      id: "call_plan_error",
                      name: "plan_write",
                      status: "error",
                    },
                  ],
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

    await waitFor(() => {
      expect(screen.getByText("execute-plan")).toBeTruthy();
    });
  });

  it("reuses the existing pending plan message when the same plan card is retried", async () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                {
                  id: "plan-message-existing",
                  role: "assistant",
                  content: "old plan body",
                  timestamp: new Date(0),
                  planAction: {
                    id: "plan_action_old",
                    title: "探针计划",
                    filename: "probe-plan",
                    status: "pending",
                  },
                },
              ],
            }
          : session
      )),
    }));
    usePlanStore.setState({
      activeCard: {
        id: "retry_card_2",
        title: "探针计划",
        filename: "probe-plan",
        content: "- 新步骤\n- 新验证",
        createdAt: Date.now(),
      },
      renderedPlanCardIds: [],
      decisionRequest: null,
      activeExecution: {
        activePlanId: "retry_card_1",
        title: "探针计划",
        filename: "probe-plan",
        sourceMessageId: "plan-message-existing",
        phase: "awaiting_confirmation",
      },
      steps: [],
      status: "waiting_decision",
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => {
      const planMessages = useSessionStore.getState().sessions[0].messages.filter((message) => Boolean(message.planAction));
      expect(planMessages).toHaveLength(1);
      expect(planMessages[0]).toMatchObject({
        id: "plan-message-existing",
        content: "- 新步骤\n- 新验证",
        planAction: expect.objectContaining({
          title: "探针计划",
          filename: "probe-plan",
          status: "pending",
        }),
      });
      expect(usePlanStore.getState().activeExecution?.sourceMessageId).toBe("plan-message-existing");
    });
  });

  it("upgrades the existing assistant plan text instead of appending a saved-plan message", async () => {
    mockedStreamError = null;
    const planContent = [
      "背景说明：这些是生成计划时的上下文，不应该抢占计划卡主视觉。",
      "",
      "## 用户需选择方向",
      "A) 全量发布审查：覆盖代码、数据、安全、UI、测试。",
      "B) 上线阻断审查：只找 P0/P1。",
      "C) 专项深挖审查：选择一个方向深挖。",
    ].join("\n");
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: "assistant-plan-source",
                  role: "assistant",
                  content: planContent,
                  timestamp: new Date(1),
                },
              ],
            }
          : session
      )),
    }));
    usePlanStore.setState({
      activeCard: {
        id: "card_existing_source",
        title: "全面审查项目计划",
        filename: "comprehensive-project-review.md",
        content: planContent,
        createdAt: Date.now(),
      },
      renderedPlanCardIds: [],
      decisionRequest: null,
      activeExecution: null,
      steps: [],
      status: "idle",
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => {
      const session = useSessionStore.getState().sessions.find((item) => item.id === "s1");
      expect(session?.messages).toHaveLength(2);
      expect(session?.messages[1]).toMatchObject({
        id: "assistant-plan-source",
        content: planContent,
        planAction: expect.objectContaining({
          title: "全面审查项目计划",
          filename: "comprehensive-project-review.md",
          status: "pending",
        }),
      });
      expect(usePlanStore.getState().activeExecution?.sourceMessageId).toBe("assistant-plan-source");
    });
  });

  it("does not reopen waiting confirmation when the same plan card re-emits during execution", async () => {
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
                  content: "old running plan",
                  timestamp: new Date(0),
                  planAction: {
                    id: "plan_action_running",
                    title: "测试计划",
                    filename: "probe-plan",
                    status: "executing",
                  },
                },
              ],
            }
          : session
      )),
    }));
    usePlanStore.setState({
      activeCard: {
        id: "retry_card_running",
        title: "创建并验证 plan_probe.txt",
        filename: "probe-plan",
        content: "- 更新后的步骤\n- 更新后的验证",
        createdAt: Date.now(),
      },
      renderedPlanCardIds: [],
      decisionRequest: null,
      activeExecution: {
        activePlanId: "plan_action_running",
        title: "测试计划",
        filename: "probe-plan",
        sourceMessageId: "plan-message-running",
        phase: "executing",
      },
      steps: [],
      status: "executing",
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    await waitFor(() => {
      const planMessages = useSessionStore.getState().sessions[0].messages.filter((message) => Boolean(message.planAction));
      expect(planMessages).toHaveLength(1);
      expect(planMessages[0]).toMatchObject({
        id: "plan-message-running",
        content: "- 更新后的步骤\n- 更新后的验证",
        planAction: expect.objectContaining({
          title: "创建并验证 plan_probe.txt",
          filename: "probe-plan",
          status: "executing",
        }),
      });
      expect(usePlanStore.getState().activeExecution?.phase).toBe("executing");
      expect(usePlanStore.getState().activeExecution?.sourceMessageId).toBe("plan-message-running");
    });
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

  it("does not render a second model selector outside the composer", () => {
    mockedStreamError = null;

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.queryByTestId("external-model-selector")).toBeNull();
  });

  it("keeps the stream surface mounted without rendering the composer while inactive", () => {
    mockedStreamError = null;

    render(
      <I18nProvider>
        <ChatView active={false} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("chat-view-root")).toBeTruthy();
    expect(screen.queryByTestId("chat-input-shell")).toBeNull();
  });

  it("shows compact token usage in the top strip without collapsing small values to zero", () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              usage: {
                inputTokens: 1200,
                outputTokens: 300,
                totalTokens: 1500,
                estimatedCostUsd: 0.0123,
                updatedAt: Date.now(),
              },
            }
          : session
      )),
    }));

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.queryByText(/模型:/)).toBeNull();
    expect(screen.getByText(/Token:/).textContent).toContain("1.5K");
    expect(screen.queryByText(/输入 /)).toBeNull();
    expect(screen.queryByText(/输出 /)).toBeNull();
  });

  it("keeps very small token counts readable in the top strip", () => {
    mockedStreamError = null;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              usage: {
                inputTokens: 10,
                outputTokens: 2,
                totalTokens: 12,
                updatedAt: Date.now(),
              },
            }
          : session
      )),
    }));

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.getByText(/Token:/).textContent).toContain("12");
  });

  it("animates token totals instead of jumping straight to the final cumulative value", () => {
    mockedStreamError = null;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;

    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    window.cancelAnimationFrame = vi.fn();

    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              usage: {
                inputTokens: 500_000,
                outputTokens: 500_000,
                totalTokens: 1_000_000,
                estimatedCostUsd: 0.01,
                updatedAt: Date.now(),
              },
            }
          : session
      )),
    }));

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.getByText(/Token:/).textContent).toContain("1M");

    act(() => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((session) => (
          session.id === "s1"
            ? {
                ...session,
                usage: {
                  inputTokens: 900_000,
                  outputTokens: 1_100_000,
                  totalTokens: 2_000_000,
                  estimatedCostUsd: 0.02,
                  updatedAt: Date.now(),
                },
              }
            : session
        )),
      }));
    });

    expect(screen.getByText(/Token:/).textContent).toContain("1M");
    expect(rafCallbacks.length).toBeGreaterThan(0);

    act(() => {
      rafCallbacks.shift()?.(performance.now() + 500);
    });

    expect(screen.getByText(/Token:/).textContent).toContain("2M");

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  it("renders the connection status before the right rail toggle in the top strip", () => {
    mockedStreamError = null;
    const onToggleRightRail = vi.fn();

    render(
      <I18nProvider>
        <ChatView rightRailCollapsed onToggleRightRail={onToggleRightRail} />
      </I18nProvider>,
    );

    const statusText = screen.getByText("已连接");
    const toggleButton = screen.getByRole("button", { name: "展开右侧栏" });

    expect(statusText.compareDocumentPosition(toggleButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggleButton.className).toBe(MINIMAX_CHROME_ICON_BUTTON_CLASSNAME);
    expect(toggleButton.parentElement?.className ?? "").toContain("translate-y-[0.5px]");

    fireEvent.click(toggleButton);
    expect(onToggleRightRail).toHaveBeenCalledTimes(1);
  });

  it("uses the input surface instead of the gray main background for the chat canvas and top strip", () => {
    mockedStreamError = null;

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    const root = screen.getByTestId("chat-view-root");
    const topStrip = root.firstElementChild as HTMLElement | null;

    expect(root.className).toContain("bg-[var(--mm-bg-input)]");
    expect(root.className).not.toContain("bg-[var(--mm-bg-main)]");
    expect(topStrip?.className ?? "").toContain("bg-[var(--mm-bg-input)]");
    expect(topStrip?.className ?? "").not.toContain("bg-[var(--mm-bg-main)]");
  });

  it("renders one conversation header without workspace, permission, or duplicate session controls", () => {
    mockedStreamError = null;

    render(
      <I18nProvider>
        <ChatView rightRailCollapsed onToggleRightRail={() => undefined} />
      </I18nProvider>,
    );

    const header = screen.getByTestId("chat-conversation-header");
    expect(header.textContent).toContain("Session 1");
    expect(header.textContent).toContain("Token:");
    expect(header.textContent).toContain("已连接");
    expect(header.textContent).not.toContain("工作区:");
    expect(header.textContent).not.toContain("权限:");
    expect(header.querySelector("select")).toBeNull();
    expect(screen.queryByLabelText("切换会话")).toBeNull();
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

  it("creates and binds the draft session only when the first message is sent", async () => {
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
    const createdSessionId = useSessionStore.getState().currentSessionId;
    expect(createdSessionId).toBeTruthy();
    expect(window.piAPI.agentsCreate).toHaveBeenCalledWith({
      workspaceId: "ws1",
      title: "未命名会话 Agent",
      sessionId: createdSessionId,
    });
    expect(useSessionStore.getState().sessions[0]?.messages[0]?.content).toBe("draft hello");
    await waitFor(() => expect(startStreaming).toHaveBeenCalledWith("ws1", "draft hello", {
      agentId: `agent_${createdSessionId}`,
    }));
  });

  it("persists follow-up user prompts into the current session when using a session-bound agent", async () => {
    mockedStreamError = null;
    useAgentStore.setState({
      agents: [
        {
          id: "agent_s1",
          workspaceId: "ws1",
          title: "Session 1 Agent",
          status: "idle",
          sessionId: "s1",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      currentAgentId: "agent_s1",
      messagesByAgent: {},
      runtimeByAgent: {},
      initialized: true,
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId("chat-input"));

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[0]?.messages).toHaveLength(2);
    });
    expect(useSessionStore.getState().sessions[0]?.messages[1]).toMatchObject({
      role: "user",
      content: "draft hello",
    });
    expect(startStreaming).toHaveBeenCalledWith("ws1", "draft hello", {
      agentId: "agent_s1",
    });
  });

  it("scrolls a searched message into view when focusMessageId is provided", async () => {
    mockedStreamError = null;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <I18nProvider>
        <ChatView focusMessageId="u1" />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it("keeps the searched message highlighted briefly before clearing the focus target", async () => {
    mockedStreamError = null;
    vi.useFakeTimers();
    const onFocusMessageHandled = vi.fn();

    render(
      <I18nProvider>
        <ChatView focusMessageId="u1" onFocusMessageHandled={onFocusMessageHandled} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("message-bubble").getAttribute("data-search-target")).toBe("true");
    expect(onFocusMessageHandled).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onFocusMessageHandled).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("uses the agent that belongs to the current workspace", async () => {
    mockedStreamError = null;
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws1",
          name: "repo one",
          path: "C:/repo-one",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
        },
        {
          id: "ws2",
          name: "repo two",
          path: "C:/repo-two",
          createdAt: new Date(0),
          lastActiveAt: new Date(1),
        },
      ],
      currentWorkspaceId: "ws2",
    });
    useAgentStore.setState({
      agents: [
        {
          id: "agent_ws1",
          workspaceId: "ws1",
          title: "Repo one Agent",
          status: "idle",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "agent_ws2",
          workspaceId: "ws2",
          title: "Repo two Agent",
          status: "idle",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      currentAgentId: "agent_ws1",
      messagesByAgent: {},
      runtimeByAgent: {},
      initialized: true,
    });

    render(
      <I18nProvider>
        <ChatView />
      </I18nProvider>,
    );

    expect(screen.getByTestId("chat-input-shell").getAttribute("data-agent-id")).toBe("agent_ws2");

    fireEvent.click(screen.getByTestId("chat-input"));

    await waitFor(() => expect(startStreaming).toHaveBeenCalledWith("ws2", "draft hello", {
      agentId: expect.stringMatching(/^agent_/),
    }));
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

  it("executes a saved plan without re-materializing a duplicate plan file", async () => {
    mockedStreamError = null;
    useAgentModeStore.getState().setMode("ws1", "plan");
    window.piAPI.planMaterialize = vi.fn(async () => ({
      filename: "test-plan.md",
      path: "C:/ai/pi-agent-desktop/.pi/plans/test-plan.md",
    }));
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
      const [workspaceId, outboundPrompt] = startStreaming.mock.calls.at(-1) as unknown as [
        string,
        string,
        { agentId: string; visibleContent: string; waitForAgentIdle?: boolean },
      ];
      expect(workspaceId).toBe("ws1");
      expect(outboundPrompt).toContain("计划文件：test-plan.md");
      expect(outboundPrompt).toContain("[PLAN_DONE]");
      expect(startStreaming).toHaveBeenCalledWith(
        "ws1",
        expect.stringContaining("计划文件：test-plan.md"),
        {
          agentId: "agent_s1",
          visibleContent: "执行计划：test-plan.md",
          waitForAgentIdle: true,
        },
      );
    });
    expect(window.piAPI.planMaterialize).not.toHaveBeenCalled();
    expect(window.piAPI.planSetEnabled).not.toHaveBeenCalled();
    expect(useAgentModeStore.getState().getMode("ws1")).toBe("build");
  });

  it("executes an inline inferred plan without forcing a filename argument", async () => {
    mockedStreamError = null;
    useAgentModeStore.getState().setMode("ws1", "plan");
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                {
                  id: "inline-plan-message",
                  role: "assistant",
                  content: "- 创建 plan_probe.txt\n- 验证文件存在",
                  timestamp: new Date(0),
                  planAction: {
                    id: "plan_action_inline",
                    title: "内联计划",
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
      expect(window.piAPI.planMaterialize).toHaveBeenCalledWith({
        workspaceId: "ws1",
        title: "内联计划",
        content: "- 创建 plan_probe.txt\n- 验证文件存在",
      });
      expect(startStreaming).toHaveBeenCalledWith(
        "ws1",
        expect.stringContaining("计划文件：inline-plan.md"),
        {
          agentId: "agent_s1",
          visibleContent: "执行计划：inline-plan.md",
          waitForAgentIdle: true,
        },
      );
    });
    expect(window.piAPI.planSetEnabled).not.toHaveBeenCalled();
    expect(useAgentModeStore.getState().getMode("ws1")).toBe("build");
  });

  it("materializes and executes a generated-ui-only inline plan", async () => {
    mockedStreamError = null;
    useAgentModeStore.getState().setMode("ws1", "plan");
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) => (
        session.id === "s1"
          ? {
              ...session,
              messages: [
                {
                  id: "generated-ui-plan-message",
                  role: "assistant",
                  content: "",
                  timestamp: new Date(0),
                  generatedUi: {
                    version: "v1",
                    id: "generated-ui-plan-card",
                    title: "内联计划",
                    sections: [
                      { id: "summary", kind: "summary", content: "先做文件修改，再做验证。" },
                      {
                        id: "steps",
                        kind: "steps",
                        items: [
                          { id: "step-1", label: "创建 plan_probe.txt" },
                          { id: "step-2", label: "验证文件存在" },
                        ],
                      },
                    ],
                  },
                  planAction: {
                    id: "plan_action_generated_ui",
                    title: "内联计划",
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
      expect(window.piAPI.planMaterialize).toHaveBeenCalledWith({
        workspaceId: "ws1",
        title: "内联计划",
        content: "内联计划\n先做文件修改，再做验证。\n创建 plan_probe.txt\n验证文件存在",
      });
      expect(startStreaming).toHaveBeenCalledWith(
        "ws1",
        expect.stringContaining("计划文件：inline-plan.md"),
        {
          agentId: "agent_s1",
          visibleContent: "执行计划：inline-plan.md",
          waitForAgentIdle: true,
        },
      );
    });
    expect(window.piAPI.planSetEnabled).not.toHaveBeenCalled();
    expect(useAgentModeStore.getState().getMode("ws1")).toBe("build");
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
