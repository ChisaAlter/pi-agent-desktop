// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { usePiStatusStore } from "../../stores/pi-status-store";
import { ChatView } from "./ChatView";

const clearError = vi.fn();
const startStreaming = vi.fn(async () => undefined);
const stopStreaming = vi.fn();

vi.mock("../../hooks/usePiStream", () => ({
  usePiStream: () => ({
    isStreaming: false,
    isConnected: true,
    streamingMessageId: null,
    startStreaming,
    stopStreaming,
    clearError,
    error: "上一轮错误",
    currentThinking: "",
    currentText: "",
    toolCalls: new Map(),
  }),
}));

vi.mock("./ChatInput", () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock("./MessageBubble", () => ({
  MessageBubble: ({ message }: { message: { content: string } }) => (
    <div data-testid="message-bubble">{message.content}</div>
  ),
}));

vi.mock("./PlanCard", () => ({
  PlanCardView: () => null,
}));

describe("ChatView", () => {
  beforeEach(() => {
    clearError.mockClear();
    startStreaming.mockClear();
    stopStreaming.mockClear();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
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
});
