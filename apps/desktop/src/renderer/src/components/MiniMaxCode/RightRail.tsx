import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isIpcError, type GitStatus } from "@shared";
import { usePlanStore } from "../../stores/plan-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useI18n } from "../../i18n";
import type { TaskProgressItem } from "./TaskProgressPanel";
import { GitRailControls } from "./GitRailControls";
import { AgentsRailCard } from "../Agents/AgentsRailCard";
import type { GitChangedFileRow } from "./GitChangesOverlay";
import {
    countDiffStats,
    readCachedGitSnapshot,
    writeCachedGitSnapshot,
    type GitSnapshotCacheEntry,
} from "../../utils/git-snapshot-cache";

interface RightRailProps {
  workspacePath?: string;
  workspaceId?: string;
  tasks?: TaskProgressItem[];
}

type DiffStats = GitSnapshotCacheEntry["diffStats"];

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

export function RightRail({ workspacePath, workspaceId }: RightRailProps): React.JSX.Element {
  const { t } = useI18n();
  const cached = readCachedGitSnapshot(workspacePath);
  const [git, setGit] = useState<GitStatus | null>(() => cached?.git ?? null);
  const [diffStats, setDiffStats] = useState<DiffStats>(() => cached?.diffStats ?? { additions: 0, deletions: 0 });
  const [diffText, setDiffText] = useState<string>(() => cached?.diffText ?? "");
  const [gitLoading, setGitLoading] = useState(() => Boolean(workspacePath) && !cached);
  const rightRailCollapsed = useSettingsStore((state) => state.rightRailCollapsed);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === "visible");
  const railVisible = !rightRailCollapsed && documentVisible;
  const { steps, goal } = usePlanStore();

  const changedFiles = useMemo<GitChangedFileRow[]>(() => {
    if (!git) return [];
    return [
      ...git.modified.map((path) => ({ path, mark: "M", className: "text-[var(--color-info)]" })),
      ...git.added.map((path) => ({ path, mark: "A", className: "text-[var(--color-success)]" })),
      ...git.deleted.map((path) => ({ path, mark: "D", className: "text-[#dc2626]" })),
      ...git.untracked.map((path) => ({ path, mark: "?", className: "text-[var(--mm-text-tertiary)]" })),
    ];
  }, [git]);

  // When workspace switches, hydrate from cache immediately (or clear to loading).
  useEffect(() => {
    const nextCached = readCachedGitSnapshot(workspacePath);
    if (nextCached) {
      setGit(nextCached.git);
      setDiffStats(nextCached.diffStats);
      setDiffText(nextCached.diffText);
      setGitLoading(false);
      return;
    }
    setGit(null);
    setDiffStats({ additions: 0, deletions: 0 });
    setDiffText("");
    setGitLoading(Boolean(workspacePath));
  }, [workspacePath]);

  const loadGitSnapshot = useCallback(async (): Promise<void> => {
    if (!workspacePath || !window.piAPI?.getGitStatus) {
      setGitLoading(false);
      return;
    }
    // Only show loading chrome when we have nothing useful to display yet.
    if (!readCachedGitSnapshot(workspacePath)) {
      setGitLoading(true);
    }
    try {
      const [statusResult, diffResult] = await Promise.all([
        window.piAPI.getGitStatus(workspacePath),
        (async () => {
          if (!window.piAPI?.gitDiff) return null;
          try {
            return await window.piAPI.gitDiff(workspacePath);
          } catch {
            return null;
          }
        })(),
      ]);
      const nextGit = isIpcError(statusResult) ? null : statusResult;
      const nextDiffText =
        diffResult == null || isIpcError(diffResult) ? "" : diffResult;
      const nextStats = nextDiffText
        ? countDiffStats(nextDiffText)
        : { additions: 0, deletions: 0 };
      setGit(nextGit);
      setDiffStats(nextStats);
      setDiffText(nextDiffText);
      writeCachedGitSnapshot(workspacePath, nextGit, nextStats, nextDiffText);
    } finally {
      setGitLoading(false);
    }
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
    // Refresh while open; first paint already used cache when available.
    // 性能优化: 高频刷新由 workspace:git-changed / workspace:file-saved 事件驱动
    // (下方 effect), 这里只保留 60s 低频兜底 (外部 git 操作/其他工具改动).
    const intervalId = setInterval(() => void load(), 60000);
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

  // Progress only when there is a goal or plan checklist — not for idle/queue-only activity.
  const showProgress = Boolean(goal || steps.length > 0);
  const completedStepCount = useMemo(
    () => steps.filter((step) => step.status === "completed").length,
    [steps],
  );

  return (
    <aside
      className="h-auto max-h-full w-full overflow-y-auto rounded-[8px] border border-[var(--right-rail-border)] bg-[var(--right-rail-bg)] px-3 py-3 text-[14px] leading-5 text-[var(--right-rail-text)] shadow-[var(--right-rail-shadow)] [font-family:var(--right-rail-font)] tracking-[0]"
      data-testid="right-rail-panel"
    >
      <section className={`px-0.5 ${showProgress ? "pb-3" : "pb-0"}`}>
        <div className="mb-1 flex min-h-9 items-center justify-between px-1.5">
          <h2 className="m-0 text-[13px] font-normal text-[var(--right-rail-muted)]">{t("rightRail.gitTools")}</h2>
        </div>
        <div className="space-y-0.5">
          <GitRailControls
            workspacePath={workspacePath}
            git={git}
            gitLoading={gitLoading}
            diffStats={diffStats}
            diffText={diffText}
            changedFiles={changedFiles}
            onRefresh={loadGitSnapshot}
          />
        </div>
      </section>

      <section className="min-h-0 border-t border-[var(--right-rail-divider)] px-0.5 py-3" data-testid="right-rail-agents">
        <div className="mb-1 flex min-h-9 items-center justify-between px-1.5">
          <h2 className="m-0 text-[13px] font-normal text-[var(--right-rail-muted)]">{t("rightRail.agents")}</h2>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "agents" } }))}
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
          >
            {t("rightRail.agentsOpenFleet")}
          </button>
        </div>
        <AgentsRailCard workspaceId={workspaceId} />
      </section>

      {showProgress ? (
        <section className="min-h-0 border-t border-[var(--right-rail-divider)] px-0.5 py-3" data-testid="right-rail-progress">
          <div className="mb-1 flex min-h-9 items-center justify-between px-1.5">
            <h2 className="m-0 text-[13px] font-normal text-[var(--right-rail-muted)]">{t("rightRail.progress")}</h2>
            {steps.length > 0 ? (
              <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 font-mono text-[10px] text-[var(--mm-text-tertiary)]">
                {t("rightRail.progressCount", { completed: completedStepCount, total: steps.length })}
              </span>
            ) : null}
          </div>
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
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
