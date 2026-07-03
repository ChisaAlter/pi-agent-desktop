import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isIpcError, type GitStatus, type ProjectInfo } from "@shared";
import { usePlanStore } from "../../stores/plan-store";
import { useSessionStore } from "../../stores/session-store";
import { useQueueStore, type QueueTaskStatus } from "../../stores/queue-store";
import { useSettingsStore } from "../../stores/settings-store";
import { UsageStatsPanel } from "../UsageStats/UsageStatsPanel";
import { useI18n } from "../../i18n";
import { contentWithGeneratedUiText } from "../../utils/generated-ui";
import { classifyTerminalCommand } from "../../utils/terminal-command";
import { projectScriptCommand } from "../../utils/project-scripts";
import { useTransientState } from "./hooks/useTransientState";
import type { TaskProgressItem } from "./TaskProgressPanel";

interface RightRailProps {
  workspacePath?: string;
  workspaceId?: string;
  tasks?: TaskProgressItem[];
}

interface DiffStats {
  additions: number;
  deletions: number;
}

interface FileOutputItem {
  path: string;
  name: string;
  source: string;
}

interface QueueRailItem {
  id: string;
  label: string;
  meta: string;
  status: QueueTaskStatus;
  sessionId?: string;
}

const FILE_OUTPUT_TOOL_NAMES = new Set(["write", "edit", "file_write", "file_edit"]);

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

function RowIcon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--mm-text-tertiary)]" aria-hidden="true">
      {children}
    </span>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function normalizeOutputPath(path: string, workspacePath?: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) return trimmed;
  if (!workspacePath) return trimmed;
  return `${workspacePath.replace(/[\\/]+$/, "")}\\${trimmed.replace(/^[\\/]+/, "")}`;
}

function extractPathsFromValue(value: unknown): string[] {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const results = new Set<string>();
  const pathPattern = /(?:[A-Za-z]:[\\/][^\s"'`<>]+|(?:[\w.-]+[\\/])+[\w.@()[\]-]+\.[A-Za-z0-9_+-]{1,12})/g;
  for (const match of text.matchAll(pathPattern)) {
    const raw = match[0].replace(/[),.;:]+$/, "");
    if (!/\.(ts|tsx|js|jsx|json|md|txt|html|css|scss|yml|yaml|toml|py|rs|go|java|cs|cpp|c|h|png|jpg|jpeg|webp|svg|pdf)$/i.test(raw)) {
      continue;
    }
    results.add(raw);
  }
  return [...results];
}

function getCommandText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const command = record.command ?? record.cmd ?? record.script;
  return typeof command === "string" && command.trim() ? command.trim() : undefined;
}

function shouldReadToolInputAsOutput(name: string, status: string): boolean {
  return status === "completed" && FILE_OUTPUT_TOOL_NAMES.has(name.toLowerCase());
}

function extractOutputPathsFromCommand(command: string): string[] {
  const results = new Set<string>();
  const redirectionPattern = /(?:^|[^\w-])(?:\d?>>?|\d?>|>>|>)\s*(?:"([^"]+)"|'([^']+)'|([^\s|&;]+))/g;
  for (const match of command.matchAll(redirectionPattern)) {
    const candidate = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!candidate || /^(?:nul|\/dev\/null|\$null)$/i.test(candidate)) continue;
    extractPathsFromValue(candidate).forEach((path) => results.add(path));
  }
  return [...results];
}

function shellActionFailure(result: unknown): string | null {
  if (isIpcError(result)) return result.fallback;
  if (typeof result === "string" && result.trim()) return result;
  return null;
}

function ProgressStatusIcon({ status }: { status: string }): React.JSX.Element {
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${statusDot(status)}`}>
      {status === "completed" ? (
        <CheckIcon />
      ) : status === "running" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      ) : status === "failed" || status === "error" || status === "blocked" ? (
        <span className="text-[12px] leading-none">!</span>
      ) : null}
    </span>
  );
}

export function RightRail({ workspacePath, workspaceId, tasks = [] }: RightRailProps): React.JSX.Element {
  const { t } = useI18n();
  const [git, setGit] = useState<GitStatus | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [fileActionStatus, setFileActionStatus] = useTransientState<{ path: string; message: string; tone: "success" | "error" }>(1800);
  const [railActionStatus, setRailActionStatus] = useTransientState<{ message: string; tone: "success" | "error" }>(1800);
  const [diffStats, setDiffStats] = useState<DiffStats>({ additions: 0, deletions: 0 });
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useTransientState<string>(1600);
  const rightRailCollapsed = useSettingsStore((state) => state.rightRailCollapsed);
  const { steps, goal } = usePlanStore();
  const queue = useQueueStore();
  const currentSession = useSessionStore((state) =>
    state.currentSessionId
      ? state.sessions.find((session) => session.id === state.currentSessionId) ?? null
      : null,
  );

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
    if (!workspacePath || !window.piAPI?.getGitStatus) return;
    let disposed = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const load = async (): Promise<void> => {
      if (!disposed) await loadGitSnapshot();
    };
    const start = (): void => {
      if (intervalId || disposed) return;
      intervalId = setInterval(() => void load(), 15000);
    };
    const stop = (): void => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible" && !rightRailCollapsed) start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void load();
    if (document.visibilityState === "visible" && !rightRailCollapsed) start();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [loadGitSnapshot, workspacePath, rightRailCollapsed]);

  useEffect(() => {
    if (!workspacePath || !window.piAPI?.detectProject) return;
    let disposed = false;
    const load = async (): Promise<void> => {
      const result = await window.piAPI!.detectProject(workspacePath);
      if (disposed) return;
      if (isIpcError(result)) {
        setProject(null);
        setProjectError(result.fallback);
        return;
      }
      setProject(result);
      setProjectError(null);
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [workspacePath]);

  useEffect(() => {
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
  }, [loadGitSnapshot, workspacePath]);

  const changeCount = useMemo(() => {
    if (!git) return 0;
    return git.modified.length + git.added.length + git.deleted.length + git.untracked.length;
  }, [git]);
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
  const fileOutputs = useMemo<FileOutputItem[]>(() => {
    const byPath = new Map<string, FileOutputItem>();
    const add = (path: string, source: string): void => {
      const normalized = normalizeOutputPath(path, workspacePath);
      if (!normalized || byPath.has(normalized)) return;
      byPath.set(normalized, { path: normalized, name: basename(normalized), source });
    };
    currentSession?.lastOutputPaths?.forEach((path) => add(path, t("rightRail.source.taskOutput")));
    currentSession?.messages.forEach((message) => {
      if (message.role === "assistant") {
        extractPathsFromValue(contentWithGeneratedUiText(message.content, message.generatedUi)).forEach((path) =>
          add(path, t("rightRail.source.reply")),
        );
      }
      message.toolCalls?.forEach((toolCall) => {
        const values: unknown[] = [toolCall.output, toolCall.result];
        if (shouldReadToolInputAsOutput(toolCall.name || "", toolCall.status)) {
          values.push(toolCall.input ?? toolCall.args);
        }
        values.forEach((value) => {
          extractPathsFromValue(value).forEach((path) => add(path, toolCall.name || t("rightRail.source.tool")));
        });
        if (toolCall.status === "completed" && /^(?:bash|shell|powershell|command)$/i.test(toolCall.name || "")) {
          const command = getCommandText(toolCall.input ?? toolCall.args);
          if (command) {
            extractOutputPathsFromCommand(command).forEach((path) => add(path, toolCall.name || t("rightRail.source.tool")));
          }
        }
      });
    });
    return [...byPath.values()].slice(0, 10);
  }, [currentSession?.lastOutputPaths, currentSession?.messages, t, workspacePath]);

  const copyPath = async (path: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setFileActionStatus({ path, message: t("rightRail.status.copiedPath"), tone: "success" });
      setTimeout(() => setCopiedPath(null), 1600);
      setTimeout(() => setFileActionStatus(null), 1600);
    } catch (err) {
      setCopiedPath(null);
      setFileActionStatus({
        path,
        message: t("rightRail.status.copyPathFailed", { message: err instanceof Error ? err.message : String(err) }),
        tone: "error",
      });
    }
  };
  const openOutputPath = async (path: string): Promise<void> => {
    if (!window.piAPI?.openPath) return;
    try {
      const result = await window.piAPI.openPath(path);
      const failure = shellActionFailure(result);
      if (failure) {
        setFileActionStatus({ path, message: failure, tone: "error" });
        return;
      }
    } catch (err) {
      setFileActionStatus({
        path,
        message: t("rightRail.status.systemOpenFailed", { message: err instanceof Error ? err.message : String(err) }),
        tone: "error",
      });
      return;
    }
    setFileActionStatus({ path, message: t("rightRail.status.openRequested"), tone: "success" });
    window.setTimeout(() => setFileActionStatus(null), 1800);
  };
  const revealOutputPath = async (path: string): Promise<void> => {
    if (!window.piAPI?.revealPath) return;
    try {
      const result = await window.piAPI.revealPath(path);
      const failure = shellActionFailure(result);
      if (failure) {
        setFileActionStatus({ path, message: failure, tone: "error" });
        return;
      }
    } catch (err) {
      setFileActionStatus({
        path,
        message: t("rightRail.status.systemRevealFailed", { message: err instanceof Error ? err.message : String(err) }),
        tone: "error",
      });
      return;
    }
    setFileActionStatus({ path, message: t("rightRail.status.revealRequested"), tone: "success" });
    window.setTimeout(() => setFileActionStatus(null), 1800);
  };
  const openWorkspaceFile = (path: string, mode?: "edit" | "diff"): void => {
    const normalized = normalizeOutputPath(path, workspacePath);
    window.dispatchEvent(
      new CustomEvent("workspace:open-file", {
        detail: { path: normalized, mode },
      }),
    );
    setRailActionStatus({ message: t("rightRail.status.fileOpened", { name: basename(normalized) }), tone: "success" });
    window.setTimeout(() => setRailActionStatus(null), 1800);
  };
  const referenceOutputPath = (path: string): void => {
    const normalized = normalizeOutputPath(path, workspacePath);
    window.dispatchEvent(new CustomEvent("chatpanel:prefill", { detail: { text: `@${normalized} ` } }));
    window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "chat" } }));
    setFileActionStatus({ path: normalized, message: t("rightRail.status.quotedToChat"), tone: "success" });
    window.setTimeout(() => setFileActionStatus(null), 1800);
  };
  const openGitDiff = (file: string): void => {
    window.dispatchEvent(new CustomEvent("workspace:open-git-diff", { detail: { file } }));
    setRailActionStatus({ message: t("rightRail.status.diffOpened", { file }), tone: "success" });
    window.setTimeout(() => setRailActionStatus(null), 1800);
  };
  const runCommandInTerminal = (command: string): void => {
    const mode = classifyTerminalCommand(command);
    window.dispatchEvent(new CustomEvent("terminal:run-command", {
      detail: { command, mode },
    }));
    setRailActionStatus({
      message: mode === "draft" ? t("rightRail.status.highRiskCommandDrafted") : t("rightRail.status.commandSent"),
      tone: "success",
    });
    window.setTimeout(() => setRailActionStatus(null), 1800);
  };
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
  const projectScripts = useMemo(() => {
    if (!project?.scripts) return [];
    return Object.keys(project.scripts).slice(0, 3).map((name) => ({
      name,
      command: projectScriptCommand(project.packageManager, name),
    }));
  }, [project?.packageManager, project?.scripts]);

  const jumpToSession = (sessionId?: string): void => {
    window.dispatchEvent(
      new CustomEvent("app:switch-section", {
        detail: { section: sessionId ? `session:${sessionId}` : "chat" },
      }),
    );
  };

  const openGitPanel = (): void => {
    window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "git" } }));
  };
  const openFilesPanel = (): void => {
    window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "files" } }));
  };

  return (
    <aside className="h-full w-full space-y-3 overflow-y-auto px-1 py-1 pb-2 text-[var(--mm-text-primary)]">
      {railActionStatus && (
        <div
          className={`rounded-[14px] border px-3 py-2 text-xs ${
            railActionStatus.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-[#dbe8d0] bg-[#f5fbf0] text-[var(--color-success)]"
          }`}
          role={railActionStatus.tone === "error" ? "alert" : "status"}
        >
          {railActionStatus.message}
        </div>
      )}
      <section className="rounded-[16px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">{t("rightRail.environment")}</h2>
        </div>
        <p className="mb-3 truncate font-mono text-[11px] leading-none text-[var(--mm-text-tertiary)]">
          {git?.branch ?? t("rightRail.noGit")}
        </p>
        <div className="space-y-3 text-xs">
          <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-2">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 truncate font-medium" title={project?.name ?? workspacePath}>
                {project?.name ?? t("rightRail.unknownProject")}
              </span>
              <span className="shrink-0 rounded bg-[var(--mm-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--mm-text-secondary)]">
                {project?.type ?? "unknown"}
              </span>
            </div>
            {projectError ? (
              <p className="m-0 text-[11px] leading-4 text-[var(--color-error)]">{projectError}</p>
            ) : (
              <div className="space-y-1.5 text-[11px] text-[var(--mm-text-secondary)]">
                <div className="flex justify-between gap-3">
                  <span>{t("rightRail.packageManager")}</span>
                  <span className="font-mono">{project?.packageManager ?? "-"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>{t("rightRail.configFiles")}</span>
                  <span className="max-w-[150px] truncate text-right font-mono" title={project?.configFiles.join(", ")}>
                    {project?.configFiles.length ? project.configFiles.slice(0, 3).join(", ") : "-"}
                  </span>
                </div>
                {project?.scripts && Object.keys(project.scripts).length > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between gap-3">
                      <span>{t("rightRail.scripts")}</span>
                      <span className="max-w-[150px] truncate text-right font-mono" title={Object.keys(project.scripts).join(", ")}>
                        {Object.keys(project.scripts).slice(0, 3).join(", ")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {projectScripts.map((script) => (
                        <button
                          key={script.name}
                          type="button"
                          onClick={() => runCommandInTerminal(script.command)}
                          className="rounded border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                          title={t("rightRail.runInTerminal", { command: script.command })}
                        >
                          {script.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <RowIcon>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 5v14m-7-7h14" />
                </svg>
              </RowIcon>
              <span>{t("rightRail.changes")}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
              <span className="text-[var(--color-success)]">+{diffStats.additions}</span>
              <span className="text-[#dc2626]">-{diffStats.deletions}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={openGitPanel}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-[var(--mm-bg-hover)]"
              aria-label={t("rightRail.commitOrPushAria")}
            >
              <RowIcon>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 12h13m0 0-4-4m4 4-4 4" />
                </svg>
              </RowIcon>
              <span>{t("rightRail.commitOrPush")}</span>
            </button>
            <span className="shrink-0 font-mono text-[11px] text-[var(--mm-text-secondary)]">
              {git ? `${git.ahead}/${git.behind}` : "-"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RowIcon>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
            </RowIcon>
            <span>{t("rightRail.projectFiles")}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={openFilesPanel}
                className="rounded-md px-1.5 py-0.5 text-[10px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
              >
                {t("rightRail.browseAllFiles")}
              </button>
              <span className="text-[11px] text-[var(--mm-text-tertiary)]">{changeCount}</span>
            </div>
          </div>
          {visibleChangedFiles.length > 0 && (
            <div className="space-y-1 border-t border-[#f2f2f0] pt-2">
              {visibleChangedFiles.map((item) => (
                <div key={`${item.mark}:${item.path}`} className="flex min-w-0 items-center gap-2 text-[11px]">
                  <span className={`w-3 shrink-0 font-mono font-semibold ${item.className}`}>{item.mark}</span>
                  <button
                    type="button"
                    onClick={() => openWorkspaceFile(item.path)}
                    className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left font-mono text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                    title={t("rightRail.openFile", { path: item.path })}
                  >
                    {item.path}
                  </button>
                  <button
                    type="button"
                    onClick={() => openGitDiff(item.path)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
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
                  className="mt-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                >
                  {filesExpanded ? t("rightRail.collapseFiles") : t("rightRail.expandRemainingFiles", { count: hiddenChangedCount })}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <UsageStatsPanel workspaceId={workspaceId} />

      <section className="min-h-0 rounded-[16px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">{t("rightRail.progress")}</h2>
          <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
            {taskFlowItems.length > 0 ? t("rightRail.itemCount", { count: taskFlowItems.length }) : t("rightRail.idle")}
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
                    className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs hover:bg-[var(--mm-bg-panel)]"
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
          <p className="m-0 rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-3 text-xs leading-5 text-[var(--mm-text-secondary)]">
            {t("rightRail.emptyProgress")}
          </p>
        )}
      </section>

      <section className="min-h-0 rounded-[16px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">{t("rightRail.fileOutput")}</h2>
        </div>
        {fileOutputs.length > 0 ? (
          <ul className="m-0 max-h-[220px] list-none space-y-2 overflow-y-auto p-0">
            {fileOutputs.map((item) => (
              <li key={item.path} className="min-w-0 rounded-lg border border-[var(--mm-border)] px-2.5 py-2">
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--mm-text-primary)]" title={item.path}>
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">{item.source}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openWorkspaceFile(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    {t("rightRail.preview")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openOutputPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    {t("rightRail.openInSystem")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void revealOutputPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    {t("rightRail.reveal")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    {copiedPath === item.path ? t("rightRail.copied") : t("rightRail.copyPath")}
                  </button>
                  <button
                    type="button"
                    onClick={() => referenceOutputPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    {t("rightRail.quote")}
                  </button>
                </div>
                {fileActionStatus?.path === item.path && (
                  <p
                    className={`m-0 mt-1 text-[10px] leading-4 ${
                      fileActionStatus.tone === "error" ? "text-[var(--color-error)]" : "text-[var(--color-success)]"
                    }`}
                    role={fileActionStatus.tone === "error" ? "alert" : "status"}
                  >
                    {fileActionStatus.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-3 text-xs leading-5 text-[var(--mm-text-secondary)]">
            {t("rightRail.emptyFileOutput")}
          </p>
        )}
      </section>
    </aside>
  );
}
