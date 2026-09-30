import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HerdrRuntimeProjection } from "@shared";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

import { setupHerdrIpc } from "../herdr.ipc";
import type { HerdrStateBridge } from "../../services/herdr/state-bridge";

function emptyProjection(): HerdrRuntimeProjection {
    return {
        revision: 1,
        status: {
            connection: "connected",
            source: "external",
            version: "0.8.0",
            protocol: 19,
            pid: null,
            owned: false,
            compatibility: "compatible",
            error: null,
        },
        agents: [],
        tree: { session: "default", workspaces: [] },
    };
}

describe("setupHerdrIpc", () => {
    beforeEach(() => handlers.clear());

    it("registers typed Herdr handlers and never exposes a generic RPC passthrough", async () => {
        const projection = emptyProjection();
        const bridge = {
            getProjection: vi.fn(() => projection),
            refresh: vi.fn(async () => projection),
            readAgentOutput: vi.fn(async () => ({
                paneId: "pane-1",
                workspaceId: "ws-1",
                tabId: "tab-1",
                source: "recent",
                text: "hello",
                revision: 3,
                truncated: false,
            })),
            focusAgent: vi.fn(async () => projection),
            promptAgent: vi.fn(async () => projection),
            sendAgentKeys: vi.fn(async () => undefined),
            start: vi.fn(async () => projection),
            stop: vi.fn(),
            installIntegration: vi.fn(async () => undefined),
        };
        const supervisor = { stop: vi.fn(async () => true) };

        setupHerdrIpc({
            bridge: bridge as unknown as HerdrStateBridge,
            supervisor,
        });

        expect([...handlers.keys()]).toEqual([
            "herdr:get-status",
            "herdr:get-snapshot",
            "herdr:read-agent-output",
            "herdr:focus-agent",
            "herdr:prompt-agent",
            "herdr:send-agent-keys",
            "herdr:start-server",
            "herdr:stop-server",
            "herdr:install-integration",
        ]);
        expect(handlers.has("herdr:request")).toBe(false);

        expect(handlers.get("herdr:get-status")?.({})).toEqual(projection.status);
        await expect(handlers.get("herdr:get-snapshot")?.({})).resolves.toEqual(projection);
        await handlers.get("herdr:read-agent-output")?.({}, { target: "pane-1", source: "recent" });
        await handlers.get("herdr:focus-agent")?.({}, { target: "pane-1" });
        await handlers.get("herdr:prompt-agent")?.({}, { target: "pane-1", text: "hello" });
        await handlers.get("herdr:send-agent-keys")?.({}, { target: "pane-1", keys: ["enter"] });
        await handlers.get("herdr:start-server")?.({});

        expect(bridge.readAgentOutput).toHaveBeenCalledWith({ target: "pane-1", source: "recent" });
        expect(bridge.focusAgent).toHaveBeenCalledWith({ target: "pane-1" });
        expect(bridge.promptAgent).toHaveBeenCalledWith({ target: "pane-1", text: "hello" });
        expect(bridge.sendAgentKeys).toHaveBeenCalledWith({ target: "pane-1", keys: ["enter"] });
        expect(bridge.start).toHaveBeenCalledOnce();
        expect(supervisor.stop).not.toHaveBeenCalled();
    });

    it("rejects stop/install without explicit confirmation and does not call Herdr", async () => {
        const bridge = {
            getProjection: vi.fn(),
            stop: vi.fn(),
            installIntegration: vi.fn(),
        };
        const supervisor = { stop: vi.fn(async () => true) };
        setupHerdrIpc({
            bridge: bridge as unknown as HerdrStateBridge,
            supervisor,
        });

        await expect(handlers.get("herdr:stop-server")?.({}, { confirmed: false })).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.herdr.stopUnconfirmed",
        });
        await expect(handlers.get("herdr:install-integration")?.({}, { target: "pi" })).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.herdr.installUnconfirmed",
        });
        await expect(handlers.get("herdr:install-integration")?.({}, {
            target: "codex",
            confirmed: true,
        })).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.herdr.installUnconfirmed",
        });

        expect(bridge.stop).not.toHaveBeenCalled();
        expect(supervisor.stop).not.toHaveBeenCalled();
        expect(bridge.installIntegration).not.toHaveBeenCalled();
    });

    it("stops the persistent server only after confirmed stop IPC", async () => {
        const projection = emptyProjection();
        const bridge = {
            getProjection: vi.fn(() => projection),
            stop: vi.fn(),
        };
        const supervisor = { stop: vi.fn(async () => true) };
        setupHerdrIpc({
            bridge: bridge as unknown as HerdrStateBridge,
            supervisor,
        });

        await expect(handlers.get("herdr:stop-server")?.({}, { confirmed: true })).resolves.toBeUndefined();
        expect(bridge.stop).toHaveBeenCalledOnce();
        expect(supervisor.stop).toHaveBeenCalledOnce();
    });

    it("rejects oversized prompt/keys before invoking the bridge", async () => {
        const bridge = {
            promptAgent: vi.fn(),
            sendAgentKeys: vi.fn(),
        };
        setupHerdrIpc({
            bridge: bridge as unknown as HerdrStateBridge,
            supervisor: { stop: vi.fn(async () => false) },
        });

        await expect(handlers.get("herdr:prompt-agent")?.({}, {
            target: "pane-1",
            text: "x".repeat(200_001),
        })).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.herdr.invalidPrompt",
        });
        await expect(handlers.get("herdr:send-agent-keys")?.({}, {
            target: "pane-1",
            keys: Array.from({ length: 201 }, () => "a"),
        })).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.herdr.invalidKeys",
        });
        expect(bridge.promptAgent).not.toHaveBeenCalled();
        expect(bridge.sendAgentKeys).not.toHaveBeenCalled();
    });
});
