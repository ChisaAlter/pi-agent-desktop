import { create } from "zustand";
import { isIpcError, type SubagentEvent, type SubagentInstance } from "@shared";
import { logger } from "../utils/logger";
import { createSubscriptionManager } from "../utils/subscription-manager";

/**
 * SubagentStore — renderer-side mirror of the SubagentManager state, fed by
 * the `subagent:event` broadcast and `subagent:list-instances` snapshots.
 *
 * Keyed by the parent `agentId` so the agent fleet UI can render subagent
 * cards indented under their parent agent (herdr-style pane hierarchy).
 * Terminal instances stay visible until the main-process GC reclaims them
 * (5 min idle grace), matching the manager's lifecycle.
 */
interface SubagentState {
    /** agentId → live + recently terminal subagent instances, newest first. */
    byAgent: Record<string, SubagentInstance[]>;
    initialized: boolean;
    init: () => Promise<void>;
    /** Full refresh for one parent agent (used after every broadcast event). */
    refreshAgent: (agentId: string) => Promise<void>;
    /** Idempotent cancel; keeps the terminal snapshot for display. */
    cancelActor: (agentId: string, actorId: string) => Promise<void>;
    /** Forget all instances for a parent agent (called when the agent is stopped). */
    dropAgent: (agentId: string) => void;
}

function upsertInstances(existing: SubagentInstance[] | undefined, next: SubagentInstance[]): SubagentInstance[] {
    const merged = new Map<string, SubagentInstance>();
    for (const inst of existing ?? []) merged.set(inst.actorId, inst);
    for (const inst of next) merged.set(inst.actorId, inst);
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export const useSubagentStore = create<SubagentState>((set, get) => ({
    byAgent: {},
    initialized: false,

    init: async () => {
        if (get().initialized) return;
        set({ initialized: true });
    },

    refreshAgent: async (agentId) => {
        if (!window.piAPI?.subagentListInstances) return;
        try {
            const result = await window.piAPI.subagentListInstances(agentId);
            if (isIpcError(result)) {
                logger.warn("[subagent-store] list-instances error:", result.fallback);
                return;
            }
            set((state) => ({
                byAgent: {
                    ...state.byAgent,
                    [agentId]: upsertInstances(state.byAgent[agentId], result),
                },
            }));
        } catch (error) {
            logger.warn("[subagent-store] refreshAgent failed:", agentId, error);
        }
    },

    cancelActor: async (agentId, actorId) => {
        if (!window.piAPI?.subagentCancel) return;
        try {
            const snapshot = await window.piAPI.subagentCancel(agentId, actorId);
            if (snapshot && !isIpcError(snapshot)) {
                set((state) => ({
                    byAgent: {
                        ...state.byAgent,
                        [agentId]: upsertInstances(state.byAgent[agentId], [snapshot]),
                    },
                }));
            }
        } catch (error) {
            logger.warn("[subagent-store] cancelActor failed:", actorId, error);
        }
    },

    dropAgent: (agentId) =>
        set((state) => {
            if (!(agentId in state.byAgent)) return state;
            const { [agentId]: _dropped, ...byAgent } = state.byAgent;
            return { byAgent };
        }),
}));

const { ensure, cleanup } = createSubscriptionManager();

/**
 * Bridge the `subagent:event` broadcast into the store. Events are sparse
 * (spawn / running / terminated / gc), so each one triggers a cheap full
 * snapshot refresh of that parent agent — simpler and more robust than
 * patch-applying partial transitions.
 */
export function ensureSubagentSubscriptions(): void {
    if (!window.piAPI?.onSubagentEvent) return;
    ensure(() => {
        const off = window.piAPI!.onSubagentEvent((event: SubagentEvent) => {
            // Fresh snapshots win: keep any locally-known terminal instances we
            // haven't fetched yet by refreshing the whole parent agent.
            void useSubagentStore.getState().refreshAgent(event.agentId);
        });
        return typeof off === "function" ? off : undefined;
    });
}

/** Unsubscribe helper for tests / AppShell remounts. */
export function cleanupSubagentSubscriptions(): void {
    cleanup();
}
