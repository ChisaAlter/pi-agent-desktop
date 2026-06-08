import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
            listeners.set(channel, listener);
        }),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => [
            {
                isDestroyed: () => false,
                webContents: { send: webContentsSend },
            },
        ]),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
    },
}));

import { setupChatIpc } from "../chat.ipc";
import type { AgentRuntimeRegistry } from "../../services/agent-runtime/registry";
import { PendingEdits } from "../../services/approval/pending-edits";
import type { WorkspaceRegistry } from "../../services/pi-session/registry";
import type { AgentTab, CreateAgentInput, Workspace } from "@shared";
import type { IpcSender } from "../../services/pi-session/event-bridge";

type WorkspaceRegistryStub = Pick<WorkspaceRegistry, "get" | "has">;
type AgentRegistryStub = Pick<AgentRuntimeRegistry, "findDefaultAgent" | "create" | "prompt" | "stop">;

function workspace(): Workspace {
    return {
        id: "ws_1",
        name: "demo",
        path: "C:/demo",
        createdAt: 1,
    };
}

function agentTab(overrides: Partial<AgentTab> = {}): AgentTab {
    return {
        id: "agent_1",
        workspaceId: "ws_1",
        title: "demo Agent",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

describe("setupChatIpc", () => {
    beforeEach(() => {
        handlers.clear();
        listeners.clear();
        webContentsSend.mockClear();
    });

    it("sends renderer event payload directly without a workspace envelope", async () => {
        const event = { type: "agent_start" };
        const registry: WorkspaceRegistryStub = {
            get: vi.fn(async (_id, _path, _pendingEdits, send?: IpcSender) => ({
                session: {
                    prompt: vi.fn(async () => {
                        send?.("pi:event", "ws_1", event);
                    }),
                    abort: vi.fn(),
                },
            })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as WorkspaceRegistry,
            getWorkspace: () => workspace(),
            getDefaultWorkspace: () => undefined,
            pendingEdits: new PendingEdits(),
        });

        const handler = handlers.get("pi:send");
        expect(handler).toBeTruthy();

        await handler?.({}, "ws_1", "hello");

        expect(webContentsSend).toHaveBeenCalledWith("pi:event", event);
    });

    it("routes legacy pi:send through agent registry when available", async () => {
        const agentRegistry: AgentRegistryStub = {
            findDefaultAgent: vi.fn(() => undefined),
            create: vi.fn(async (_input: CreateAgentInput) => agentTab()),
            prompt: vi.fn(async () => undefined),
            stop: vi.fn(),
        };

        setupChatIpc({
            registry: {} as WorkspaceRegistry,
            agentRegistry: agentRegistry as AgentRuntimeRegistry,
            getWorkspace: () => workspace(),
            getDefaultWorkspace: () => undefined,
            pendingEdits: new PendingEdits(),
        });

        await handlers.get("pi:send")?.({}, "ws_1", "hello");

        expect(agentRegistry.create).toHaveBeenCalledWith({ workspaceId: "ws_1", title: "demo Agent" });
        expect(agentRegistry.prompt).toHaveBeenCalledWith({ agentId: "agent_1", message: "hello" });
    });

    it("routes legacy pi:stop through agent registry when available", async () => {
        const agentRegistry: AgentRegistryStub = {
            findDefaultAgent: vi.fn(() => agentTab()),
            create: vi.fn(async (_input: CreateAgentInput) => agentTab()),
            prompt: vi.fn(async () => undefined),
            stop: vi.fn(),
        };

        setupChatIpc({
            registry: {} as WorkspaceRegistry,
            agentRegistry: agentRegistry as AgentRuntimeRegistry,
            getWorkspace: () => workspace(),
            getDefaultWorkspace: () => undefined,
            pendingEdits: new PendingEdits(),
        });

        await handlers.get("pi:stop")?.({}, "ws_1");

        expect(agentRegistry.stop).toHaveBeenCalledWith("agent_1");
    });
});
