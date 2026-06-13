// settings-store 测试 (v1.0.9)
// 覆盖: 初始状态 / open/close / updateSettings 走 IpcError 路径 / resetSettings / clearWriteError

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ipcError } from "@shared";
import type { AppSettings } from "@shared";

// mock window.piAPI; 每个 case 单独覆盖
const mockApi = {
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    loadPiConfig: vi.fn(),
    configSetDefaultModel: vi.fn(),
};

async function flushPendingSettingsWrite(): Promise<void> {
    await vi.advanceTimersByTimeAsync(150);
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    vi.useRealTimers();
    (globalThis as { window: unknown }).window = { piAPI: mockApi };
    vi.clearAllMocks();
});

// store 顶层会调 getSettings() (loadSettings), mock 默认返 {}
mockApi.getSettings.mockResolvedValue({});

import { useSettingsStore } from "../settings-store";

describe("settings-store: 初始状态", () => {
    it("默认 settings 是 defaultSettings", () => {
        useSettingsStore.setState({
            settings: {
                theme: "light", fontSize: 14, model: "", provider: "",
                temperature: 0.7, maxTokens: 4096, autoSave: true,
                showLineNumbers: true, wordWrap: true,
            },
            isOpen: false,
            piModels: null,
            lastWriteError: null,
        });
        const s = useSettingsStore.getState();
        expect(s.isOpen).toBe(false);
        expect(s.settings.theme).toBe("light");
        expect(s.lastWriteError).toBeNull();
    });
});

describe("settings-store: open / close / toggle", () => {
    it("openSettings → isOpen=true", () => {
        useSettingsStore.setState({ isOpen: false });
        useSettingsStore.getState().openSettings();
        expect(useSettingsStore.getState().isOpen).toBe(true);
    });

    it("closeSettings → isOpen=false", () => {
        useSettingsStore.setState({ isOpen: true });
        useSettingsStore.getState().closeSettings();
        expect(useSettingsStore.getState().isOpen).toBe(false);
    });

    it("toggleSettings 翻 isOpen", () => {
        useSettingsStore.setState({ isOpen: false });
        useSettingsStore.getState().toggleSettings();
        expect(useSettingsStore.getState().isOpen).toBe(true);
        useSettingsStore.getState().toggleSettings();
        expect(useSettingsStore.getState().isOpen).toBe(false);
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
