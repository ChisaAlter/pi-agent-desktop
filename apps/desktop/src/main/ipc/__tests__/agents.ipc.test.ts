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
    "list" | "create" | "prompt" | "abort" | "stop" | "restart" | "getMessages" | "getRuntimeState"
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
        };

        setupAgentsIpc(registry as AgentRuntimeRegistry);

        await expect(handlers.get("agents:list")?.({})).resolves.toEqual([
            { id: "agent_1", workspaceId: "ws_1", title: "Agent 1", status: "idle", createdAt: 1, updatedAt: 1 },
        ]);
        await handlers.get("agents:create")?.({}, { workspaceId: "ws_1" });
        await handlers.get("agents:prompt")?.({}, { agentId: "agent_2", message: "hello" });
        await handlers.get("agents:stop")?.({}, "agent_2");

        expect(registry.create).toHaveBeenCalledWith({ workspaceId: "ws_1" });
        expect(registry.prompt).toHaveBeenCalledWith({ agentId: "agent_2", message: "hello" });
        expect(registry.stop).toHaveBeenCalledWith("agent_2");
    });
});
