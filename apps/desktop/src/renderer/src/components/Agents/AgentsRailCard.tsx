import React from "react";
import { useI18n } from "../../i18n";
import { useAgentFleet } from "../../hooks/useAgentFleet";
import { AgentStatusBadge } from "./AgentStatusBadge";

/**
 * Compact agents rollup card for the chat right rail: for the current
 * workspace, show working/blocked/done counts and jump to the fleet view.
 */
export function AgentsRailCard({ workspaceId }: { workspaceId?: string }): React.JSX.Element | null {
    const { t } = useI18n();
    const { groups } = useAgentFleet();
    if (!workspaceId) return null;

    const group = groups.find((item) => item.workspaceId === workspaceId);
    const counts = group?.counts;
    const hasAny = group && group.agents.length > 0;
    const visible = (["working", "blocked", "done"] as const).filter((status) => (counts?.[status] ?? 0) > 0);

    const openFleet = (): void => {
        window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "agents" } }));
    };

    return (
        <div data-testid="right-rail-agents-summary">
            {!hasAny ? (
                <p className="m-0 px-1.5 pb-1 text-xs text-[var(--mm-text-tertiary)]">{t("rightRail.agentsEmpty")}</p>
            ) : visible.length === 0 ? (
                <p className="m-0 px-1.5 pb-1 text-xs text-[var(--mm-text-tertiary)]">{t("rightRail.agentsIdle")}</p>
            ) : (
                <div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-1">
                    {visible.map((status) => (
                        <button
                            key={status}
                            type="button"
                            onClick={openFleet}
                            className="flex items-center gap-1 rounded-full bg-[var(--mm-bg-sidebar)] px-1.5 py-0.5 transition-colors hover:bg-[var(--mm-bg-hover)]"
                            title={t("rightRail.agentsOpenFleet")}
                        >
                            <AgentStatusBadge status={status} />
                            <span className="text-[12px] leading-4 text-[var(--mm-text-secondary)]">{counts?.[status] ?? 0}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
