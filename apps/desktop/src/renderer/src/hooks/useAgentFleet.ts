import { useMemo } from "react";
import type { AgentMessage, AgentRuntimeState, AgentTab, SubagentInstance } from "@shared";
import { useAgentStore } from "../stores/agent-store";
import { useSubagentStore } from "../stores/subagent-store";
import { usePermissionStore } from "../stores/permission-store";
import { usePlanStore } from "../stores/plan-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useFleetSignalsStore } from "../stores/fleet-signals-store";

/**
 * Agent fleet model — the GUI equivalent of herdr's working/blocked/done
 * lifecycle sidebar. Composes the runtime signals already flowing through the
 * renderer stores (agents, subagents, permission, plan, fleet-signals) into a
 * herdr-style per-agent status + workspace rollup.
 *
 * Status semantics (strict, aligned with herdr: only REAL suspension counts):
 *  - blocked: a permission/plan/approval prompt is awaiting the user, or the
 *    agent has queued steering/followUp messages it cannot process yet.
 *  - working: streaming or in a running turn (starting counts).
 *  - done: idle with at least one finished assistant output.
 *  - idle: idle with nothing produced yet.
 *  - error / closed: surfaced from AgentTab.status.
 *
 * Suspension signals (queue / approval) live in fleet-signals-store with a
 * single app-wide subscription, so the panel and the right-rail card share
 * state and nothing is lost on unmount.
 */

export type FleetAgentStatus = "working" | "blocked" | "done" | "idle" | "error" | "closed";

export type FleetBlockedReason = "permission" | "plan" | "approval" | "queue";

export interface FleetBlockedSignals {
    pendingPermission: boolean;
    pendingPlan: boolean;
    pendingApproval: boolean;
    queueBlocked: boolean;
}

export interface FleetAgent {
    agent: AgentTab;
    runtime: AgentRuntimeState | undefined;
    status: FleetAgentStatus;
    blockedReason: FleetBlockedReason | null;
    summary: string;
    toolCall: string | null;
    messageCount: number;
    hasAssistantOutput: boolean;
    subagents: SubagentInstance[];
}

export interface FleetWorkspaceGroup {
    workspaceId: string;
    workspaceName: string;
    status: FleetAgentStatus;
    counts: Record<FleetAgentStatus, number>;
    agents: FleetAgent[];
}

export interface FleetCounts {
    working: number;
    blocked: number;
    done: number;
    idle: number;
    error: number;
    closed: number;
}

export const FLEET_STATUSES: FleetAgentStatus[] = ["working", "blocked", "done", "idle", "error", "closed"];

/** Lower = worse (rollup takes the worst status in a group). */
const STATUS_PRIORITY: Record<FleetAgentStatus, number> = {
    error: 0,
    blocked: 1,
    working: 2,
    done: 3,
    idle: 4,
    closed: 5,
};

export function emptyFleetCounts(): FleetCounts {
    return { working: 0, blocked: 0, done: 0, idle: 0, error: 0, closed: 0 };
}

/**
 * Pure status synthesis — the signal source is separated so this stays
 * unit-testable without any store wiring.
 */
export function computeFleetStatus(
    agent: AgentTab,
    runtime: AgentRuntimeState | undefined,
    signals: FleetBlockedSignals,
): FleetAgentStatus {
    if (agent.status === "closed") return "closed";
    if (agent.status === "error") return "error";
    // Strict blocked: real suspension beats "working" because a streaming
    // agent parked on a prompt still shows isStreaming=true.
    if (signals.pendingPermission || signals.pendingPlan || signals.pendingApproval || signals.queueBlocked) {
        return "blocked";
    }
    if (agent.status === "running" || agent.status === "starting") return "working";
    if (runtime?.isStreaming || runtime?.status === "running") return "working";
    return "idle";
}

export interface FleetMessageSummary {
    summary: string;
    toolCall: string | null;
    messageCount: number;
    hasAssistantOutput: boolean;
}

const SUMMARY_MAX_LENGTH = 140;

/** Extract the "activity line" of an agent from its message list. */
export function extractFleetSummary(messages: AgentMessage[]): FleetMessageSummary {
    const last = messages[messages.length - 1];
    const hasAssistantOutput = messages.some((m) => m.role === "assistant" && m.content.trim().length > 0);

    // Latest assistant text (truncated) is the activity summary.
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === "assistant" && message.content.trim()) {
            return {
                summary: truncateMiddle(message.content, SUMMARY_MAX_LENGTH),
                toolCall: null,
                messageCount: messages.length,
                hasAssistantOutput,
            };
        }
    }
    // No assistant text yet — surface the latest tool invocation instead.
    if (last && last.role === "tool") {
        return {
            summary: "",
            toolCall: truncateMiddle(last.content, 80),
            messageCount: messages.length,
            hasAssistantOutput,
        };
    }
    return { summary: "", toolCall: null, messageCount: messages.length, hasAssistantOutput };
}

function truncateMiddle(text: string, max: number): string {
    // 剥掉 markdown 代码围栏标记, 活动行只保留内容 (```text ... ``` → ...)
    const noFences = text.replace(/```[^\n]*\n?/g, "").trim();
    const normalized = noFences.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    const head = normalized.slice(0, Math.floor(max * 0.6));
    const tail = normalized.slice(-Math.floor(max * 0.35));
    return `${head}…${tail}`;
}

function rollupStatus(statuses: FleetAgentStatus[]): FleetAgentStatus {
    if (statuses.length === 0) return "idle";
    return statuses.reduce((worst, next) =>
        STATUS_PRIORITY[next] < STATUS_PRIORITY[worst] ? next : worst,
    );
}

function agentSort(a: FleetAgent, b: FleetAgent): number {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (diff !== 0) return diff;
    return (b.runtime?.tokenUsage?.total ?? 0) - (a.runtime?.tokenUsage?.total ?? 0);
}

/**
 * React hook composing all agent/runtime/subagent/permission/plan state into
 * the fleet model consumed by AgentsPanel and the RightRail agents card.
 */
export function useAgentFleet(): {
    groups: FleetWorkspaceGroup[];
    counts: FleetCounts;
    total: number;
} {
    const agents = useAgentStore((state) => state.agents);
    const runtimeByAgent = useAgentStore((state) => state.runtimeByAgent);
    const messagesByAgent = useAgentStore((state) => state.messagesByAgent);
    const subagentsByAgent = useSubagentStore((state) => state.byAgent);
    const pendingRequests = usePermissionStore((state) => state.pending);
    const decisionRequest = usePlanStore((state) => state.decisionRequest);
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    // Shared suspension signals (queue + legacy approval), fed by one
    // app-wide subscription in fleet-signals-store.
    const queueBlockedByAgent = useFleetSignalsStore((state) => state.queueBlockedByAgent);
    const approvalPendingByWorkspace = useFleetSignalsStore((state) => state.approvalPendingByWorkspace);

    return useMemo(() => {
        const fleetAgents: FleetAgent[] = agents.map((agent) => {
            const runtime = runtimeByAgent[agent.id];
            const messages = messagesByAgent[agent.id] ?? [];
            const { summary, toolCall, messageCount, hasAssistantOutput } = extractFleetSummary(messages);
            const signals: FleetBlockedSignals = {
                pendingPermission: pendingRequests.some(
                    (request) =>
                        request.agentId === agent.id
                        || (!request.agentId && !!request.workspaceId && request.workspaceId === agent.workspaceId),
                ),
                pendingPlan: !!decisionRequest && decisionRequest.workspaceId === agent.workspaceId,
                pendingApproval: (approvalPendingByWorkspace[agent.workspaceId] ?? 0) > 0,
                queueBlocked: queueBlockedByAgent[agent.id] ?? false,
            };
            let status = computeFleetStatus(agent, runtime, signals);
            let blockedReason: FleetBlockedReason | null = null;
            if (status === "blocked") {
                blockedReason = signals.pendingPermission
                    ? "permission"
                    : signals.pendingPlan
                        ? "plan"
                        : signals.pendingApproval
                            ? "approval"
                            : "queue";
            }
            // Idle + finished assistant output reads as "done" (herdr: turn
            // completed) — a brand-new agent or one awaiting its first reply
            // stays "idle".
            if (status === "idle" && hasAssistantOutput) {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage?.role !== "user") status = "done";
            }
            return {
                agent,
                runtime,
                status,
                blockedReason,
                summary,
                toolCall,
                messageCount,
                hasAssistantOutput,
                subagents: subagentsByAgent[agent.id] ?? [],
            };
        });

        const byWorkspace = new Map<string, FleetAgent[]>();
        for (const fleetAgent of fleetAgents) {
            const list = byWorkspace.get(fleetAgent.agent.workspaceId) ?? [];
            list.push(fleetAgent);
            byWorkspace.set(fleetAgent.agent.workspaceId, list);
        }

        const counts = emptyFleetCounts();
        for (const fleetAgent of fleetAgents) counts[fleetAgent.status] += 1;

        const groups: FleetWorkspaceGroup[] = [...byWorkspace.entries()].map(([workspaceId, members]) => {
            const groupCounts = emptyFleetCounts();
            for (const member of members) groupCounts[member.status] += 1;
            const workspace = workspaces.find((item) => item.id === workspaceId);
            return {
                workspaceId,
                workspaceName: workspace?.name ?? workspaceId,
                status: rollupStatus(members.map((member) => member.status)),
                counts: groupCounts,
                agents: members.sort(agentSort),
            };
        });
        groups.sort((a, b) => {
            const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
            if (diff !== 0) return diff;
            return a.workspaceName.localeCompare(b.workspaceName);
        });

        return { groups, counts, total: fleetAgents.length };
    }, [agents, runtimeByAgent, messagesByAgent, subagentsByAgent, pendingRequests, decisionRequest, queueBlockedByAgent, approvalPendingByWorkspace, workspaces]);
}
