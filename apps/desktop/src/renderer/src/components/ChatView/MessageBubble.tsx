// 消息气泡 - v2.0 MiniMax Code 风格
// AI 消息: 白底圆角卡片 + 底部复制/时间戳
// 用户消息: 浅色 pill + normal 字重

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Message } from '../../stores/session-store';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CommandCard } from './CommandCard';
import { CustomMessageCard } from './CustomMessageCard';
import { GeneratedUiCard } from './GeneratedUiCard';
import type { GeneratedUiSendRequest } from './GeneratedUiForm';
import { ThinkingBlock } from './ThinkingBlock';
import { PlanCard } from './PlanCard';
import { usePlanStore } from '../../stores/plan-store';
import { useSettingsStore } from '../../stores/settings-store';
import { formatTime, formatIso } from '../../utils/format';
import { contentWithGeneratedUiText } from '../../utils/generated-ui';
import type { GeneratedUiCard as GeneratedUiCardData } from '@shared';

type ChatMessage = Message & {
  thinkingCount?: number;
};

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isSearchTarget?: boolean;
  onPlanAction?: (message: ChatMessage, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string) => Promise<void>;
  onGeneratedUiSend?: (request: GeneratedUiSendRequest) => Promise<void>;
  generatedUiDisabled?: boolean;
}

function inferInlinePlanAction(
  message: Pick<ChatMessage, "id" | "role" | "planAction">,
  visibleContent: string,
  generatedUi: GeneratedUiCardData | undefined,
): Message["planAction"] | undefined {
  if (message.role !== "assistant" || message.planAction || !visibleContent.trim()) return undefined;
  const normalized = visibleContent.trim();
  const isExecutionSummary =
    /计划已(?:定义|生成)[\s\S]*等待执行/i.test(normalized) &&
    /\/execute_plan|执行上述计划|退出计划模式/i.test(normalized);
  if (isExecutionSummary) return undefined;
  const titleMatch = normalized.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  const firstLine = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = titleMatch?.[1]?.trim() ?? firstLine ?? "计划";
  const listStepCount = normalized
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+\S+/.test(line.trim()))
    .length;
  const tableStepCount = normalized
    .split(/\r?\n/)
    .filter((line) => /^\s*\|\s*\d+\s*\|/.test(line))
    .length;
  const generatedUiStepCount = generatedUi?.sections.reduce((count, section) => (
    section.kind === "steps" ? count + section.items.length : count
  ), 0) ?? 0;
  const hasPlanSignal =
    /(?:^|\n)\s*#{1,6}\s*(?:执行计划|计划|plan)(?:\s|$)/i.test(normalized) ||
    /请执行上述步骤|等待执行|等待您的指令后开始执行|use\s*\/execute_plan|执行上述计划/i.test(normalized);
  const stepCount = listStepCount + tableStepCount + generatedUiStepCount;
  if (!hasPlanSignal || stepCount < 2) return undefined;
  return {
    id: `inline_plan_${message.id}`,
    title,
    status: "pending",
  };
}

function describeToolCall(name: unknown): "view" | "modify" | "command" | "tool" {
  if (typeof name !== "string") return "tool";
  const lower = name.toLowerCase();
  if (lower.includes("read") || lower.includes("list") || lower.includes("search") || lower.includes("grep")) return "view";
  if (lower.includes("write") || lower.includes("edit") || lower.includes("patch")) return "modify";
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("command")) return "command";
  return "tool";
}

function countOutputPaths(toolCalls: NonNullable<Message["toolCalls"]>): number {
  const paths = new Set<string>();
  const pattern = /(?:[A-Za-z]:[\\/][^\s"'`<>]+|(?:[\w.-]+[\\/])+[\w.@()[\]-]+\.[A-Za-z0-9_+-]{1,12})/g;
  for (const tc of toolCalls) {
    const text = typeof tc.output === "string" ? tc.output : tc.output == null ? "" : JSON.stringify(tc.output);
    for (const match of text.matchAll(pattern)) {
      paths.add(match[0].replace(/[),.;:]+$/, ""));
    }
  }
  return paths.size;
}

function toolSummary(toolCalls: NonNullable<Message["toolCalls"]>): string {
  const counts = toolCalls.reduce(
    (acc, tc) => {
      acc[describeToolCall(tc.name)] += 1;
      return acc;
    },
    { view: 0, modify: 0, command: 0, tool: 0 },
  );
  const parts: string[] = [];
  if (counts.view > 0) parts.push(`查看 ${counts.view} 个文件`);
  if (counts.modify > 0) parts.push(`修改 ${counts.modify} 个文件`);
  if (counts.command > 0) parts.push(`执行 ${counts.command} 条命令`);
  const outputCount = countOutputPaths(toolCalls);
  if (outputCount > 0) parts.push(`生成 ${outputCount} 个文件`);
  if (counts.tool > 0) parts.push(`使用 ${counts.tool} 个工具`);
  return parts.join("，") || `使用 ${toolCalls.length} 个工具`;
}

function splitInlineThinking(content: string): { thinking: string; content: string; count: number } {
  const thinkingParts: string[] = [];
  let visible = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, thinking: string) => {
    if (thinking.trim()) thinkingParts.push(thinking.trim());
    return "";
  });

  visible = visible.replace(/<think>([\s\S]*)$/i, (_match, thinking: string) => {
    if (thinking.trim()) thinkingParts.push(thinking.trim());
    return "";
  });

  return {
    thinking: thinkingParts.join("\n\n"),
    count: thinkingParts.length,
    content: visible.trim(),
  };
}

type UserInternalCommand = {
  badge: string | null;
  content: string;
  kind: "plan" | "execute-plan" | null;
};

function splitUserInternalCommand(content: string): UserInternalCommand {
  const planMatch = content.match(/^\/plan(?:\r?\n|\s+)?([\s\S]*)$/);
  if (planMatch) {
    return {
      badge: "计划模式",
      content: (planMatch[1] ?? "").trim(),
      kind: "plan",
    };
  }
  const executeMatch = content.match(/^\/execute_plan(?:\s+)?([\s\S]*)$/i);
  if (executeMatch) {
    const target = (executeMatch[1] ?? "").trim();
    return {
      badge: "执行计划",
      content: target ? `执行计划：${target}` : "执行计划",
      kind: "execute-plan",
    };
  }
  const visibleExecuteMatch = content.trim().match(/^执行计划(?:[：:]\s*([\s\S]+))?$/);
  if (visibleExecuteMatch) {
    const target = (visibleExecuteMatch[1] ?? "").trim();
    return {
      badge: "执行计划",
      content: target ? `执行计划：${target}` : "执行计划",
      kind: "execute-plan",
    };
  }
  return {
    badge: null,
    content,
    kind: null,
  };
}

function PlanExecutionUserState({ content }: { content: string }): React.JSX.Element {
  const target = content.replace(/^执行计划：?/, "").trim();
  return (
    <div
      className="flex min-w-0 items-start gap-3"
      data-testid="plan-execution-user-state"
    >
      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h11m0 0-4-4m4 4-4 4M19 5v14" />
        </svg>
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[12px] font-medium leading-5 text-[var(--mm-text-primary)]">
          执行计划
        </div>
        <div className="mt-0.5 truncate font-mono text-[12px] leading-5 text-[var(--mm-text-secondary)]">
          {target ? `执行计划：${target}` : "执行计划"}
        </div>
      </div>
    </div>
  );
}

function ToolActivity({
  toolCalls,
}: {
  toolCalls: NonNullable<Message["toolCalls"]>;
}): React.JSX.Element {
  const visibleToolCalls = toolCalls.filter((toolCall) => toolCall.name !== "render_ui" || toolCall.status === "error");
  const [isExpanded, setIsExpanded] = useState(false);
  const running = toolCalls.some((tc) => tc.status === "running");
  const summary = useMemo(() => toolSummary(visibleToolCalls), [visibleToolCalls]);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="mt-2 flex w-full items-center justify-between rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-1.5 text-left text-xs text-[var(--mm-text-tertiary)] transition-colors hover:border-[#deded9] hover:text-[var(--mm-text-secondary)]"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "pi-motion-running-dot bg-[#f59e0b]" : "bg-[var(--color-success)]"}`} aria-hidden />
          <span className="truncate">{running ? "处理中" : summary}</span>
        </span>
        <svg
          className={`ml-2 h-3 w-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="pi-motion-thinking-content mt-2 space-y-1" data-motion="tool-activity-content">
          {visibleToolCalls.map((toolCall) => (
            <CommandCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubbleImpl({
  message,
  isStreaming = false,
  isSearchTarget = false,
  onPlanAction,
  onGeneratedUiSend,
  generatedUiDisabled,
}: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';
  const timeText = formatTime(message.timestamp);
  const timeIso = formatIso(message.timestamp);
  const articleLabel = `${isUser ? '你' : 'Pi'} · ${timeText}`;
  const userCommand: UserInternalCommand = isUser
    ? splitUserInternalCommand(message.content)
    : { badge: null, content: message.content, kind: null };
  const inlineThinking = useMemo(
    () => !isUser ? splitInlineThinking(message.content) : { thinking: "", content: userCommand.content, count: 0 },
    [isUser, message.content, userCommand.content],
  );
  const thinkingParts = [message.thinking?.trim(), inlineThinking.thinking]
    .filter((part): part is string => Boolean(part))
  const thinkingContent = thinkingParts.join("\n\n");
  const showThinking = useSettingsStore((state) =>
    state.settings.showThinking !== false && state.settings.thinkingLevel !== "none"
  );
  const thinkingCount = (message.thinkingCount ?? (message.thinking?.trim() ? 1 : 0)) + inlineThinking.count;
  const visibleContent = inlineThinking.content;
  const assistantPlainTextContent = useMemo(
    () => (!isUser ? contentWithGeneratedUiText(visibleContent, message.generatedUi) : ""),
    [isUser, message.generatedUi, visibleContent],
  );
  const copyContent = assistantPlainTextContent;
  const planContent = assistantPlainTextContent;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const planAction = useMemo(
    () =>
      !isUser
        ? (message.planAction ??
          inferInlinePlanAction(
            { id: message.id, role: message.role, planAction: message.planAction },
            planContent,
            message.generatedUi,
          ))
        : undefined,
    [isUser, message.generatedUi, message.id, message.planAction, message.role, planContent],
  );
  const planStatus = planAction?.status ?? "pending";
  const showPlanPanel = Boolean(planAction);
  const shouldRenderAssistantContent = Boolean(visibleContent && !showPlanPanel);
  const laneAlignmentClassName = isUser ? 'justify-end' : 'justify-center';
  const bubbleWidthClassName = isUser ? 'max-w-[74%]' : 'w-full max-w-[42rem]';
  const isExecutePlanCommand = userCommand.kind === "execute-plan";
  const messageSurfaceClassName = [
    isUser
      ? isExecutePlanCommand
        ? "rounded-lg border border-[var(--mm-border-strong)] bg-[var(--mm-bg-control)] px-3 py-3 text-[var(--mm-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        : "rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-4 py-2 text-[var(--mm-text-primary)]"
      : "rounded-lg px-1 py-1 text-[var(--mm-text-primary)]",
    isSearchTarget ? "ring-2 ring-[#f59e0b] ring-offset-2 ring-offset-[var(--mm-bg-main)]" : "",
  ].filter(Boolean).join(" ");
  // Narrow subscription: only re-render when the steps for THIS message's plan change.
  // The store tracks steps for the single active plan; return undefined when this
  // message's plan isn't the active one so other plans' step updates don't re-render us.
  const planSteps = usePlanStore((state) => {
    if (!planAction?.id) return undefined;
    const active = state.activeExecution;
    return active && active.activePlanId === planAction.id ? state.steps : undefined;
  });
  // 仅当此 plan 是当前 active plan 时, 透传 store 的 lastError (用于显示写失败 + 重试).
  const planLastError = usePlanStore((state) => {
    if (!planAction?.id) return null;
    const active = state.activeExecution;
    return active && active.activePlanId === planAction.id ? state.lastError : null;
  });
  const handlePlanRetry = useCallback(() => {
    usePlanStore.getState().clearError();
  }, []);
  const effectiveMessage = planAction && !message.planAction
    ? { ...message, planAction }
    : message;

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!copyContent) return;
    try {
      await navigator.clipboard.writeText(copyContent);
    } catch (err) {
      setCopied(false);
      setCopyError(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setCopyError(null);
    setCopied(true);
    // 清理之前的定时器
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [copyContent]);

  return (
    <article
      data-message-id={message.id}
      data-search-target={isSearchTarget ? "true" : "false"}
      data-motion="message-enter"
      className={`pi-motion-message-enter flex ${laneAlignmentClassName}`}
      role="article"
      aria-label={articleLabel}
      aria-busy={isStreaming}
    >
      <div className={bubbleWidthClassName}>
        <div className={`mb-1 flex items-center gap-2 px-1 text-[11px] text-[#9a9a95] ${isUser ? 'justify-end' : 'justify-start'}`}>
          <time dateTime={timeIso}>{timeText}</time>
        </div>
          <div
            className={messageSurfaceClassName}
            data-testid="message-surface"
            data-message-role={message.role}
          >
            {isUser ? (
              <div className="space-y-2">
                {userCommand.badge && !isExecutePlanCommand && (
                  <div className="flex justify-end">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#d8e7d9] bg-[#eef8ef] px-2.5 py-1 text-[11px] font-medium text-[var(--color-success)]"
                      aria-label={`${userCommand.badge}消息`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
                      </svg>
                      {userCommand.badge}
                    </span>
                  </div>
                )}
                {isExecutePlanCommand ? (
                  <PlanExecutionUserState content={visibleContent} />
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed font-normal">
                    {visibleContent || (userCommand.badge ? userCommand.badge : "")}
                  </div>
                )}
              </div>
            ) : (
              <>
                {showThinking && thinkingContent && (
                  <ThinkingBlock
                    content={thinkingContent}
                    count={thinkingCount}
                    isStreaming={isStreaming && !visibleContent}
                  />
                )}

                {shouldRenderAssistantContent && (
                  <div className="text-sm leading-relaxed font-normal">
                    {isStreaming ? (
                      <div className="whitespace-pre-wrap break-words">{visibleContent}</div>
                    ) : (
                      <MarkdownRenderer content={visibleContent} />
                    )}
                  </div>
                )}

                {message.customCard && (
                  <div className={message.content ? "mt-3" : ""}>
                    <CustomMessageCard card={message.customCard} />
                  </div>
                )}

                {message.generatedUi && !showPlanPanel && (
                  <div className={message.content ? "mt-3" : ""}>
                    <GeneratedUiCard card={message.generatedUi} disabled={generatedUiDisabled} onSend={onGeneratedUiSend} />
                  </div>
                )}

                {showPlanPanel && (
                  <PlanCard
                    title={planAction?.title ?? "计划"}
                    content={planContent}
                    filename={planAction?.filename}
                    status={planStatus}
                    steps={planSteps}
                    lastError={planLastError}
                    onExecute={(selectedOption) => void (
                      selectedOption
                        ? onPlanAction?.(effectiveMessage, "execute", selectedOption)
                        : onPlanAction?.(effectiveMessage, "execute")
                    )}
                    onRefine={(text) => void onPlanAction?.(effectiveMessage, "refine", text)}
                    onCancel={() => void onPlanAction?.(effectiveMessage, "cancel")}
                    onPause={() => void onPlanAction?.(effectiveMessage, "pause")}
                    onResume={() => void onPlanAction?.(effectiveMessage, "resume")}
                    onRetry={handlePlanRetry}
                  />
                )}

                {isStreaming && !visibleContent && !thinkingContent && (
                  <div className="pi-motion-running-card flex items-center gap-2 py-1" aria-hidden="true">
                    <span className="inline-block h-4 w-0.5 animate-pulse bg-[#1a1a1a]" />
                  </div>
                )}
              </>
            )}

            {message.toolCalls?.some((toolCall) => toolCall.name === "render_ui" && toolCall.status === "running") ? (
              <div className="mt-2 text-[11px] text-[var(--mm-text-tertiary)]">正在生成界面...</div>
            ) : null}
            {message.toolCalls && message.toolCalls.some((toolCall) => toolCall.name !== "render_ui" || toolCall.status === "error") ? (
              <ToolActivity toolCalls={message.toolCalls} />
            ) : null}

            {!isUser && (
              <div className="mt-2 flex items-center justify-start gap-2" data-testid="message-footer">
                {copyContent && (
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="text-[#aaa] hover:text-[var(--mm-text-secondary)] transition-colors"
                    aria-label={copied ? "已复制" : "复制内容"}
                    title={copied ? "已复制" : "复制"}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {copied ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      )}
                    </svg>
                  </button>
                )}
                {copyError && (
                  <span className="text-[11px] text-[var(--color-error)]" role="alert">
                    {copyError}
                  </span>
                )}
                <time dateTime={timeIso} className="sr-only">
                  {timeText}
                </time>
              </div>
            )}
          </div>
      </div>
    </article>
  );
}

function areEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  // Only re-render when this message's identity/data or streaming/search state changes.
  // Avoids re-rendering when unrelated parent state (other sessions, sidebar, etc.) changes.
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.thinking === next.message.thinking &&
    prev.message.thinkingCount === next.message.thinkingCount &&
    prev.message.toolCalls === next.message.toolCalls &&
    prev.message.generatedUi === next.message.generatedUi &&
    prev.message.customCard === next.message.customCard &&
    prev.message.planAction === next.message.planAction &&
    prev.isStreaming === next.isStreaming &&
    prev.isSearchTarget === next.isSearchTarget &&
    prev.onGeneratedUiSend === next.onGeneratedUiSend &&
    prev.generatedUiDisabled === next.generatedUiDisabled &&
    prev.onPlanAction === next.onPlanAction
  );
}

export const MessageBubble = React.memo(MessageBubbleImpl, areEqual);
