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

describe("setupChatIpc", () => {
    beforeEach(() => {
        handlers.clear();
        listeners.clear();
        webContentsSend.mockClear();
    });

    it("sends renderer event payload directly without a workspace envelope", async () => {
        const event = { type: "agent_start" };
        const registry = {
            get: vi.fn(async (_id, _path, _pendingEdits, send) => ({
                session: {
                    prompt: vi.fn(async () => {
                        send("pi:event", "ws_1", event);
                    }),
                    abort: vi.fn(),
                },
            })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:send");
        expect(handler).toBeTruthy();

        await handler?.({}, "ws_1", "hello");

        expect(webContentsSend).toHaveBeenCalledWith("pi:event", event);
    });
});
