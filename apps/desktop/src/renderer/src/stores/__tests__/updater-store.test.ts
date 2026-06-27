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
});
