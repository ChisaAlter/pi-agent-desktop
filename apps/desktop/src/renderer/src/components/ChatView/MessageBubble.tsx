// 消息气泡 - v2.0 MiniMax Code 风格
// AI 消息: 白底圆角卡片 + 底部复制/时间戳
// 用户消息: 浅色 pill + normal 字重

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Message } from '../../stores/session-store';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CommandCard } from './CommandCard';
import { CustomMessageCard } from './CustomMessageCard';
import { ThinkingBlock } from './ThinkingBlock';
import { PlanCard } from './PlanCard';
import { usePlanStore } from '../../stores/plan-store';
import { useSettingsStore } from '../../stores/settings-store';
import { formatTime, formatIso } from '../../utils/format';

type ChatMessage = Message & {
  thinkingCount?: number;
};

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onPlanAction?: (message: ChatMessage, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string) => Promise<void>;
}

function inferInlinePlanAction(message: ChatMessage, visibleContent: string): Message["planAction"] | undefined {
  if (message.role !== "assistant" || message.planAction || !visibleContent.trim()) return undefined;
  const normalized = visibleContent.trim();
  const titleMatch = normalized.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  const title = titleMatch?.[1]?.trim() ?? "计划";
  const listStepCount = normalized
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+\S+/.test(line.trim()))
    .length;
  const tableStepCount = normalized
    .split(/\r?\n/)
    .filter((line) => /^\s*\|\s*\d+\s*\|/.test(line))
    .length;
  const hasPlanSignal =
    /(?:^|\n)\s*#{1,6}\s*(?:执行计划|计划|plan)(?:\s|$)/i.test(normalized) ||
    /请执行上述步骤|等待执行|等待您的指令后开始执行|use\s*\/execute_plan|执行上述计划/i.test(normalized);
  const stepCount = listStepCount + tableStepCount;
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

function splitUserInternalCommand(content: string): { badge: string | null; content: string } {
  const planMatch = content.match(/^\/plan(?:\r?\n|\s+)?([\s\S]*)$/);
  if (planMatch) {
    return {
      badge: "计划模式",
      content: (planMatch[1] ?? "").trim(),
    };
  }
  const executeMatch = content.match(/^\/execute_plan(?:\s+)?([\s\S]*)$/i);
  if (executeMatch) {
    const target = (executeMatch[1] ?? "").trim();
    return {
      badge: "执行计划",
      content: target ? `执行计划：${target}` : "执行计划",
    };
  }
  return {
    badge: null,
    content,
  };
}

function ToolActivity({
  toolCalls,
}: {
  toolCalls: NonNullable<Message["toolCalls"]>;
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const running = toolCalls.some((tc) => tc.status === "running");

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="mt-2 flex w-full items-center justify-between rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-1.5 text-left text-xs text-[var(--mm-text-tertiary)] transition-colors hover:border-[#deded9] hover:text-[var(--mm-text-secondary)]"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "bg-[#f59e0b]" : "bg-[var(--color-success)]"}`} aria-hidden />
          <span className="truncate">{running ? "处理中" : toolSummary(toolCalls)}</span>
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
        <div className="mt-2 space-y-1">
          {toolCalls.map((toolCall) => (
            <CommandCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = React.memo(function MessageBubble({ message, isStreaming = false, onPlanAction }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';
  const timeText = formatTime(message.timestamp);
  const timeIso = formatIso(message.timestamp);
  const articleLabel = `${isUser ? '你' : 'Pi'} · ${timeText}`;
  const userCommand = isUser ? splitUserInternalCommand(message.content) : { badge: null, content: message.content };
  const inlineThinking = !isUser ? splitInlineThinking(message.content) : { thinking: "", content: userCommand.content, count: 0 };
  const thinkingParts = [message.thinking?.trim(), inlineThinking.thinking]
    .filter((part): part is string => Boolean(part))
  const thinkingContent = thinkingParts.join("\n\n");
  const showThinking = useSettingsStore((state) =>
    state.settings.showThinking !== false && state.settings.thinkingLevel !== "none"
  );
  const thinkingCount = (message.thinkingCount ?? (message.thinking?.trim() ? 1 : 0)) + inlineThinking.count;
  const visibleContent = inlineThinking.content;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const planAction = !isUser ? (message.planAction ?? inferInlinePlanAction(message, visibleContent)) : undefined;
  const planStatus = planAction?.status ?? "pending";
  const showPlanPanel = Boolean(planAction);
  const planSteps = usePlanStore((state) => state.steps);
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
    if (!visibleContent) return;
    try {
      await navigator.clipboard.writeText(visibleContent);
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
  }, [visibleContent]);

  return (
    <article
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      role="article"
      aria-label={articleLabel}
      aria-busy={isStreaming}
    >
      <div className={isUser ? 'max-w-[74%]' : 'w-full max-w-full'}>
        <div className={`mb-1 flex items-center gap-2 px-1 text-[11px] text-[#9a9a95] ${isUser ? 'justify-end' : 'justify-start'}`}>
          <time dateTime={timeIso}>{timeText}</time>
        </div>
          <div className={`${
            isUser
              ? 'rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-4 py-3 text-[var(--mm-text-primary)]'
              : 'rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-3 text-[var(--mm-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
          }`}>
            {isUser ? (
              <div className="space-y-2">
                {userCommand.badge && (
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
                <div className="whitespace-pre-wrap text-sm leading-relaxed font-normal">
                  {visibleContent || (userCommand.badge ? userCommand.badge : "")}
                </div>
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

                {visibleContent && (
                  <div className="text-sm leading-relaxed font-normal">
                    <MarkdownRenderer content={visibleContent} />
                  </div>
                )}

                {message.customCard && (
                  <div className={message.content ? "mt-3" : ""}>
                    <CustomMessageCard card={message.customCard} />
                  </div>
                )}

                {showPlanPanel && (
                  <PlanCard
                    title={planAction?.title ?? "计划"}
                    content={visibleContent}
                    filename={planAction?.filename}
                    status={planStatus}
                    steps={planSteps}
                    onExecute={() => void onPlanAction?.(effectiveMessage, "execute")}
                    onRefine={() => void onPlanAction?.(effectiveMessage, "refine")}
                    onCancel={() => void onPlanAction?.(effectiveMessage, "cancel")}
                    onPause={() => void onPlanAction?.(effectiveMessage, "pause")}
                    onResume={() => void onPlanAction?.(effectiveMessage, "resume")}
                  />
                )}

                {isStreaming && !visibleContent && !thinkingContent && (
                  <div className="flex items-center gap-2 py-1" aria-hidden="true">
                    <span className="inline-block w-0.5 h-4 bg-[#1a1a1a] animate-pulse" />
                  </div>
                )}
              </>
            )}

            {message.toolCalls && message.toolCalls.length > 0 && (
              <ToolActivity toolCalls={message.toolCalls} />
            )}

            {/* 底部栏: 复制 + 时间戳 */}
            <div className={`flex items-center gap-2 mt-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && visibleContent && (
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
          </div>
      </div>
    </article>
  );
});
