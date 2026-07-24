// pi-status-store IpcError 路径测试 (v1.0.8)
// 覆盖: partition 逻辑 + IPC 返 IpcError 时 error 字段是 IpcError (非 string)
//       + 兼容 catch 路径 (老 throw / preload 未桥接)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ipcError } from "@shared";
import type { PiStatus } from "@shared";

// mock window.piAPI; 每个 case 单独覆盖
const mockApi = {
    onPiStatusChanged: vi.fn(),
    onPiInstallProgress: vi.fn(),
    getStatus: vi.fn(),
    refreshPiStatus: vi.fn(),
    installPi: vi.fn(),
    updatePi: vi.fn(),
    uninstallPi: vi.fn(),
    cancelPiOperation: vi.fn(),
};

beforeEach(() => {
    (globalThis as { window: unknown }).window = { piAPI: mockApi };
    vi.clearAllMocks();
});

// 注: store 顶层会调 setupListeners 不需要, 这里我们只测 actions
import { usePiStatusStore } from "../pi-status-store";

const fakeStatus: PiStatus = {
    installed: true,
    localVersion: "0.75.5",
    latestVersion: "0.75.5",
    updateAvailable: false,
    executablePath: "/usr/bin/pi",
    installMethod: "npm",
    configExists: true,
    defaultProvider: "",
    defaultModel: "",
};

describe("pi-status-store: checkStatus", () => {
    it("IPC 返 PiStatus → 写入 status, 清 error", async () => {
        mockApi.getStatus.mockResolvedValue(fakeStatus);
        usePiStatusStore.setState({ loading: false, error: null, status: null });
        await usePiStatusStore.getState().checkStatus();
        const s = usePiStatusStore.getState();
        expect(s.status).toEqual(fakeStatus);
        expect(s.error).toBeNull();
        expect(s.loading).toBe(false);
    });

    it("IPC 返 IpcError → 写入 error (IpcError), status 保留旧值", async () => {
        const err = ipcError("ipcErrors.pi.detectFailed", "检测 Pi 状态失败: EACCES", { message: "EACCES" });
        mockApi.getStatus.mockResolvedValue(err);
        usePiStatusStore.setState({ loading: false, error: null, status: fakeStatus });
        await usePiStatusStore.getState().checkStatus();
        const s = usePiStatusStore.getState();
        expect(s.error).toEqual(err);
        expect(s.status).toEqual(fakeStatus); // 没被覆盖
        expect(s.loading).toBe(false);
    });

    it("IPC throw (老路径) → error 走 string 兜底", async () => {
        mockApi.getStatus.mockRejectedValue(new Error("network down"));
        usePiStatusStore.setState({ loading: false, error: null, status: null });
        await usePiStatusStore.getState().checkStatus();
        const s = usePiStatusStore.getState();
        expect(typeof s.error).toBe("string");
        expect(s.error).toContain("network down");
    });
});

describe("pi-status-store: install", () => {
    it("成功: 调 installPi, isOperating 翻 false, refreshStatus 接力调", async () => {
        mockApi.installPi.mockResolvedValue(fakeStatus);
        mockApi.refreshPiStatus.mockResolvedValue(fakeStatus);
        usePiStatusStore.setState({ isOperating: false, error: null, status: null });
        await usePiStatusStore.getState().install();
        const s = usePiStatusStore.getState();
        expect(mockApi.installPi).toHaveBeenCalledTimes(1);
        expect(mockApi.refreshPiStatus).toHaveBeenCalledTimes(1);
        expect(s.isOperating).toBe(false);
        expect(s.status).toEqual(fakeStatus);
        expect(s.error).toBeNull();
    });

    it("失败 (IpcError): isOperating 翻 false, error 写入 IpcError, 不调 refresh", async () => {
        const err = ipcError("ipcErrors.pi.installFailed", "安装失败: EACCES", { message: "EACCES" });
        mockApi.installPi.mockResolvedValue(err);
        usePiStatusStore.setState({ isOperating: false, error: null, status: null });
        await usePiStatusStore.getState().install();
        const s = usePiStatusStore.getState();
        expect(s.isOperating).toBe(false);
        expect(s.error).toEqual(err);
        expect(mockApi.refreshPiStatus).not.toHaveBeenCalled();
    });
});

describe("pi-status-store: update", () => {
    it("成功路径", async () => {
        mockApi.updatePi.mockResolvedValue(fakeStatus);
        mockApi.refreshPiStatus.mockResolvedValue(fakeStatus);
        await usePiStatusStore.getState().update();
        expect(mockApi.updatePi).toHaveBeenCalled();
    });

    it("失败: IpcError 写入 error", async () => {
        const err = ipcError("ipcErrors.pi.updateFailed", "更新失败", { message: "x" });
        mockApi.updatePi.mockResolvedValue(err);
        usePiStatusStore.setState({ error: null, isOperating: false });
        await usePiStatusStore.getState().update();
        expect(usePiStatusStore.getState().error).toEqual(err);
    });
});

describe("pi-status-store: uninstall", () => {
    it("成功路径", async () => {
        mockApi.uninstallPi.mockResolvedValue(fakeStatus);
        mockApi.refreshPiStatus.mockResolvedValue(fakeStatus);
        await usePiStatusStore.getState().uninstall();
        expect(mockApi.uninstallPi).toHaveBeenCalled();
    });

    it("失败: IpcError 写入 error", async () => {
        const err = ipcError("ipcErrors.pi.uninstallFailed", "卸载失败", { message: "x" });
        mockApi.uninstallPi.mockResolvedValue(err);
        usePiStatusStore.setState({ error: null, isOperating: false });
        await usePiStatusStore.getState().uninstall();
        expect(usePiStatusStore.getState().error).toEqual(err);
    });
});

describe("pi-status-store: cancelOperation", () => {
    it("调 cancelPiOperation, 清 isOperating 和 progress", async () => {
        mockApi.cancelPiOperation.mockResolvedValue(undefined);
        usePiStatusStore.setState({ isOperating: true, progress: { stage: "downloading", message: "x" } });
        await usePiStatusStore.getState().cancelOperation();
        const s = usePiStatusStore.getState();
        expect(s.isOperating).toBe(false);
        expect(s.progress).toBeNull();
    });
});

describe("pi-status-store: refreshStatus", () => {
    it("IPC 返 IpcError → error 字段是 IpcError", async () => {
        const err = ipcError("ipcErrors.pi.detectFailed", "刷新失败", { message: "EIO" });
        mockApi.refreshPiStatus.mockResolvedValue(err);
        usePiStatusStore.setState({ error: null, status: null });
        await usePiStatusStore.getState().refreshStatus();
        expect(usePiStatusStore.getState().error).toEqual(err);
    });
});

// wave-104 residual
describe("pi-status-store residual", () => {
    it("install throw path records string error and clears isOperating", async () => {
        mockApi.installPi.mockRejectedValue(new Error("spawn failed"));
        usePiStatusStore.setState({ isOperating: false, error: null, status: null });
        await usePiStatusStore.getState().install();
        const s = usePiStatusStore.getState();
        expect(s.isOperating).toBe(false);
        expect(String(s.error)).toContain("spawn failed");
        expect(mockApi.refreshPiStatus).not.toHaveBeenCalled();
    });

    it("cancelOperation is safe when already idle", async () => {
        mockApi.cancelPiOperation.mockResolvedValue(undefined);
        usePiStatusStore.setState({ isOperating: false, progress: null, error: null });
        await usePiStatusStore.getState().cancelOperation();
        expect(mockApi.cancelPiOperation).toHaveBeenCalled();
        expect(usePiStatusStore.getState().isOperating).toBe(false);
        expect(usePiStatusStore.getState().progress).toBeNull();
    });

    it("refreshStatus success updates status and clears error", async () => {
        mockApi.refreshPiStatus.mockResolvedValue(fakeStatus);
        usePiStatusStore.setState({
            error: ipcError("ipcErrors.pi.detectFailed", "old", { message: "old" }),
            status: null,
        });
        await usePiStatusStore.getState().refreshStatus();
        expect(usePiStatusStore.getState().status).toEqual(fakeStatus);
        expect(usePiStatusStore.getState().error).toBeNull();
    });
});

// wave-125 residual
describe("pi-status-store residual (wave-125)", () => {
    it("update IpcError clears isOperating without refreshStatus", async () => {
        const err = ipcError("ipcErrors.pi.updateFailed", "更新失败", { message: "EPERM" });
        mockApi.updatePi.mockResolvedValue(err);
        usePiStatusStore.setState({ isOperating: false, error: null, status: fakeStatus });
        await usePiStatusStore.getState().update();
        const s = usePiStatusStore.getState();
        expect(s.isOperating).toBe(false);
        expect(s.error).toEqual(err);
        expect(s.status).toEqual(fakeStatus);
        expect(mockApi.refreshPiStatus).not.toHaveBeenCalled();
    });

    it("uninstall success clears isOperating and refreshes", async () => {
        mockApi.uninstallPi.mockResolvedValue(fakeStatus);
        mockApi.refreshPiStatus.mockResolvedValue({ ...fakeStatus, installed: false });
        usePiStatusStore.setState({ isOperating: false, error: null, status: fakeStatus });
        await usePiStatusStore.getState().uninstall();
        expect(mockApi.uninstallPi).toHaveBeenCalledTimes(1);
        expect(mockApi.refreshPiStatus).toHaveBeenCalledTimes(1);
        expect(usePiStatusStore.getState().isOperating).toBe(false);
        expect(usePiStatusStore.getState().status?.installed).toBe(false);
    });

    it("missing piAPI is a no-op for checkStatus/install", async () => {
        (globalThis as { window: unknown }).window = {};
        usePiStatusStore.setState({
            status: fakeStatus,
            loading: false,
            error: null,
            isOperating: false,
            progress: { stage: "downloading", message: "x" },
        });
        await usePiStatusStore.getState().checkStatus();
        await usePiStatusStore.getState().install();
        const s = usePiStatusStore.getState();
        expect(s.status).toEqual(fakeStatus);
        expect(s.loading).toBe(false);
        expect(s.isOperating).toBe(false);
        expect(s.error).toBeNull();
    });

    it("_setProgress done triggers refreshStatus without flipping isOperating", async () => {
        mockApi.refreshPiStatus.mockResolvedValue(fakeStatus);
        usePiStatusStore.setState({ isOperating: true, progress: null, status: null });
        usePiStatusStore.getState()._setProgress({ stage: "done", message: "完成" });
        expect(usePiStatusStore.getState().progress).toMatchObject({ stage: "done" });
        expect(usePiStatusStore.getState().isOperating).toBe(true);
        await vi.waitFor(() => {
            expect(mockApi.refreshPiStatus).toHaveBeenCalled();
        });
    });
});

// wave-130 residual
describe("pi-status-store residual update/cancel/listeners", () => {
    beforeEach(() => {
        (globalThis as { window: unknown }).window = { piAPI: mockApi };
        vi.clearAllMocks();
        usePiStatusStore.setState({
            status: fakeStatus,
            loading: false,
            error: null,
            progress: null,
            isOperating: false,
        });
        usePiStatusStore.getState().cleanupListeners();
    });

    it("update records IpcError and clears isOperating without refresh", async () => {
        mockApi.updatePi.mockResolvedValueOnce(ipcError("ipcErrors.pi.updateFailed", "更新失败"));
        await usePiStatusStore.getState().update();
        expect(usePiStatusStore.getState().isOperating).toBe(false);
        expect(usePiStatusStore.getState().error).toMatchObject({
            code: "ipcErrors.pi.updateFailed",
        });
        expect(mockApi.refreshPiStatus).not.toHaveBeenCalled();
    });

    it("update transport throw stringifies error", async () => {
        mockApi.updatePi.mockRejectedValueOnce(new Error("network"));
        await usePiStatusStore.getState().update();
        expect(usePiStatusStore.getState().isOperating).toBe(false);
        expect(String(usePiStatusStore.getState().error)).toContain("network");
    });

    it("cancelOperation clears progress and isOperating", async () => {
        mockApi.cancelPiOperation.mockResolvedValueOnce(undefined);
        usePiStatusStore.setState({
            isOperating: true,
            progress: { stage: "downloading", message: "x" },
        });
        await usePiStatusStore.getState().cancelOperation();
        expect(mockApi.cancelPiOperation).toHaveBeenCalled();
        expect(usePiStatusStore.getState().isOperating).toBe(false);
        expect(usePiStatusStore.getState().progress).toBeNull();
    });

    it("setupListeners is idempotent", () => {
        mockApi.onPiStatusChanged.mockReturnValue(vi.fn());
        mockApi.onPiInstallProgress.mockReturnValue(vi.fn());
        usePiStatusStore.getState().setupListeners();
        usePiStatusStore.getState().setupListeners();
        expect(mockApi.onPiStatusChanged).toHaveBeenCalledTimes(1);
        usePiStatusStore.getState().cleanupListeners();
    });

    // wave-239 residual
    it("cleanupListeners is safe when never setup and after double cleanup", () => {
        expect(() => usePiStatusStore.getState().cleanupListeners()).not.toThrow();
        mockApi.onPiStatusChanged.mockReturnValue(vi.fn());
        mockApi.onPiInstallProgress.mockReturnValue(vi.fn());
        usePiStatusStore.getState().setupListeners();
        usePiStatusStore.getState().cleanupListeners();
        usePiStatusStore.getState().cleanupListeners();
        expect(() => usePiStatusStore.getState().cleanupListeners()).not.toThrow();
    });

    it("_setProgress done stage triggers refreshStatus without clearing isOperating here", async () => {
        mockApi.refreshPiStatus.mockResolvedValueOnce(fakeStatus);
        usePiStatusStore.setState({ isOperating: true, progress: null });
        usePiStatusStore.getState()._setProgress({ stage: "done", message: "ok" });
        await Promise.resolve();
        await Promise.resolve();
        expect(mockApi.refreshPiStatus).toHaveBeenCalled();
        // product: isOperating reset is action-owned, not _setProgress
        expect(usePiStatusStore.getState().isOperating).toBe(true);
        expect(usePiStatusStore.getState().progress?.stage).toBe("done");
    });
});
