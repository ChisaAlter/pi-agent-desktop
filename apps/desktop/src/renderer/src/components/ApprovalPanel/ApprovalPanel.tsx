// ApprovalPanel - 文件变更面板 (按文件聚合)
//
// 浮层固定在右侧、输入框上方, 不参与文档流 (此前 portal 到 body 却没有
// fixed 定位, 会把页面撑长、掉到输入框下面, 必须滚动才能看到)。
//
// 语义:
//  - 保留: 接受这次变更, 不改文件
//  - 撤销: 主进程用变更前快照真实回滚文件
//  - 关闭: 最小化面板, 不处理任何变更 (未处理项仍可通过浮标重新打开)

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useApprovalStore } from '../../stores/approval-store';
import { ChangeApprovalCard } from './ChangeApprovalCard';

interface ApprovalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  workspaceId?: string | null;
}

/** 按 filePath 聚合, 组内按时间升序 */
function groupChanges(
  changes: ReturnType<typeof useApprovalStore.getState>['changes'],
): Array<{ filePath: string; changes: ReturnType<typeof useApprovalStore.getState>['changes'] }> {
  const order: string[] = [];
  const byPath = new Map<string, ReturnType<typeof useApprovalStore.getState>['changes']>();
  for (const change of changes) {
    const existing = byPath.get(change.filePath);
    if (existing) {
      existing.push(change);
    } else {
      order.push(change.filePath);
      byPath.set(change.filePath, [change]);
    }
  }
  return order.map((filePath) => ({
    filePath,
    changes: byPath.get(filePath)!.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  }));
}

export function ApprovalPanel({ isOpen, onToggle, workspaceId }: ApprovalPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const { changes: allChanges, autoApprove, keepChange, undoChange, undoAll, keepAll, undoError, toggleAutoApprove } =
    useApprovalStore(
      useShallow((s) => ({
        changes: s.changes,
        autoApprove: s.autoApprove,
        keepChange: s.keepChange,
        undoChange: s.undoChange,
        undoAll: s.undoAll,
        keepAll: s.keepAll,
        undoError: s.undoError,
        toggleAutoApprove: s.toggleAutoApprove,
      })),
    );
  const changes = useMemo(
    () => allChanges.filter((change) => !workspaceId || change.workspaceId === workspaceId),
    [allChanges, workspaceId],
  );
  const [undoing, setUndoing] = useState(false);

  // v1.1: 同步 autoApprove 到主进程
  const handleToggleAutoApprove = (): void => {
    toggleAutoApprove();
    // toggleAutoApprove 是异步的 (zustand set 不是立刻更新), 所以取反当前值
    window.piAPI?.setAutoApprove?.(!autoApprove);
  };

  const handleKeepAll = (): void => {
    if (undoing) return;
    setUndoing(true);
    void Promise.resolve(keepAll()).finally(() => setUndoing(false));
  };

  const handleUndoAll = (): void => {
    if (undoing) return;
    setUndoing(true);
    void Promise.resolve(undoAll()).finally(() => setUndoing(false));
  };

  const pendingCount = changes.filter((c) => c.status === 'pending').length;
  const groups = useMemo(() => groupChanges(changes), [changes]);

  if (!isOpen) return <></>;

  return (
    <div
      className="fixed right-3 z-[230] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-[10px] border border-[var(--mm-border)] bg-[var(--mm-bg-main)] shadow-[0_18px_46px_rgba(15,23,42,0.16)]"
      style={{
        bottom: "calc(var(--pi-global-composer-height, 103px) + 12px)",
        maxHeight: "calc(100vh - var(--pi-global-composer-height, 103px) - 66px)",
      }}
      role="dialog"
      aria-modal="false"
      aria-label={t("approvalPanel.rootAria")}
      data-testid="approval-panel"
    >
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-[var(--mm-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <h2 className="truncate text-sm font-medium text-[var(--mm-text-primary)]">{t("approvalPanel.title")}</h2>
          {pendingCount > 0 && (
            <span
              className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#f59e0b] px-1.5 text-[10px] font-bold text-white"
              aria-label={t("approvalPanel.pendingCount", { count: pendingCount })}
            >
              {pendingCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded p-1 text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          title={t("approvalPanel.closeAria")}
          aria-label={t("approvalPanel.closePanel")}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 摘要: N 个文件 · M 次编辑 */}
      {changes.length > 0 && (
        <div className="shrink-0 border-b border-[var(--mm-border)] px-4 py-2 text-xs text-[var(--mm-text-secondary)]">
          {t("approvalPanel.groupSummary", {
            files: groups.length,
            edits: changes.length,
            pending: pendingCount,
          })}
        </div>
      )}

      {/* 变更列表 (按文件聚合) */}
      <ul
        className="m-0 min-h-0 flex-auto list-none space-y-2 overflow-y-auto p-3"
        role="list"
        aria-label={t("approvalPanel.listAria")}
      >
        {changes.length === 0 ? (
          /* 空状态 */
          <li className="flex h-full flex-col items-center justify-center text-center" role="listitem">
            <svg className="mb-3 h-12 w-12 text-[#e5e5e5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-sm text-[var(--mm-text-tertiary)]">{t("approvalPanel.empty")}</p>
            <p className="mt-1 text-xs text-[#cccccc]">{t("approvalPanel.emptyHint")}</p>
          </li>
        ) : (
          groups.map((group) => (
            <li key={group.filePath} role="listitem">
              <ChangeApprovalCard
                filePath={group.filePath}
                changes={group.changes}
                onKeep={(id) => void keepChange(id)}
                onUndo={(id) => void undoChange(id)}
                undoError={undoError}
              />
            </li>
          ))
        )}
      </ul>

      {/* 底部操作栏 */}
      {changes.length > 0 && (
        <div className="shrink-0 border-t border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            {/* 左侧: 全部操作 */}
            <div className="flex flex-wrap items-center gap-2">
              {pendingCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleUndoAll}
                    disabled={undoing}
                    className="inline-flex items-center gap-1 rounded bg-[var(--mm-bg-sidebar)] px-2.5 py-1.5 text-xs font-medium text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-accent-blue)] disabled:opacity-60"
                    aria-label={t("approvalPanel.undoAll")}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1 0 3-6.7M3 5v5h5" />
                    </svg>
                    {undoing ? t("approvalPanel.undoing") : t("approvalPanel.undoAll")}
                  </button>
                  <button
                    type="button"
                    onClick={handleKeepAll}
                    className="inline-flex items-center gap-1 rounded bg-[var(--color-success)] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#059669] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-success)] disabled:opacity-60"
                    disabled={undoing}
                    aria-label={t("approvalPanel.keepAll")}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t("approvalPanel.keepAll")}
                  </button>
                </>
              )}
            </div>

            {/* 右侧: 自动审批开关 */}
            <button
              type="button"
              onClick={handleToggleAutoApprove}
              role="switch"
              aria-checked={autoApprove}
              aria-label={t("approvalPanel.autoApprove")}
              className={`flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-accent-blue)] ${
                autoApprove
                  ? 'bg-[#dcfce7] text-[var(--color-success)]'
                  : 'border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]'
              }`}
              title={autoApprove ? t("approvalPanel.autoApproveOn") : t("approvalPanel.autoApproveOff")}
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3 rounded-full ${autoApprove ? 'bg-[var(--color-success)]' : 'bg-[var(--mm-bg-selected)]'}`}
              />
              {t("approvalPanel.autoApprove")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
