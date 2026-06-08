import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateAgentInput } from "@shared";
import { useAgentStore } from "../agent-store";

const api = {
    agentsList: vi.fn(async () => []),
    agentsCreate: vi.fn(async (input: CreateAgentInput) => ({
        id: "agent_1",
        workspaceId: input.workspaceId,
        title: input.title ?? "Agent",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
    })),
    agentsPrompt: vi.fn(async () => undefined),
    agentsStop: vi.fn(async () => undefined),
    agentsRestart: vi.fn(async (agentId) => ({
        id: "restarted_" + agentId,
        workspaceId: "ws_1",
        title: "Restarted Agent",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
    })),
    agentsMessages: vi.fn(async () => []),
    agentsRuntimeState: vi.fn(async (agentId: string) => ({ agentId, status: "idle", isStreaming: false })),
    onAgentsState: vi.fn(() => () => undefined),
    onAgentMessages: vi.fn(() => () => undefined),
};

describe("agent-store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as typeof globalThis & { window: { piAPI: typeof api } }).window = { piAPI: api };
        useAgentStore.setState({
            agents: [],
            currentAgentId: null,
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: false,
        });
    });

    it("creates an agent and makes it current", async () => {
        const agent = await useAgentStore.getState().createAgent("ws_1", "Demo Agent");

        expect(agent.id).toBe("agent_1");
        expect(useAgentStore.getState().currentAgentId).toBe("agent_1");
        expect(api.agentsCreate).toHaveBeenCalledWith({ workspaceId: "ws_1", title: "Demo Agent" });
    });

    it("sends prompt to current agent", async () => {
        await useAgentStore.getState().createAgent("ws_1", "Demo Agent");
        await useAgentStore.getState().sendPrompt("hello");

        expect(api.agentsPrompt).toHaveBeenCalledWith({ agentId: "agent_1", message: "hello" });
    });

    it("restartAgent replaces old agent with new", async () => {
        await useAgentStore.getState().createAgent("ws_1", "Old");
        // set up a second agent to verify it is untouched
        api.agentsCreate.mockResolvedValueOnce({ id: "agent_2", workspaceId: "ws_1", title: "Other", status: "idle", createdAt: 1, updatedAt: 1 });
        await useAgentStore.getState().createAgent("ws_1", "Other");
        useAgentStore.getState().setCurrentAgent("agent_1");

        const newAgent = await useAgentStore.getState().restartAgent("agent_1");

        expect(newAgent.id).toBe("restarted_agent_1");
        expect(api.agentsRestart).toHaveBeenCalledWith("agent_1");
        // agent_2 should still be present
        const agents = useAgentStore.getState().agents;
        expect(agents.find((a) => a.id === "agent_2")).toBeTruthy();
        expect(agents.find((a) => a.id === "agent_1")).toBeUndefined();
        expect(agents.find((a) => a.id === "restarted_agent_1")).toBeTruthy();
    });

    it("appendStreamMessage adds a message to agent", () => {
        useAgentStore.getState().appendStreamMessage("agent_1", {
            id: "am_1", agentId: "agent_1", role: "assistant", content: "hello", createdAt: 1,
        });
        useAgentStore.getState().appendStreamMessage("agent_1", {
            id: "am_2", agentId: "agent_1", role: "assistant", content: "world", createdAt: 2,
        });

        expect(useAgentStore.getState().messagesByAgent.agent_1).toHaveLength(2);
        expect(useAgentStore.getState().messagesByAgent.agent_1[1].content).toBe("world");
    });

    it("updateStreamMessage modifies a message in-place", () => {
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "m1", agentId: "agent_1", role: "user", content: "hello", createdAt: 1 },
            { id: "m2", agentId: "agent_1", role: "assistant", content: "", createdAt: 2 },
        ]);
        useAgentStore.getState().updateStreamMessage("agent_1", "m2", { content: "updated", thinking: "thought" });

        const msgs = useAgentStore.getState().messagesByAgent.agent_1;
        expect(msgs[1].content).toBe("updated");
        expect(msgs[1].thinking).toBe("thought");
    });

    it("updates messages by agent id", () => {
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "m1", agentId: "agent_1", role: "user", content: "hello", createdAt: 1 },
        ]);

        expect(useAgentStore.getState().messagesByAgent.agent_1).toHaveLength(1);
    });
});
