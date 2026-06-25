import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn(),
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
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import type { AppSettings } from "@shared";
import { setupSettingsIpc } from "../settings.ipc";

describe("setupSettingsIpc", () => {
    beforeEach(() => {
        handlers.clear();
        webContentsSend.mockClear();
    });

    it("notifies the host when settings:set updates long-horizon capabilities", async () => {
        const onSettingsChanged = vi.fn();
        const settings: AppSettings = {
            theme: "light",
            fontSize: 14,
            model: "",
            provider: "",
            temperature: 0.7,
            maxTokens: 4096,
            autoSave: true,
            showLineNumbers: true,
            wordWrap: true,
            permissionLevel: "smart",
            runtimeChannel: "stable",
            autoCompactionEnabled: false,
            workspaceToolDefaults: {},
            longHorizon: {
                enabled: true,
                defaultMode: "build",
                planMode: { enabled: true },
                composeMode: { enabled: true },
                maxMode: { enabled: true, candidates: 5 },
                memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
                history: { enabled: true },
                checkpoint: { enabled: true },
                goal: { enabled: true },
                subagents: { enabled: true },
                task: { enabled: true },
                actor: { enabled: true },
                workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
                dream: { enabled: false },
                distill: { enabled: false },
                composeWorkflow: { enabled: true },
            },
        };
        const store = {
            get: vi.fn(() => settings),
            set: vi.fn((_key: "settings", value: AppSettings) => {
                Object.assign(settings, value);
            }),
        };

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => null,
            piAgentDir: "C:/Users/test/.pi/agent",
            onSettingsChanged,
        });

        const handler = handlers.get("settings:set");
        await handler?.({}, {
            longHorizon: {
                ...settings.longHorizon!,
                planMode: { enabled: false },
            },
        });

        expect(onSettingsChanged).toHaveBeenCalledWith(
            expect.objectContaining({
                longHorizon: expect.objectContaining({
                    planMode: { enabled: false },
                }),
            }),
            expect.objectContaining({
                longHorizon: expect.objectContaining({
                    planMode: { enabled: true },
                }),
            }),
        );
    });
});
