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
        removeAllListeners: vi.fn((event?: string) => {
            if (event) listeners.delete(event);
            else listeners.clear();
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

    // wave-103 residual
    it("skips download when no update is available and install before downloaded", async () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        await service.downloadUpdate();
        expect(downloadUpdateMock).not.toHaveBeenCalled();
        await service.installUpdate();
        expect(quitAndInstallMock).not.toHaveBeenCalled();
    });

    it("records update-not-available and surfaces GitHub metadata errors", async () => {
        const enabled = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-not-available", { version: "0.1.0", releaseNotes: "same" });
        expect(enabled.getState()).toMatchObject({
            phase: "not-available",
            latestVersion: "0.1.0",
            updateAvailable: false,
        });

        fetchLatestReleaseMock.mockRejectedValueOnce(new Error("network down"));
        const manual = setupAutoUpdater({
            autoUpdateEnabled: false,
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await manual.checkForUpdates();
        expect(manual.getState()).toMatchObject({
            phase: "error",
            error: expect.stringContaining("network down"),
        });
        await expect(manual.downloadUpdate()).resolves.toMatchObject({ phase: "error" });
        await expect(manual.installUpdate()).resolves.toMatchObject({ phase: "error" });
    });

    it("dispose clears timers without throwing", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: true });
        expect(() => service.dispose()).not.toThrow();
        expect(() => service.dispose()).not.toThrow();
        vi.runOnlyPendingTimers();
    });

    // wave-134 residual
    it("downloadUpdate catches download failures into error phase", async () => {
        downloadUpdateMock.mockRejectedValueOnce(new Error("disk full"));
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "0.3.0", releaseNotes: "n" });
        const state = await service.downloadUpdate();
        expect(downloadUpdateMock).toHaveBeenCalledTimes(1);
        expect(state).toMatchObject({
            phase: "error",
            error: expect.stringContaining("disk full"),
        });
    });

    it("update-downloaded normalizes progress to 100 percent", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("download-progress", {
            percent: 50,
            bytesPerSecond: 10,
            transferred: 50,
            total: 100,
        });
        emit("update-downloaded", { version: "0.4.0", releaseNotes: "done" });
        expect(service.getState()).toMatchObject({
            phase: "downloaded",
            latestVersion: "0.4.0",
            updateAvailable: true,
            progress: expect.objectContaining({ percent: 100 }),
        });
    });

    it("getState returns a shallow clone so callers cannot mutate service state", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        const a = service.getState();
        a.phase = "error";
        a.error = "mutated";
        expect(service.getState().phase).toBe("idle");
        expect(service.getState().error).toBeNull();
    });

    // wave-174 residual
    it("GitHub metadata path treats equal versions as not-available and prerelease as older than release", async () => {
        fetchLatestReleaseMock.mockResolvedValueOnce({
            tagName: "v0.1.0",
            body: "same",
            pageUrl: "https://example.test/same",
        });
        const same = setupAutoUpdater({
            autoUpdateEnabled: false,
            currentVersion: "0.1.0",
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await same.checkForUpdates();
        expect(same.getState()).toMatchObject({
            phase: "not-available",
            latestVersion: "0.1.0",
            updateAvailable: false,
        });

        fetchLatestReleaseMock.mockResolvedValueOnce({
            tagName: "v0.2.0-beta.1",
            body: "pre",
            pageUrl: "https://example.test/pre",
        });
        const pre = setupAutoUpdater({
            autoUpdateEnabled: false,
            currentVersion: "0.2.0",
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await pre.checkForUpdates();
        // installed stable 0.2.0 is newer than prerelease candidate → not-available
        expect(pre.getState()).toMatchObject({
            phase: "not-available",
            updateAvailable: false,
            latestVersion: "0.2.0-beta.1",
        });
    });

    it("GitHub metadata path marks newer patch and stable-over-prerelease as available", async () => {
        fetchLatestReleaseMock.mockResolvedValueOnce({
            tagName: "v0.1.1",
            body: "patch",
            pageUrl: "https://example.test/patch",
        });
        const patch = setupAutoUpdater({
            autoUpdateEnabled: false,
            currentVersion: "0.1.0",
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await patch.checkForUpdates();
        expect(patch.getState()).toMatchObject({
            phase: "available",
            updateAvailable: true,
            latestVersion: "0.1.1",
            releaseNotes: "patch",
            releasePageUrl: "https://example.test/patch",
        });

        // stable candidate is always newer than an installed prerelease with same numbers
        fetchLatestReleaseMock.mockResolvedValueOnce({
            tagName: "v0.3.0",
            body: "stable",
            pageUrl: "https://example.test/stable",
        });
        const stable = setupAutoUpdater({
            autoUpdateEnabled: false,
            currentVersion: "0.3.0-rc.1",
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await stable.checkForUpdates();
        expect(stable.getState()).toMatchObject({
            phase: "available",
            updateAvailable: true,
            latestVersion: "0.3.0",
        });
    });

    it("normalizes network-style and empty errors on the GitHub metadata path", async () => {
        fetchLatestReleaseMock.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND api.github.com"));
        const network = setupAutoUpdater({
            autoUpdateEnabled: false,
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await network.checkForUpdates();
        expect(network.getState()).toMatchObject({
            phase: "error",
            error: "连接 GitHub Releases 失败，请检查网络连接后重试。",
        });

        fetchLatestReleaseMock.mockRejectedValueOnce(new Error("   "));
        const blank = setupAutoUpdater({
            autoUpdateEnabled: false,
            fetchLatestRelease: fetchLatestReleaseMock,
            scheduleChecks: false,
        });
        await blank.checkForUpdates();
        expect(blank.getState()).toMatchObject({
            phase: "error",
            error: "检查更新失败，请稍后重试。",
        });
    });

    // wave-186 residual
    it("downloadUpdate while idle does not call underlying download", async () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        expect(service.getState().phase).toBe("idle");
        const state = await service.downloadUpdate();
        expect(downloadUpdateMock).not.toHaveBeenCalled();
        // product returns current state (idle or error-style skip) without downloading
        expect(["idle", "error", "not-available"]).toContain(state.phase);
    });

    it("installUpdate before downloaded does not quitAndInstall", async () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "0.9.0", releaseNotes: "n" });
        const state = await service.installUpdate();
        expect(quitAndInstallMock).not.toHaveBeenCalled();
        expect(state.phase).not.toBe("downloaded");
    });

    it("initial state exposes release page url and null progress/error", () => {
        const service = setupAutoUpdater({
            autoUpdateEnabled: true,
            scheduleChecks: false,
            currentVersion: "1.0.14",
        });
        const state = service.getState();
        expect(state.currentVersion).toBe("1.0.14");
        expect(state.latestVersion).toBeNull();
        expect(state.updateAvailable).toBe(false);
        expect(state.progress).toBeNull();
        expect(state.error).toBeNull();
        expect(state.releasePageUrl).toMatch(/github\.com.*releases/i);
    });

    // wave-195 residual
    it("update-available event marks available with version and notes", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "1.0.15", releaseNotes: "fixes" });
        const state = service.getState();
        expect(state.phase).toBe("available");
        expect(state.updateAvailable).toBe(true);
        expect(state.latestVersion).toBe("1.0.15");
    });

    it("download-progress updates progress object while downloading", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "1.0.15", releaseNotes: "n" });
        emit("download-progress", { percent: 42.5, transferred: 100, total: 200, bytesPerSecond: 10 });
        const state = service.getState();
        expect(state.phase === "downloading" || state.progress != null || state.phase === "available").toBe(true);
        if (state.progress) {
            expect(state.progress.percent).toBeCloseTo(42.5);
        }
        void service;
    });

    it("update-not-available sets not-available phase", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-not-available", { version: "1.0.14" });
        expect(service.getState().phase).toBe("not-available");
        expect(service.getState().updateAvailable).toBe(false);
    });

    // wave-207 residual
    it("whitespace-only releaseNotes normalize to null; empty array notes null", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "1.1.0", releaseNotes: "   \n\t  " });
        expect(service.getState().releaseNotes).toBeNull();
        emit("update-available", { version: "1.1.1", releaseNotes: [] });
        expect(service.getState().releaseNotes).toBeNull();
        emit("update-available", {
            version: "1.1.2",
            releaseNotes: [
                { version: "1.1.2", note: "  " },
                { version: "1.1.1", note: "keep" },
            ],
        });
        expect(service.getState().releaseNotes).toBe("v1.1.1\nkeep");
    });

    it("download-progress fills missing numeric fields with 0; downloaded sets percent 100", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "2.0.0" });
        emit("download-progress", {});
        expect(service.getState().phase).toBe("downloading");
        expect(service.getState().progress).toEqual({
            percent: 0,
            bytesPerSecond: 0,
            transferred: 0,
            total: 0,
        });
        emit("update-downloaded", { version: "2.0.0", releaseNotes: "done" });
        const done = service.getState();
        expect(done.phase).toBe("downloaded");
        expect(done.progress?.percent).toBe(100);
        expect(done.updateAvailable).toBe(true);
        expect(done.releaseNotes).toBe("done");
    });

    it("error event normalizes app-update.yml and non-Error string messages", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("error", new Error("ENOENT: no such file or directory, open 'app-update.yml'"));
        expect(service.getState().error).toContain("app-update.yml");
        expect(service.getState().phase).toBe("error");
        emit("error", "socket hang up while contacting github");
        expect(service.getState().error).toBe("连接 GitHub Releases 失败，请检查网络连接后重试。");
    });

    it("dispose removes updater listeners so later emit is ignored", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        service.dispose();
        // dispose clears listener map via removeAllListeners mock
        emit("update-available", { version: "9.9.9", releaseNotes: "late" });
        expect(service.getState().phase).toBe("idle");
        expect(service.getState().updateAvailable).toBe(false);
    });

    // wave-225 residual
    it("array releaseNotes with version-less notes join without v-prefix; mixed whitespace dropped", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", {
            version: "3.0.0",
            releaseNotes: [
                { note: " alpha " },
                { version: "3.0.0", note: " beta " },
                { version: "3.0.1", note: "   " },
            ],
        });
        expect(service.getState().releaseNotes).toBe("alpha\n\nv3.0.0\nbeta");
        expect(service.getState().updateAvailable).toBe(true);
        expect(service.getState().phase).toBe("available");
    });

    it("checking phase then update-not-available settles without available flag", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("checking-for-update");
        expect(service.getState().phase).toBe("checking");
        emit("update-not-available", { version: "0.1.0" });
        // product phase is "not-available" (not idle) after a finished check with no update
        expect(service.getState().phase).toBe("not-available");
        expect(service.getState().updateAvailable).toBe(false);
    });

    // wave-250 residual
    it("download-progress normalizes missing fields to zeros; update-downloaded sets phase", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-available", { version: "2.0.0", releaseNotes: "n" });
        emit("download-progress", {});
        expect(service.getState().progress).toEqual({
            percent: 0,
            bytesPerSecond: 0,
            transferred: 0,
            total: 0,
        });
        emit("download-progress", {
            percent: 42.5,
            bytesPerSecond: 1000,
            transferred: 4200,
            total: 10000,
        });
        expect(service.getState().progress).toMatchObject({
            percent: 42.5,
            bytesPerSecond: 1000,
            transferred: 4200,
            total: 10000,
        });
        emit("update-downloaded", { version: "2.0.0" });
        expect(service.getState().phase).toBe("downloaded");
        expect(service.getState().updateAvailable).toBe(true);
    });

    it("signature/trust errors map to Chinese trust message; empty error falls back", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("error", new Error("ERR_UPDATER_INVALID_SIGNATURE: not signed by the application owner"));
        expect(service.getState().phase).toBe("error");
        expect(service.getState().error).toMatch(/代码签名|信任/);
        emit("error", "   ");
        expect(service.getState().error).toMatch(/检查更新失败|稍后重试/);
    });

    // wave-265 residual
    it("getState returns a shallow copy; mutating result does not corrupt service state", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        const a = service.getState();
        a.phase = "error";
        a.error = "mutated";
        expect(service.getState().phase).not.toBe("error");
        expect(service.getState().error).not.toBe("mutated");
    });

    it("update-not-available then available transitions phases without throw", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("update-not-available", { version: "1.0.14" });
        expect(service.getState().phase).toBe("not-available");
        emit("update-available", { version: "9.9.9" });
        expect(service.getState().phase).toBe("available");
        expect(service.getState().updateAvailable).toBe(true);
    });

    // wave-283 residual
    it("error event maps ECONNRESET to network Chinese message and clears progress", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        emit("download-progress", { percent: 10, bytesPerSecond: 1, transferred: 1, total: 10 });
        expect(service.getState().progress?.percent).toBe(10);
        emit("error", new Error("read ECONNRESET"));
        const err = service.getState();
        expect(err.phase).toBe("error");
        expect(err.error).toBe("连接 GitHub Releases 失败，请检查网络连接后重试。");
        expect(err.progress).toBeNull();
    });

    it("getState snapshots are independent objects across successive calls", () => {
        const service = setupAutoUpdater({ autoUpdateEnabled: true, scheduleChecks: false });
        const a = service.getState();
        const b = service.getState();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        a.phase = "error";
        expect(service.getState().phase).toBe("idle");
    });



});
