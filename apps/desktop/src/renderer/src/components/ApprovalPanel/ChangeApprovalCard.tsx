// ChangeApprovalCard - 单个文件的变更组卡片 (按 filePath 聚合)
//
// 同文件多次 write/edit 合并成一张卡:
//  - 头部: 路径 + 操作次数 + 展开/折叠
//  - 展开: 每次变更一行 (时间 + 工具类型 + 状态 + 保留/撤销 + diff)
// 语义: 保留 = 不改文件; 撤销 = 主进程用变更前快照真实回滚文件。

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffViewer } from "../DiffView";
import { useTranslateIpcError } from "../../i18n";
import type { PendingChange } from "../../stores/approval-store";

interface ChangeApprovalCardProps {
  filePath: string;
  /** 同文件的所有变更, 按时间升序 */
  changes: PendingChange[];
  onKeep: (id: string) => void;
  onUndo: (id: string) => void;
  /** changeId → 撤销失败原因 (IpcError 或内部错误文案) */
  undoError: Record<string, string | import("@shared").IpcError>;
  defaultExpanded?: boolean;
}

/** 从完整路径提取面包屑样式的文件路径 */
function BreadcrumbPath({ filePath }: { filePath: string }): React.JSX.Element {
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  const fileName = parts.pop() || filePath;
  const dirParts = parts.slice(-2); // 最多显示两级目录

  return (
    <span className="flex min-w-0 items-center gap-1 text-xs">
      {dirParts.map((part, i) => (
        <React.Fragment key={i}>
          <span className="truncate text-[var(--mm-text-tertiary)]">{part}</span>
          <span className="flex-shrink-0 text-[#cccccc]">/</span>
        </React.Fragment>
      ))}
      <span
        className="truncate font-medium text-[var(--mm-text-primary)]"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
      >
        {fileName}
      </span>
    </span>
  );
}

/** 工具类型标签 */
function ToolBadge({ toolName, t }: { toolName: "write" | "edit"; t: (key: string) => string }): React.JSX.Element {
  if (toolName === "write") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#dbeafe] text-[var(--color-info)]">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {t("approvalPanel.changeTypes.new")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-medium text-[#92400e]">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      {t("approvalPanel.changeTypes.edit")}
    </span>
  );
}

/** 状态标签 */
function StatusBadge({ status, t }: { status: PendingChange["status"]; t: (key: string) => string }): React.JSX.Element | null {
  if (status === "pending") return null;

  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-success)]">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        {t("approvalPanel.statusBadge.approved")}
      </span>
    );
  }

  if (status === "undone") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-[#f0f0ef] px-1.5 py-0.5 text-[10px] font-medium text-[var(--mm-text-tertiary)]">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1 0 3-6.7M3 5v5h5" />
        </svg>
        {t("approvalPanel.statusBadge.undone")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded bg-[#fef2f2] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-error)]">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      {t("approvalPanel.statusBadge.rejected")}
    </span>
  );
}

function formatTime(timestamp: Date): string {
  return timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChangeApprovalCard({
  filePath,
  changes,
  onKeep,
  onUndo,
  undoError,
  defaultExpanded = true,
}: ChangeApprovalCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const translateIpcError = useTranslateIpcError();
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 头部摘要: 各工具类型的次数 (走 i18n)
  const summary = useMemo(() => {
    const writes = changes.filter((c) => c.toolName === "write").length;
    const edits = changes.filter((c) => c.toolName === "edit").length;
    const parts: string[] = [];
    if (writes > 0) parts.push(t("approvalPanel.changeCount.write", { count: writes }));
    if (edits > 0) parts.push(t("approvalPanel.changeCount.edit", { count: edits }));
    return parts.join(" · ");
  }, [changes, t]);

  const errorTextOf = (changeId: string): string => {
    const error = undoError[changeId];
    if (!error) return "";
    if (typeof error === "string") return error;
    return translateIpcError(error);
  };

  const pendingCount = changes.filter((c) => c.status === "pending").length;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
      {/* 头部: 路径 + 次数 + 展开 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${filePath} · ${summary}`}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-[var(--mm-text-tertiary)] transition-transform duration-150 ${expanded ? "rotate-90" : "rotate-0"}`}
          fill="none"
          viewBox="0 0 16 16"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m6 3.5 4 4.5-4 4.5" />
        </svg>
        <span className="min-w-0 flex-1">
          <BreadcrumbPath filePath={filePath} />
        </span>
        <span className="shrink-0 text-[11px] text-[var(--mm-text-tertiary)]">{summary}</span>
        {pendingCount > 0 && (
          <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#f59e0b] px-1.5 text-[10px] font-bold text-white">
            {pendingCount}
          </span>
        )}
      </button>

      {/* 展开: 每次变更一行 */}
      {expanded && (
        <div className="border-t border-[var(--mm-border)]">
          {changes.map((change, index) => (
            <div key={change.id} className="border-b border-[var(--mm-border)] last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--mm-text-secondary)]">
                  <span className="shrink-0 font-medium text-[var(--mm-text-tertiary)]">#{index + 1}</span>
                  <ToolBadge toolName={change.toolName} t={t} />
                  <span className="shrink-0">{formatTime(change.timestamp)}</span>
                  <StatusBadge status={change.status} t={t} />
                </div>
                {change.status === "pending" ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {errorTextOf(change.id) && (
                      <span className="text-[11px] text-[var(--color-error)]" role="alert">
                        {errorTextOf(change.id)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onUndo(change.id)}
                      aria-label={`${t("approvalPanel.reject")} ${filePath}`}
                      disabled={false}
                      className="inline-flex items-center gap-1 rounded bg-[var(--mm-bg-sidebar)] px-2.5 py-1.5 text-xs font-medium text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1 0 3-6.7M3 5v5h5" />
                      </svg>
                      {t("approvalPanel.reject")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onKeep(change.id)}
                      aria-label={`${t("approvalPanel.approve")} ${filePath}`}
                      className="inline-flex items-center gap-1 rounded bg-[var(--color-success)] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#059669] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {t("approvalPanel.approve")}
                    </button>
                  </div>
                ) : null}
              </div>
              {change.diff ? (
                <div className="max-h-[220px] overflow-auto px-3 pb-2">
                  <DiffViewer diff={change.diff} maxHeight="200px" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
