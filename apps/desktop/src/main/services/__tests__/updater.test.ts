import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
const {
    windows,
    checkForUpdatesMock,
    downloadUpdateMock,
    fetchLatestReleaseMock,
    quitAndInstallMock,
} = vi.hoisted(() => ({
    windows: [
        { isDestroyed: () => false, webContents: { send: vi.fn() } },
        { isDestroyed: () => false, webContents: { send: vi.fn() } },
    ],
    checkForUpdatesMock: vi.fn(),
    downloadUpdateMock: vi.fn(),
    fetchLatestReleaseMock: vi.fn(),
    quitAndInstallMock: vi.fn(),
}));

vi.mock("electron", () => ({
    app: {
        isPackaged: true,
        getVersion: () => "0.1.0",
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => windows),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("electron-updater", () => ({
    autoUpdater: {
        autoDownload: true,
        autoInstallOnAppQuit: true,
        on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
            const existing = listeners.get(event) ?? [];
            existing.push(handler);
            listeners.set(event, existing);
        }),
        checkForUpdates: checkForUpdatesMock,
        downloadUpdate: downloadUpdateMock,
        quitAndInstall: quitAndInstallMock,
    },
}));

import { setupAutoUpdater } from "../updater";

function emit(event: string, ...args: unknown[]): void {
    for (const handler of listeners.get(event) ?? []) {
        handler(...args);
    }
}

describe("AppUpdaterService", () => {
    beforeEach(() => {
        listeners.clear();
        checkForUpdatesMock.mockReset();
        downloadUpdateMock.mockReset();
        fetchLatestReleaseMock.mockReset();
        quitAndInstallMock.mockReset();
        for (const win of windows) {
            win.webContents.send.mockReset();
        }
        vi.useFakeTimers();
    });

    it("checks GitHub release metadata when signed automatic updates are off", async () => {
        fetchLatestReleaseMock.mockResolvedValueOnce({
            tagName: "v0.2.0",
            body: "Manual release notes",
            pageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/tag/v0.2.0",
        });
        const service = setupAutoUpdater({
            autoUpdateEnabled: false,
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });

        expect(service.getState()).toMatchObject({
            phase: "idle",
            currentVersion: "0.1.0",
            updateAvailable: false,
        });
        expect(service.getState().disabledReason).toContain("签名");

        await service.checkForUpdates();

        expect(fetchLatestReleaseMock).toHaveBeenCalledTimes(1);
        expect(service.getState()).toMatchObject({
            phase: "available",
            latestVersion: "0.2.0",
            updateAvailable: true,
            releaseNotes: "Manual release notes",
        });
    });

    it("reports up to date when the GitHub release is older than the installed build", async () => {
        fetchLatestReleaseMock.mockResolvedValueOnce({
            tagName: "v0.0.9",
            body: null,
            pageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/tag/v0.0.9",
        });
        const service = setupAutoUpdater({
            autoUpdateEnabled: false,
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });

        await service.checkForUpdates();

        expect(service.getState()).toMatchObject({
            phase: "not-available",
            latestVersion: "0.0.9",
            updateAvailable: false,
        });
    });

    it("broadcasts normalized update availability and progress to every window", async () => {
        checkForUpdatesMock.mockResolvedValueOnce({ updateInfo: { version: "0.2.0" } });
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });

        await service.checkForUpdates();
        emit("checking-for-update");
        emit("update-available", {
            version: "0.2.0",
            releaseNotes: [
                { version: "0.2.0", note: "Line 1" },
                { version: "0.1.9", note: "Older" },
            ],
        });
        emit("download-progress", {
            percent: 42,
            bytesPerSecond: 1024,
            transferred: 420,
            total: 1000,
        });

        expect(service.getState()).toMatchObject({
            phase: "downloading",
            latestVersion: "0.2.0",
            updateAvailable: true,
            progress: expect.objectContaining({ percent: 42 }),
        });
        expect(service.getState().releaseNotes).toContain("Line 1");
        for (const win of windows) {
            expect(win.webContents.send).toHaveBeenCalledWith(
                "updater:state-changed",
                expect.objectContaining({
                    latestVersion: "0.2.0",
                }),
            );
        }
    });

    it("downloads and installs only after the state reaches downloaded", async () => {
        downloadUpdateMock.mockResolvedValueOnce(undefined);
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });

        emit("update-available", { version: "0.2.0", releaseNotes: "Patch notes" });
        await service.downloadUpdate();
        emit("update-downloaded", { version: "0.2.0", releaseNotes: "Patch notes" });
        await service.installUpdate();

        expect(downloadUpdateMock).toHaveBeenCalledTimes(1);
        expect(service.getState()).toMatchObject({
            phase: "downloaded",
            latestVersion: "0.2.0",
        });
        expect(quitAndInstallMock).toHaveBeenCalledTimes(1);
    });

    it("explains untrusted update signatures without exposing certificate internals", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });

        emit(
            "error",
            new Error("ERR_UPDATER_INVALID_SIGNATURE: A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider"),
        );

        expect(service.getState()).toMatchObject({
            phase: "error",
            error: "更新包的代码签名无法通过 Windows 信任校验。请暂勿安装，并从 GitHub Releases 获取受信任签名的版本。",
        });
    });

    it("normalizes noisy GitHub 404 errors before exposing them to the renderer", async () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });

        emit(
            "error",
            new Error(
                '404 "method: GET url: https://github.com/ChisaAlter/pi-agent-desktop/releases.atom\\n\\nPlease double check that your authentication token is correct.\\n"\\nHeaders: {"x-test":"value"}',
            ),
        );

        expect(service.getState()).toMatchObject({
            phase: "error",
            error: "未找到 GitHub Releases 元数据（404）。请确认仓库、发布页和 latest.yml 已公开发布。",
        });
    });
});
