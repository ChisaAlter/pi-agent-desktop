import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isIpcError, type GitStatus, type ProjectInfo } from "@shared";
import { usePlanStore } from "../../stores/plan-store";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useQueueStore, type QueueTaskStatus } from "../../stores/queue-store";
import { ToolPermissionsPanel } from "../ToolPermissions/ToolPermissionsPanel";
import { UsageStatsPanel } from "../UsageStats/UsageStatsPanel";
import { useAgentStore } from "../../stores/agent-store";
import { classifyTerminalCommand } from "../../utils/terminal-command";
import { projectScriptCommand } from "../../utils/project-scripts";
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

interface RecentToolItem {
  id: string;
  name: string;
  status: string;
  command?: string;
  label: string;
  commandMode?: ReturnType<typeof classifyTerminalCommand>;
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
  if (status === "failed" || status === "error") return "bg-[var(--color-error)] text-white";
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

function toolLabel(name: string, command?: string): string {
  if (name === "bash" || name === "shell" || name === "command") return command || "运行命令";
  if (name === "read") return "读取文件";
  if (name === "write") return "写入文件";
  if (name === "edit") return "编辑文件";
  if (name === "grep") return "搜索内容";
  return name || "工具";
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
      ) : status === "failed" || status === "error" ? (
        <span className="text-[12px] leading-none">!</span>
      ) : null}
    </span>
  );
}

function formatToken(value?: number): string {
  if (value === undefined) return "unknown";
  return value >= 1000 ? `${Math.round(value / 100) / 10}K` : String(value);
}

const THINKING_LEVELS = ["none", "low", "medium", "high"] as const;
const THINKING_LABELS: Record<string, string> = {
  none: "关闭",
  low: "低",
  medium: "中",
  high: "高",
};

function ThinkingControlPanel(): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const runtimeByAgent = useAgentStore((state) => state.runtimeByAgent);
  const currentRuntime = currentAgentId ? runtimeByAgent[currentAgentId] : null;
  const activeLevel = currentRuntime?.thinkingLevel ?? settings.thinkingLevel ?? "medium";
  const showThinking = settings.showThinking ?? true;

  const cycleLevel = useCallback(() => {
    const currentIndex = THINKING_LEVELS.indexOf(activeLevel as typeof THINKING_LEVELS[number]);
    const nextLevel = THINKING_LEVELS[(currentIndex + 1) % THINKING_LEVELS.length];
    updateSettings({ thinkingLevel: nextLevel });
    if (currentAgentId && window.piAPI?.agentsSetThinking) {
      void window.piAPI.agentsSetThinking(currentAgentId, nextLevel).catch(() => {});
    }
  }, [activeLevel, currentAgentId, updateSettings]);

  const toggleShowThinking = useCallback(() => {
    updateSettings({ showThinking: !showThinking });
  }, [showThinking, updateSettings]);

  return (
    <section className="rounded-[14px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-medium">思考</h2>
        <button
          type="button"
          onClick={toggleShowThinking}
          aria-label="切换思考显示"
          aria-pressed={showThinking}
          className={`flex h-5 w-9 items-center rounded-full transition-colors ${showThinking ? "bg-[var(--mm-bg-active)]" : "bg-[var(--mm-bg-sidebar)]"}`}
        >
          <span className={`h-4 w-4 rounded-full bg-white transition-transform ${showThinking ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>
      <button
        type="button"
        onClick={cycleLevel}
        className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
        aria-label="切换思考级别"
      >
        级别: <span className="font-medium text-[var(--mm-text-primary)]">{THINKING_LABELS[activeLevel] ?? activeLevel}</span>
      </button>
    </section>
  );
}

export function RightRail({ workspacePath, workspaceId, tasks = [] }: RightRailProps): React.JSX.Element {
  const [git, setGit] = useState<GitStatus | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [fileActionStatus, setFileActionStatus] = useState<{ path: string; message: string; tone: "success" | "error" } | null>(null);
  const [railActionStatus, setRailActionStatus] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats>({ additions: 0, deletions: 0 });
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const { steps, activeCard } = usePlanStore();
  const settings = useSettingsStore((state) => state.settings);
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
    const load = async (): Promise<void> => {
      if (!disposed) await loadGitSnapshot();
    };
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [loadGitSnapshot, workspacePath]);

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
    currentSession?.lastOutputPaths?.forEach((path) => add(path, "任务输出"));
    currentSession?.messages.forEach((message) => {
      if (message.role === "assistant") {
        extractPathsFromValue(message.content).forEach((path) => add(path, "回复"));
      }
      message.toolCalls?.forEach((toolCall) => {
        extractPathsFromValue(toolCall.output ?? toolCall.result ?? toolCall.input).forEach((path) =>
          add(path, toolCall.name || "工具"),
        );
      });
    });
    if (activeCard?.filename) add(activeCard.filename, "计划");
    changedFiles.slice(0, 8).forEach((item) => add(item.path, "Git 变更"));
    return [...byPath.values()].slice(0, 10);
  }, [activeCard?.filename, changedFiles, currentSession?.lastOutputPaths, currentSession?.messages, workspacePath]);
  const recentTools = useMemo<RecentToolItem[]>(() => {
    const tools: RecentToolItem[] = [];
    currentSession?.messages.forEach((message) => {
      message.toolCalls?.forEach((toolCall) => {
        const command = getCommandText(toolCall.input ?? toolCall.args);
        const name = toolCall.name || "tool";
        tools.push({
          id: `${message.id}:${toolCall.id}`,
          name,
          status: toolCall.status,
          command,
          label: toolLabel(name, command),
          commandMode: command ? classifyTerminalCommand(command) : undefined,
        });
      });
    });
    return tools.slice(-5).reverse();
  }, [currentSession?.messages]);

  const copyPath = async (path: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setFileActionStatus({ path, message: "已复制路径", tone: "success" });
      setTimeout(() => setCopiedPath(null), 1600);
      setTimeout(() => setFileActionStatus(null), 1600);
    } catch (err) {
      setCopiedPath(null);
      setFileActionStatus({ path, message: `复制路径失败: ${err instanceof Error ? err.message : String(err)}`, tone: "error" });
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
      setFileActionStatus({ path, message: `系统打开失败: ${err instanceof Error ? err.message : String(err)}`, tone: "error" });
      return;
    }
    setFileActionStatus({ path, message: "已请求系统打开", tone: "success" });
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
      setFileActionStatus({ path, message: `系统定位失败: ${err instanceof Error ? err.message : String(err)}`, tone: "error" });
      return;
    }
    setFileActionStatus({ path, message: "已请求系统定位", tone: "success" });
    window.setTimeout(() => setFileActionStatus(null), 1800);
  };
  const openWorkspaceFile = (path: string, mode?: "edit" | "diff"): void => {
    const normalized = normalizeOutputPath(path, workspacePath);
    window.dispatchEvent(
      new CustomEvent("workspace:open-file", {
        detail: { path: normalized, mode },
      }),
    );
    setRailActionStatus({ message: `已打开文件 ${basename(normalized)}`, tone: "success" });
    window.setTimeout(() => setRailActionStatus(null), 1800);
  };
  const referenceOutputPath = (path: string): void => {
    const normalized = normalizeOutputPath(path, workspacePath);
    window.dispatchEvent(new CustomEvent("chatpanel:prefill", { detail: { text: `@${normalized} ` } }));
    window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "chat" } }));
    setFileActionStatus({ path: normalized, message: "已引用到聊天", tone: "success" });
    window.setTimeout(() => setFileActionStatus(null), 1800);
  };
  const openGitDiff = (file: string): void => {
    window.dispatchEvent(new CustomEvent("workspace:open-git-diff", { detail: { file } }));
    setRailActionStatus({ message: `已打开 diff ${file}`, tone: "success" });
    window.setTimeout(() => setRailActionStatus(null), 1800);
  };
  const runCommandInTerminal = (command: string): void => {
    const mode = classifyTerminalCommand(command);
    window.dispatchEvent(new CustomEvent("terminal:run-command", {
      detail: { command, mode },
    }));
    setRailActionStatus({
      message: mode === "draft" ? "高风险命令已填入终端，请确认后手动执行" : "已发送命令到终端",
      tone: "success",
    });
    window.setTimeout(() => setRailActionStatus(null), 1800);
  };
  const usage = currentSession?.usage;
  const usedTokens = usage?.totalTokens ?? (
    usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
      ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
      : undefined
  );
  const usagePercent = usage?.contextWindow && usedTokens !== undefined
    ? Math.min(100, Math.round((usedTokens / usage.contextWindow) * 100))
    : undefined;
  const queueItems = useMemo<QueueRailItem[]>(() => {
    const sessionId = currentSession?.id;
    return queue.items.slice(0, 8).map((item) => ({
      id: item.id,
      label: (item.id === "queue:running" || item.id === "queue:auto-retry") && item.status === "running"
        ? currentSession?.title || item.label
        : item.label,
      meta: item.id === "queue:auto-retry" && item.status === "running"
        ? "自动重试"
        : item.id === "queue:running" && item.status === "running"
        ? queue.autoRetrying ? "自动重试" : "当前会话"
        : item.meta,
      status: item.status,
      sessionId,
    }));
  }, [currentSession?.id, currentSession?.title, queue.autoRetrying, queue.items]);
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

  const contextLabel = usagePercent === undefined
    ? "等待用量事件"
    : usagePercent >= 80
      ? "接近上限"
      : usagePercent >= 50
        ? "上下文充足"
        : "上下文健康";

  return (
    <aside className="flex h-full w-full flex-col gap-3 bg-transparent px-4 py-[48px] text-[var(--mm-text-primary)]">
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
      <UsageStatsPanel />
      <section className="rounded-[14px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">运行状态</h2>
          <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
            {usage?.compactionStatus === "running" ? "压缩中" : usage?.compactionStatus ?? "idle"}
          </span>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--mm-text-secondary)]">模型</span>
            <span className="truncate text-right font-mono">{usage?.model || settings.model || "unknown"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--mm-text-secondary)]">Provider</span>
            <span className="truncate text-right font-mono">{usage?.provider || settings.provider || "unknown"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--mm-text-secondary)]">Context</span>
            <span className="font-mono">{formatToken(usedTokens)} / {formatToken(usage?.contextWindow)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mm-bg-hover)]">
            <div
              className={`h-full rounded-full ${usagePercent !== undefined && usagePercent >= 80 ? "bg-[var(--color-error)]" : "bg-[#1f1f1f]"}`}
              style={{ width: `${usagePercent ?? 0}%` }}
            />
          </div>
          <div className="flex justify-between gap-3 text-[11px] text-[var(--mm-text-tertiary)]">
            <span>{contextLabel}</span>
            <span>{usagePercent === undefined ? "-" : `${usagePercent}%`}</span>
          </div>
          <div className="flex justify-between gap-3 text-[11px] text-[var(--mm-text-tertiary)]">
            <span>输入 {formatToken(usage?.inputTokens)}</span>
            <span>输出 {formatToken(usage?.outputTokens)}</span>
            <span>费用 {usage?.estimatedCostUsd === undefined ? "unknown" : `$${usage.estimatedCostUsd.toFixed(4)}`}</span>
          </div>
        </div>
      </section>

      <ToolPermissionsPanel workspaceId={workspaceId} />

      <ThinkingControlPanel />

      <section className="rounded-[14px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">环境信息</h2>
        </div>
        <p className="mb-3 truncate font-mono text-[11px] leading-none text-[var(--mm-text-tertiary)]">
          {git?.branch ?? "无 Git"}
        </p>
        <div className="space-y-3 text-xs">
          <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-2">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 truncate font-medium" title={project?.name ?? workspacePath}>
                {project?.name ?? "未知项目"}
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
                  <span>包管理器</span>
                  <span className="font-mono">{project?.packageManager ?? "-"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>配置文件</span>
                  <span className="max-w-[150px] truncate text-right font-mono" title={project?.configFiles.join(", ")}>
                    {project?.configFiles.length ? project.configFiles.slice(0, 3).join(", ") : "-"}
                  </span>
                </div>
                {project?.scripts && Object.keys(project.scripts).length > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between gap-3">
                      <span>脚本</span>
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
                          title={`在终端运行 ${script.command}`}
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
              <span>变更</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
              <span className="text-[var(--color-success)]">+{diffStats.additions}</span>
              <span className="text-[#dc2626]">-{diffStats.deletions}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <RowIcon>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 12h13m0 0-4-4m4 4-4 4" />
                </svg>
              </RowIcon>
              <span>提交或推送</span>
            </div>
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
            <span>项目文件</span>
            <span className="ml-auto text-[11px] text-[var(--mm-text-tertiary)]">{changeCount}</span>
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
                    title={`在文件工作区打开 ${item.path}`}
                  >
                    {item.path}
                  </button>
                  <button
                    type="button"
                    onClick={() => openGitDiff(item.path)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                    title={`查看 ${item.path} 的 Git diff`}
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
                  {filesExpanded ? "收起文件" : `展开其余 ${hiddenChangedCount} 个文件`}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0 rounded-[14px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">进度</h2>
          <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
            {taskFlowItems.length > 0 ? `${taskFlowItems.length} 项` : "idle"}
          </span>
        </div>
        {queue.lastError && (
          <div className="mb-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs leading-5 text-[var(--color-error)]" role="alert">
            {queue.lastError}
          </div>
        )}
        {!queue.lastError && queue.lastCompletedAt && (
          <div className="mb-3 rounded-lg border border-[#dcfce7] bg-[#f0fdf4] px-3 py-2 text-xs leading-5 text-[var(--color-success)]" role="status">
            最近任务已完成
          </div>
        )}
        {queue.lastActivity && (
          <div className="mb-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs leading-5 text-[var(--mm-text-secondary)]" role="status">
            {queue.lastActivity}
          </div>
        )}

        {taskFlowItems.length > 0 && (
          <div className="mb-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-2">
            <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--mm-text-tertiary)]">
              <span>运行队列</span>
              <span>{queue.autoRetrying ? "自动重试" : queue.running ? "运行中" : "排队"}</span>
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
            开始对话或执行工具后，这里会显示计划步骤、工具调用和长任务进度。
          </p>
        )}
      </section>

      <section className="min-h-0 rounded-[14px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">最近工具</h2>
          <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
            {recentTools.length}
          </span>
        </div>
        {recentTools.length > 0 ? (
          <ul className="m-0 max-h-[180px] list-none space-y-1.5 overflow-y-auto p-0">
            {recentTools.map((item) => (
              <li key={item.id} className="rounded-lg border border-[var(--mm-border)] px-2.5 py-2">
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <ProgressStatusIcon status={item.status} />
                  <span className="min-w-0 flex-1 truncate text-xs" title={item.label}>
                    {item.label}
                  </span>
                </div>
                {item.command && (
                  <div className="flex items-center gap-1">
                    <code className="min-w-0 flex-1 truncate rounded bg-[var(--mm-bg-panel)] px-1.5 py-1 font-mono text-[10px] text-[var(--mm-text-secondary)]">
                      {item.command}
                    </code>
                    <button
                      type="button"
                      onClick={() => runCommandInTerminal(item.command!)}
                      className={`shrink-0 rounded px-1.5 py-1 text-[11px] hover:bg-[var(--mm-bg-sidebar)] ${
                        item.commandMode === "draft" ? "text-amber-700" : "text-[var(--mm-text-secondary)]"
                      }`}
                      title={item.commandMode === "draft" ? "高风险命令只填入终端，不自动执行" : "在终端中执行此命令"}
                    >
                      {item.commandMode === "draft" ? "填入" : "复跑"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-3 text-xs leading-5 text-[var(--mm-text-secondary)]">
            Pi 调用工具后，这里会保留最近的命令和文件操作，方便复跑或回看。
          </p>
        )}
      </section>

      <section className="min-h-0 rounded-[14px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">文件输出</h2>
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
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => void openOutputPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    系统打开
                  </button>
                  <button
                    type="button"
                    onClick={() => void revealOutputPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    定位
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    {copiedPath === item.path ? "已复制" : "复制路径"}
                  </button>
                  <button
                    type="button"
                    onClick={() => referenceOutputPath(item.path)}
                    className="rounded px-1.5 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                  >
                    引用
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
            本轮生成、修改或引用的文件会在这里汇总，方便打开、定位和复制路径。
          </p>
        )}
      </section>
    </aside>
  );
}
