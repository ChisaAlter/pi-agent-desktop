import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcError } from "@shared";

const updaterState = {
    phase: "idle",
    currentVersion: "0.1.0",
    latestVersion: null,
    updateAvailable: false,
    releaseNotes: null,
    progress: null,
    lastCheckedAt: null,
    disabledReason: null,
    error: null,
    releasePageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest",
};

const listeners: Array<(state: typeof updaterState) => void> = [];
const mockApi = {
    updaterGetState: vi.fn(),
    updaterCheck: vi.fn(),
    updaterDownload: vi.fn(),
    updaterInstall: vi.fn(),
    onUpdaterStateChanged: vi.fn((cb: (state: typeof updaterState) => void) => {
        listeners.push(cb);
        return () => undefined;
    }),
};

beforeEach(() => {
    listeners.length = 0;
    vi.clearAllMocks();
    (globalThis as { window: unknown }).window = { piAPI: mockApi };
    // Module-level cleanupFn must be cleared so setupListeners re-registers.
    useUpdaterStore.getState().cleanupListeners();
});
import { useUpdaterStore } from "../updater-store";

describe("updater-store", () => {
    it("hydrates from updaterGetState and listens for pushed state changes", async () => {
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);

        await useUpdaterStore.getState().hydrate();
        useUpdaterStore.getState().setupListeners();
        listeners[0]?.({
            ...updaterState,
            phase: "available",
            latestVersion: "0.2.0",
            updateAvailable: true,
        });

        expect(useUpdaterStore.getState().state).toMatchObject({
            phase: "available",
            latestVersion: "0.2.0",
            updateAvailable: true,
        });
    });

    it("records IPC errors from manual check without discarding the last good state", async () => {
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        mockApi.updaterCheck.mockResolvedValueOnce(ipcError("ipcErrors.updater.checkFailed", "检查更新失败"));

        await useUpdaterStore.getState().hydrate();
        await useUpdaterStore.getState().checkForUpdates();

        expect(useUpdaterStore.getState().error).toMatchObject({
            code: "ipcErrors.updater.checkFailed",
        });
        expect(useUpdaterStore.getState().state).toMatchObject({
            phase: "idle",
            currentVersion: "0.1.0",
        });
    });

    it("applies download progress and failure without losing currentVersion", async () => {
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        mockApi.updaterDownload.mockResolvedValueOnce({
            ...updaterState,
            phase: "downloading",
            progress: { percent: 35, bytesPerSecond: 512, transferred: 35, total: 100 },
            latestVersion: "0.2.0",
            updateAvailable: true,
        });

        await useUpdaterStore.getState().hydrate();
        await useUpdaterStore.getState().downloadUpdate();

        expect(useUpdaterStore.getState().state).toMatchObject({
            phase: "downloading",
            progress: { percent: 35 },
            currentVersion: "0.1.0",
        });

        mockApi.updaterDownload.mockResolvedValueOnce(
            ipcError("ipcErrors.updater.downloadFailed", "磁盘空间不足"),
        );
        await useUpdaterStore.getState().downloadUpdate();

        expect(useUpdaterStore.getState().error).toMatchObject({
            code: "ipcErrors.updater.downloadFailed",
        });
        expect(useUpdaterStore.getState().state?.currentVersion).toBe("0.1.0");
    });

    it("pushes progress updates from onUpdaterStateChanged during download", async () => {
        useUpdaterStore.getState().cleanupListeners();
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        await useUpdaterStore.getState().hydrate();
        useUpdaterStore.getState().setupListeners();

        expect(listeners.length).toBeGreaterThan(0);
        listeners[listeners.length - 1]?.({
            ...updaterState,
            phase: "downloading",
            latestVersion: "0.2.0",
            updateAvailable: true,
            progress: { percent: 88, bytesPerSecond: 2048, transferred: 88, total: 100 },
        });

        expect(useUpdaterStore.getState().state).toMatchObject({
            phase: "downloading",
            progress: { percent: 88 },
        });
        expect(useUpdaterStore.getState().loading).toBe(false);
    });

    // wave-97 residual: install / hydrate errors / listener idempotency / missing API
    it("installUpdate applies success state and records install IPC errors", async () => {
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        mockApi.updaterInstall.mockResolvedValueOnce({
            ...updaterState,
            phase: "installing",
            latestVersion: "0.2.0",
            updateAvailable: true,
        });
        await useUpdaterStore.getState().hydrate();
        await useUpdaterStore.getState().installUpdate();
        expect(useUpdaterStore.getState().state).toMatchObject({ phase: "installing", latestVersion: "0.2.0" });
        expect(useUpdaterStore.getState().loading).toBe(false);

        mockApi.updaterInstall.mockResolvedValueOnce(
            ipcError("ipcErrors.updater.installFailed", "安装失败"),
        );
        await useUpdaterStore.getState().installUpdate();
        expect(useUpdaterStore.getState().error).toMatchObject({
            code: "ipcErrors.updater.installFailed",
        });
        expect(useUpdaterStore.getState().state?.phase).toBe("installing");
    });

    it("hydrate records IpcError and transport throw without inventing state", async () => {
        useUpdaterStore.setState({ state: null, loading: false, error: null });
        mockApi.updaterGetState.mockResolvedValueOnce(
            ipcError("ipcErrors.updater.getStateFailed", "读取状态失败"),
        );
        await useUpdaterStore.getState().hydrate();
        expect(useUpdaterStore.getState().error).toMatchObject({
            code: "ipcErrors.updater.getStateFailed",
        });
        // hydrate does not invent state on IPC error — leaves prior state (null here)
        expect(useUpdaterStore.getState().state).toBeNull();
        expect(useUpdaterStore.getState().loading).toBe(false);

        mockApi.updaterGetState.mockRejectedValueOnce(new Error("transport down"));
        await useUpdaterStore.getState().hydrate();
        expect(useUpdaterStore.getState().error).toContain("transport down");
        expect(useUpdaterStore.getState().loading).toBe(false);
        expect(useUpdaterStore.getState().state).toBeNull();
    });

    it("checkForUpdates swallows transport throw and clears loading", async () => {
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        await useUpdaterStore.getState().hydrate();
        mockApi.updaterCheck.mockRejectedValueOnce(new Error("check transport failed"));
        await useUpdaterStore.getState().checkForUpdates();
        expect(useUpdaterStore.getState().error).toContain("check transport failed");
        expect(useUpdaterStore.getState().loading).toBe(false);
        expect(useUpdaterStore.getState().state?.currentVersion).toBe("0.1.0");
    });

    it("setupListeners is idempotent and cleanupListeners unsubscribes", async () => {
        useUpdaterStore.getState().cleanupListeners();
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        await useUpdaterStore.getState().hydrate();

        useUpdaterStore.getState().setupListeners();
        useUpdaterStore.getState().setupListeners();
        expect(mockApi.onUpdaterStateChanged).toHaveBeenCalledTimes(1);

        useUpdaterStore.getState().cleanupListeners();
        useUpdaterStore.getState().setupListeners();
        expect(mockApi.onUpdaterStateChanged).toHaveBeenCalledTimes(2);
    });

    it("missing updater APIs are no-ops", async () => {
        (globalThis as { window: unknown }).window = {
            piAPI: {
                updaterGetState: undefined,
                updaterCheck: undefined,
                updaterDownload: undefined,
                updaterInstall: undefined,
                onUpdaterStateChanged: undefined,
            },
        };
        useUpdaterStore.setState({ state: null, loading: false, error: null });
        await useUpdaterStore.getState().hydrate();
        await useUpdaterStore.getState().checkForUpdates();
        await useUpdaterStore.getState().downloadUpdate();
        await useUpdaterStore.getState().installUpdate();
        useUpdaterStore.getState().setupListeners();
        expect(useUpdaterStore.getState().state).toBeNull();
        expect(useUpdaterStore.getState().loading).toBe(false);
    });

    // wave-125 residual
    it("downloadUpdate success applies state; IpcError preserves prior state", async () => {
        mockApi.updaterGetState.mockResolvedValueOnce(updaterState);
        await useUpdaterStore.getState().hydrate();
        mockApi.updaterDownload.mockResolvedValueOnce({
            ...updaterState,
            phase: "downloaded",
            updateAvailable: true,
            latestVersion: "0.2.0",
        });
        await useUpdaterStore.getState().downloadUpdate();
        expect(useUpdaterStore.getState().state).toMatchObject({
            phase: "downloaded",
            latestVersion: "0.2.0",
        });
        expect(useUpdaterStore.getState().loading).toBe(false);

        mockApi.updaterDownload.mockResolvedValueOnce(
            ipcError("ipcErrors.updater.downloadFailed", "下载失败"),
        );
        await useUpdaterStore.getState().downloadUpdate();
        expect(useUpdaterStore.getState().error).toMatchObject({
            code: "ipcErrors.updater.downloadFailed",
        });
        expect(useUpdaterStore.getState().state?.phase).toBe("downloaded");
        expect(useUpdaterStore.getState().loading).toBe(false);
    });

    it("listener push clears error and loading", async () => {
        useUpdaterStore.getState().cleanupListeners();
        let push: ((state: typeof updaterState) => void) | undefined;
        mockApi.onUpdaterStateChanged.mockImplementationOnce((cb: (s: typeof updaterState) => void) => {
            push = cb;
            return vi.fn();
        });
        useUpdaterStore.setState({
            state: updaterState,
            loading: true,
            error: "stale",
        });
        useUpdaterStore.getState().setupListeners();
        push?.({
            ...updaterState,
            phase: "ready",
            updateAvailable: true,
            latestVersion: "0.3.0",
        });
        expect(useUpdaterStore.getState().state?.phase).toBe("ready");
        expect(useUpdaterStore.getState().loading).toBe(false);
        expect(useUpdaterStore.getState().error).toBeNull();
        useUpdaterStore.getState().cleanupListeners();
    });

    // wave-130 residual
    it("installUpdate transport throw clears loading and stringifies error", async () => {
        mockApi.updaterInstall.mockRejectedValueOnce(new Error("install crash"));
        useUpdaterStore.setState({ state: updaterState, loading: false, error: null });
        await useUpdaterStore.getState().installUpdate();
        expect(useUpdaterStore.getState().loading).toBe(false);
        expect(String(useUpdaterStore.getState().error)).toContain("install crash");
        expect(useUpdaterStore.getState().state).toEqual(updaterState);
    });

    it("cleanupListeners is safe when never setup", () => {
        useUpdaterStore.getState().cleanupListeners();
        useUpdaterStore.getState().cleanupListeners();
        expect(() => useUpdaterStore.getState().cleanupListeners()).not.toThrow();
    });

    it("hydrate no-op keeps prior error when updaterGetState missing", async () => {
        (globalThis as { window: unknown }).window = {
            piAPI: { updaterGetState: undefined },
        };
        useUpdaterStore.setState({
            state: updaterState,
            loading: false,
            error: "keep",
        });
        await useUpdaterStore.getState().hydrate();
        expect(useUpdaterStore.getState()).toMatchObject({
            state: updaterState,
            loading: false,
            error: "keep",
        });
    });

    // wave-239 residual
    it("setupListeners is idempotent and cleanup unsubscribes once", () => {
        const offState = vi.fn();
        mockApi.onUpdaterStateChanged.mockImplementation((cb: (state: typeof updaterState) => void) => {
            listeners.push(cb);
            return offState;
        });
        useUpdaterStore.getState().cleanupListeners();
        useUpdaterStore.getState().setupListeners();
        useUpdaterStore.getState().setupListeners();
        expect(mockApi.onUpdaterStateChanged).toHaveBeenCalledTimes(1);
        useUpdaterStore.getState().cleanupListeners();
        expect(offState).toHaveBeenCalledTimes(1);
        // second cleanup is no-op (cleanupFn already null)
        useUpdaterStore.getState().cleanupListeners();
        expect(offState).toHaveBeenCalledTimes(1);
    });

    it("checkForUpdates transport reject clears loading and stringifies error", async () => {
        mockApi.updaterCheck.mockRejectedValueOnce(new Error("check failed"));
        useUpdaterStore.setState({ loading: false, error: null, state: updaterState });
        await useUpdaterStore.getState().checkForUpdates();
        expect(useUpdaterStore.getState().loading).toBe(false);
        expect(String(useUpdaterStore.getState().error)).toContain("check failed");
    });
});
