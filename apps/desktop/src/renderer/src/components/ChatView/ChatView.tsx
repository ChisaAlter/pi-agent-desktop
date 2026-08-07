// 聊天主区域 - 空态 + 消息列表 + 输入框
// v1.0.4: 用户可见文案走 t()

import React, { useRef, useEffect, useMemo, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePiStream } from '../../hooks/usePiStream';
import { useSessionStore } from '../../stores/session-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAgentStore } from '../../stores/agent-store';
import { MessageBubble } from './MessageBubble';
import { VirtualizedMessageList } from './VirtualizedMessageList';
import { ChatInput } from './ChatInput';
import type { GeneratedUiSendRequest } from './GeneratedUiForm';
import { useI18n } from '../../i18n';
import { usePlanStore } from '../../stores/plan-store';
import { useAgentModeStore } from '../../stores/agent-mode-store';
import { useSettingsStore } from '../../stores/settings-store';
import { WorkspaceSwitcher } from '../TopTabBar/WorkspaceSwitcher';
import { SEARCH_FOCUS_CLEAR_DELAY_MS } from './search-focus';
import type { Message } from '../../stores/session-store';
import { isIpcError, type AgentMessage, type PiImageContent } from '@shared';
import { buildPlanExecutionPrompt } from './plan-execution-prompt';
import { usePlanSyncEffect } from './hooks/usePlanSyncEffect';
import { MINIMAX_CHROME_ICON_BUTTON_CLASSNAME } from '../MiniMaxCode/chromeButton';
import { contentWithGeneratedUiText } from '../../utils/generated-ui';
import { resolveActiveAgent } from '../../utils/active-agent';
import { isVisionUnsupportedError } from '../../utils/vision';

// Ref-based callback that always sees the latest state but has stable identity.
// Used to avoid stale closures (e.g. handleStop reading an outdated messages array).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional generic callback pattern
function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: any[]) => ref.current(...args), []) as T;
}

interface ChatViewProps {
    active?: boolean;
    /** v1.0.14: 外部注入的预填文本(由 App.tsx 监听 'chatpanel:prefill' 事件传来,用于跨组件切到 chat 时把 prompt 灌进 ChatInput) */
    prefillText?: string | null;
    /** prefill 已被 ChatInput 消费后回调 */
    onPrefillConsumed?: () => void;
    focusMessageId?: string | null;
    onFocusMessageHandled?: () => void;
    rightRailCollapsed?: boolean;
    onToggleRightRail?: () => void;
}

function hasVisibleAssistantContent(message: Message): boolean {
  const content = message.content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
  return Boolean(content || message.generatedUi || message.customCard || (message.toolCalls && message.toolCalls.length > 0));
}

type ChatMessage = Message & {
  thinkingCount?: number;
};

const EMPTY_AGENT_MESSAGES: AgentMessage[] = [];

function cleanCompactValue(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatTokenSummary(num: number): string {
  if (num <= 0) return "0";
  if (num < 1_000) return num.toLocaleString();
  if (num < 1_000_000) return `${cleanCompactValue(num / 1_000)}K`;
  return `${cleanCompactValue(num / 1_000_000)}M`;
}

function resolveTotalTokens(
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number },
): number | undefined {
  if (!usage) return undefined;
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return undefined;
}

/** Token 速度滑动窗口: 只统计最近 5s 内 output token 增量, 避免整段平均被开头/结尾拖慢. */
const TOKEN_RATE_WINDOW_MS = 5_000;
/** 窗口跨度低于该值 (秒) 时速度不稳定, 沿用上一个值. */
const TOKEN_RATE_MIN_SPAN_SEC = 0.3;

function RightRailToggleIcon({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="10" y1="3" x2="10" y2="13" />
      {collapsed ? (
        <path d="M7.5 6 5.5 8 7.5 10" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M5.5 6 7.5 8 5.5 10" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function stripThinking(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

function visibleText(message: Message): string {
  return stripThinking(message.content);
}

function isHiddenInternalContext(message: Message): boolean {
  if (message.role !== "assistant") return false;
  const text = contentWithGeneratedUiText(message.content, message.generatedUi);
  return text.includes("Compose runtime is active.")
    && text.includes("compose-guided turn for the current session");
}

// plan execution prompt helpers: ./plan-execution-prompt.ts

function EmptyConversationIntro({
  workspaceControl,
  modelSummary,
  permissionLabel,
  thinkingLabel,
  title,
  subtitle,
  workspaceFieldLabel,
  modelFieldLabel,
  permissionFieldLabel,
  thinkingFieldLabel,
}: {
  workspaceControl: React.ReactNode;
  modelSummary: string;
  permissionLabel: string;
  thinkingLabel: string;
  title: string;
  subtitle: string;
  workspaceFieldLabel: string;
  modelFieldLabel: string;
  permissionFieldLabel: string;
  thinkingFieldLabel: string;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-6 pb-2 pt-8 text-left">
      <div className="w-full rounded-[6px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
        <div className="text-[14px] font-medium leading-5 text-[var(--mm-text-primary)]">{title}</div>
        <div className="mt-1 text-[12px] text-[#8a939c]">{subtitle}</div>
        <div className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[11px] leading-4">
          <span className="text-[var(--mm-text-tertiary)]">{workspaceFieldLabel}</span>
          {workspaceControl}
          <span className="text-[var(--mm-text-tertiary)]">{modelFieldLabel}</span>
          <span className="min-w-0 whitespace-normal break-all text-[var(--mm-text-secondary)]" title={modelSummary}>{modelSummary}</span>
          <span className="text-[var(--mm-text-tertiary)]">{permissionFieldLabel}</span>
          <span className="text-[var(--mm-text-secondary)]">{permissionLabel}</span>
          <span className="text-[var(--mm-text-tertiary)]">{thinkingFieldLabel}</span>
          <span className="text-[var(--mm-text-secondary)]">{thinkingLabel}</span>
        </div>
      </div>
    </div>
  );
}

function isCumulativeAssistantUpdate(previous: Message, next: Message): boolean {
  if (previous.role !== "assistant" || next.role !== "assistant") return false;
  if (previous.generatedUi || next.generatedUi || previous.customCard || next.customCard || previous.planAction || next.planAction) return false;
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

export function ChatView({
  active = true,
  prefillText,
  onPrefillConsumed,
  focusMessageId,
  onFocusMessageHandled,
  rightRailCollapsed = true,
  onToggleRightRail,
}: ChatViewProps = {}): React.JSX.Element {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const isNearBottomRef = useRef(true);
  const focusHandledTimerRef = useRef<number | null>(null);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const agents = useAgentStore((state) => state.agents);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const createAgent = useAgentStore((state) => state.createAgent);
  const currentAgent = useMemo(
    () => currentWorkspace
      ? resolveActiveAgent(agents, currentWorkspace.id, { agentId: currentAgentId, sessionId: currentSessionId })
      : null,
    [agents, currentAgentId, currentSessionId, currentWorkspace],
  );
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
  const settings = useSettingsStore((state) => state.settings);
  const initAgents = useAgentStore((state) => state.init);
  const agentMessages = useAgentStore((state) => agentId ? state.messagesByAgent[agentId] ?? EMPTY_AGENT_MESSAGES : EMPTY_AGENT_MESSAGES);
  const runtimeState = useAgentStore((state) => agentId ? state.runtimeByAgent[agentId] : undefined);
  const { t } = useI18n();
  const currentSession = getCurrentSession();
  const [sendError, setSendError] = useState<string | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [globalComposerRoot, setGlobalComposerRoot] = useState<HTMLElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const activePlanExecution = usePlanStore((state) => state.activeExecution);
  const animatedTokenFrameRef = useRef<number | null>(null);
  const animatedTokenSessionIdRef = useRef<string | null>(currentSession?.id ?? null);
  const animatedTokenValueRef = useRef(0);
  const [animatedTotalTokens, setAnimatedTotalTokens] = useState(() => resolveTotalTokens(currentSession?.usage) ?? 0);
  // Token 速度: 流式输出期间按 usage 更新采样 output token 增量 / 时间
  const tokenRateSamplesRef = useRef<Array<{ t: number; output: number }>>([]);
  const tokenRateSessionIdRef = useRef<string | null>(currentSession?.id ?? null);
  const [tokenRate, setTokenRate] = useState<number | null>(null);
  const hasAgent = Boolean(currentAgent);
  const shouldUseSessionMessages = Boolean(currentSession);

  useEffect(() => {
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  }, [agentId, currentSession?.id]);

  useEffect(() => {
    if (focusMessageId || !isNearBottomRef.current || autoScrollFrameRef.current !== null) return;
    const scrollToBottom = (): void => {
      autoScrollFrameRef.current = null;
      const scrollRegion = scrollRegionRef.current;
      if (!scrollRegion || !isNearBottomRef.current) return;
      scrollRegion.scrollTo({ top: scrollRegion.scrollHeight, behavior: 'auto' });
      isNearBottomRef.current = true;
    };
    if (typeof window.requestAnimationFrame !== "function") {
      scrollToBottom();
      return;
    }
    autoScrollFrameRef.current = window.requestAnimationFrame(scrollToBottom);
  }, [agentMessages, currentSession?.messages, focusMessageId]);

  // 输入框被拖高时, 对话区 flex 空间同步收缩; 贴底时把最后一条消息顶上去, 避免
  // 视觉上"输入框盖在对话下面/中间还露一块对话".
  useEffect(() => {
    const stickToBottomOnComposerResize = (): void => {
      if (focusMessageId || !isNearBottomRef.current) return;
      const scrollRegion = scrollRegionRef.current;
      if (!scrollRegion) return;
      scrollRegion.scrollTo({ top: scrollRegion.scrollHeight, behavior: "auto" });
    };
    window.addEventListener("pi:composer-height-change", stickToBottomOnComposerResize);
    return () => window.removeEventListener("pi:composer-height-change", stickToBottomOnComposerResize);
  }, [focusMessageId]);

  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void initAgents();
  }, [initAgents]);

  useEffect(() => {
    clearError();
    setSendError(null);
    setSessionActionError(null);
  }, [currentSession?.id, clearError]);

  // SubTask 7.2: plan card → conversation sync extracted into usePlanSyncEffect.
  usePlanSyncEffect(currentSession?.id ?? null, isStreaming);

  const handleSend = useEventCallback(async (
    message: string,
    options?: {
      visibleContent?: string;
      waitForAgentIdle?: boolean;
      /**
       * Stage the user bubble immediately, then await this for the final
       * model-bound transport text (vision preflight lives here).
       */
      resolveTransport?: () => Promise<string>;
      /** Native multimodal images for direct vision models. */
      images?: PiImageContent[];
      /** Original data URLs for auto-fallback to describeImages after direct-send rejection. */
      imageDataUrls?: Array<{ name: string; dataUrl: string; mimeType?: string }>;
    },
  ) => {
    if (!currentWorkspace) return;
    let stagedMessageId: string | null = null;
    let stagedSessionId: string | null = null;
    try {
      if (getCurrentSession()?.readOnly) {
        setSendError(t("chatView.errors.readOnlyHistory"));
        return;
      }
      let sessionForSend = getCurrentSession();
      if (!sessionForSend || sessionForSend.workspaceId !== currentWorkspace.id) {
        sessionForSend = await createSession(currentWorkspace.id);
      }
      setSendError(null);
      setSessionActionError(null);
      let agentIdForSend = currentAgent?.sessionId === sessionForSend.id
        ? currentAgent.id
        : agents.find((agent) => agent.workspaceId === currentWorkspace.id && agent.sessionId === sessionForSend!.id)?.id;
      if (!agentIdForSend) {
        const agent = await createAgent(currentWorkspace.id, `${sessionForSend.title || t("chatView.session.untitled")} Agent`, sessionForSend.id);
        agentIdForSend = agent.id;
      }
      // Always stage the visible user bubble before vision/model work so the chat
      // does not look frozen while describeImages or multimodal prompt setup runs.
      const visibleContent = options?.visibleContent ?? message;
      stagedMessageId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      stagedSessionId = sessionForSend.id;
      useSessionStore.getState().addMessage(sessionForSend.id, {
        id: stagedMessageId,
        role: "user",
        content: visibleContent,
        timestamp: new Date(),
      });

      // Persist image bytes for history thumbnails / fork / export (metadata only in sqlite).
      if (options?.images && options.images.length > 0 && window.piAPI?.saveSessionAttachments) {
        try {
          const saved = await window.piAPI.saveSessionAttachments({
            sessionId: sessionForSend.id,
            messageId: stagedMessageId,
            images: options.images.map((image, index) => ({
              name: options.imageDataUrls?.[index]?.name ?? `image-${index + 1}`,
              mimeType: image.mimeType,
              data: image.data,
            })),
          });
          if (!isIpcError(saved) && saved.attachments?.length) {
            useSessionStore.getState().updateMessage(sessionForSend.id, stagedMessageId, {
              attachments: saved.attachments,
            }, { persist: false });
          }
        } catch (attachErr) {
          // Non-fatal: chat can continue even if disk persistence fails.
          console.warn("[ChatView] saveSessionAttachments failed:", attachErr);
        }
      } else if (options?.imageDataUrls && options.imageDataUrls.length > 0 && window.piAPI?.saveSessionAttachments) {
        // Describe-fallback path still keeps durable thumbnails from original data URLs.
        try {
          const images = options.imageDataUrls
            .map((item) => {
              const match = /^data:([^;,]+);base64,(.+)$/i.exec(item.dataUrl);
              if (!match) return null;
              return {
                name: item.name,
                mimeType: item.mimeType || match[1] || "image/png",
                data: match[2],
              };
            })
            .filter((item): item is { name: string; mimeType: string; data: string } => Boolean(item));
          if (images.length > 0) {
            const saved = await window.piAPI.saveSessionAttachments({
              sessionId: sessionForSend.id,
              messageId: stagedMessageId,
              images,
            });
            if (!isIpcError(saved) && saved.attachments?.length) {
              useSessionStore.getState().updateMessage(sessionForSend.id, stagedMessageId, {
                attachments: saved.attachments,
              }, { persist: false });
            }
          }
        } catch (attachErr) {
          console.warn("[ChatView] saveSessionAttachments (fallback) failed:", attachErr);
        }
      }

      const transport = options?.resolveTransport
        ? await options.resolveTransport()
        : message;

      const streamOptions = {
        visibleContent,
        skipOptimisticUserMessage: true,
        ...(options?.waitForAgentIdle ? { waitForAgentIdle: true } : {}),
        ...(agentIdForSend ? { agentId: agentIdForSend } : {}),
        ...(options?.images && options.images.length > 0 ? { images: options.images } : {}),
      };

      try {
        await startStreaming(currentWorkspace.id, transport, streamOptions);
      } catch (directErr) {
        // Auto-fallback: model claimed vision but provider rejected images → describe then resend as text.
        const directMessage = directErr instanceof Error ? directErr.message : String(directErr);
        const canFallback =
          Boolean(options?.images?.length)
          && Boolean(options?.imageDataUrls?.length)
          && Boolean(window.piAPI?.describeImages)
          && isVisionUnsupportedError(directMessage);
        if (!canFallback) throw directErr;

        const describeImages = window.piAPI.describeImages;
        if (!describeImages) throw directErr;
        const result = await describeImages(options?.imageDataUrls ?? []);
        if (isIpcError(result)) throw new Error(result.fallback);
        const text = typeof result?.text === "string" ? result.text.trim() : "";
        if (!text) throw new Error(t("chatInput.errors.visionEmptyResult"));
        const fallbackTransport = [
          "图片识别结果:",
          text,
          "",
          "用户消息:",
          message,
        ].join("\n");
        await startStreaming(currentWorkspace.id, fallbackTransport, {
          visibleContent,
          skipOptimisticUserMessage: true,
          ...(options?.waitForAgentIdle ? { waitForAgentIdle: true } : {}),
          ...(agentIdForSend ? { agentId: agentIdForSend } : {}),
        });
      }
    } catch (err) {
      if (stagedSessionId && stagedMessageId) {
        useSessionStore.getState().removeMessage(stagedSessionId, stagedMessageId);
      }
      setSendError(err instanceof Error ? err.message : String(err));
      // 关键: 必须向上抛出, ChatInput.handleSend 的 catch 依赖 onSend 抛异常
      // 来恢复草稿 + 附件 + 焦点。吞掉异常会让用户输入被清空且无法重试。
      throw err;
    }
  });
  const handleGeneratedUiSend = useEventCallback(async (request: GeneratedUiSendRequest): Promise<void> => {
    try {
      await handleSend(request.transportContent, { visibleContent: request.visibleContent, waitForAgentIdle: true });
    } catch {
      // 失败已通过 sendError 展示; 生成 UI 卡片没有输入框草稿可恢复, 不继续上抛。
    }
  });

  // SubTask 7.1: useEventCallback keeps identity stable (so ChatInput's onStop
  // prop doesn't churn) while always reading the latest `messages` via the ref,
  // avoiding the stale-closure bug where stop operated on an outdated array.
  const handleStop = useEventCallback(() => {
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
  });
  const handleContinueReadOnly = async (): Promise<void> => {
    if (!currentSession) return;
    try {
      setSessionActionError(null);
      const next = await continueSession(currentSession.id);
      setCurrentSession(next.id);
    } catch (error) {
      setSessionActionError(t("chatView.errors.continueFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  };
  const rawMessages = useMemo(() => shouldUseSessionMessages
    ? currentSession?.messages || []
    : hasAgent && agentMessages.length > 0
      ? agentMessages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" || message.role === "system" || message.role === "user"
          ? message.role
          : "system",
        content: message.content,
        timestamp: new Date(message.createdAt),
        thinking: message.thinking,
        generatedUi: message.generatedUi,
        planAction: message.planAction,
      }))
      : [], [agentMessages, currentSession?.messages, hasAgent, shouldUseSessionMessages]);
  const messages = useMemo(() => {
    const merged = mergeAdjacentThinkingMessages(rawMessages);
    // v1.0.14-fix: 过滤后端偶发的完全空白 assistant 消息(有 content/thinking/card/tools/plan 至少一个才保留)
    return merged.filter((message) => {
      if (isHiddenInternalContext(message)) return false;
      const hasVisible = visibleText(message).length > 0;
      const hasThinking = Boolean(message.thinking?.trim());
      const hasGeneratedUi = Boolean(message.generatedUi);
      const hasCard = Boolean(message.customCard);
      const hasTools = Boolean(message.toolCalls?.some((toolCall) =>
        toolCall.name !== "render_ui" || toolCall.status !== "completed"
      ));
      const hasPlan = Boolean(message.planAction);
      const isEmpty = !hasVisible && !hasThinking && !hasGeneratedUi && !hasCard && !hasTools && !hasPlan;
      // 当前正在流式中的消息即使暂时为空也不删除,避免闪烁
      if (isEmpty && isStreaming && message.id === streamingMessageId) return true;
      return !isEmpty;
    });
  }, [rawMessages, isStreaming, streamingMessageId]);

  useEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    const bottomSentinel = messagesEndRef.current;
    if (!scrollRegion || !bottomSentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(([entry]) => {
      const isNearBottom = entry?.isIntersecting ?? true;
      isNearBottomRef.current = isNearBottom;
      setShowScrollToBottom(!isNearBottom);
    }, {
      root: scrollRegion,
      rootMargin: "0px 0px 160px 0px",
      threshold: 0,
    });
    observer.observe(bottomSentinel);
    return () => observer.disconnect();
  }, [agentId, currentSession?.id, messages.length]);

  useEffect(() => {
    if (focusHandledTimerRef.current !== null) {
      window.clearTimeout(focusHandledTimerRef.current);
      focusHandledTimerRef.current = null;
    }
    if (!focusMessageId) return;
    if (messages.length > 50) return;
    const target = document.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    focusHandledTimerRef.current = window.setTimeout(() => {
      focusHandledTimerRef.current = null;
      onFocusMessageHandled?.();
    }, SEARCH_FOCUS_CLEAR_DELAY_MS);
    return () => {
      if (focusHandledTimerRef.current !== null) {
        window.clearTimeout(focusHandledTimerRef.current);
        focusHandledTimerRef.current = null;
      }
    };
  }, [focusMessageId, messages, onFocusMessageHandled]);
  const permissionMode = currentWorkspace?.id
    ? settings.workspacePermissionModes?.[currentWorkspace.id] ?? settings.permissionLevel
    : settings.permissionLevel;
  const permissionLabel =
    permissionMode === "always"
      ? t("chatInput.permissions.always.label")
      : permissionMode === "ask"
        ? t("chatInput.permissions.ask.label")
        : t("chatInput.permissions.smart.label");
  const effectiveThinking = runtimeState?.thinkingLevel ?? (settings.thinkingLevel === "none" ? "off" : settings.thinkingLevel ?? "medium");
  const thinkingLabel = t(`chatInput.thinking.${effectiveThinking}`);
  const modelSummary = runtimeState?.modelId
    ? [runtimeState.modelProvider, runtimeState.modelName ?? runtimeState.modelId].filter(Boolean).join(" / ")
    : [settings.provider, settings.model].filter(Boolean).join(" / ") || t("chatInput.model.notConfigured");
  const workspaceControl = <WorkspaceSwitcher variant="inline" />;
  const totalTokens = resolveTotalTokens(currentSession?.usage);
  const toggleRightRailLabel = rightRailCollapsed ? t("chatView.rightRail.expand") : t("chatView.rightRail.collapse");
  const connectionLabel = isStreaming
    ? t("chatView.status.running")
    : isConnected
      ? t("chatView.status.connected")
      : t("chatView.status.disconnected");
  const shouldUseGlobalComposer = active && !currentSession?.readOnly;

  useEffect(() => {
    animatedTokenValueRef.current = animatedTotalTokens;
  }, [animatedTotalTokens]);

  useEffect(() => {
    const nextSessionId = currentSession?.id ?? null;
    if (animatedTokenSessionIdRef.current === nextSessionId) return;
    animatedTokenSessionIdRef.current = nextSessionId;
    setAnimatedTotalTokens(totalTokens ?? 0);
    animatedTokenValueRef.current = totalTokens ?? 0;
  }, [currentSession?.id, totalTokens]);

  useEffect(() => {
    if (animatedTokenFrameRef.current !== null) {
      cancelAnimationFrame(animatedTokenFrameRef.current);
      animatedTokenFrameRef.current = null;
    }
    if (totalTokens === undefined) return;

    const from = animatedTokenValueRef.current;
    const to = totalTokens;
    if (from === to) {
      setAnimatedTotalTokens(to);
      animatedTokenValueRef.current = to;
      return;
    }

    const durationMs = 480;
    const startAt = performance.now();
    const step = (now: number): void => {
      const progress = Math.min((now - startAt) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (to - from) * eased);
      animatedTokenValueRef.current = next;
      setAnimatedTotalTokens(next);
      if (progress < 1) {
        animatedTokenFrameRef.current = requestAnimationFrame(step);
      } else {
        animatedTokenFrameRef.current = null;
      }
    };

    animatedTokenFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animatedTokenFrameRef.current !== null) {
        cancelAnimationFrame(animatedTokenFrameRef.current);
        animatedTokenFrameRef.current = null;
      }
    };
  }, [totalTokens]);

  useEffect(() => {
    return () => {
      if (animatedTokenFrameRef.current !== null) {
        cancelAnimationFrame(animatedTokenFrameRef.current);
      }
    };
  }, []);

  // Token 速度采样: usage 每次更新 (updatedAt 变化) 记一个样本, 保留最近 5s 窗口
  const currentOutputTokens = currentSession?.usage?.outputTokens ?? 0;
  const usageUpdatedAt = currentSession?.usage?.updatedAt ?? 0;
  useEffect(() => {
    if (tokenRateSessionIdRef.current !== currentSession?.id) {
      tokenRateSessionIdRef.current = currentSession?.id ?? null;
      tokenRateSamplesRef.current = [];
      setTokenRate(null);
    }
    if (!isStreaming) {
      tokenRateSamplesRef.current = [];
      setTokenRate(null);
      return;
    }
    const now = usageUpdatedAt > 0 ? usageUpdatedAt : Date.now();
    const samples = tokenRateSamplesRef.current;
    samples.push({ t: now, output: currentOutputTokens });
    while (samples.length > 1 && now - samples[0].t > TOKEN_RATE_WINDOW_MS) {
      samples.shift();
    }
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dtSec = (last.t - first.t) / 1000;
      const dOutput = last.output - first.output;
      if (dtSec >= TOKEN_RATE_MIN_SPAN_SEC && dOutput > 0) {
        setTokenRate(dOutput / dtSec);
      }
    }
  }, [currentSession?.id, currentOutputTokens, usageUpdatedAt, isStreaming]);

  const tokenRateSummary = tokenRate !== null && tokenRate > 0
    ? `· ${tokenRate >= 10 ? Math.round(tokenRate).toString() : tokenRate.toFixed(1)} tok/s`
    : null;

  const displayedTotalTokens = totalTokens === undefined && !isStreaming
    ? undefined
    : animatedTotalTokens;
  const usageSummary = displayedTotalTokens === undefined
    ? "Token: -"
    : `Token: ${formatTokenSummary(displayedTotalTokens)}`;

  useEffect(() => {
    const composerRoot = document.getElementById("pi-global-composer-root");

    if (shouldUseGlobalComposer && composerRoot) {
      setGlobalComposerRoot(composerRoot);
    } else {
      setGlobalComposerRoot(null);
    }
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
    if (!shouldUseSessionMessages && hasAgent && currentAgent) {
      useAgentStore.getState().updateStreamMessage(currentAgent.id, message.id, { planAction: nextAction });
      return;
    }
    if (currentSession) {
      updateMessage(currentSession.id, message.id, { planAction: nextAction });
    }
  }, [currentAgent, currentSession, hasAgent, shouldUseSessionMessages, updateMessage]);

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

  // useEventCallback keeps identity stable so MessageBubble's React.memo can
  // short-circuit during streaming (onPlanAction prop identity doesn't churn).
  const executePlanMessage = useEventCallback(async (message: Message, selectedOption?: string): Promise<void> => {
    if (!message.planAction) return;
    if (!currentWorkspace) return;
    const planContent = contentWithGeneratedUiText(message.content, message.generatedUi).trim();
    let filename = message.planAction.filename;
    if (!filename && window.piAPI?.planMaterialize && planContent) {
      const result = await window.piAPI.planMaterialize({
        workspaceId: currentWorkspace.id,
        title: message.planAction.title,
        content: planContent,
      });
      if (isIpcError(result)) {
        setSendError(result.fallback);
        updatePlanActionStatus(message, "failed");
        return;
      }
      filename = result.filename;
    }
    const name = filename ?? message.planAction.title;
    const executionPrompt = buildPlanExecutionPrompt({
      title: message.planAction.title,
      filename,
      selectedOption,
      content: planContent,
    });
    const visibleContent = name ? t("chatView.plan.executeNamed", { name }) : t("chatView.plan.execute");
    const nextMessage = filename && filename !== message.planAction.filename
      ? {
          ...message,
          planAction: {
            ...message.planAction,
            filename,
          },
        }
      : message;
    usePlanStore.getState().startExecution({
      activePlanId: message.planAction.id,
      title: message.planAction.title,
      filename,
      sourceMessageId: message.id,
    });
    updatePlanActionStatus(nextMessage, "executing");
    usePlanStore.getState().setDecisionRequest(null);
    if (currentWorkspace?.id) {
      useAgentModeStore.getState().setMode(currentWorkspace.id, "build");
    }
    await handleSend(executionPrompt, { visibleContent, waitForAgentIdle: true });
  });

  const handlePlanAction = useEventCallback(async (message: Message, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string): Promise<void> => {
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
        await handleSend(text.trim(), { visibleContent: t("chatView.plan.supplement", { text: text.trim() }) });
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
    await executePlanMessage(message, text?.trim() || undefined);
  });

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
    <div data-testid="chat-view-root" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--mm-bg-input)] text-[var(--mm-text-primary)]">
      <div
        data-testid="chat-conversation-header"
        className="grid min-h-[44px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--mm-border)] bg-[var(--mm-bg-input)] pl-12 pr-4 text-[12px]"
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[var(--mm-text-primary)]">
          <div className="shrink-0">{workspaceControl}</div>
          {messages.length > 0 ? (
            <>
              <svg className="h-4 w-4 shrink-0 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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
                  className="h-7 min-w-0 max-w-[420px] flex-1 rounded-[4px] border border-[var(--mm-border)] bg-[var(--mm-bg-input)] px-2 text-[13px] font-medium text-[var(--mm-text-primary)] outline-none focus:border-[var(--mm-bg-active)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                  aria-label={t("chatView.session.renameAria")}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(currentSession?.title || t("chatView.session.untitled"));
                    setEditingTitle(true);
                  }}
                  className="h-7 min-w-0 max-w-[420px] truncate rounded-[4px] px-1.5 text-left text-[13px] font-medium transition-colors hover:bg-[var(--mm-bg-hover)] active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
                  title={t("chatView.session.renameTitle")}
                >
                  {currentSession?.title || t("chatView.session.untitled")}
                </button>
              )}
            </>
          ) : null}
        </div>
        <div className="pi-motion-status-pill flex h-7 shrink-0 items-center justify-end gap-3 text-[var(--mm-text-secondary)]" data-motion-state={isStreaming ? "running" : isConnected ? "connected" : "disconnected"}>
          <span className="inline-flex h-7 shrink-0 items-center font-mono tabular-nums leading-none text-[var(--mm-text-primary)]">{usageSummary}</span>
          {tokenRateSummary ? (
            <span
              data-testid="chat-token-rate"
              className="inline-flex h-7 shrink-0 items-center font-mono tabular-nums leading-none text-[var(--mm-text-secondary)]"
            >
              {tokenRateSummary}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${isStreaming ? "pi-motion-running-dot bg-[var(--color-success)]" : isConnected ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"}`} aria-hidden="true" />
            <span key={connectionLabel} className="pi-motion-status-text inline-flex h-7 items-center leading-none" role="status" aria-label={connectionLabel}>{connectionLabel}</span>
          </span>
          {onToggleRightRail ? (
            <span className="inline-flex translate-y-[0.5px]">
              <button
                type="button"
                onClick={onToggleRightRail}
                aria-label={toggleRightRailLabel}
                title={toggleRightRailLabel}
                className={MINIMAX_CHROME_ICON_BUTTON_CLASSNAME}
              >
                <RightRailToggleIcon collapsed={rightRailCollapsed} />
              </button>
            </span>
          ) : null}
        </div>
      </div>
      {/* 消息区域 */}
      <div
        ref={scrollRegionRef}
        data-testid="chat-scroll-region"
        onWheel={(event) => {
          if (event.deltaY < 0) isNearBottomRef.current = false;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          currentSession?.messagesLoaded === false ? (
            /* 会话消息懒加载中 — 不渲染"新对话"欢迎卡片, 避免历史会话
               加载完成时闪成消息列表, 让用户误以为对话被清空。 */
            <div className="flex min-h-full items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-[var(--mm-text-secondary)]" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--mm-border)] border-t-[var(--mm-accent-blue)]" aria-hidden="true" />
                {t("chatView.loading.messages")}
              </div>
            </div>
          ) : (
            <div className="flex min-h-full flex-col px-0 pb-0 pt-0 text-center">
              <EmptyConversationIntro
              workspaceControl={workspaceControl}
              modelSummary={modelSummary}
              permissionLabel={permissionLabel}
              thinkingLabel={thinkingLabel}
              title={t("chatView.empty.title")}
              subtitle={t("chatView.empty.subtitle")}
              workspaceFieldLabel={t("chatView.empty.workspace")}
              modelFieldLabel={t("chatView.empty.model")}
              permissionFieldLabel={t("chatView.empty.permission")}
              thinkingFieldLabel={t("chatView.empty.thinking")}
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
                  type="button"
                  onClick={() => {
                    clearError();
                    setSendError(null);
                    setSessionActionError(null);
                  }}
                    className="px-4 py-2 bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] rounded-md hover:opacity-90 transition-colors text-sm font-medium self-start focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                  {t('chatView.sendFailed.dismiss')}
                </button>
              </div>
            )}
            </div>
          )
        ) : (
          /* 消息列表 — 底部 pb-8 留白, 最后一条消息与输入框保持间距 */
          <div
            className="mx-auto flex w-full max-w-[780px] flex-col space-y-5 px-4 pt-5 pb-8 sm:px-6 lg:px-8"
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
                focusMessageId={focusMessageId}
                onFocusHandled={onFocusMessageHandled}
                onPlanAction={handlePlanAction}
                onGeneratedUiSend={handleGeneratedUiSend}
                generatedUiDisabled={!isConnected || isStreaming || Boolean(currentSession?.readOnly)}
                scrollElementRef={scrollRegionRef}
              />
            ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={isStreaming && message.id === streamingMessageId}
                isSearchTarget={focusMessageId === message.id}
                onPlanAction={handlePlanAction}
                onGeneratedUiSend={handleGeneratedUiSend}
                generatedUiDisabled={!isConnected || isStreaming || Boolean(currentSession?.readOnly)}
              />
            ))
            )}

            {/* 流式处理中指示器（仅在没有 assistant 消息占位符时显示） */}
            {isStreaming && !streamingMessageId && !shouldUseGlobalComposer && (
              <div
                className="pi-motion-running-card flex justify-center"
                role="status"
                aria-label={t('chatView.streamIndicator')}
                aria-busy="true"
                data-motion="stream-placeholder"
              >
                <div className="w-full max-w-[42rem]">
                  <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
                    <div className="flex items-center gap-2 text-sm text-[var(--mm-text-secondary)]">
                      <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                        <span className="absolute inset-0 rounded-full bg-[var(--mm-bg-active)] opacity-25 animate-ping" />
                        <span className="pi-motion-running-dot relative h-2.5 w-2.5 rounded-full bg-[var(--mm-bg-active)]" />
                      </span>
                      <span>
                        {activePlanExecution?.phase === "executing"
                          ? t("chatInput.running.plan")
                          : t("chatInput.running.task")}
                      </span>
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
                  className="mt-2 rounded-md bg-[var(--mm-bg-active)] px-3 py-1.5 text-xs font-medium text-[var(--mm-text-on-active)] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                  {t('chatView.sendFailed.retry')}
                </button>
              </div>
            )}

            {/* 回到最新消息按钮 */}
            {messages.length > 5 && showScrollToBottom && (
              <button
                type="button"
                onClick={() => {
                  const scrollRegion = scrollRegionRef.current;
                  if (!scrollRegion) return;
                  scrollRegion.scrollTo({ top: scrollRegion.scrollHeight, behavior: 'smooth' });
                  isNearBottomRef.current = true;
                  setShowScrollToBottom(false);
                }}
                className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] shadow-sm text-[var(--mm-text-secondary)] hover:text-[var(--mm-text-primary)] transition-[background-color,border-color,color,opacity,box-shadow,transform] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                aria-label={t("chatView.scrollBottom")}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 14l7 7m0 0l7-7m-7 7V3" />
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
              <span className="text-[var(--mm-text-secondary)]">{t("chatView.readOnly.label")}</span>
              <button
                type="button"
                onClick={() => void handleContinueReadOnly()}
                className="rounded-md bg-[var(--mm-bg-active)] px-2.5 py-1.5 text-[var(--mm-text-on-active)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
              >
                {t("chatView.readOnly.continue")}
              </button>
            </div>
          </div>
      )}
    </div>
  );
}

