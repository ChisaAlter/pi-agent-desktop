// PlanCard — 消息气泡内使用的统一计划卡片 (v2.0)
// 支持: 独立卡片样式 / 折叠正文 / 内联步骤列表 / 选项按钮 / 补充文本区 / 文件链接 / 进度指示

import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface PlanStepItem {
  id: string;
  text: string;
  status: "pending" | "running" | "completed" | "failed" | "waiting" | "blocked";
}

export interface PlanChoiceOption {
  label: string;
  value: string;
}

export type PlanCardStatus =
  | "pending"
  | "refining"
  | "executing"
  | "pausing"
  | "paused"
  | "executed"
  | "cancelled"
  | "failed";

export interface PlanCardProps {
  title: string;
  content: string;
  filename?: string;
  status: PlanCardStatus;
  steps?: PlanStepItem[];
  /** Plan-store 的 lastError; 仅当与当前 plan 关联时透传. */
  lastError?: string | null;
  onExecute?: (selectedOption?: string) => void;
  onRefine?: (text: string) => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  /** 重试按钮回调; 通常调用 plan-store.clearError() 让用户重发. */
  onRetry?: () => void;
}

function statusBadgeClass(status: PlanCardStatus): string {
  switch (status) {
    case "executing":
    case "pausing":
      return "bg-[#fef3c7] text-[#92400e] border-[#fde68a]";
    case "executed":
      return "bg-[#dcfce7] text-[var(--color-success)] border-[#bbf7d0]";
    case "failed":
    case "cancelled":
      return "bg-[#fee2e2] text-[var(--color-error)] border-[#fecaca]";
    case "paused":
    case "refining":
      return "bg-[#f3f4f6] text-[var(--mm-text-secondary)] border-[#e5e7eb]";
    default:
      return "bg-[#eef8ef] text-[var(--color-success)] border-[#d8e7d9]";
  }
}

function stepIcon(status: PlanStepItem["status"]): React.ReactNode {
  switch (status) {
    case "completed":
      return (
        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      );
    case "running":
      return (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--mm-bg-active)] animate-pulse" aria-hidden />
      );
    case "failed":
      return (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-error)] text-[10px] text-white leading-none" aria-hidden>
          !
        </span>
      );
    case "waiting":
      return (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]" aria-hidden />
      );
    default:
      return (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]" aria-hidden />
      );
  }
}

/** 从计划内容中提取选项（A/B/C 或列表项） */
function extractChoiceOptions(content: string): PlanChoiceOption[] | null {
  const lines = content.split(/\r?\n/);
  const options: PlanChoiceOption[] = [];

  // 模式1: A) / A. 开头的选项
  for (const line of lines) {
    const t = line.trim();
    if (t.length < 3) continue;
    const c0 = t.charCodeAt(0);
    const c1 = t.charAt(1);
    if (c0 >= 65 && c0 <= 90 && (c1 === ")" || c1 === ".")) {
      const text = t.slice(2).trim();
      if (text) options.push({ label: String.fromCharCode(c0) + c1, value: text });
    }
  }
  if (options.length >= 2) return options;

  // 模式2: 多个"是否"问句
  const questions = lines.filter((l) => /是否/.test(l) && /\?/.test(l));
  if (questions.length >= 2) {
    return questions.map((q, i) => ({
      label: String.fromCharCode(65 + i) + ")",
      value: q.trim(),
    }));
  }

  return null;
}

function cleanHeading(line: string): string {
  return line.replace(/^\s*#{1,6}\s+/, "").trim();
}

function isDecisionHeading(line: string): boolean {
  return /(?:用户需选择方向|请选择.*方向|审查方向|执行方案|方案选择)/.test(cleanHeading(line));
}

function isChoiceLine(line: string): boolean {
  return /^[A-Z][).]\s+\S+/.test(line.trim());
}

/** 生成计划摘要：优先展示用户真正要确认的计划/选择区，而不是前置背景说明。 */
function planSummaryLines(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---"));

  const rawLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const decisionHeadingIndex = rawLines.findIndex(isDecisionHeading);
  if (decisionHeadingIndex >= 0) {
    const summary = [cleanHeading(rawLines[decisionHeadingIndex])];
    for (const line of rawLines.slice(decisionHeadingIndex + 1)) {
      if (/^\s*#{1,6}\s+/.test(line) && summary.length > 1) break;
      if (!line.startsWith("---")) summary.push(line);
      if (summary.length >= 4) break;
    }
    return summary;
  }

  const choiceLines = rawLines.filter(isChoiceLine);
  if (choiceLines.length >= 2) return choiceLines.slice(0, 3);

  return lines.slice(0, 3);
}

export function PlanCard({
  title,
  content,
  filename,
  status,
  steps,
  lastError,
  onExecute,
  onRefine,
  onCancel,
  onPause,
  onResume,
  onRetry,
}: PlanCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const options = useMemo(() => extractChoiceOptions(content), [content]);
  const hasOptions = options && options.length >= 2;

  // 写失败: lastError 非空且 filename 仍为空 (说明 planCreate 失败, 还未持久化).
  // 此时禁用 Execute, 显示重试按钮.
  const isWriteFailure = Boolean(lastError) && !filename;

  const statusLabel = useMemo(() => {
    switch (status) {
      case "executing":
        return t("planCard.status.executing");
      case "pausing":
        return t("planCard.status.pausing");
      case "paused":
        return t("planCard.status.paused");
      case "executed":
        return t("planCard.status.executed");
      case "cancelled":
        return t("planCard.status.cancelled");
      case "failed":
        return t("planCard.status.failed");
      case "refining":
        return t("planCard.status.refining");
      default:
        return t("planCard.status.pending");
    }
  }, [status, t]);

  const handleExecute = useCallback(() => {
    onExecute?.(selectedOption ?? undefined);
  }, [selectedOption, onExecute]);

  const handleRefine = useCallback(() => {
    if (feedback.trim()) {
      onRefine?.(feedback.trim());
      setFeedback("");
    }
  }, [feedback, onRefine]);

  const isPending = status === "pending" || status === "refining";
  const isExecuting = status === "executing" || status === "pausing";
  const isPaused = status === "paused";
  const isTerminal = status === "executed" || status === "cancelled" || status === "failed";

  const completedCount = steps?.filter((s) => s.status === "completed").length ?? 0;
  const totalCount = steps?.length ?? 0;
  const progressText = totalCount > 0
    ? t("planCard.progressSuffix", { completed: completedCount, total: totalCount })
    : "";

  const openPlanFile = (): void => {
    if (!filename) return;
    window.dispatchEvent(new CustomEvent("workspace:open-file", { detail: { path: filename } }));
  };

  return (
    <div
      className="mt-2 rounded-lg border border-[var(--mm-border-subtle)] bg-[var(--mm-bg-panel)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      data-testid="plan-card"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid="plan-status"
            className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium ${statusBadgeClass(status)}`}
          >
            {statusLabel}{progressText}
          </span>
          <span className="truncate text-xs text-[var(--mm-text-tertiary)]" title={title}>
            {title}
          </span>
        </div>
        {filename && (
          <button
            type="button"
            onClick={openPlanFile}
            data-testid="plan-filename"
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-0.5 text-[10px] font-mono text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
            title={filename}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="truncate max-w-[160px]">{filename.replace(/^.*[\\/]/, "")}</span>
          </button>
        )}
      </div>

      {/* 正文区 */}
      <div className="px-4 py-2">
        {expanded ? (
          <div className="text-sm leading-relaxed">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="text-sm leading-relaxed text-[var(--mm-text-secondary)]">
            <div className="space-y-1">
              {planSummaryLines(content).map((line) => (
                <div key={line} className="whitespace-pre-wrap">{line}</div>
              ))}
            </div>
            {content.split(/\r?\n/).filter((l) => l.trim()).length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-1 text-xs text-[var(--mm-text-tertiary)] transition-colors hover:text-[var(--mm-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
              >
                {t("planCard.expandDetails")}
              </button>
            )}
          </div>
        )}
        {expanded && content.split(/\r?\n/).filter((l) => l.trim()).length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-1 text-xs text-[var(--mm-text-tertiary)] transition-colors hover:text-[var(--mm-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            {t("planCard.collapse")}
          </button>
        )}
      </div>

      {/* 步骤列表 */}
      {steps && steps.length > 0 && (
        <div className="px-4 pb-2" data-testid="plan-steps">
          <div className="border-t border-[var(--mm-border-subtle)] pt-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--mm-text-tertiary)]">{t("planCard.stepsLabel")}</span>
              {totalCount > 0 && (
                <span className="text-[10px] text-[var(--mm-text-tertiary)]">
                  {completedCount}/{totalCount}
                </span>
              )}
            </div>
            <ol className="m-0 list-none space-y-1.5 p-0">
              {steps.map((step) => (
                <li key={step.id} className="flex min-w-0 items-start gap-2 text-xs">
                  {stepIcon(step.status)}
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      step.status === "completed"
                        ? "text-[var(--mm-text-tertiary)] line-through"
                        : step.status === "running"
                          ? "text-[var(--mm-text-primary)] font-medium"
                          : "text-[var(--mm-text-secondary)]"
                    }`}
                    title={step.text}
                  >
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* 选项按钮区 */}
      {isPending && hasOptions && (
        <div className="px-4 pb-2" data-testid="plan-options">
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-testid="plan-option"
                aria-label={t("planCard.optionAria", { label: opt.label, value: opt.value })}
                onClick={() => setSelectedOption(opt.value)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${
                  selectedOption === opt.value
                    ? "border-[var(--mm-bg-active)] bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]"
                    : "border-[var(--mm-border-subtle)] bg-transparent text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                <span className="truncate max-w-[180px]">{opt.value}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 操作区 */}
      <div className="border-t border-[var(--mm-border-subtle)] px-4 pt-3 pb-3" data-testid="plan-actions">
        {isPending && (
          <div className="flex flex-col gap-2">
            {/* 补充文本区 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={hasOptions ? t("planCard.feedbackPlaceholderWithOptions") : t("planCard.feedbackPlaceholder")}
                className="flex-1 rounded-lg border border-[var(--mm-border-subtle)] bg-[var(--mm-bg-control)] px-3 py-1.5 text-xs focus:border-[var(--mm-border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (feedback.trim()) {
                      handleRefine();
                    }
                  }
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExecute}
                data-testid="plan-execute-button"
                className="h-8 rounded-full bg-[var(--mm-bg-active)] px-3 text-xs font-medium text-[var(--mm-text-on-active)] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isWriteFailure || Boolean(hasOptions && !selectedOption)}
              >
                {hasOptions ? (selectedOption ? t("planCard.confirmAndExecute") : t("planCard.selectOptionPrompt")) : t("planCard.executePlan")}
              </button>
              <button
                type="button"
                onClick={handleRefine}
                disabled={!feedback.trim()}
                className="h-8 rounded-full border border-[var(--mm-border-subtle)] bg-transparent px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("planCard.sendSupplement")}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-full px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
              >
                {t("planCard.cancel")}
              </button>
              {hasOptions && !selectedOption && status !== "refining" && (
                <span className="text-xs text-[var(--mm-text-tertiary)]">{t("planCard.selectFirstHint")}</span>
              )}
              {isWriteFailure && (
                <span
                  data-testid="plan-write-error"
                  className="inline-flex items-center gap-2 rounded-full border border-[#fecaca] bg-[#fee2e2] px-2 py-0.5 text-[11px] text-[var(--color-error)]"
                  title={lastError ?? undefined}
                >
                  <span>{t("planCard.writeFailed")}</span>
                  {onRetry && (
                    <button
                      type="button"
                      data-testid="plan-retry-button"
                      onClick={onRetry}
                      className="font-medium underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {t("planCard.retry")}
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
        )}

        {isExecuting && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onPause}
              disabled={status === "pausing"}
              className="h-8 rounded-full border border-[var(--mm-border-subtle)] bg-transparent px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:opacity-60"
            >
              {status === "pausing" ? t("planCard.pausing") : t("planCard.pauseExecution")}
            </button>
            {totalCount > 0 && (
              <span className="text-xs text-[var(--mm-text-tertiary)]">
                {t("planCard.progressLabel", { completed: completedCount, total: totalCount })}
              </span>
            )}
          </div>
        )}

        {isPaused && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResume}
              className="h-8 rounded-full bg-[var(--mm-bg-active)] px-3 text-xs font-medium text-[var(--mm-text-on-active)] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
            >
              {t("planCard.resumeExecution")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-8 rounded-full px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
            >
              {t("planCard.cancel")}
            </button>
          </div>
        )}

        {isTerminal && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--mm-text-tertiary)]">
              {status === "executed"
                ? t("planCard.terminalExecuted")
                : status === "cancelled"
                  ? t("planCard.terminalCancelled")
                  : t("planCard.terminalFailed")}
            </span>
            {totalCount > 0 && (
              <span className="text-xs text-[var(--mm-text-tertiary)]">
                {t("planCard.completedLabel", { completed: completedCount, total: totalCount })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
