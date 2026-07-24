import React, { useMemo } from "react";
import { useWorkspaceStore, type Workspace } from "../../stores/workspace-store";

interface RecentWorkspacesProps {
  onSelect: (workspace: Workspace) => void;
  className?: string;
  limit?: number;
}

/** Exported for unit tests — relative time labels for recent workspace rows. */
export function formatTimeAgo(date: Date, nowMs: number = Date.now()): string {
  const diff = nowMs - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function RecentWorkspaces({ onSelect, className, limit = 5 }: RecentWorkspacesProps): React.JSX.Element | null {
  const { workspaces, currentWorkspaceId } = useWorkspaceStore();

  const recentWorkspaces = useMemo(() => {
    return workspaces
      .filter((w) => w.id !== currentWorkspaceId)
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
      .slice(0, limit);
  }, [workspaces, currentWorkspaceId, limit]);

  if (recentWorkspaces.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--mm-text-tertiary)]">
        最近工作区
      </div>
      <div className="space-y-1">
        {recentWorkspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => onSelect(workspace)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[var(--mm-text-primary)]">{workspace.name}</div>
              <div className="truncate text-[10px] text-[var(--mm-text-tertiary)]">{workspace.path}</div>
            </div>
            <span className="shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">
              {formatTimeAgo(workspace.lastActiveAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
