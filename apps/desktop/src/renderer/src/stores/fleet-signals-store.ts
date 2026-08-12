import { create } from "zustand";
import type { ApprovalRequest, PiEvent } from "@shared";
import { createSubscriptionManager } from "../utils/subscription-manager";

/**
 * Fleet signals store — shared, module-level tracking of the suspension
 * signals that feed the fleet's strict blocked semantics:
 *
 *  - queue: per-agent steering/followUp parked messages (from `agents:event`
 *    queue_update). Tracked here (not inside a hook) so AgentsPanel and the
 *    RightRail card share one subscription and state survives panel unmounts.
 *  - approval: legacy modal approval requests awaiting the user (approval:request
 *    → approval:resolved). The main process only added `approval:resolved` so
 *    the pending count can be closed out on respond AND timeout.
 *
 * Blocked reason precedence in useAgentFleet: permission > plan > approval > queue.
 */
interface FleetSignalsState {
    /** agentId → true when steering/followUp queue is non-empty. */
    queueBlockedByAgent: Record<string, boolean>;
    /** requestId → workspaceId for pending legacy approvals. */
    approvalByRequest: Record<string, string>;
    /** workspaceId → number of pending approvals (workspace-level suspension). */
    approvalPendingByWorkspace: Record<string, number>;
    applyQueueEvent: (agentId: string, event: PiEvent) => void;
    trackApprovalRequest: (request: ApprovalRequest) => void;
    resolveApproval: (requestId: string) => void;
}

export const useFleetSignalsStore = create<FleetSignalsState>((set) => ({
    queueBlockedByAgent: {},
    approvalByRequest: {},
    approvalPendingByWorkspace: {},

    applyQueueEvent: (agentId, event) => {
        set((state) => {
            if (event.type === "queue_update") {
                const blocked = event.steering.length > 0 || event.followUp.length > 0;
                if ((state.queueBlockedByAgent[agentId] ?? false) === blocked) return state;
                return {
                    ...state,
                    queueBlockedByAgent: { ...state.queueBlockedByAgent, [agentId]: blocked },
                };
            }
            if (event.type === "turn_end" || event.type === "agent_end") {
                if (!state.queueBlockedByAgent[agentId]) return state;
                const next = { ...state.queueBlockedByAgent };
                delete next[agentId];
                return { ...state, queueBlockedByAgent: next };
            }
            return state;
        });
    },

    trackApprovalRequest: (request) => {
        const workspaceId = request.workspaceId;
        if (!workspaceId) return;
        set((state) => {
            if (state.approvalByRequest[request.requestId]) return state; // 幂等
            return {
                ...state,
                approvalByRequest: { ...state.approvalByRequest, [request.requestId]: workspaceId },
                approvalPendingByWorkspace: {
                    ...state.approvalPendingByWorkspace,
                    [workspaceId]: (state.approvalPendingByWorkspace[workspaceId] ?? 0) + 1,
                },
            };
        });
    },

    resolveApproval: (requestId) => {
        set((state) => {
            const workspaceId = state.approvalByRequest[requestId];
            if (!workspaceId) return state;
            const nextByRequest = { ...state.approvalByRequest };
            delete nextByRequest[requestId];
            const count = (state.approvalPendingByWorkspace[workspaceId] ?? 1) - 1;
            const nextPending = { ...state.approvalPendingByWorkspace };
            if (count <= 0) {
                delete nextPending[workspaceId];
            } else {
                nextPending[workspaceId] = count;
            }
            return { ...state, approvalByRequest: nextByRequest, approvalPendingByWorkspace: nextPending };
        });
    },
}));

const { ensure, cleanup } = createSubscriptionManager();

/** Subscribe agents:event (queue) + approval:request/resolved once, app-wide. */
export function ensureFleetSignalSubscriptions(): void {
    if (!window.piAPI?.onAgentEvent) return;
    ensure(() => {
        const offs: Array<(() => void) | undefined> = [];
        offs.push(
            window.piAPI!.onAgentEvent(({ agentId, event }) => {
                useFleetSignalsStore.getState().applyQueueEvent(agentId, event);
            }),
        );
        if (window.piAPI.onApprovalRequest) {
            offs.push(
                window.piAPI.onApprovalRequest((request) => {
                    useFleetSignalsStore.getState().trackApprovalRequest(request);
                }),
            );
        }
        if (window.piAPI.onApprovalResolved) {
            offs.push(
                window.piAPI.onApprovalResolved(({ requestId }) => {
                    useFleetSignalsStore.getState().resolveApproval(requestId);
                }),
            );
        }
        return () => {
            for (const off of offs) off?.();
        };
    });
}

/** Unsubscribe helper for tests / AppShell remounts. */
export function cleanupFleetSignalSubscriptions(): void {
    cleanup();
}
