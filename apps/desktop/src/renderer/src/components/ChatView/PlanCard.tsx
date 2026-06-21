// PlanCard — 消息气泡内使用的统一计划卡片 (v2.0)
// 支持: 独立卡片样式 / 折叠正文 / 内联步骤列表 / 选项按钮 / 补充文本区 / 文件链接 / 进度指示

import React, { useState, useCallback } from "react";
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
  onExecute?: () => void;
  onRefine?: (text: string) => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

function statusLabel(status: PlanCardStatus): string {
  switch (status) {
    case "executing":
      return "执行中";
    case "pausing":
      return "正在暂停";
    case "paused":
      return "已暂停";
    case "executed":
      return "已完成";
    case "cancelled":
      return "已取消";
    case "failed":
      return "执行失败";
    case "refining":
      return "等待补充";
    default:
      return "等待确认";
  }
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
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#1a1a1a]" aria-hidden />
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

  // 模式2: - [ ] / * [ ] 开头的列表项（当成选项）
  const listOptions: PlanChoiceOption[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*])\s+(?:\[[ xX]\]\s*)?(.+)$/);
    if (match) {
      const text = match[1].trim();
      // 排除普通计划步骤（含"修改/实现/新增/删除/运行/验证/测试/构建/修复/重构/更新/提交/检查"）
      if (!/修改|实现|新增|删除|运行|验证|测试|构建|修复|重构|更新|提交|检查/.test(text)) {
        listOptions.push({ label: String.fromCharCode(65 + listOptions.length) + ")", value: text });
      }
    }
  }
  if (listOptions.length >= 2) return listOptions;

  // 模式3: 多个"是否"问句
  const questions = lines.filter((l) => /是否/.test(l) && /\?/.test(l));
  if (questions.length >= 2) {
    return questions.map((q, i) => ({
      label: String.fromCharCode(65 + i) + ")",
      value: q.trim(),
    }));
  }

  return null;
}

/** 生成计划摘要（前3行非空内容） */
function planSummary(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---"));
  return lines.slice(0, 3).join("\n");
}

export function PlanCard({
  title,
  content,
  filename,
  status,
  steps,
  onExecute,
  onRefine,
  onCancel,
  onPause,
  onResume,
}: PlanCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const options = extractChoiceOptions(content);
  const hasOptions = options && options.length >= 2;

  const handleExecute = useCallback(() => {
    if (selectedOption && onRefine) {
      onRefine(selectedOption);
    } else {
      onExecute?.();
    }
  }, [selectedOption, onRefine, onExecute]);

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
  const progressText = totalCount > 0 ? ` (${completedCount}/${totalCount})` : "";

  const openPlanFile = (): void => {
    if (!filename) return;
    window.dispatchEvent(new CustomEvent("workspace:open-file", { detail: { path: filename } }));
  };

  return (
    <div
      className={`mt-3 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${
        isExecuting ? "animate-pulse-subtle" : ""
      }`}
      data-testid="plan-card"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#f0f0ee]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid="plan-status"
            className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium ${statusBadgeClass(status)}`}
          >
            {statusLabel(status)}{progressText}
          </span>
          <span className="truncate text-xs text-[var(--mm-text-tertiary)]" title={title}>
            {title}
          </span>
        </div>
        {filename && (
          <button
            type="button"
            onClick={openPlanFile}
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-0.5 text-[10px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] transition-colors"
            title={filename}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="truncate max-w-[120px]">{filename.replace(/^.*[\\/]/, "")}</span>
          </button>
        )}
      </div>

      {/* 正文区 */}
      <div className="px-4 py-3">
        {expanded ? (
          <div className="text-sm leading-relaxed">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="text-sm leading-relaxed text-[var(--mm-text-secondary)]">
            <div className="whitespace-pre-wrap">{planSummary(content)}</div>
            {content.split(/\r?\n/).filter((l) => l.trim()).length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-1 text-xs text-[var(--mm-text-tertiary)] hover:text-[var(--mm-text-secondary)] transition-colors"
              >
                展开计划详情 ↓
              </button>
            )}
          </div>
        )}
        {expanded && content.split(/\r?\n/).filter((l) => l.trim()).length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-1 text-xs text-[var(--mm-text-tertiary)] hover:text-[var(--mm-text-secondary)] transition-colors"
          >
            收起 ↑
          </button>
        )}
      </div>

      {/* 步骤列表 */}
      {steps && steps.length > 0 && (
        <div className="px-4 pb-2">
          <div className="rounded-lg border border-[#f0f0ee] bg-[var(--mm-bg-panel)] p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#aaa]">计划步骤</span>
              {totalCount > 0 && (
                <span className="text-[10px] text-[#aaa]">
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
                aria-label={`选项 ${opt.label} ${opt.value}`}
                onClick={() => setSelectedOption(opt.value)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  selectedOption === opt.value
                    ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                    : "border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
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
      <div className="px-4 py-3 border-t border-[#f0f0ee] bg-[var(--mm-bg-panel)]">
        {isPending && (
          <div className="flex flex-col gap-2">
            {/* 补充文本区 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={hasOptions ? "选好后可补充说明（可选）" : "有补充就写在这里"}
                className="flex-1 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-1.5 text-xs focus:border-[#d6d6d1] focus:outline-none focus:ring-0"
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
                className="h-8 rounded-full bg-[#242423] px-3 text-xs font-medium text-white hover:bg-[#111] disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={Boolean(hasOptions && !selectedOption)}
              >
                {hasOptions ? (selectedOption ? "确认并执行" : "请选择选项") : "执行计划"}
              </button>
              <button
                type="button"
                onClick={handleRefine}
                disabled={!feedback.trim()}
                className="h-8 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                发送补充
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-full px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
              >
                取消
              </button>
              {hasOptions && !selectedOption && status !== "refining" && (
                <span className="text-xs text-[var(--mm-text-tertiary)]">先选一个选项再执行</span>
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
              className="h-8 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-60"
            >
              {status === "pausing" ? "正在暂停..." : "暂停执行"}
            </button>
            {totalCount > 0 && (
              <span className="text-xs text-[var(--mm-text-tertiary)]">
                进度 {completedCount}/{totalCount}
              </span>
            )}
          </div>
        )}

        {isPaused && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResume}
              className="h-8 rounded-full bg-[#242423] px-3 text-xs font-medium text-white hover:bg-[#111]"
            >
              继续执行
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-8 rounded-full px-3 text-xs font-medium text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
            >
              取消
            </button>
          </div>
        )}

        {isTerminal && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--mm-text-tertiary)]">
              {status === "executed" ? "计划已执行完毕" : status === "cancelled" ? "计划已取消" : "计划执行失败"}
            </span>
            {totalCount > 0 && (
              <span className="text-xs text-[var(--mm-text-tertiary)]">
                完成 {completedCount}/{totalCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
