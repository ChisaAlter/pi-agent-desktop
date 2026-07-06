import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError, type AppSettings, type Workspace } from "@shared";
import type { PiAgentConfig } from "../../types";

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

const listLocalSkillsMock = vi.fn();

vi.mock("../../services/skills/list-local-skills", () => ({
    listLocalSkills: (...args: unknown[]) => listLocalSkillsMock(...args),
}));

import { setupSettingsIpc } from "../settings.ipc";

function createPiConfig(defaultProvider: string, defaultModel: string): PiAgentConfig {
    return {
        defaultProvider,
        defaultModel,
        providers: [
            {
                id: defaultProvider,
                name: defaultProvider.toUpperCase(),
                models: [
                    {
                        id: defaultModel,
                        name: defaultModel,
                        provider: defaultProvider,
                        providerName: defaultProvider.toUpperCase(),
                    },
                ],
            },
        ],
    };
}

function createStore(settings: Partial<AppSettings> = {}) {
    const state = {
        settings: {
            theme: "light",
            fontSize: 14,
            model: "",
            provider: "",
            temperature: 0.7,
            maxTokens: 4096,
            autoSave: true,
            showLineNumbers: true,
            wordWrap: true,
            schemaVersion: 1,
            permissionLevel: "smart",
            runtimeChannel: "stable",
            autoCompactionEnabled: false,
            workspaceToolDefaults: {},
            sidebarGroupMode: "date",
            shortcutOverrides: [],
            showThinking: true,
            thinkingLevel: "medium",
            ...settings,
        } satisfies AppSettings,
        workspaces: [] satisfies Workspace[],
    };

    return {
        get: vi.fn((key: "settings" | "workspaces") => state[key]),
        set: vi.fn((key: "settings", value: AppSettings) => {
            state[key] = value;
        }),
    };
}

describe("setupSettingsIpc", () => {
    beforeEach(() => {
        handlers.clear();
        webContentsSend.mockReset();
        listLocalSkillsMock.mockReset();
    });

    it("reloads Pi config before returning settings:load-pi-config so stale main-process cache does not leak into settings", async () => {
        const store = createStore();
        const staleConfig = createPiConfig("mimo", "mimo-v2.5");
        const freshConfig = createPiConfig("longcat", "longcat-preview");
        let cachedConfig = staleConfig;
        let nextDiskConfig = staleConfig;
        const reloadPiAgentConfig = vi.fn(() => {
            cachedConfig = nextDiskConfig;
            return cachedConfig;
        });

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => cachedConfig,
            reloadPiAgentConfig,
            piAgentDir: "C:/Users/demo/.pi/agent",
        } as never);

        const loadPiConfig = handlers.get("settings:load-pi-config");
        expect(loadPiConfig).toBeTruthy();

        const initial = await loadPiConfig?.({});
        expect(initial).toMatchObject({
            currentModel: { provider: "mimo", model: "mimo-v2.5" },
        });

        nextDiskConfig = freshConfig;
        const refreshed = await loadPiConfig?.({});
        expect(refreshed).toMatchObject({
            currentModel: { provider: "longcat", model: "longcat-preview" },
        });
        expect(reloadPiAgentConfig).toHaveBeenCalledTimes(2);
    });

    it("reloads Pi config before returning pi:get-full-config so the PiAgent tab reflects current disk config", async () => {
        const store = createStore();
        const staleConfig = createPiConfig("mimo", "mimo-v2.5");
        const freshConfig = createPiConfig("longcat", "longcat-preview");
        let cachedConfig = staleConfig;
        let nextDiskConfig = staleConfig;
        const reloadPiAgentConfig = vi.fn(() => {
            cachedConfig = nextDiskConfig;
            return cachedConfig;
        });

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => cachedConfig,
            reloadPiAgentConfig,
            piAgentDir: "C:/Users/demo/.pi/agent",
        } as never);

        const getFullConfig = handlers.get("pi:get-full-config");
        expect(getFullConfig).toBeTruthy();

        const initial = await getFullConfig?.({});
        expect(initial).toMatchObject({
            defaultProvider: "mimo",
            defaultModel: "mimo-v2.5",
        });

        nextDiskConfig = freshConfig;
        const refreshed = await getFullConfig?.({});
        expect(refreshed).toMatchObject({
            defaultProvider: "longcat",
            defaultModel: "longcat-preview",
        });
        expect(reloadPiAgentConfig).toHaveBeenCalledTimes(2);
    });

    it("broadcasts pi-config:changed when a reload discovers different disk config so other windows can refresh model lists", async () => {
        const store = createStore();
        const staleConfig = createPiConfig("mimo", "mimo-v2.5");
        const freshConfig = createPiConfig("longcat", "longcat-preview");
        let cachedConfig = staleConfig;
        let nextDiskConfig = staleConfig;
        const reloadPiAgentConfig = vi.fn(() => {
            cachedConfig = nextDiskConfig;
            return cachedConfig;
        });

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => cachedConfig,
            reloadPiAgentConfig,
            piAgentDir: "C:/Users/demo/.pi/agent",
        } as never);

        const loadPiConfig = handlers.get("settings:load-pi-config");
        expect(loadPiConfig).toBeTruthy();

        await loadPiConfig?.({});
        expect(webContentsSend).not.toHaveBeenCalledWith("pi-config:changed");

        nextDiskConfig = freshConfig;
        await loadPiConfig?.({});
        expect(webContentsSend).toHaveBeenCalledWith("pi-config:changed");
    });

    it("calls onSettingsChanged and broadcasts settings:changed after settings:set", async () => {
        const store = createStore();
        const onSettingsChanged = vi.fn();

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => null,
            piAgentDir: "C:/Users/demo/.pi/agent",
            onSettingsChanged,
        } as never);

        const setSettings = handlers.get("settings:set");
        expect(setSettings).toBeTruthy();

        const result = await setSettings?.({}, { permissionLevel: "always", visionModel: "gpt-4.1-mini" });
        expect(result).toMatchObject({
            permissionLevel: "always",
            visionModel: "gpt-4.1-mini",
        });
        expect(onSettingsChanged).toHaveBeenCalledTimes(1);
        expect(onSettingsChanged).toHaveBeenCalledWith(
            expect.objectContaining({
                permissionLevel: "always",
                visionModel: "gpt-4.1-mini",
            }),
            expect.objectContaining({
                permissionLevel: "smart",
            }),
        );
        expect(webContentsSend).toHaveBeenCalledWith(
            "settings:changed",
            expect.objectContaining({
                permissionLevel: "always",
                visionModel: "gpt-4.1-mini",
            }),
        );
    });

    it("falls back to the most recently active workspace for pi:list-skills when the renderer does not provide a workspace id", async () => {
        const store = createStore();
        const workspaces: Workspace[] = [
            {
                id: "ws-old",
                name: "old",
                path: "C:/repo-old",
                createdAt: 1,
                lastActiveAt: 10,
            },
            {
                id: "ws-new",
                name: "new",
                path: "C:/repo-new",
                createdAt: 2,
                lastActiveAt: 20,
            },
        ];
        (store.get as ReturnType<typeof vi.fn>).mockImplementation((key: "settings" | "workspaces") => {
            if (key === "workspaces") return workspaces;
            return {
                theme: "light",
                fontSize: 14,
                model: "",
                provider: "",
                temperature: 0.7,
                maxTokens: 4096,
                autoSave: true,
                showLineNumbers: true,
                wordWrap: true,
                schemaVersion: 1,
                permissionLevel: "smart",
                runtimeChannel: "stable",
                autoCompactionEnabled: false,
                workspaceToolDefaults: {},
                sidebarGroupMode: "date",
                shortcutOverrides: [],
                showThinking: true,
                thinkingLevel: "medium",
            } satisfies AppSettings;
        });
        listLocalSkillsMock.mockResolvedValue([{ slug: "demo-skill", name: "Demo Skill" }]);

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => null,
            piAgentDir: "C:/Users/demo/.pi/agent",
        } as never);

        const listSkills = handlers.get("pi:list-skills");
        expect(listSkills).toBeTruthy();

        const result = await listSkills?.({}, undefined);
        expect(listLocalSkillsMock).toHaveBeenCalledWith("C:/repo-new");
        expect(result).toEqual([{ slug: "demo-skill", name: "Demo Skill" }]);
    });

    it("returns workspaceNotFound when pi:list-skills receives an unknown workspace id", async () => {
        const store = createStore();

        setupSettingsIpc({
            store,
            getPiAgentConfig: () => null,
            piAgentDir: "C:/Users/demo/.pi/agent",
        } as never);

        const listSkills = handlers.get("pi:list-skills");
        expect(listSkills).toBeTruthy();

        const result = await listSkills?.({}, { workspaceId: "missing-workspace" });
        expect(listLocalSkillsMock).not.toHaveBeenCalled();
        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.chat.workspaceNotFound");
            expect(result.params).toMatchObject({ id: "missing-workspace" });
        }
    });
});
