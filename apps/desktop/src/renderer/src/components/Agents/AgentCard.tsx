import React, { useEffect, useMemo, useState } from "react";
import type { AgentMessage, SubagentInstance } from "@shared";
import { useI18n } from "../../i18n";
import { useAgentStore } from "../../stores/agent-store";
import { useSubagentStore } from "../../stores/subagent-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { isIpcError } from "@shared";
import type { FleetAgent } from "../../hooks/useAgentFleet";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { MarkdownRenderer } from "../ChatView/MarkdownRenderer";
import { readCachedGitSnapshot } from "../../utils/git-snapshot-cache";

/**
 * Agent card — one fleet member. Header shows the lifecycle badge + identity,
 * the activity line shows the live summary (or the blocked reason), and the
 * expandable body shows the full message stream rendered through the shared
 * markdown pipeline, subagent panes, and — for finished agents — a harvest
 * section (output + file changes).
 */

const MAX_STREAM_MESSAGES = 40;

function formatMetaTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return sameDay ? time : `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${time}`;
}

function formatTokens(count?: number): string {
    if (!count || count <= 0) return "";
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
}

const SUBAGENT_STATUS_STYLE: Record<SubagentInstance["status"], string> = {
    pending: "bg-[var(--mm-bg-hover)] text-[var(--mm-text-tertiary)]",
    running: "bg-[var(--mm-accent-blue)]/10 text-[var(--mm-accent-blue)]",
    idle: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
    cancelled: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
    failed: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
    timeout: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
};

function SubagentRow({
    instance,
    agentId,
    onCancel,
}: {
    instance: SubagentInstance;
    agentId: string;
    onCancel: (agentId: string, actorId: string) => void;
}): React.JSX.Element {
    const { t } = useI18n();
    const terminal = instance.status === "idle" || instance.status === "cancelled" || instance.status === "failed" || instance.status === "timeout";
    const outcomeText =
        instance.status === "idle"
            ? instance.lastOutcome === "success"
                ? "✓"
                : (instance.lastOutcome ?? "").slice(0, 60)
            : instance.lastOutcome?.slice(0, 60) ?? "";
    return (
        <li className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${instance.status === "running" ? "pi-motion-running-dot bg-[var(--mm-accent-blue)]" : "bg-[var(--mm-text-tertiary)]"}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs" title={instance.description}>
                {instance.description}
            </span>
            {terminal && outcomeText ? (
                <span className="min-w-0 max-w-[200px] shrink truncate text-[10px] text-[var(--mm-text-tertiary)]" title={outcomeText}>
                    {t("agents.subagents.outcome")}: {outcomeText}
                </span>
            ) : null}
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-3 ${SUBAGENT_STATUS_STYLE[instance.status]}`}>
                {t(`agents.subagentStatus.${instance.status}`)}
            </span>
            {!terminal ? (
                <button
                    type="button"
                    onClick={() => onCancel(agentId, instance.actorId)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--color-error)]"
                >
                    {t("agents.actions.cancel")}
                </button>
            ) : null}
        </li>
    );
}

/** 消息行 — assistant 走共享 Markdown 管线 (代码块/表格/公式), 其余精简. */
function MessageLine({ message }: { message: AgentMessage }): React.JSX.Element {
    const { t } = useI18n();
    // 流式期间让 MarkdownRenderer 的 100ms 节流生效 (避免每次 delta 全量解析)
    const isStreaming = useAgentStore((state) => state.runtimeByAgent[message.agentId]?.isStreaming ?? false);
    if (message.role === "tool") {
        return (
            <div className="flex min-w-0 items-start gap-2 text-xs text-[var(--mm-text-tertiary)]">
                <span className="shrink-0 rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 font-mono text-[10px]">
                    {t("agents.message.tool")}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{truncate(message.content, 200)}</span>
            </div>
        );
    }
    const label = message.role === "user" ? t("agents.message.user") : message.role === "assistant" ? t("agents.message.assistant") : message.role;
    if (message.role === "assistant") {
        return (
            <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-[var(--mm-accent-blue)]/10 px-1.5 py-0.5 text-[10px] text-[var(--mm-accent-blue)]">{label}</span>
                    {message.thinking ? (
                        <details className="text-[10px] text-[var(--mm-text-tertiary)]">
                            <summary className="cursor-pointer select-none">{t("agents.message.thinking")}</summary>
                            <p className="m-0 mt-1 whitespace-pre-wrap text-[11px] leading-5">{message.thinking}</p>
                        </details>
                    ) : null}
                </div>
                {message.content ? (
                    <div className="text-[13px] leading-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[var(--mm-bg-sidebar)] [&_pre]:p-2 [&_pre]:text-[12px]">
                        <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
                    </div>
                ) : null}
            </div>
        );
    }
    return (
        <div className="flex min-w-0 items-start gap-2 text-xs">
            <span className="shrink-0 rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-secondary)]">{label}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[var(--mm-text-primary)]">
                {message.content || (message.thinking ? t("agents.message.thinkingOnly") : t("agents.message.empty"))}
            </span>
        </div>
    );
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
}

const CHANGE_MARK: Record<string, { mark: string; className: string }> = {
    modified: { mark: "M", className: "text-[var(--color-info)]" },
    added: { mark: "A", className: "text-[var(--color-success)]" },
    deleted: { mark: "D", className: "text-[#dc2626]" },
    renamed: { mark: "R", className: "text-[var(--color-info)]" },
    untracked: { mark: "?", className: "text-[var(--mm-text-tertiary)]" },
};

/** 本地文件行类型 — git 缓存含 untracked, IPC 返回不含, 统一为宽松 status. */
interface HarvestFile {
    path: string;
    status: string;
}

/** 收割结果 — 产出 (最后一条 assistant 全文) + 文件改动预览 (共享 git 缓存). */
function HarvestSection({ fleetAgent }: { fleetAgent: FleetAgent }): React.JSX.Element {
    const { t } = useI18n();
    const [changedFiles, setChangedFiles] = useState<HarvestFile[] | null>(null);
    const [detecting, setDetecting] = useState(false);
    const messages = useAgentStore((state) => state.messagesByAgent[fleetAgent.agent.id]);
    const workspacePath = useWorkspaceStore(
        (state) => state.workspaces.find((item) => item.id === fleetAgent.agent.workspaceId)?.path,
    );

    const output = useMemo(() => {
        const list = messages ?? [];
        for (let i = list.length - 1; i >= 0; i--) {
            const message = list[i];
            if (message.role === "assistant" && message.content.trim()) return message;
        }
        return null;
    }, [messages]);

    // 改动列表: 优先读 RightRail 共享缓存, 未命中再拉 IPC (gitChangedFiles 按 path).
    useEffect(() => {
        let disposed = false;
        void (async () => {
            if (!window.piAPI?.gitChangedFiles || !workspacePath) return;
            const cached = readCachedGitSnapshot(workspacePath);
            if (cached?.git) {
                setChangedFiles([
                    ...cached.git.modified.map((path) => ({ path, status: "modified" as const })),
                    ...cached.git.added.map((path) => ({ path, status: "added" as const })),
                    ...cached.git.deleted.map((path) => ({ path, status: "deleted" as const })),
                    ...cached.git.untracked.map((path) => ({ path, status: "untracked" as const })),
                ]);
                return;
            }
            setDetecting(true);
            try {
                const result = await window.piAPI.gitChangedFiles(workspacePath);
                if (!disposed && !isIpcError(result)) setChangedFiles(result);
            } catch {
                // 静默 — 无 git 或非 git workspace
            } finally {
                if (!disposed) setDetecting(false);
            }
        })();
        return () => {
            disposed = true;
        };
    }, [workspacePath]);

    return (
        <div className="space-y-2" data-testid="agent-harvest">
            {output ? (
                <div>
                    <h4 className="mb-1.5 text-[11px] font-medium text-[var(--mm-text-tertiary)]">{t("agents.harvest.title")}</h4>
                    <div className="rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-2 text-[13px] leading-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[var(--mm-bg-sidebar)] [&_pre]:p-2 [&_pre]:text-[12px]">
                        <MarkdownRenderer content={output.content} />
                    </div>
                </div>
            ) : null}
            <div>
                <h4 className="mb-1.5 text-[11px] font-medium text-[var(--mm-text-tertiary)]">{t("agents.harvest.changes")}</h4>
                {detecting ? (
                    <p className="m-0 text-xs text-[var(--mm-text-tertiary)]">{t("agents.harvest.detecting")}</p>
                ) : changedFiles && changedFiles.length > 0 ? (
                    <ul className="m-0 max-h-[160px] list-none space-y-0.5 overflow-y-auto p-0">
                        {changedFiles.map((file) => {
                            const style = CHANGE_MARK[file.status] ?? CHANGE_MARK.untracked;
                            // 显示文件名, 完整路径放 title (绝对路径过长会被截断)
                            const display = file.path.split(/[\\/]/).pop() ?? file.path;
                            return (
                                <li key={`${file.status}-${file.path}`} className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
                                    <span className={`w-4 shrink-0 ${style.className}`}>{style.mark}</span>
                                    <span className="min-w-0 truncate text-[var(--mm-text-secondary)]" title={file.path}>{display}</span>
                                </li>
                            );
                        })}
                    </ul>
                ) : changedFiles ? (
                    <p className="m-0 text-xs text-[var(--mm-text-tertiary)]">{t("agents.harvest.noChanges")}</p>
                ) : null}
            </div>
        </div>
    );
}

export function AgentCard({
    fleetAgent,
    workspaceName,
    onOpenChat,
    onStop,
    onRestart,
}: {
    fleetAgent: FleetAgent;
    workspaceName: string;
    onOpenChat: (agentId: string) => void;
    onStop: (agentId: string) => void;
    onRestart: (agentId: string) => void;
}): React.JSX.Element {
    const { t } = useI18n();
    const [expanded, setExpanded] = useState(false);
    const { agent, status, blockedReason, summary, toolCall, runtime, subagents } = fleetAgent;
    const messages = useAgentStore((state) => state.messagesByAgent[agent.id]);
    const cancelSubagent = useSubagentStore((state) => state.cancelActor);

    const streamMessages = useMemo(() => (messages ?? []).slice(-MAX_STREAM_MESSAGES), [messages]);
    const modelName = runtime?.modelName ?? runtime?.modelId ?? runtime?.modelProvider;
    const tokens = formatTokens(runtime?.tokenUsage?.total);

    const activityLine = blockedReason
        ? t(`agents.blockedReason.${blockedReason}`)
        : summary || toolCall || t("agents.activity.idle");

    return (
        <article
            className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]"
            data-testid="agent-card"
            data-agent-id={agent.id}
            data-agent-status={status}
        >
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full min-w-0 items-start gap-3 px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-accent-blue)]"
                aria-expanded={expanded}
            >
                <AgentStatusBadge status={status} blockedReason={blockedReason} />
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 truncate text-[13px] font-medium text-[var(--mm-text-primary)]">
                            {agent.title || t("agents.untitled")}
                        </span>
                        <span className="shrink-0 truncate text-[11px] text-[var(--mm-text-tertiary)]">{workspaceName}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--mm-text-secondary)]" data-testid="agent-activity">
                        {activityLine}
                    </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-[10px] leading-3 text-[var(--mm-text-tertiary)]">
                    {modelName ? <span className="max-w-[160px] truncate">{modelName}</span> : null}
                    {tokens ? <span className="font-mono">{tokens} tok</span> : null}
                    <span>{formatMetaTime(agent.updatedAt ?? agent.createdAt)}</span>
                </span>
            </button>

            <div className="flex items-center gap-1 border-t border-[var(--mm-border)] px-3 py-1.5">
                <button
                    type="button"
                    onClick={() => onOpenChat(agent.id)}
                    className="rounded px-2 py-1 text-xs text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                >
                    {t("agents.actions.openChat")}
                </button>
                <button
                    type="button"
                    onClick={() => onStop(agent.id)}
                    className="rounded px-2 py-1 text-xs text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--color-error)]"
                >
                    {t("agents.actions.stop")}
                </button>
                <button
                    type="button"
                    onClick={() => onRestart(agent.id)}
                    className="rounded px-2 py-1 text-xs text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                >
                    {t("agents.actions.restart")}
                </button>
                {status === "done" ? (
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="rounded px-2 py-1 text-xs text-[var(--mm-accent-blue)] transition-colors hover:bg-[var(--mm-accent-blue)]/10"
                        data-testid="harvest-button"
                    >
                        {t("agents.actions.harvest")}
                    </button>
                ) : null}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--mm-text-tertiary)]">
                    {subagents.length > 0 ? `${subagents.length} ${t("agents.subagents.label")}` : null}
                    {subagents.length > 0 && (messages?.length ?? 0) > 0 ? "·" : null}
                    {(messages?.length ?? 0) > 0 ? `${messages.length} ${t("agents.message.count")}` : null}
                    <svg
                        className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 16 16" stroke="currentColor" aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6l4 4 4-4" />
                    </svg>
                </span>
            </div>

            {expanded ? (
                <div className="space-y-2 border-t border-[var(--mm-border)] px-3 py-2.5" data-testid="agent-card-expanded">
                    {status === "done" ? <HarvestSection fleetAgent={fleetAgent} /> : null}
                    <div>
                        <h4 className="mb-1.5 text-[11px] font-medium text-[var(--mm-text-tertiary)]">
                            {t("agents.subagents.title")}
                        </h4>
                        {subagents.length > 0 ? (
                            <ul className="space-y-1">
                                {subagents.map((instance) => (
                                    <SubagentRow key={instance.actorId} instance={instance} agentId={agent.id} onCancel={(a, c) => void cancelSubagent(a, c)} />
                                ))}
                            </ul>
                        ) : (
                            <p className="m-0 text-xs text-[var(--mm-text-tertiary)]">{t("agents.subagents.none")}</p>
                        )}
                    </div>
                    <div>
                        <h4 className="mb-1.5 text-[11px] font-medium text-[var(--mm-text-tertiary)]">
                            {t("agents.message.recent")}
                        </h4>
                        {streamMessages.length > 0 ? (
                            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                                {streamMessages.map((message) => (
                                    <MessageLine key={message.id} message={message} />
                                ))}
                            </div>
                        ) : (
                            <p className="m-0 text-xs text-[var(--mm-text-tertiary)]">{t("agents.message.none")}</p>
                        )}
                    </div>
                </div>
            ) : null}
        </article>
    );
}
