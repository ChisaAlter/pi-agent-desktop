import { create } from "zustand";
import type { AgentMessage, AgentRuntimeState, AgentTab } from "@shared";
import { logger } from "../utils/logger";
import { addToast } from "./toast-store";
import { i18n } from "../i18n";

interface AgentStore {
    agents: AgentTab[];
    currentAgentId: string | null;
    messagesByAgent: Record<string, AgentMessage[]>;
    runtimeByAgent: Record<string, AgentRuntimeState>;
    initialized: boolean;
    init: () => Promise<void>;
    createAgent: (workspaceId: string, title?: string, sessionPath?: string, sessionId?: string) => Promise<AgentTab>;
    setCurrentAgent: (agentId: string | null) => void;
    sendPrompt: (message: string) => Promise<void>;
    stopAgent: (agentId: string) => Promise<void>;
    restartAgent: (agentId: string) => Promise<AgentTab>;
    setAgentMessages: (agentId: string, messages: AgentMessage[]) => void;
    appendStreamMessage: (agentId: string, message: AgentMessage) => void;
    updateStreamMessage: (agentId: string, messageId: string, updates: Partial<AgentMessage>) => void;
    getCurrentAgent: () => AgentTab | null;
    getCurrentMessages: () => AgentMessage[];
}
let unsubscribeState: (() => void) | undefined;
let unsubscribeMessages: (() => void) | undefined;

function hasSameVisibleMessage(left: AgentMessage, right: AgentMessage): boolean {
    return left.role === right.role && left.content === right.content;
}

function isLocalOnlyMessage(message: AgentMessage): boolean {
    return message.meta?.optimistic === true || /^(?:um|am|pm)_/.test(message.id);
}

function mergeRemoteAgentMessages(localMessages: AgentMessage[] = [], remoteMessages: AgentMessage[]): AgentMessage[] {
    const remoteIds = new Set(remoteMessages.map((message) => message.id));
    const preservedLocal = localMessages.filter((message) => {
        if (remoteIds.has(message.id)) return false;
        if (!isLocalOnlyMessage(message)) return false;
        if (message.meta?.optimistic === true && remoteMessages.some((remote) => hasSameVisibleMessage(message, remote))) {
            return false;
        }
        return true;
    });
    return [...remoteMessages, ...preservedLocal].sort((a, b) => a.createdAt - b.createdAt);
}

export const useAgentStore = create<AgentStore>((set, get) => ({
    agents: [],
    currentAgentId: null,
    messagesByAgent: {},
    runtimeByAgent: {},
    initialized: false,

    init: async () => {
        if (get().initialized) return;
        if (!window.piAPI.agentsList) {
            set({ initialized: true });
            return;
        }
        const agents = await window.piAPI.agentsList();
        set({
            agents,
            currentAgentId: get().currentAgentId ?? agents[0]?.id ?? null,
            initialized: true,
        });
        unsubscribeState?.();
        unsubscribeMessages?.();
        unsubscribeState = window.piAPI.onAgentsState((nextAgents) => {
            set((state) => ({
                agents: nextAgents,
                currentAgentId:
                    state.currentAgentId && nextAgents.some((agent) => agent.id === state.currentAgentId)
                        ? state.currentAgentId
                        : nextAgents[0]?.id ?? null,
            }));
        });
        unsubscribeMessages = window.piAPI.onAgentMessages(({ agentId, messages }) => {
            get().setAgentMessages(agentId, messages);
        });
        await Promise.all(agents.map(async (agent) => {
            try {
                const [messages, runtime] = await Promise.all([
                    window.piAPI.agentsMessages(agent.id),
                    window.piAPI.agentsRuntimeState(agent.id),
                ]);
                set((state) => ({
                    messagesByAgent: {
                        ...state.messagesByAgent,
                        [agent.id]: mergeRemoteAgentMessages(state.messagesByAgent[agent.id], messages),
                    },
                    runtimeByAgent: { ...state.runtimeByAgent, [agent.id]: runtime },
                }));
            } catch (error) {
                logger.warn("[agent-store] failed to hydrate agent", agent.id, error);
            }
        }));
    },

    createAgent: async (workspaceId, title, sessionPath, sessionId) => {
        const agent = await window.piAPI.agentsCreate({ workspaceId, title, sessionPath, sessionId });
        set((state) => ({
            agents: [...state.agents.filter((item) => item.id !== agent.id), agent],
            currentAgentId: agent.id,
        }));
        try {
            const [messages, runtime] = await Promise.all([
                window.piAPI.agentsMessages(agent.id),
                window.piAPI.agentsRuntimeState(agent.id),
            ]);
            set((state) => ({
                messagesByAgent: { ...state.messagesByAgent, [agent.id]: messages },
                runtimeByAgent: { ...state.runtimeByAgent, [agent.id]: runtime },
            }));
        } catch (error) {
            logger.warn("[agent-store] failed to hydrate new agent", error);
        }
        return agent;
    },

    setCurrentAgent: (agentId) => set({ currentAgentId: agentId }),

    sendPrompt: async (message) => {
        const agentId = get().currentAgentId;
        if (!agentId) throw new Error("No active agent");
        await window.piAPI.agentsPrompt({ agentId, message });
    },

    stopAgent: async (agentId) => {
        await window.piAPI.agentsStop(agentId);
        set((state) => {
            const agents = state.agents.filter((agent) => agent.id !== agentId);
            const { [agentId]: _messages, ...messagesByAgent } = state.messagesByAgent;
            const { [agentId]: _runtime, ...runtimeByAgent } = state.runtimeByAgent;
            return {
                agents,
                messagesByAgent,
                runtimeByAgent,
                currentAgentId: state.currentAgentId === agentId ? agents[0]?.id ?? null : state.currentAgentId,
            };
        });
    },

    restartAgent: async (agentId) => {
        const newAgent = await window.piAPI.agentsRestart(agentId);
        set((state) => {
            const agents = state.agents.filter((a) => a.id !== agentId);
            const { [agentId]: _messages, ...messagesByAgent } = state.messagesByAgent;
            const { [agentId]: _runtime, ...runtimeByAgent } = state.runtimeByAgent;
            return {
                agents: [...agents, newAgent],
                messagesByAgent,
                runtimeByAgent,
                currentAgentId: state.currentAgentId === agentId ? newAgent.id : state.currentAgentId,
            };
        });
        try {
            const [messages, runtime] = await Promise.all([
                window.piAPI.agentsMessages(newAgent.id),
                window.piAPI.agentsRuntimeState(newAgent.id),
            ]);
            set((state) => ({
                messagesByAgent: { ...state.messagesByAgent, [newAgent.id]: messages },
                runtimeByAgent: { ...state.runtimeByAgent, [newAgent.id]: runtime },
            }));
        } catch (error) {
            logger.warn("[agent-store] failed to hydrate restarted agent", error);
            addToast(i18n.t("errors.agentRestartFailed"), "error");
        }
        return newAgent;
    },

    setAgentMessages: (agentId, messages) =>
        set((state) => ({
            messagesByAgent: {
                ...state.messagesByAgent,
                [agentId]: mergeRemoteAgentMessages(state.messagesByAgent[agentId], messages),
            },
        })),

    appendStreamMessage: (agentId, message) =>
        set((state) => ({
            messagesByAgent: {
                ...state.messagesByAgent,
                [agentId]: [...(state.messagesByAgent[agentId] ?? []), message],
            },
        })),

    updateStreamMessage: (agentId, messageId, updates) =>
        set((state) => ({
            messagesByAgent: {
                ...state.messagesByAgent,
                [agentId]: (state.messagesByAgent[agentId] ?? []).map((m) =>
                    m.id === messageId ? { ...m, ...updates } : m
                ),
            },
        })),


    getCurrentAgent: () => {
        const state = get();
        return state.agents.find((agent) => agent.id === state.currentAgentId) ?? null;
    },

    getCurrentMessages: () => {
        const state = get();
        return state.currentAgentId ? state.messagesByAgent[state.currentAgentId] ?? [] : [];
    },
}));
