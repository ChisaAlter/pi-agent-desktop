// settings-store 测试 (v1.0.9)
// 覆盖: 初始状态 / updateSettings 走 IpcError 路径 / resetSettings / clearWriteError

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ipcError, TOOL_PERMISSION_PRESETS as SHARED_TOOL_PERMISSION_PRESETS } from "@shared";
import type { AppSettings } from "@shared";

function createLocalStorageMock(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: vi.fn(() => values.clear()),
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
        removeItem: vi.fn((key: string) => values.delete(key)),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
}

// mock window.piAPI; 每个 case 单独覆盖
const mockApi = {
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    loadPiConfig: vi.fn(),
    configSetDefaultModel: vi.fn(),
    onPiConfigChanged: vi.fn(),
};

async function flushPendingSettingsWrite(): Promise<void> {
    await vi.advanceTimersByTimeAsync(150);
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    vi.useRealTimers();
    const localStorage = createLocalStorageMock();
    const documentElement = {
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        style: {
            setProperty: vi.fn(),
        },
    };
    const document = { documentElement };
    (globalThis as { window: unknown }).window = {
        piAPI: mockApi,
        localStorage,
        matchMedia: vi.fn(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })),
    };
    (globalThis as { document: unknown }).document = document;
    (globalThis as { localStorage: Storage }).localStorage = localStorage;
    vi.clearAllMocks();
});

// store 顶层会调 getSettings() (loadSettings), mock 默认返 {}
mockApi.getSettings.mockResolvedValue({});

import { TOOL_PERMISSION_PRESETS, useSettingsStore } from "../settings-store";

describe("settings-store: tool permission presets", () => {
    it("re-exports the frozen shared preset authority", () => {
        expect(TOOL_PERMISSION_PRESETS).toBe(SHARED_TOOL_PERMISSION_PRESETS);
        expect(Object.isFrozen(TOOL_PERMISSION_PRESETS)).toBe(true);
        expect(Object.isFrozen(TOOL_PERMISSION_PRESETS.development)).toBe(true);
    });
});

describe("settings-store: 初始状态", () => {
    it("默认 settings 是 defaultSettings", () => {
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            piModels: null,
            lastWriteError: null,
        });
        const s = useSettingsStore.getState();
        expect(s.settings.theme).toBe("light");
        expect(s.lastWriteError).toBeNull();
    });
});

describe("settings-store: updateSettings 走 IPC 错误路径", () => {
    it("成功: 调 setSettings, lastWriteError 保持 null", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({ lastWriteError: null });
        useSettingsStore.getState().updateSettings({ fontSize: 18 });
        await flushPendingSettingsWrite();
        const s = useSettingsStore.getState();
        expect(s.settings.fontSize).toBe(18);
        expect(s.lastWriteError).toBeNull();
        expect(mockApi.setSettings).toHaveBeenCalledWith({ fontSize: 18 });
        expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--font-size-body", "18px");
        expect(window.localStorage.setItem).toHaveBeenCalledWith("pi-desktop-font-size", "18");
    });

    it("成功: 清除上一次写错误", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue(undefined);
        useSettingsStore.setState({ lastWriteError: "stale error" });
        useSettingsStore.getState().updateSettings({ fontSize: 16 });
        await flushPendingSettingsWrite();
        expect(useSettingsStore.getState().lastWriteError).toBeNull();
    });

    it("失败 (IpcError): 调 setSettings, lastWriteError 写入 IpcError", async () => {
        vi.useFakeTimers();
        const err = ipcError("ipcErrors.settings.saveFailed", "保存失败: EACCES", { message: "EACCES" });
        mockApi.setSettings.mockResolvedValue(err);
        useSettingsStore.setState({ lastWriteError: null });
        useSettingsStore.getState().updateSettings({ fontSize: 18 });
        await flushPendingSettingsWrite();
        expect(useSettingsStore.getState().lastWriteError).toEqual(err);
    });

    it("老 throw 路径: setSettings 抛, lastWriteError 写入 string", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockRejectedValue(new Error("network down"));
        useSettingsStore.setState({ lastWriteError: null });
        useSettingsStore.getState().updateSettings({ fontSize: 18 });
        await flushPendingSettingsWrite();
        const s = useSettingsStore.getState();
        expect(typeof s.lastWriteError).toBe("string");
        expect(s.lastWriteError).toContain("network down");
    });

    // v1.0.10 (H2 修复): 失败时本地 settings 也要回滚, 跟磁盘保持一致
    it("失败 (IpcError): 本地 settings 回滚到写之前, 跟磁盘一致", async () => {
        vi.useFakeTimers();
        const err = ipcError("ipcErrors.settings.saveFailed", "保存失败: EACCES");
        mockApi.setSettings.mockResolvedValue(err);
        // 起点 fontSize = 14 (default)
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            lastWriteError: null,
        });
        useSettingsStore.getState().updateSettings({ fontSize: 18 });
        // 乐观更新立刻生效
        expect(useSettingsStore.getState().settings.fontSize).toBe(18);
        await flushPendingSettingsWrite();
        const s = useSettingsStore.getState();
        expect(s.settings.fontSize).toBe(14); // 回滚
        expect(s.lastWriteError).toEqual(err);
        expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--font-size-body", "18px");
        expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--font-size-body", "14px");
        expect(window.localStorage.setItem).toHaveBeenCalledWith("pi-desktop-font-size", "14");
    });

    it("连续更新会合并为一次后台保存，避免拖动设置时频繁 IPC", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            lastWriteError: null,
        });

        useSettingsStore.getState().updateSettings({ fontSize: 15 });
        useSettingsStore.getState().updateSettings({ fontSize: 16 });
        useSettingsStore.getState().updateSettings({ wordWrap: false });

        expect(useSettingsStore.getState().settings.fontSize).toBe(16);
        expect(useSettingsStore.getState().settings.wordWrap).toBe(false);
        expect(mockApi.setSettings).not.toHaveBeenCalled();

        await flushPendingSettingsWrite();

        expect(mockApi.setSettings).toHaveBeenCalledTimes(1);
        expect(mockApi.setSettings).toHaveBeenCalledWith({ fontSize: 16, wordWrap: false });
    });

    it("支持在窗口关闭前主动 flush 未落盘设置", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            lastWriteError: null,
        });

        useSettingsStore.getState().updateSettings({ fontSize: 17 });
        expect(mockApi.setSettings).not.toHaveBeenCalled();

        await useSettingsStore.getState().flushPendingSettingsWrite();

        expect(mockApi.setSettings).toHaveBeenCalledTimes(1);
        expect(mockApi.setSettings).toHaveBeenCalledWith({ fontSize: 17 });
        expect(useSettingsStore.getState().lastWriteError).toBeNull();
    });

    it("切换模型时同步写入 Pi 默认模型", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        mockApi.configSetDefaultModel.mockResolvedValue({ valid: true });
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            lastWriteError: null,
        });

        useSettingsStore.getState().updateSettings({ provider: "minimax", model: "MiniMax-M3" });
        await flushPendingSettingsWrite();

        expect(mockApi.setSettings).toHaveBeenCalledWith({ provider: "minimax", model: "MiniMax-M3" });
        expect(mockApi.configSetDefaultModel).toHaveBeenCalledWith("minimax", "MiniMax-M3");
        expect(useSettingsStore.getState().lastWriteError).toBeNull();
    });

    it("Pi 默认模型同步失败时回滚 UI 模型选择", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        mockApi.configSetDefaultModel.mockResolvedValue({ valid: false, error: "模型不存在，无法设为默认" });
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "old-model", provider: "old-provider",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            lastWriteError: null,
        });

        useSettingsStore.getState().updateSettings({ provider: "minimax", model: "MiniMax-M3" });
        await flushPendingSettingsWrite();
        await Promise.resolve();

        const s = useSettingsStore.getState();
        expect(s.settings.model).toBe("old-model");
        expect(s.settings.provider).toBe("old-provider");
        expect(String(s.lastWriteError)).toContain("模型不存在");
        expect(mockApi.setSettings).toHaveBeenLastCalledWith({ model: "old-model", provider: "old-provider" });
    });

    it("setTheme('system') applies the resolved theme but persists the selected system mode", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            lastWriteError: null,
        });

        useSettingsStore.getState().setTheme("system");
        await flushPendingSettingsWrite();

        expect(useSettingsStore.getState().settings.theme).toBe("system");
        expect(mockApi.setSettings).toHaveBeenCalledWith({ theme: "system" });
        expect(window.localStorage.setItem).toHaveBeenCalledWith("pi-desktop-theme", "system");
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith("data-theme", "dark");
    });

    it("setSidebarGroupMode persists the selected sidebar grouping mode", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
                sidebarGroupMode: "date",
            },
            sidebarGroupMode: "date",
            lastWriteError: null,
        });

        useSettingsStore.getState().setSidebarGroupMode("workspace");
        await flushPendingSettingsWrite();

        expect(useSettingsStore.getState().sidebarGroupMode).toBe("workspace");
        expect(useSettingsStore.getState().settings.sidebarGroupMode).toBe("workspace");
        expect(mockApi.setSettings).toHaveBeenCalledWith({ sidebarGroupMode: "workspace" });
    });

    it("persists shortcut overrides and updates runtime cache", async () => {
        vi.useFakeTimers();
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
                shortcutOverrides: [],
            },
            lastWriteError: null,
        });

        const shortcutOverrides = [{ id: "open-command-palette", keys: "Ctrl+Shift+Y" }];
        useSettingsStore.getState().updateSettings({ shortcutOverrides });
        await flushPendingSettingsWrite();

        expect(useSettingsStore.getState().settings.shortcutOverrides).toEqual(shortcutOverrides);
        expect(mockApi.setSettings).toHaveBeenCalledWith({ shortcutOverrides });
        expect(window.localStorage.setItem).toHaveBeenCalledWith(
            "pi-desktop-shortcut-overrides",
            JSON.stringify(shortcutOverrides),
        );
    });
});

describe("settings-store: resetSettings 走 IPC 错误路径", () => {
    it("成功: 调 setSettings(defaultSettings)", async () => {
        mockApi.setSettings.mockResolvedValue({});
        useSettingsStore.setState({ lastWriteError: "stale reset error" });
        useSettingsStore.getState().resetSettings();
        await Promise.resolve();
        await Promise.resolve();
        expect(mockApi.setSettings).toHaveBeenCalled();
        expect(useSettingsStore.getState().settings.fontSize).toBe(14); // 复位到 default
        expect(useSettingsStore.getState().lastWriteError).toBeNull();
    });

    it("失败 (IpcError): lastWriteError 写入", async () => {
        const err = ipcError("ipcErrors.settings.saveFailed", "重置失败", { message: "x" });
        mockApi.setSettings.mockResolvedValue(err);
        useSettingsStore.setState({ lastWriteError: null });
        useSettingsStore.getState().resetSettings();
        await Promise.resolve();
        await Promise.resolve();
        expect(useSettingsStore.getState().lastWriteError).toEqual(err);
    });
});

describe("settings-store: clearWriteError", () => {
    it("清 lastWriteError", () => {
        useSettingsStore.setState({ lastWriteError: "stale error" });
        useSettingsStore.getState().clearWriteError();
        expect(useSettingsStore.getState().lastWriteError).toBeNull();
    });
});

describe("settings-store: Pi 配置变更同步", () => {
    it("收到 Pi 配置变更事件后重新加载模型并替换旧缓存", async () => {
        vi.resetModules();
        const localStorage = createLocalStorageMock();
        let onChanged: (() => void) | undefined;
        const eventApi = {
            ...mockApi,
            getSettings: vi.fn(async () => ({})),
            setSettings: vi.fn(async () => ({})),
            loadPiConfig: vi.fn(async () => ({
                models: [
                    {
                        id: "longcat-preview",
                        name: "LongCat 2.0 Preview",
                        provider: "longcat",
                        providerName: "LongCat",
                        description: "LongCat · 通用 · 128K上下文",
                    },
                ],
                currentModel: { model: "longcat-preview", provider: "longcat" },
            })),
            onSettingsChanged: vi.fn(),
            onPiConfigChanged: vi.fn((cb: () => void) => {
                onChanged = cb;
                return vi.fn();
            }),
        };
        (globalThis as { window: unknown }).window = {
            piAPI: eventApi,
            localStorage,
            matchMedia: vi.fn(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        };
        (globalThis as { localStorage: Storage }).localStorage = localStorage;

        const { useSettingsStore: freshStore } = await import("../settings-store");
        // 监听器现在通过 init() 注册 (不再 module-top-level side effect)
        freshStore.getState().init();
        freshStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "mimo-v2.5", provider: "mimo",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            piModels: [
                {
                    id: "mimo-v2.5",
                    name: "MiMo v2.5",
                    provider: "mimo",
                    providerName: "MiMo",
                    description: "stale",
                },
            ],
            lastWriteError: null,
        });

        expect(eventApi.onPiConfigChanged).toHaveBeenCalledTimes(1);
        await onChanged?.();
        await Promise.resolve();

        expect(freshStore.getState().piModels).toEqual([
            expect.objectContaining({
                id: "longcat-preview",
                provider: "longcat",
                name: "LongCat 2.0 Preview",
            }),
        ]);
        expect(freshStore.getState().settings).toMatchObject({
            model: "longcat-preview",
            provider: "longcat",
        });
    });
});

// wave-129 residual
describe("settings-store residual rightRail/fontSize", () => {
    beforeEach(async () => {
        vi.resetModules();
        const { useSettingsStore } = await import("../settings-store");
        useSettingsStore.setState({
            rightRailCollapsed: true,
            lastWriteError: null,
        });
        (globalThis as { window?: unknown }).window = {
            piAPI: {
                setSettings: vi.fn(async () => undefined),
            },
            localStorage: {
                getItem: vi.fn(() => null),
                setItem: vi.fn(),
                removeItem: vi.fn(),
            },
        };
    });

    it("toggleRightRail flips collapsed state without IPC", async () => {
        const { useSettingsStore } = await import("../settings-store");
        expect(useSettingsStore.getState().rightRailCollapsed).toBe(true);
        useSettingsStore.getState().toggleRightRail();
        expect(useSettingsStore.getState().rightRailCollapsed).toBe(false);
        useSettingsStore.getState().toggleRightRail();
        expect(useSettingsStore.getState().rightRailCollapsed).toBe(true);
    });

    it("updateSettings applies clamped fontSize to DOM but keeps raw settings value", async () => {
        const { useSettingsStore } = await import("../settings-store");
        const { normalizeFontSize } = await import("../../utils/theme");
        // product: optimistic merge stores raw fontSize; only applyAndCacheFontSize clamps for CSS vars
        useSettingsStore.getState().updateSettings({ fontSize: 99 });
        expect(useSettingsStore.getState().settings.fontSize).toBe(99);
        expect(normalizeFontSize(99)).toBe(20);
        useSettingsStore.getState().updateSettings({ fontSize: 1 });
        expect(useSettingsStore.getState().settings.fontSize).toBe(1);
        expect(normalizeFontSize(1)).toBe(12);
    });
});
