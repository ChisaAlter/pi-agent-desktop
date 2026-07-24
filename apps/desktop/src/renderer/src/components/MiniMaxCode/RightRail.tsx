import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isIpcError, type GitStatus } from "@shared";
import { usePlanStore } from "../../stores/plan-store";
import { useSessionStore } from "../../stores/session-store";
import { useQueueStore, type QueueTaskStatus } from "../../stores/queue-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useI18n } from "../../i18n";
import type { TaskProgressItem } from "./TaskProgressPanel";
import { GitRailControls } from "./GitRailControls";
interface RightRailProps {
  workspacePath?: string;
  workspaceId?: string;
  tasks?: TaskProgressItem[];
}

interface DiffStats {
  additions: number;
  deletions: number;
}

interface QueueRailItem {
  id: string;
  label: string;
  meta: string;
  status: QueueTaskStatus;
  sessionId?: string;
}


function countDiffStats(diff: string): DiffStats {
  return diff.split(/\r?\n/).reduce<DiffStats>((acc, line) => {
    if (line.startsWith("+++") || line.startsWith("---")) return acc;
    if (line.startsWith("+")) acc.additions += 1;
    if (line.startsWith("-")) acc.deletions += 1;
    return acc;
  }, { additions: 0, deletions: 0 });
}

function statusDot(status: string): string {
  if (status === "completed") return "bg-[#666] text-white";
  if (status === "running") return "bg-[#1f1f1f] text-white";
  if (status === "failed" || status === "error" || status === "blocked") return "bg-[var(--color-error)] text-white";
  if (status === "waiting") return "bg-[#f59e0b] text-white";
  return "border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-transparent";
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function ProgressStatusIcon({ status }: { status: string }): React.JSX.Element {
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${statusDot(status)}`}>
      {status === "completed" ? (
        <CheckIcon />
      ) : status === "running" ? (
        <span className="pi-motion-running-dot h-1.5 w-1.5 rounded-full bg-current" />
      ) : status === "failed" || status === "error" || status === "blocked" ? (
        <span className="text-[12px] leading-none">!</span>
      ) : null}
    </span>
  );
}

export function RightRail({ workspacePath, tasks = [] }: RightRailProps): React.JSX.Element {
  const { t } = useI18n();
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats>({ additions: 0, deletions: 0 });
  const [filesExpanded, setFilesExpanded] = useState(false);
  const rightRailCollapsed = useSettingsStore((state) => state.rightRailCollapsed);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === "visible");
  const railVisible = !rightRailCollapsed && documentVisible;
  const { steps, goal } = usePlanStore();
  const queue = useQueueStore();
  const currentSession = useSessionStore((state) =>
    state.currentSessionId
      ? state.sessions.find((session) => session.id === state.currentSessionId) ?? null
      : null,
  );

  const changedFiles = useMemo(() => {
    if (!git) return [];
    return [
      ...git.modified.map((path) => ({ path, mark: "M", className: "text-[var(--color-info)]" })),
      ...git.added.map((path) => ({ path, mark: "A", className: "text-[var(--color-success)]" })),
      ...git.deleted.map((path) => ({ path, mark: "D", className: "text-[#dc2626]" })),
      ...git.untracked.map((path) => ({ path, mark: "?", className: "text-[var(--mm-text-tertiary)]" })),
    ];
  }, [git]);
  const visibleChangedFiles = filesExpanded ? changedFiles : changedFiles.slice(0, 3);
  const hiddenChangedCount = Math.max(0, changedFiles.length - visibleChangedFiles.length);

  const openWorkspaceFile = (path: string, mode?: "edit" | "diff"): void => {
    window.dispatchEvent(
      new CustomEvent("workspace:open-file", {
        detail: { path, mode },
      }),
    );
  };
  const openGitDiff = (file: string): void => {
    window.dispatchEvent(new CustomEvent("workspace:open-git-diff", { detail: { file } }));
  };

  const loadGitSnapshot = useCallback(async (): Promise<void> => {
    if (!workspacePath || !window.piAPI?.getGitStatus) return;
    const next = await window.piAPI.getGitStatus(workspacePath);
    let nextStats: DiffStats = { additions: 0, deletions: 0 };
    if (window.piAPI?.gitDiff) {
      try {
        const diff = await window.piAPI.gitDiff(workspacePath);
        nextStats = isIpcError(diff) ? { additions: 0, deletions: 0 } : countDiffStats(diff);
      } catch {
        nextStats = { additions: 0, deletions: 0 };
      }
    }
    setGit(isIpcError(next) ? null : next);
    setDiffStats(nextStats);
  }, [workspacePath]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      setDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!railVisible || !workspacePath || !window.piAPI?.getGitStatus) return;
    let disposed = false;
    const load = async (): Promise<void> => {
      if (!disposed) await loadGitSnapshot();
    };
    const intervalId = setInterval(() => void load(), 15000);
    void load();
    return () => {
      disposed = true;
      clearInterval(intervalId);
    };
  }, [loadGitSnapshot, railVisible, workspacePath]);

  useEffect(() => {
    if (!railVisible) return;
    const onWorkspaceGitUpdate = (event: Event): void => {
      const detail = (event as CustomEvent<{ workspacePath?: string }>).detail;
      if (!detail?.workspacePath || detail.workspacePath === workspacePath) {
        void loadGitSnapshot();
      }
    };
    window.addEventListener("workspace:file-saved", onWorkspaceGitUpdate);
    window.addEventListener("workspace:git-changed", onWorkspaceGitUpdate);
    return () => {
      window.removeEventListener("workspace:file-saved", onWorkspaceGitUpdate);
      window.removeEventListener("workspace:git-changed", onWorkspaceGitUpdate);
    };
  }, [loadGitSnapshot, railVisible, workspacePath]);


  const localizeQueueText = useCallback((text: string): string => {
    const exact: Record<string, string> = {
      "Agent 已开始": t("rightRail.queueActivity.agentStarted"),
      "Turn 已开始": t("rightRail.queueActivity.turnStarted"),
      "Agent 已结束": t("rightRail.queueActivity.agentEnded"),
      "Turn 已结束": t("rightRail.queueActivity.turnEnded"),
      "自动重试中": t("rightRail.queueActivity.autoRetrying"),
      "自动重试结束": t("rightRail.queueActivity.autoRetryEnded"),
      "扩展错误": t("rightRail.queueActivity.extensionError"),
      "队列已更新": t("rightRail.queueActivity.queueUpdated"),
      "当前任务运行中": t("rightRail.queueActivity.taskRunning"),
      "当前任务已完成": t("rightRail.queueActivity.taskCompleted"),
    };
    if (exact[text]) return exact[text];
    const toolMatch = text.match(/^(.+?) (运行中|失败|完成)$/);
    if (toolMatch) {
      const [, name, status] = toolMatch;
      if (status === "运行中") return t("rightRail.queueActivity.toolRunning", { name });
      if (status === "失败") return t("rightRail.queueActivity.toolFailed", { name });
      if (status === "完成") return t("rightRail.queueActivity.toolCompleted", { name });
    }
    return text;
  }, [t]);
  const queueItems = useMemo<QueueRailItem[]>(() => {
    const sessionId = currentSession?.id;
    return queue.items.slice(0, 8).map((item) => ({
      id: item.id,
      label: (item.id === "queue:running" || item.id === "queue:auto-retry") && item.status === "running"
        ? currentSession?.title || localizeQueueText(item.label)
        : localizeQueueText(item.label),
      meta: item.id === "queue:auto-retry" && item.status === "running"
        ? t("rightRail.autoRetry")
        : item.id === "queue:running" && item.status === "running"
        ? queue.autoRetrying ? t("rightRail.autoRetry") : t("rightRail.currentSession")
        : item.meta,
      status: item.status,
      sessionId,
    }));
  }, [currentSession?.id, currentSession?.title, localizeQueueText, queue.autoRetrying, queue.items, t]);
  const taskItems = useMemo<QueueRailItem[]>(() => {
    return tasks.slice(0, 5).map((task) => ({
      id: `task:${task.id}`,
      label: task.name,
      meta: "Tool",
      status: task.status === "running" ? "running" : task.status === "failed" ? "waiting" : "pending",
      sessionId: currentSession?.id,
    }));
  }, [currentSession?.id, tasks]);
  const taskFlowItems = useMemo(() => [...queueItems, ...taskItems].slice(0, 8), [queueItems, taskItems]);
  const jumpToSession = (sessionId?: string): void => {
    window.dispatchEvent(
      new CustomEvent("app:switch-section", {
        detail: { section: sessionId ? `session:${sessionId}` : "chat" },
      }),
    );
  };

  const openFilesPanel = (): void => {
    window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "files" } }));
  };
  // Always mount the progress region so idle chat has a stable landmark for
  // status + empty state. Content inside still adapts to queue/goal/task data.
  const hasActiveProgress = Boolean(
    queue.lastError || queue.lastCompletedAt || queue.lastActivity || goal || taskFlowItems.length || steps.length || tasks.length,
  );

  return (
    <aside
      className="h-auto max-h-full w-full overflow-y-auto rounded-[8px] border border-[var(--right-rail-border)] bg-[var(--right-rail-bg)] px-3 py-3 text-[14px] leading-5 text-[var(--right-rail-text)] shadow-[var(--right-rail-shadow)] [font-family:var(--right-rail-font)] tracking-[0]"
      data-testid="right-rail-panel"
    >
      <section className="px-0.5 pb-3">
        <div className="mb-1 flex min-h-9 items-center justify-between px-1.5">
          <h2 className="m-0 text-[13px] font-normal text-[var(--right-rail-muted)]">{t("rightRail.environment")}</h2>
          <button
            type="button"
            onClick={openFilesPanel}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--right-rail-muted)] hover:bg-[var(--right-rail-hover)] hover:text-[var(--right-rail-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
            aria-label={t("rightRail.browseAllFiles")}
            title={t("rightRail.browseAllFiles")}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeWidth={1.6} d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="space-y-0.5">
          <GitRailControls
            workspacePath={workspacePath}
            git={git}
            diffStats={diffStats}
            onRefresh={loadGitSnapshot}
          />
          {visibleChangedFiles.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-[var(--right-rail-divider)] pt-2">
              <div className="flex items-center justify-between px-1.5 text-[11px] text-[var(--right-rail-muted)]">
                <span>{t("rightRail.projectFiles")}</span>
                <span className="font-mono">{changedFiles.length}</span>
              </div>
              {visibleChangedFiles.map((item) => (
                <div key={`${item.mark}:${item.path}`} className="flex min-w-0 items-center gap-2 px-1 text-[11px]">
                  <span className={`w-3 shrink-0 font-mono font-semibold ${item.className}`}>{item.mark}</span>
                  <button
                    type="button"
                    onClick={() => openWorkspaceFile(item.path)}
                    className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left font-mono text-[var(--right-rail-secondary)] hover:bg-[var(--right-rail-hover)] hover:text-[var(--right-rail-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
                    title={t("rightRail.openFile", { path: item.path })}
                  >
                    {item.path}
                  </button>
                  <button
                    type="button"
                    onClick={() => openGitDiff(item.path)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--right-rail-muted)] hover:bg-[var(--right-rail-hover)] hover:text-[var(--right-rail-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    title={t("rightRail.viewDiff", { path: item.path })}
                  >
                    Diff
                  </button>
                </div>
              ))}
              {changedFiles.length > 3 && (
                <button
                  type="button"
                  onClick={() => setFilesExpanded((value) => !value)}
                  className="mt-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--right-rail-secondary)] transition-colors hover:bg-[var(--right-rail-hover)] hover:text-[var(--right-rail-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                  {filesExpanded
                    ? t("rightRail.collapseFiles")
                    : t("rightRail.expandRemainingFiles", { count: hiddenChangedCount })}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0 border-t border-[var(--right-rail-divider)] px-0.5 py-3" data-testid="right-rail-progress">
        <div className="mb-1 flex min-h-9 items-center justify-between px-1.5">
          <h2 className="m-0 text-[13px] font-normal text-[var(--right-rail-muted)]">{t("rightRail.progress")}</h2>
          <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
            {hasActiveProgress && taskFlowItems.length > 0
              ? t("rightRail.itemCount", { count: taskFlowItems.length })
              : t("rightRail.idle")}
          </span>
        </div>
        {queue.lastError && (
          <div className="mb-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs leading-5 text-[var(--color-error)]" role="alert">
            {queue.lastError}
          </div>
        )}
        {!queue.lastError && queue.lastCompletedAt && (
          <div className="mb-3 rounded-lg border border-[#dcfce7] bg-[#f0fdf4] px-3 py-2 text-xs leading-5 text-[var(--color-success)]" role="status">
            {t("rightRail.recentTaskCompleted")}
          </div>
        )}
        {queue.lastActivity && (
          <div className="mb-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs leading-5 text-[var(--mm-text-secondary)]" role="status">
            {localizeQueueText(queue.lastActivity)}
          </div>
        )}
        {goal && (
          <div className="mb-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs leading-5" role="status">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium" title={goal.condition}>
                {t("rightRail.goal", { condition: goal.condition })}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[10px] text-[var(--mm-text-secondary)]">
                {t(`rightRail.goalStatus.${goal.status}`)}
              </span>
            </div>
            {goal.reason && (
              <p className="m-0 mt-1 truncate text-[11px] text-[var(--mm-text-tertiary)]" title={goal.reason}>
                {goal.reason}
              </p>
            )}
          </div>
        )}

        {taskFlowItems.length > 0 && (
          <div className="mb-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-2">
            <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--mm-text-tertiary)]">
              <span>{t("rightRail.queue")}</span>
              <span>{queue.autoRetrying ? t("rightRail.autoRetry") : queue.running ? t("rightRail.running") : t("rightRail.queued")}</span>
            </div>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {taskFlowItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => jumpToSession(item.sessionId)}
                    className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs hover:bg-[var(--mm-bg-panel)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
                    title={item.label}
                  >
                    <ProgressStatusIcon status={item.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      <span className="block truncate text-[10px] text-[var(--mm-text-tertiary)]">{item.meta}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {steps.length > 0 ? (
          <ol className="m-0 max-h-[440px] list-none space-y-2 overflow-y-auto p-0">
            {steps.map((step) => (
              <li key={step.id} className="flex min-w-0 items-start gap-2 text-xs">
                <ProgressStatusIcon status={step.status} />
                <span className={`min-w-0 flex-1 truncate ${step.status === "completed" ? "text-[var(--mm-text-tertiary)] line-through" : ""}`}>
                  {step.text}
                </span>
              </li>
            ))}
          </ol>
        ) : tasks.length > 0 ? (
          <ul className="m-0 max-h-[440px] list-none space-y-2 overflow-y-auto p-0">
            {tasks.map((task) => (
              <li key={task.id} className="flex min-w-0 items-center gap-2 text-xs">
                <ProgressStatusIcon status={task.status} />
                <span className="truncate">{task.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 px-1.5 py-1 text-[12px] leading-5 text-[var(--right-rail-muted)]">
            {t("rightRail.emptyProgress")}
          </p>
        )}
      </section>

    </aside>
  );
}
