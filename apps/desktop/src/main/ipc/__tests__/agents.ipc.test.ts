import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

import { setupAgentsIpc } from "../agents.ipc";
import type { AgentRuntimeRegistry } from "../../services/agent-runtime/registry";

type RegistryStub = Pick<
    AgentRuntimeRegistry,
    "list" | "create" | "prompt" | "abort" | "stop" | "restart" | "getMessages" | "getRuntimeState" | "syncPermissions"
>;

describe("setupAgentsIpc", () => {
    beforeEach(() => handlers.clear());

    it("registers agent handlers against the registry", async () => {
        const registry: RegistryStub = {
            list: vi.fn(() => [{ id: "agent_1", workspaceId: "ws_1", title: "Agent 1", status: "idle", createdAt: 1, updatedAt: 1 }]),
            create: vi.fn(async (input) => ({
                id: "agent_2",
                workspaceId: input.workspaceId,
                title: input.title ?? "Agent 2",
                status: "idle",
                createdAt: 1,
                updatedAt: 1,
            })),
            prompt: vi.fn(async () => undefined),
            abort: vi.fn(async () => undefined),
            stop: vi.fn(),
            restart: vi.fn(async () => ({ id: "agent_3", workspaceId: "ws_1", title: "Agent 3", status: "idle", createdAt: 1, updatedAt: 1 })),
            getMessages: vi.fn(() => []),
            getRuntimeState: vi.fn(() => ({ agentId: "agent_1", status: "idle", isStreaming: false })),
            syncPermissions: vi.fn(async () => ({ activeTools: ["read"], deniedTools: ["write"] })),
        };

        setupAgentsIpc(registry as AgentRuntimeRegistry);

        await expect(handlers.get("agents:list")?.({})).resolves.toEqual([
            { id: "agent_1", workspaceId: "ws_1", title: "Agent 1", status: "idle", createdAt: 1, updatedAt: 1 },
        ]);
        await handlers.get("agents:create")?.({}, { workspaceId: "ws_1" });
        await handlers.get("agents:prompt")?.({}, { agentId: "agent_2", message: "hello" });
        await handlers.get("agents:stop")?.({}, "agent_2");
        await expect(handlers.get("agents:sync-permissions")?.({}, "agent_2")).resolves.toEqual({
            activeTools: ["read"],
            deniedTools: ["write"],
        });

        expect(registry.create).toHaveBeenCalledWith({ workspaceId: "ws_1" });
        expect(registry.prompt).toHaveBeenCalledWith({ agentId: "agent_2", message: "hello" });
        expect(registry.stop).toHaveBeenCalledWith("agent_2");
        expect(registry.syncPermissions).toHaveBeenCalledWith("agent_2");
    });

    it("returns ipcError for an invalid permission sync agent id", async () => {
        const registry = { syncPermissions: vi.fn() } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);

        await expect(handlers.get("agents:sync-permissions")?.({}, "")).resolves.toMatchObject({
            __brand: "IpcError",
        });
        expect(registry.syncPermissions).not.toHaveBeenCalled();
    });

    it("returns a branded syncPermissionsFailed ipcError when permission sync throws", async () => {
        const registry = {
            syncPermissions: vi.fn(async () => {
                throw new Error("tool registry unavailable");
            }),
        } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);

        await expect(handlers.get("agents:sync-permissions")?.({}, "agent_1")).resolves.toEqual({
            __brand: "IpcError",
            code: "ipcErrors.agents.syncPermissionsFailed",
            fallback: "tool registry unavailable",
            params: undefined,
        });
    });

    // wave-99 residual
    it("routes abort/restart/messages/runtime-state through the registry", async () => {
        const registry = {
            abort: vi.fn(async () => undefined),
            restart: vi.fn(async () => ({
                id: "agent_r",
                workspaceId: "ws_1",
                title: "R",
                status: "idle",
                createdAt: 1,
                updatedAt: 1,
            })),
            getMessages: vi.fn(() => [{ id: "m1", agentId: "agent_1", role: "user", content: "hi", createdAt: 1 }]),
            getRuntimeState: vi.fn(() => ({ agentId: "agent_1", status: "running", isStreaming: true })),
        } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);

        await handlers.get("agents:abort")?.({}, "agent_1");
        await expect(handlers.get("agents:restart")?.({}, "agent_1")).resolves.toMatchObject({ id: "agent_r" });
        await expect(handlers.get("agents:messages")?.({}, "agent_1")).resolves.toHaveLength(1);
        await expect(handlers.get("agents:runtime-state")?.({}, "agent_1")).resolves.toMatchObject({
            isStreaming: true,
        });

        expect(registry.abort).toHaveBeenCalledWith("agent_1");
        expect(registry.restart).toHaveBeenCalledWith("agent_1");
        expect(registry.getMessages).toHaveBeenCalledWith("agent_1");
        expect(registry.getRuntimeState).toHaveBeenCalledWith("agent_1");
    });

    it("rejects empty agent ids for abort/stop/restart/messages/runtime-state", async () => {
        const registry = {
            abort: vi.fn(),
            stop: vi.fn(),
            restart: vi.fn(),
            getMessages: vi.fn(),
            getRuntimeState: vi.fn(),
        } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);

        for (const channel of [
            "agents:abort",
            "agents:stop",
            "agents:restart",
            "agents:messages",
            "agents:runtime-state",
        ]) {
            await expect(handlers.get(channel)?.({}, "")).rejects.toThrow();
        }
        expect(registry.abort).not.toHaveBeenCalled();
        expect(registry.stop).not.toHaveBeenCalled();
        expect(registry.restart).not.toHaveBeenCalled();
        expect(registry.getMessages).not.toHaveBeenCalled();
        expect(registry.getRuntimeState).not.toHaveBeenCalled();
    });

    it("returns invalidThinkingLevel for bad set-thinking input", async () => {
        const registry = { setThinking: vi.fn() } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);
        await expect(handlers.get("agents:set-thinking")?.({}, "", "off")).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.agents.invalidThinkingLevel",
        });
        await expect(handlers.get("agents:set-thinking")?.({}, "agent_1", "mega")).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.agents.invalidThinkingLevel",
        });
        expect(registry.setThinking).not.toHaveBeenCalled();
    });

    it("returns setThinkingFailed when registry throws", async () => {
        const registry = {
            setThinking: vi.fn(() => {
                throw new Error("session gone");
            }),
        } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);
        await expect(handlers.get("agents:set-thinking")?.({}, "agent_1", "high")).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.agents.setThinkingFailed",
            fallback: "session gone",
        });
    });

    it("forwards valid set-thinking levels", async () => {
        const registry = {
            setThinking: vi.fn(() => ({ agentId: "agent_1", thinkingLevel: "medium" })),
        } as unknown as AgentRuntimeRegistry;
        setupAgentsIpc(registry);
        await expect(handlers.get("agents:set-thinking")?.({}, "agent_1", "medium")).resolves.toEqual({
            agentId: "agent_1",
            thinkingLevel: "medium",
        });
        expect(registry.setThinking).toHaveBeenCalledWith("agent_1", "medium");
    });
});
