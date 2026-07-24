// ApprovalPanel - 文件变更审批面板
//
// 显示待审批的文件变更列表，支持全部接受/拒绝/自动审批

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useApprovalStore } from '../../stores/approval-store';
import { ChangeApprovalCard } from './ChangeApprovalCard';

interface ApprovalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function ApprovalPanel({ isOpen, onToggle }: ApprovalPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const { changes, autoApprove, approveChange, rejectChange, approveAll, rejectAll, toggleAutoApprove, clearChanges } = useApprovalStore(
    useShallow((s) => ({
      changes: s.changes,
      autoApprove: s.autoApprove,
      approveChange: s.approveChange,
      rejectChange: s.rejectChange,
      approveAll: s.approveAll,
      rejectAll: s.rejectAll,
      toggleAutoApprove: s.toggleAutoApprove,
      clearChanges: s.clearChanges,
    })),
  );

  // v1.1: 同步 autoApprove 到主进程
  const handleToggleAutoApprove = (): void => {
    toggleAutoApprove();
    // toggleAutoApprove 是异步的 (zustand set 不是立刻更新), 所以取反当前值
    window.piAPI?.setAutoApprove?.(!autoApprove);
  };

  const pendingCount = changes.filter((c) => c.status === 'pending').length;
  const totalChanges = changes.length;

  if (!isOpen) return <></>;

  return (
    <div
      className="w-[420px] flex-shrink-0 bg-[#ffffff] border-l border-[var(--mm-border)] flex flex-col h-full"
      role="region"
      aria-label={t("approvalPanel.rootAria")}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--mm-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <h2 className="text-sm font-medium text-[var(--mm-text-primary)]">{t("approvalPanel.title")}</h2>
          {pendingCount > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold text-white bg-[#f59e0b]"
              aria-label={t("approvalPanel.pendingCount", { count: pendingCount })}
            >
              {pendingCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded hover:bg-[var(--mm-bg-hover)] transition-colors text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          title={t("approvalPanel.closeAria")}
          aria-label={t("approvalPanel.closePanel")}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 变更计数 */}
      {totalChanges > 0 && (
        <div className="px-4 py-2 border-b border-[var(--mm-border)] text-xs text-[var(--mm-text-secondary)]">
          {pendingCount > 0 ? (
            <span><strong className="text-[#f59e0b]">{pendingCount}</strong> {t("approvalPanel.pendingSummarySuffix")}</span>
          ) : (
            <span>{t("approvalPanel.allProcessed", { count: totalChanges })}</span>
          )}
        </div>
      )}

      {/* 变更列表 */}
      <ul
        className="flex-1 overflow-y-auto p-3 space-y-3 list-none"
        role="list"
        aria-label={t("approvalPanel.listAria")}
      >
        {totalChanges === 0 ? (
          /* 空状态 */
          <li className="flex flex-col items-center justify-center h-full text-center" role="listitem">
            <svg className="w-12 h-12 text-[#e5e5e5] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-sm text-[var(--mm-text-tertiary)]">{t("approvalPanel.empty")}</p>
            <p className="text-xs text-[#cccccc] mt-1">{t("approvalPanel.emptyHint")}</p>
          </li>
        ) : (
          changes.map((change) => (
            <li key={change.id} role="listitem">
              <ChangeApprovalCard
                change={change}
                onApprove={approveChange}
                onReject={rejectChange}
              />
            </li>
          ))
        )}
      </ul>

      {/* 底部操作栏 */}
      {totalChanges > 0 && (
        <div className="px-3 py-3 border-t border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
          <div className="flex items-center justify-between gap-2">
            {/* 左侧: 全部操作 */}
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={approveAll}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[var(--color-success)] hover:bg-[#059669] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-success)]"
                    aria-label={t("approvalPanel.approveAll")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t("approvalPanel.approveAll")}
                  </button>
                  <button
                    type="button"
                    onClick={rejectAll}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[var(--color-error)] hover:bg-[var(--color-error)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-error)]"
                    aria-label={t("approvalPanel.rejectAll")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {t("approvalPanel.rejectAll")}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={clearChanges}
                className="px-2.5 py-1.5 rounded text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-accent-blue)]"
                aria-label={t("approvalPanel.clearAria")}
              >
                {t("approvalPanel.clear")}
              </button>
            </div>

            {/* 右侧: 自动审批开关 */}
            <button
              type="button"
              onClick={handleToggleAutoApprove}
              role="switch"
              aria-checked={autoApprove}
              aria-label={t("approvalPanel.autoApprove")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-accent-blue)] ${
                autoApprove
                  ? 'bg-[#dcfce7] text-[var(--color-success)]'
                  : 'bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]'
              }`}
              title={autoApprove ? t("approvalPanel.autoApproveOn") : t("approvalPanel.autoApproveOff")}
            >
              <span
                aria-hidden="true"
                className={`w-3 h-3 rounded-full ${autoApprove ? 'bg-[var(--color-success)]' : 'bg-[var(--mm-bg-selected)]'}`}
              />
              {t("approvalPanel.autoApprove")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
