import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n, i18n } from "../../i18n";
import { useAgentStore } from "../../stores/agent-store";
import { useSubagentStore } from "../../stores/subagent-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { addToast } from "../../stores/toast-store";
import { useAgentFleet, FLEET_STATUSES } from "../../hooks/useAgentFleet";
import { AgentCard } from "./AgentCard";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { NewAgentDialog } from "./NewAgentDialog";

/**
 * AgentsPanel — the GUI fleet view (herdr's status sidebar, upgraded):
 * a rollup bar on top, agents grouped by workspace with workspace-level status
 * rollup, and per-agent cards exposing lifecycle, live activity, subagents and
 * the recent message stream.
 */
export function AgentsPanel({
    onOpenAgent,
}: {
    onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
    const { t } = useI18n();
    const { groups, counts, total } = useAgentFleet();
    const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
    const createAgent = useAgentStore((state) => state.createAgent);
    const stopAgent = useAgentStore((state) => state.stopAgent);
    const restartAgent = useAgentStore((state) => state.restartAgent);
    const setCurrentAgent = useAgentStore((state) => state.setCurrentAgent);
    const sendPrompt = useAgentStore((state) => state.sendPrompt);
    const refreshSubagents = useSubagentStore((state) => state.refreshAgent);
    const [dialogOpen, setDialogOpen] = useState(false);

    // 挂载时预拉一次每个 agent 的 subagent 快照 (此后由 subagent:event 驱动),
    // 避免面板首次打开时子代理列表为空直到下一次事件。
    const fetchedSubagentsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const agent of useAgentStore.getState().agents) {
            if (fetchedSubagentsRef.current.has(agent.id)) continue;
            fetchedSubagentsRef.current.add(agent.id);
            void refreshSubagents(agent.id);
        }
    }, [refreshSubagents]);

    const handleCreate = useCallback(
        async ({ workspaceId, title, description }: { workspaceId: string; title: string; description: string }) => {
            try {
                const agent = await createAgent(workspaceId, title || undefined);
                setCurrentAgent(agent.id);
                if (description) {
                    await sendPrompt(description);
                }
                addToast(i18n.t("agents.created"), "success");
                setDialogOpen(false);
            } catch (error) {
                addToast(error instanceof Error ? error.message : String(error), "error");
            }
        },
        [createAgent, setCurrentAgent, sendPrompt],
    );

    const handleStop = useCallback(
        async (agentId: string) => {
            try {
                await stopAgent(agentId);
            } catch (error) {
                addToast(error instanceof Error ? error.message : String(error), "error");
            }
        },
        [stopAgent],
    );

    const handleRestart = useCallback(
        async (agentId: string) => {
            try {
                await restartAgent(agentId);
            } catch (error) {
                addToast(error instanceof Error ? error.message : String(error), "error");
            }
        },
        [restartAgent],
    );

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="agents-panel">
            {/* Rollup bar — fleet-wide counts + new agent entry.
                pl-12 给左上「折叠左侧栏」浮层按钮预留空间 (与 chat/workbench/run
                header 的 pl-12 惯例一致), 否则按钮会盖住第一个 chip. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 pr-4 pb-3 pt-1">
                {FLEET_STATUSES.map((status) =>
                    counts[status] > 0 ? (
                        <span
                            key={status}
                            className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[11px] leading-4 text-[var(--mm-text-secondary)]"
                            data-testid={`fleet-count-${status}`}
                        >
                            {t(`agents.status.${status}`)} · {counts[status]}
                        </span>
                    ) : null,
                )}
                {total === 0 ? (
                    <span className="text-xs text-[var(--mm-text-tertiary)]">{t("agents.empty")}</span>
                ) : null}
                <button
                    type="button"
                    onClick={() => setDialogOpen(true)}
                    className="ml-auto rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-1.5 text-[13px] text-[var(--mm-text-primary)] transition-colors hover:border-[var(--mm-accent-blue)] hover:text-[var(--mm-accent-blue)]"
                    data-testid="new-agent-button"
                >
                    {t("agents.new")}
                </button>
            </div>

            {/* Workspace-grouped fleet */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                {groups.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <p className="m-0 text-[13px] text-[var(--mm-text-secondary)]">{t("agents.emptyTitle")}</p>
                        <p className="m-0 max-w-[420px] text-xs leading-5 text-[var(--mm-text-tertiary)]">
                            {t("agents.emptyHint")}
                        </p>
                        <button
                            type="button"
                            onClick={() => setDialogOpen(true)}
                            className="rounded-md bg-[var(--mm-accent-blue)] px-4 py-2 text-[13px] text-white transition-opacity hover:opacity-90"
                        >
                            {t("agents.new")}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {groups.map((group) => {
                            const isCurrent = group.workspaceId === currentWorkspaceId;
                            return (
                                <section key={group.workspaceId} data-testid="fleet-workspace-group" data-workspace-id={group.workspaceId}>
                                    <header className="mb-2 flex min-w-0 items-center gap-2">
                                        <AgentStatusBadge status={group.status} />
                                        <h3 className="m-0 min-w-0 truncate text-[13px] font-medium text-[var(--mm-text-primary)]">
                                            {group.workspaceName}
                                        </h3>
                                        {isCurrent ? (
                                            <span className="shrink-0 rounded-full bg-[var(--mm-accent-blue)]/10 px-2 py-0.5 text-[10px] text-[var(--mm-accent-blue)]">
                                                {t("agents.currentWorkspace")}
                                            </span>
                                        ) : null}
                                        <span className="ml-auto shrink-0 text-[11px] text-[var(--mm-text-tertiary)]">
                                            {t("agents.workspaceCount", { count: group.agents.length })}
                                        </span>
                                    </header>
                                    <div className="space-y-2">
                                        {group.agents.map((fleetAgent) => (
                                            <AgentCard
                                                key={fleetAgent.agent.id}
                                                fleetAgent={fleetAgent}
                                                workspaceName={group.workspaceName}
                                                onOpenChat={onOpenAgent}
                                                onStop={(agentId) => void handleStop(agentId)}
                                                onRestart={(agentId) => void handleRestart(agentId)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>

            <NewAgentDialog
                open={dialogOpen}
                defaultWorkspaceId={currentWorkspaceId ?? undefined}
                onClose={() => setDialogOpen(false)}
                onCreate={(input) => void handleCreate(input)}
            />
        </div>
    );
}
