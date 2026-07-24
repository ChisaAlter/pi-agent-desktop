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
    agentsSyncPermissions: vi.fn(async () => ({ activeTools: ["read", "edit"], deniedTools: ["bash"] })),
    onAgentsState: vi.fn(() => () => undefined),
    onAgentMessages: vi.fn(() => () => undefined),
    onAgentRuntimeState: vi.fn(() => () => undefined),
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

    it("syncs permissions for a live agent and returns the enforced tool sets", async () => {
        const result = await useAgentStore.getState().syncPermissions("agent_1");

        expect(api.agentsSyncPermissions).toHaveBeenCalledWith("agent_1");
        expect(result).toEqual({ activeTools: ["read", "edit"], deniedTools: ["bash"] });
    });

    it("hydrates existing agent messages during init", async () => {
        api.agentsList.mockResolvedValueOnce([
            { id: "agent_existing", workspaceId: "ws_1", title: "Existing", status: "running", createdAt: 1, updatedAt: 2 },
        ]);
        api.agentsMessages.mockResolvedValueOnce([
            { id: "msg_existing", agentId: "agent_existing", role: "user", content: "需要触发权限确认的对话", createdAt: 3 },
        ]);
        api.agentsRuntimeState.mockResolvedValueOnce({ agentId: "agent_existing", status: "running", isStreaming: true });

        await useAgentStore.getState().init();

        expect(useAgentStore.getState().currentAgentId).toBe("agent_existing");
        expect(useAgentStore.getState().messagesByAgent.agent_existing).toEqual([
            { id: "msg_existing", agentId: "agent_existing", role: "user", content: "需要触发权限确认的对话", createdAt: 3 },
        ]);
        expect(useAgentStore.getState().runtimeByAgent.agent_existing).toMatchObject({
            agentId: "agent_existing",
            isStreaming: true,
        });
    });

    it("merges canonical agent messages without dropping local streaming rows", () => {
        useAgentStore.setState({
            messagesByAgent: {
                agent_1: [
                    {
                        id: "um_local",
                        agentId: "agent_1",
                        role: "user",
                        content: "触发权限确认",
                        createdAt: 1,
                        meta: { optimistic: true },
                    },
                    { id: "am_local", agentId: "agent_1", role: "assistant", content: "处理中", createdAt: 2 },
                ],
            },
        });

        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "remote_user", agentId: "agent_1", role: "user", content: "触发权限确认", createdAt: 1 },
        ]);

        expect(useAgentStore.getState().messagesByAgent.agent_1).toEqual([
            { id: "remote_user", agentId: "agent_1", role: "user", content: "触发权限确认", createdAt: 1 },
            { id: "am_local", agentId: "agent_1", role: "assistant", content: "处理中", createdAt: 2 },
        ]);
    });

    // wave-97 residual: stop/prompt edges, init idempotency, getters, syncPermissions error
    it("sendPrompt without current agent throws", async () => {
        useAgentStore.setState({ currentAgentId: null });
        await expect(useAgentStore.getState().sendPrompt("x")).rejects.toThrow("No active agent");
        expect(api.agentsPrompt).not.toHaveBeenCalled();
    });

    it("stopAgent removes messages/runtime and reassigns current", async () => {
        useAgentStore.setState({
            agents: [
                { id: "agent_1", workspaceId: "ws_1", title: "A", status: "idle", createdAt: 1, updatedAt: 1 },
                { id: "agent_2", workspaceId: "ws_1", title: "B", status: "idle", createdAt: 2, updatedAt: 2 },
            ],
            currentAgentId: "agent_1",
            messagesByAgent: {
                agent_1: [{ id: "m1", agentId: "agent_1", role: "user", content: "hi", createdAt: 1 }],
                agent_2: [{ id: "m2", agentId: "agent_2", role: "user", content: "yo", createdAt: 1 }],
            },
            runtimeByAgent: {
                agent_1: { agentId: "agent_1", status: "idle", isStreaming: false },
                agent_2: { agentId: "agent_2", status: "idle", isStreaming: false },
            },
        });

        await useAgentStore.getState().stopAgent("agent_1");

        expect(api.agentsStop).toHaveBeenCalledWith("agent_1");
        const state = useAgentStore.getState();
        expect(state.agents.map((a) => a.id)).toEqual(["agent_2"]);
        expect(state.currentAgentId).toBe("agent_2");
        expect(state.messagesByAgent.agent_1).toBeUndefined();
        expect(state.runtimeByAgent.agent_1).toBeUndefined();
        expect(state.messagesByAgent.agent_2).toHaveLength(1);
    });

    it("stopAgent on non-current keeps currentAgentId", async () => {
        useAgentStore.setState({
            agents: [
                { id: "agent_1", workspaceId: "ws_1", title: "A", status: "idle", createdAt: 1, updatedAt: 1 },
                { id: "agent_2", workspaceId: "ws_1", title: "B", status: "idle", createdAt: 2, updatedAt: 2 },
            ],
            currentAgentId: "agent_1",
            messagesByAgent: {},
            runtimeByAgent: {},
        });

        await useAgentStore.getState().stopAgent("agent_2");

        expect(useAgentStore.getState().currentAgentId).toBe("agent_1");
        expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(["agent_1"]);
    });

    it("init is idempotent after first successful load", async () => {
        api.agentsList.mockResolvedValueOnce([
            { id: "agent_1", workspaceId: "ws_1", title: "A", status: "idle", createdAt: 1, updatedAt: 1 },
        ]);
        await useAgentStore.getState().init();
        expect(api.agentsList).toHaveBeenCalledTimes(1);

        await useAgentStore.getState().init();
        expect(api.agentsList).toHaveBeenCalledTimes(1);
        expect(useAgentStore.getState().initialized).toBe(true);
    });

    it("init without agentsList marks initialized and skips listeners", async () => {
        (globalThis as typeof globalThis & { window: { piAPI: Record<string, unknown> } }).window = {
            piAPI: { ...api, agentsList: undefined },
        };
        await useAgentStore.getState().init();
        expect(useAgentStore.getState().initialized).toBe(true);
        expect(useAgentStore.getState().agents).toEqual([]);
        expect(api.onAgentsState).not.toHaveBeenCalled();
    });

    it("syncPermissions throws when IPC returns IpcError", async () => {
        api.agentsSyncPermissions.mockResolvedValueOnce({
            code: "ipcErrors.agent.syncFailed",
            fallback: "权限同步失败",
            __brand: "IpcError",
        });
        await expect(useAgentStore.getState().syncPermissions("agent_1")).rejects.toThrow("权限同步失败");
    });

    it("getCurrentAgent and getCurrentMessages handle empty selection", () => {
        useAgentStore.setState({
            agents: [{ id: "agent_1", workspaceId: "ws_1", title: "A", status: "idle", createdAt: 1, updatedAt: 1 }],
            currentAgentId: null,
            messagesByAgent: {
                agent_1: [{ id: "m1", agentId: "agent_1", role: "user", content: "hi", createdAt: 1 }],
            },
        });
        expect(useAgentStore.getState().getCurrentAgent()).toBeNull();
        expect(useAgentStore.getState().getCurrentMessages()).toEqual([]);

        useAgentStore.getState().setCurrentAgent("agent_1");
        expect(useAgentStore.getState().getCurrentAgent()?.id).toBe("agent_1");
        expect(useAgentStore.getState().getCurrentMessages()).toHaveLength(1);
    });

    it("updateStreamMessage is a no-op for unknown message ids", () => {
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "m1", agentId: "agent_1", role: "user", content: "hello", createdAt: 1 },
        ]);
        useAgentStore.getState().updateStreamMessage("agent_1", "missing", { content: "nope" });
        expect(useAgentStore.getState().messagesByAgent.agent_1[0].content).toBe("hello");
    });

    it("preserves pm_ local streaming rows not present remotely", () => {
        useAgentStore.setState({
            messagesByAgent: {
                agent_1: [
                    { id: "pm_progress", agentId: "agent_1", role: "assistant", content: "…", createdAt: 5 },
                ],
            },
        });
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "remote_1", agentId: "agent_1", role: "user", content: "hi", createdAt: 1 },
        ]);
        const msgs = useAgentStore.getState().messagesByAgent.agent_1;
        expect(msgs.map((m) => m.id)).toEqual(["remote_1", "pm_progress"]);
    });

    it("drops non-local local-only-looking remote duplicates by id", () => {
        useAgentStore.setState({
            messagesByAgent: {
                agent_1: [
                    { id: "remote_1", agentId: "agent_1", role: "user", content: "old", createdAt: 1 },
                    { id: "stale_canonical", agentId: "agent_1", role: "assistant", content: "gone", createdAt: 2 },
                ],
            },
        });
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "remote_1", agentId: "agent_1", role: "user", content: "new", createdAt: 1 },
        ]);
        expect(useAgentStore.getState().messagesByAgent.agent_1).toEqual([
            { id: "remote_1", agentId: "agent_1", role: "user", content: "new", createdAt: 1 },
        ]);
    });

    // wave-129 residual
    it("drops optimistic local rows when remote has same visible role+content", () => {
        useAgentStore.setState({
            messagesByAgent: {
                agent_1: [
                    {
                        id: "um_local",
                        agentId: "agent_1",
                        role: "user",
                        content: "hello",
                        createdAt: 5,
                        meta: { optimistic: true },
                    },
                ],
            },
        });
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "remote_hello", agentId: "agent_1", role: "user", content: "hello", createdAt: 1 },
        ]);
        expect(useAgentStore.getState().messagesByAgent.agent_1).toEqual([
            { id: "remote_hello", agentId: "agent_1", role: "user", content: "hello", createdAt: 1 },
        ]);
    });

    it("preserves um_/am_ local-only rows and sorts by createdAt", () => {
        useAgentStore.setState({
            messagesByAgent: {
                agent_1: [
                    { id: "am_late", agentId: "agent_1", role: "assistant", content: "later", createdAt: 30 },
                    { id: "um_early", agentId: "agent_1", role: "user", content: "early", createdAt: 5 },
                ],
            },
        });
        useAgentStore.getState().setAgentMessages("agent_1", [
            { id: "remote_mid", agentId: "agent_1", role: "assistant", content: "mid", createdAt: 10 },
        ]);
        expect(useAgentStore.getState().messagesByAgent.agent_1.map((m) => m.id)).toEqual([
            "um_early",
            "remote_mid",
            "am_late",
        ]);
    });

    it("setCurrentAgent(null) clears selection without touching messages", () => {
        useAgentStore.setState({
            agents: [{ id: "agent_1", workspaceId: "ws_1", title: "A", status: "idle", createdAt: 1, updatedAt: 1 }],
            currentAgentId: "agent_1",
            messagesByAgent: {
                agent_1: [{ id: "m1", agentId: "agent_1", role: "user", content: "hi", createdAt: 1 }],
            },
        });
        useAgentStore.getState().setCurrentAgent(null);
        expect(useAgentStore.getState().currentAgentId).toBeNull();
        expect(useAgentStore.getState().messagesByAgent.agent_1).toHaveLength(1);
        expect(useAgentStore.getState().getCurrentMessages()).toEqual([]);
    });
});
