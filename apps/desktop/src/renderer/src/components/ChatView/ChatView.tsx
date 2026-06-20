// 聊天主区域 - 空态 + 消息列表 + 输入框
// v1.0.4: 用户可见文案走 t()

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePiStream } from '../../hooks/usePiStream';
import { useSessionStore } from '../../stores/session-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAgentStore } from '../../stores/agent-store';
import { MessageBubble } from './MessageBubble';
import { VirtualizedMessageList } from './VirtualizedMessageList';
import { ChatInput } from './ChatInput';
import { useI18n } from '../../i18n';
import { usePlanStore } from '../../stores/plan-store';
import { useSettingsStore } from '../../stores/settings-store';
import type { Message } from '../../stores/session-store';
import type { AgentMessage } from '@shared';

interface ChatViewProps {
    /** v1.0.14: 外部注入的预填文本(由 App.tsx 监听 'chatpanel:prefill' 事件传来,用于跨组件切到 chat 时把 prompt 灌进 ChatInput) */
    prefillText?: string | null;
    /** prefill 已被 ChatInput 消费后回调 */
    onPrefillConsumed?: () => void;
}

function hasVisibleAssistantContent(message: Message): boolean {
  const content = message.content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
  return Boolean(content || message.customCard || (message.toolCalls && message.toolCalls.length > 0));
}

type ChatMessage = Message & {
  thinkingCount?: number;
};

const EMPTY_AGENT_MESSAGES: AgentMessage[] = [];

function stripThinking(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

function visibleText(message: Message): string {
  return stripThinking(message.content);
}

function EmptyConversationIntro({
  workspaceName,
  modelSummary,
  permissionLabel,
  thinkingLabel,
}: {
  workspaceName: string;
  modelSummary: string;
  permissionLabel: string;
  thinkingLabel: string;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-[456px] flex-1 flex-col px-5 pb-2 pt-8 text-left">
      <div className="relative -left-[20px] w-[461px] rounded-[6px] border border-[#f5f6f8] bg-[#f5f6f8] px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
        <div className="text-[14px] font-medium leading-5 text-[var(--mm-text-primary)]">新对话</div>
        <div className="mt-1 text-[12px] text-[#8a939c]">输入消息后，Pi Agent 会在当前工作区开始运行。</div>
        <div className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px] leading-4">
          <span className="text-[var(--mm-text-tertiary)]">工作区</span>
          <span className="truncate text-[var(--mm-text-secondary)]">{workspaceName}</span>
          <span className="text-[var(--mm-text-tertiary)]">模型</span>
          <span className="truncate text-[var(--mm-text-secondary)]">{modelSummary}</span>
          <span className="text-[var(--mm-text-tertiary)]">权限</span>
          <span className="text-[var(--mm-text-secondary)]">{permissionLabel}</span>
          <span className="text-[var(--mm-text-tertiary)]">思考</span>
          <span className="text-[var(--mm-text-secondary)]">{thinkingLabel}</span>
        </div>
      </div>
    </div>
  );
}

function isCumulativeAssistantUpdate(previous: Message, next: Message): boolean {
  if (previous.role !== "assistant" || next.role !== "assistant") return false;
  if (previous.customCard || next.customCard || previous.planAction || next.planAction) return false;
  const previousContent = visibleText(previous);
  const nextContent = visibleText(next);
  if (!previousContent || !nextContent) return false;
  return nextContent !== previousContent && nextContent.startsWith(previousContent);
}

function mergeAdjacentThinkingMessages(messages: Message[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  let pendingThinking: string[] = [];

  for (const message of messages) {
    const isThinkingOnlyAssistant =
      message.role === "assistant" &&
      Boolean(message.thinking?.trim()) &&
      !hasVisibleAssistantContent(message);

    if (isThinkingOnlyAssistant) {
      pendingThinking.push(message.thinking!.trim());
      continue;
    }

    const previous = merged.at(-1);
    if (previous && isCumulativeAssistantUpdate(previous, message)) {
      const previousThinking = previous.thinking?.trim();
      const nextThinking = message.thinking?.trim();
      merged[merged.length - 1] = {
        ...previous,
        ...message,
        thinking: [previousThinking, nextThinking]
          .filter((part): part is string => Boolean(part))
          .filter((part, index, parts) => parts.findIndex((candidate) => candidate === part) === index)
          .join("\n\n"),
        thinkingCount:
          (previous.thinkingCount ?? (previousThinking ? 1 : 0)) +
          (message.thinking ? 1 : 0),
      };
      continue;
    }

    if (pendingThinking.length > 0 && message.role === "assistant") {
      const existingCount = message.thinking?.trim() ? ((message as ChatMessage).thinkingCount ?? 1) : 0;
      merged.push({
        ...message,
        thinking: [pendingThinking.join("\n\n"), message.thinking?.trim()]
          .filter((part): part is string => Boolean(part))
          .join("\n\n"),
        thinkingCount: pendingThinking.length + existingCount,
      });
      pendingThinking = [];
      continue;
    }

    if (pendingThinking.length > 0) {
      const timestamp = merged.at(-1)?.timestamp ?? message.timestamp;
      merged.push({
        id: `merged_thinking_${merged.length}`,
        role: "assistant",
        content: "",
        timestamp,
        thinking: pendingThinking.join("\n\n"),
        thinkingCount: pendingThinking.length,
      });
      pendingThinking = [];
    }

    merged.push(message);
  }

  if (pendingThinking.length > 0) {
    const timestamp = merged.at(-1)?.timestamp ?? new Date();
    merged.push({
      id: `merged_thinking_${merged.length}`,
      role: "assistant",
      content: "",
      timestamp,
      thinking: pendingThinking.join("\n\n"),
      thinkingCount: pendingThinking.length,
    });
  }

  return merged;
}

export function ChatView({ prefillText, onPrefillConsumed }: ChatViewProps = {}): React.JSX.Element {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const agents = useAgentStore((state) => state.agents);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const currentAgent = useMemo(() => {
    if (!currentWorkspace) return null;
    const selectedAgent = currentAgentId
      ? agents.find((agent) => agent.id === currentAgentId && agent.workspaceId === currentWorkspace.id)
      : undefined;
    return selectedAgent ?? agents.find((agent) => agent.workspaceId === currentWorkspace.id) ?? null;
  }, [agents, currentAgentId, currentWorkspace]);
  const agentId = currentAgent?.id ?? null;
  const {
    isStreaming,
    isConnected,
    streamingMessageId,
    startStreaming,
    stopStreaming,
    clearError,
    error: streamError,
  } = usePiStream(agentId);
  const { getCurrentSession, createSession, renameSession, setCurrentSession, continueSession } = useSessionStore();
  const updateMessage = useSessionStore((state) => state.updateMessage);
  const sessions = useSessionStore((state) => state.sessions);
  const settings = useSettingsStore((state) => state.settings);
  const initAgents = useAgentStore((state) => state.init);
  const agentMessages = useAgentStore((state) => agentId ? state.messagesByAgent[agentId] ?? EMPTY_AGENT_MESSAGES : EMPTY_AGENT_MESSAGES);
  const { t } = useI18n();
  const [sendError, setSendError] = useState<string | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [globalComposerRoot, setGlobalComposerRoot] = useState<HTMLElement | null>(null);
  const activePlanCard = usePlanStore((state) => state.activeCard);
  const renderedPlanCardIds = usePlanStore((state) => state.renderedPlanCardIds);
  const activePlanExecution = usePlanStore((state) => state.activeExecution);

  const currentSession = getCurrentSession();
  const hasAgent = Boolean(currentAgent);

  useEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) return;
    scrollRegion.scrollTo({ top: scrollRegion.scrollHeight, behavior: 'smooth' });
  }, [agentMessages, currentSession?.messages]);

  useEffect(() => {
    void initAgents();
  }, [initAgents]);

  useEffect(() => {
    clearError();
    setSendError(null);
    setSessionActionError(null);
  }, [currentSession?.id, clearError]);

  useEffect(() => {
    if (!activePlanCard || renderedPlanCardIds.includes(activePlanCard.id)) return;
    const cleanContent = activePlanCard.content
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<think>[\s\S]*$/gi, "")
      .trim();
    const planAction = {
      id: `plan_action_${activePlanCard.id}`,
      title: activePlanCard.title,
      filename: activePlanCard.filename,
      status: "pending" as const,
    };
    if (hasAgent && currentAgent) {
      const messageId = `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      useAgentStore.getState().appendStreamMessage(currentAgent.id, {
        id: messageId,
        agentId: currentAgent.id,
        role: "assistant",
        content: cleanContent,
        createdAt: Date.now(),
        planAction,
      });
      usePlanStore.getState().markPlanCardRendered(activePlanCard.id);
      usePlanStore.getState().setAwaitingConfirmation({
        activePlanId: activePlanCard.id,
        title: activePlanCard.title,
        filename: activePlanCard.filename,
        sourceMessageId: messageId,
      });
      return;
    }
    if (currentSession) {
      const messageId = `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      useSessionStore.getState().addMessage(currentSession.id, {
        id: messageId,
        role: "assistant",
        content: cleanContent,
        timestamp: new Date(),
        planAction,
      });
      usePlanStore.getState().markPlanCardRendered(activePlanCard.id);
      usePlanStore.getState().setAwaitingConfirmation({
        activePlanId: activePlanCard.id,
        title: activePlanCard.title,
        filename: activePlanCard.filename,
        sourceMessageId: messageId,
      });
    }
  }, [activePlanCard, currentAgent, currentSession, hasAgent, renderedPlanCardIds]);

  const handleSend = async (message: string, options?: { visibleContent?: string }) => {
    if (!currentWorkspace) return;
    try {
      if (!hasAgent && getCurrentSession()?.readOnly) {
        setSendError("当前会话是只读历史，请先从此会话继续。");
        return;
      }
      if (!hasAgent && !getCurrentSession()) {
        await createSession(currentWorkspace.id);
      }
      setSendError(null);
      setSessionActionError(null);
      if (options) {
        await startStreaming(currentWorkspace.id, message, options);
      } else {
        await startStreaming(currentWorkspace.id, message);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    }
  };
  const handleStop = () => {
    if (currentWorkspace) {
      let sourceMessage: Message | undefined;
      if (activePlanExecution?.phase === "executing") {
        usePlanStore.getState().markPausing();
        if (activePlanExecution.sourceMessageId) {
          sourceMessage = messages.find((message) => message.id === activePlanExecution.sourceMessageId);
          if (sourceMessage?.planAction) updatePlanActionStatus(sourceMessage, "pausing");
        }
      }
      stopStreaming(currentWorkspace.id);
      if (sourceMessage?.planAction) {
        updatePlanActionStatus(sourceMessage, "paused");
      }
    }
  };
  const handleContinueReadOnly = async (): Promise<void> => {
    if (!currentSession) return;
    try {
      setSessionActionError(null);
      const next = await continueSession(currentSession.id);
      setCurrentSession(next.id);
    } catch (error) {
      setSessionActionError(`继续会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const rawMessages = useMemo(() => hasAgent && agentMessages.length > 0
    ? agentMessages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" || message.role === "system" || message.role === "user"
          ? message.role
          : "system",
        content: message.content,
        timestamp: new Date(message.createdAt),
        thinking: message.thinking,
        planAction: message.planAction,
      }))
    : currentSession?.messages || [], [agentMessages, currentSession?.messages, hasAgent]);
  const messages = useMemo(() => {
    const merged = mergeAdjacentThinkingMessages(rawMessages);
    // v1.0.14-fix: 过滤后端偶发的完全空白 assistant 消息(有 content/thinking/card/tools/plan 至少一个才保留)
    return merged.filter((message) => {
      const hasVisible = visibleText(message).length > 0;
      const hasThinking = Boolean(message.thinking?.trim());
      const hasCard = Boolean(message.customCard);
      const hasTools = Boolean(message.toolCalls && message.toolCalls.length > 0);
      const hasPlan = Boolean(message.planAction);
      const isEmpty = !hasVisible && !hasThinking && !hasCard && !hasTools && !hasPlan;
      // 当前正在流式中的消息即使暂时为空也不删除,避免闪烁
      if (isEmpty && isStreaming && message.id === streamingMessageId) return true;
      return !isEmpty;
    });
  }, [rawMessages, isStreaming, streamingMessageId]);
  const workspaceSessions = sessions
    .filter((session) => !session.archived && session.workspaceId === currentWorkspace?.id)
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const permissionLabel =
    settings.permissionLevel === "always"
      ? "始终授权"
      : settings.permissionLevel === "ask"
        ? "主动询问"
        : "智能授权";
  const thinkingLabel =
    settings.thinkingLevel === "high"
      ? "高"
      : settings.thinkingLevel === "low"
        ? "低"
        : settings.thinkingLevel === "none"
          ? "关闭"
          : "中";
  const modelSummary = [settings.provider, settings.model].filter(Boolean).join(" / ") || "未配置模型";
  const workspaceName = currentWorkspace?.name ?? "未选择";
  const shouldUseGlobalComposer = !currentSession?.readOnly;

  useEffect(() => {
    const layoutBody = document.querySelector<HTMLElement>('[data-mmcode-region="body"]');
    const composerRoot = document.getElementById("pi-global-composer-root");

    if (shouldUseGlobalComposer && composerRoot) {
      layoutBody?.setAttribute("data-has-global-composer", "true");
      setGlobalComposerRoot(composerRoot);
    } else {
      layoutBody?.removeAttribute("data-has-global-composer");
      setGlobalComposerRoot(null);
    }

    return () => {
      layoutBody?.removeAttribute("data-has-global-composer");
    };
  }, [shouldUseGlobalComposer]);

  const commitTitle = (): void => {
    if (!currentSession) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== currentSession.title) {
      renameSession(currentSession.id, trimmed);
    }
    setEditingTitle(false);
  };

  const updatePlanActionStatus = useCallback((message: Message, status: NonNullable<Message["planAction"]>["status"]): void => {
    if (!message.planAction) return;
    const nextAction = { ...message.planAction, status };
    if (hasAgent && currentAgent) {
      useAgentStore.getState().updateStreamMessage(currentAgent.id, message.id, { planAction: nextAction });
      return;
    }
    if (currentSession) {
      updateMessage(currentSession.id, message.id, { planAction: nextAction });
    }
  }, [currentAgent, currentSession, hasAgent, updateMessage]);

  useEffect(() => {
    if (!activePlanExecution?.sourceMessageId) return;
    const sourceMessage = messages.find((message) => message.id === activePlanExecution.sourceMessageId);
    if (!sourceMessage?.planAction) return;
    const phaseToStatus: Partial<Record<NonNullable<typeof activePlanExecution>["phase"], NonNullable<Message["planAction"]>["status"]>> = {
      awaiting_confirmation: "pending",
      executing: "executing",
      pausing: "pausing",
      paused: "paused",
      completed: "executed",
      failed: "failed",
    };
    const nextStatus = phaseToStatus[activePlanExecution.phase];
    if (nextStatus && sourceMessage.planAction.status !== nextStatus) {
      updatePlanActionStatus(sourceMessage, nextStatus);
    }
  }, [activePlanExecution?.phase, activePlanExecution?.sourceMessageId, messages, updatePlanActionStatus]);

  const executePlanMessage = async (message: Message): Promise<void> => {
    if (!message.planAction) return;
    const name = message.planAction.filename ?? message.planAction.title;
    const visibleContent = `执行计划：${name}`;
    usePlanStore.getState().startExecution({
      activePlanId: message.planAction.id,
      title: message.planAction.title,
      filename: message.planAction.filename,
      sourceMessageId: message.id,
    });
    updatePlanActionStatus(message, "executing");
    usePlanStore.getState().setDecisionRequest(null);
    usePlanStore.getState().setEnabled(currentWorkspace?.id, false);
    await handleSend(`/execute_plan ${name}`, { visibleContent });
  };

  const handlePlanAction = async (message: Message, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string): Promise<void> => {
    if (!message.planAction) return;
    if (action === "cancel") {
      updatePlanActionStatus(message, "cancelled");
      usePlanStore.getState().clearPlanFlow();
      return;
    }
    if (action === "refine") {
      updatePlanActionStatus(message, "refining");
      usePlanStore.getState().setDecisionRequest(null);
      if (text?.trim()) {
        // v2.0: 选项选择后自动发送补充文本
        await handleSend(text.trim(), { visibleContent: `补充: ${text.trim()}` });
      }
      setComposerFocusKey((value) => value + 1);
      return;
    }
    if (action === "pause") {
      updatePlanActionStatus(message, "pausing");
      usePlanStore.getState().markPausing();
      handleStop();
      return;
    }
    if (action === "resume") {
      await executePlanMessage(message);
      return;
    }
    await executePlanMessage(message);
  };

  // 外部预填文本，光标停在末尾方便用户继续。
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>({ text: '', nonce: 0 });
  // v1.0.14: 外部传进来的 prefillText(走 'chatpanel:prefill' 事件)
  //  - 用 Date.now() 做 nonce 保证 effect 重跑
  //  - 消费后回调 onPrefillConsumed 让 App 清 state
  useEffect(() => {
    if (typeof prefillText === 'string' && prefillText.length > 0) {
      setPrefill({ text: prefillText, nonce: Date.now() });
      onPrefillConsumed?.();
    }
  }, [prefillText, onPrefillConsumed]);

  const composer = shouldUseGlobalComposer ? (
    <ChatInput
      isConnected={isConnected}
      isProcessing={isStreaming}
      runContext={activePlanExecution?.phase === "executing" || activePlanExecution?.phase === "pausing" ? "plan_execution" : null}
      onSend={handleSend}
      onStop={handleStop}
      workspaceId={currentWorkspace?.id}
      workspacePath={currentWorkspace?.path}
      agentId={agentId}
      prefill={prefill.text}
      prefillKey={prefill.nonce}
      onPrefillConsumed={() => setPrefill((p) => ({ ...p, text: '' }))}
      focusKey={composerFocusKey}
      referenceFrame
    />
  ) : null;
  const renderedComposer = composer && globalComposerRoot ? createPortal(composer, globalComposerRoot) : composer;

  return (
    <div data-testid="chat-view-root" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--mm-bg-main)] text-[var(--mm-text-primary)]">
      <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-3 border-b border-[#e5e5e5] bg-[var(--mm-bg-main)] px-4 text-[12px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[var(--mm-text-secondary)]">
          <span className="min-w-0 truncate">
            工作区: <span className="text-[var(--mm-text-primary)]">{workspaceName}</span>
          </span>
          <span className="min-w-0 truncate">
            模型: <span className="font-mono text-[var(--mm-text-primary)]">{modelSummary}</span>
          </span>
          <span>权限: <span className="text-[var(--mm-text-primary)]">{permissionLabel}</span></span>
          <span>思考: <span className="text-[var(--mm-text-primary)]">{thinkingLabel}</span></span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[var(--mm-text-secondary)]" role="status" aria-label={isStreaming ? "运行中" : isConnected ? "已连接" : "未连接"}>
          <span className={`h-1.5 w-1.5 rounded-full ${isStreaming ? "bg-[var(--color-success)]" : isConnected ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"}`} aria-hidden="true" />
          <span>{isStreaming ? "运行中" : isConnected ? "已连接" : "未连接"}</span>
        </div>
      </div>
      {messages.length > 0 && (
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="mx-auto flex w-full max-w-[770px] items-center gap-2 text-sm text-[var(--mm-text-primary)]">
            <svg className="h-4 w-4 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            {editingTitle ? (
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitTitle();
                  if (event.key === "Escape") setEditingTitle(false);
                }}
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-input)] px-2 py-1 text-sm font-medium text-[var(--mm-text-primary)] outline-none focus:border-[var(--mm-bg-active)]"
                aria-label="重命名当前会话"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(currentSession?.title || "未命名会话");
                  setEditingTitle(true);
                }}
                className="min-w-0 truncate rounded-md px-1 py-1 text-left font-medium hover:bg-[var(--mm-bg-hover)]"
                title="重命名会话"
              >
                {currentSession?.title || "未命名会话"}
              </button>
            )}
            <select
              value={currentSession?.id ?? ""}
              onChange={(event) => {
                if (event.target.value) setCurrentSession(event.target.value);
              }}
              className="max-w-[220px] rounded-md border border-transparent bg-transparent px-1 py-1 text-xs text-[var(--mm-text-secondary)] hover:border-[var(--mm-border)] hover:bg-[var(--mm-bg-hover)]"
              aria-label="切换会话"
            >
              {workspaceSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title || "未命名会话"}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {/* 消息区域 */}
      <div ref={scrollRegionRef} data-testid="chat-scroll-region" className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col px-0 pb-0 pt-0 text-center">
            <EmptyConversationIntro
              workspaceName={workspaceName}
              modelSummary={modelSummary}
              permissionLabel={permissionLabel}
              thinkingLabel={thinkingLabel}
            />
            {/* Chat send 失败的错误 — 重试按钮 */}
            {isConnected && (streamError || sendError || sessionActionError) && (
              <div
                className="mx-3 mb-3 mt-2 inline-flex max-w-md flex-col gap-2 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-left"
                role="alert"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-[var(--color-error)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-sm text-[var(--color-error)] font-medium">
                    {t('chatView.sendFailed.title')}
                  </span>
                </div>
                <p className="text-xs text-[var(--mm-text-secondary)] break-all font-mono">{streamError || sendError || sessionActionError}</p>
                <button
                  onClick={() => {
                    clearError();
                    setSendError(null);
                    setSessionActionError(null);
                  }}
                    className="px-4 py-2 bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] rounded-md hover:opacity-90 transition-colors text-sm font-medium self-start"
                >
                  {t('chatView.sendFailed.retry')}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* 消息列表 */
          <div
            className="mx-auto flex max-w-[740px] flex-col space-y-5 px-0 py-5"
            role="log"
            aria-live="polite"
            aria-label={t('chatView.messagesAria')}
            aria-busy={isStreaming}
          >
            {messages.length > 50 ? (
              <VirtualizedMessageList
                messages={messages}
                isStreaming={isStreaming}
                streamingMessageId={streamingMessageId}
                onPlanAction={handlePlanAction}
              />
            ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={isStreaming && message.id === streamingMessageId}
                onPlanAction={handlePlanAction}
              />
            ))
            )}

            {/* 流式处理中指示器（仅在没有 assistant 消息占位符时显示） */}
            {isStreaming && !streamingMessageId && (
              <div
                className="flex justify-start"
                role="status"
                aria-label={t('chatView.streamIndicator')}
                aria-busy="true"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" aria-hidden="true" />
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} aria-hidden="true" />
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} aria-hidden="true" />
                      <button
                        type="button"
                        onClick={handleStop}
                        className="ml-3 text-xs text-[var(--mm-text-secondary)] hover:text-[var(--mm-text-primary)] transition-colors"
                        aria-label={activePlanExecution?.phase === "executing" ? "暂停执行" : t('chatView.stopGeneration')}
                      >
                        {activePlanExecution?.phase === "executing" ? "暂停执行" : t('chatView.stop')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(streamError || sendError || sessionActionError) && (
              <div
                className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-left"
                role="alert"
              >
                <div className="mb-1 text-sm font-medium text-[var(--color-error)]">
                  {t('chatView.sendFailed.title')}
                </div>
                <p className="break-all font-mono text-xs text-[var(--mm-text-secondary)]">{streamError || sendError || sessionActionError}</p>
                <button
                  type="button"
                  onClick={() => {
                    clearError();
                    setSendError(null);
                    setSessionActionError(null);
                  }}
                  className="mt-2 rounded-md bg-[var(--mm-bg-active)] px-3 py-1.5 text-xs font-medium text-[var(--mm-text-on-active)] hover:opacity-90"
                >
                  {t('chatView.sendFailed.retry')}
                </button>
              </div>
            )}

            {/* 回到顶部按钮 */}
            {messages.length > 5 && (
              <button
                type="button"
                onClick={() => {
                  scrollRegionRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] shadow-sm text-[var(--mm-text-secondary)] hover:text-[var(--mm-text-primary)] transition-all"
                aria-label="回到顶部"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {renderedComposer}

      {messages.length > 0 && currentSession?.readOnly && (
          <div className="border-t border-[var(--mm-border-subtle)] bg-[var(--mm-bg-main)] px-4 py-3">
            <div className="mx-auto flex max-w-[770px] items-center justify-between gap-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs">
              <span className="text-[var(--mm-text-secondary)]">当前为只读历史会话</span>
              <button
                type="button"
                onClick={() => void handleContinueReadOnly()}
                className="rounded-md bg-[var(--mm-bg-active)] px-2.5 py-1.5 text-[var(--mm-text-on-active)]"
              >
                从此会话继续
              </button>
            </div>
          </div>
      )}
    </div>
  );
}

