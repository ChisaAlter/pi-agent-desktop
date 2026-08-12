import React from "react";
import { useI18n } from "../../i18n";
import type { FleetBlockedReason, FleetAgentStatus } from "../../hooks/useAgentFleet";

/**
 * herdr-style lifecycle badge: working / blocked / done / idle / error / closed.
 * Blocked additionally shows the concrete suspension reason (permission / plan
 * / queue) — the GUI's answer to herdr's strict "blocked" semantics.
 */

const STATUS_LABEL_KEYS: Record<FleetAgentStatus, string> = {
    working: "agents.status.working",
    blocked: "agents.status.blocked",
    done: "agents.status.done",
    idle: "agents.status.idle",
    error: "agents.status.error",
    closed: "agents.status.closed",
};

const BLOCKED_REASON_KEYS: Record<FleetBlockedReason, string> = {
    permission: "agents.blockedReason.permission",
    plan: "agents.blockedReason.plan",
    approval: "agents.blockedReason.approval",
    queue: "agents.blockedReason.queue",
};

export function AgentStatusBadge({
    status,
    blockedReason,
}: {
    status: FleetAgentStatus;
    blockedReason?: FleetBlockedReason | null;
}): React.JSX.Element {
    const { t } = useI18n();
    const label = t(STATUS_LABEL_KEYS[status]);

    let dot: React.ReactNode = null;
    let className = "border border-[var(--mm-border)] bg-[var(--mm-bg-hover)] text-[var(--mm-text-tertiary)]";
    if (status === "working") {
        className = "bg-[var(--mm-accent-blue)]/10 text-[var(--mm-accent-blue)]";
        dot = <span className="pi-motion-running-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />;
    } else if (status === "blocked") {
        className = "bg-[var(--color-error)]/10 text-[var(--color-error)]";
        dot = (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-error)] text-[9px] font-bold leading-none text-white" aria-hidden="true">
                !
            </span>
        );
    } else if (status === "done") {
        className = "bg-[var(--color-success)]/10 text-[var(--color-success)]";
        dot = (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.5 8.5 6.5 11.5 12.5 4.5" />
            </svg>
        );
    } else if (status === "error") {
        className = "bg-[var(--color-error)] text-white";
        dot = (
            <span className="text-[10px] font-bold leading-none" aria-hidden="true">!</span>
        );
    }

    const title = status === "blocked" && blockedReason ? t(BLOCKED_REASON_KEYS[blockedReason]) : undefined;

    return (
        <span
            className={`inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 ${className}`}
            title={title}
            role="status"
            data-agent-status={status}
        >
            {dot}
            <span className="whitespace-nowrap">{label}</span>
        </span>
    );
}
