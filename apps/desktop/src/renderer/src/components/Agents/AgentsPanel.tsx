import React from "react";
import { useI18n } from "../../i18n";
import { useHerdrStore, rollupState } from "../../stores/herdr-store";
import { AgentCard } from "./AgentCard";

/**
 * AgentsPanel — Herdr 舰队视图（UI-REQ-020），与已批准原型 1:1：
 * 按 workspace 分组（宽屏多列 grid auto-fit 290px / 窄屏单列），
 * 工作区标题行 = 图标 + 名称 + 计数摘要；worktree 显示分支。
 * 数据源 = herdr-store（Phase 1 mock / Phase 4 真实 snapshot+seq）。
 */

export function AgentsPanel(): React.JSX.Element {
    const { t } = useI18n();
    const mock = useHerdrStore((s) => s.mock);
    const tree = useHerdrStore((s) => s.tree);
    const server = useHerdrStore((s) => s.server);
    const selectedAgent = useHerdrStore((s) => s.selectedAgent);
    const selectAgent = useHerdrStore((s) => s.selectAgent);

    if (!mock || tree.workspaces.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center" data-testid="agents-panel">
                <p className="m-0 text-[13px] text-[var(--mm-text-secondary)]">{t("herdr.card.empty")}</p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="agents-panel">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                {tree.workspaces.map((workspace) => {
                    const panes = workspace.tabs.flatMap((tab) => tab.panes);
                    const rollup = rollupState(panes, server);
                    const isWorktree = workspace.kind === "worktree";
                    return (
                        <section key={workspace.id} data-testid="fleet-workspace-group" data-workspace={workspace.id} data-rollup={rollup}>
                            <header className="mx-0.5 mb-2 mt-3 flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-[13px] text-[var(--mm-text-secondary)]" aria-hidden="true">
                                    ◇
                                </span>
                                <h3 className="m-0 min-w-0 truncate text-[14px] font-semibold text-[var(--mm-text-primary)]">{workspace.name}</h3>
                                <span className="ml-auto shrink-0 text-[11px] text-[var(--mm-text-tertiary)]">
                                    {isWorktree
                                        ? t("herdr.fleet.branch", { branch: `herdr/${panes[0]?.name ?? ""}` })
                                        : t("herdr.fleet.agentCount", {
                                              count: panes.length,
                                              tabs: workspace.tabs.length,
                                              repo: tree.session,
                                          })}
                                </span>
                            </header>
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(290px,1fr))] gap-[10px]">
                                {panes.map((agent) => (
                                    <AgentCard
                                        key={agent.name}
                                        agent={agent}
                                        selected={selectedAgent === agent.name}
                                        onSelect={() => selectAgent(agent.name)}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
