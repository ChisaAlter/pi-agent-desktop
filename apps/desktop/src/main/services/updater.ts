import { app, BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import log from "electron-log/main";
import type { AppUpdaterProgress, AppUpdaterState } from "@shared";

declare const __PI_DESKTOP_AUTO_UPDATE_ENABLED__: boolean;

const RELEASE_PAGE_URL = "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest";
const STARTUP_CHECK_DELAY_MS = 3_000;
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1_000;

interface BrowserWindowLike {
    isDestroyed(): boolean;
    webContents: { send(channel: string, payload: unknown): void };
}

export interface AppUpdaterLike {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    on(
        event:
            | "checking-for-update"
            | "update-available"
            | "update-not-available"
            | "download-progress"
            | "update-downloaded"
            | "error",
        handler: (...args: unknown[]) => void,
    ): void;
    removeAllListeners(event?: string): void;
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface AppUpdaterService {
    getState(): AppUpdaterState;
    checkForUpdates(): Promise<AppUpdaterState>;
    downloadUpdate(): Promise<AppUpdaterState>;
    installUpdate(): Promise<AppUpdaterState>;
    /** SubTask 40.10: cancel scheduled timers and detach listeners. */
    dispose(): void;
}

export interface SetupAutoUpdaterOptions {
    autoUpdateEnabled?: boolean;
    currentVersion?: string;
    getWindows?: () => BrowserWindowLike[];
    isPackaged?: boolean;
    updater?: AppUpdaterLike;
    scheduleChecks?: boolean;
}

function createState(currentVersion: string): AppUpdaterState {
    return {
        phase: "idle",
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseNotes: null,
        progress: null,
        lastCheckedAt: null,
        disabledReason: null,
        error: null,
        releasePageUrl: RELEASE_PAGE_URL,
    };
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo["releaseNotes"]): string | null {
    if (typeof releaseNotes === "string") {
        const normalized = releaseNotes.trim();
        return normalized || null;
    }
    if (!Array.isArray(releaseNotes)) return null;
    const normalized = releaseNotes
        .map((item) => {
            const note = typeof item.note === "string" ? item.note.trim() : "";
            if (!note) return null;
            return item.version ? `v${item.version}\n${note}` : note;
        })
        .filter((item): item is string => Boolean(item))
        .join("\n\n");
    return normalized || null;
}

function normalizeProgress(progress: ProgressInfo): AppUpdaterProgress {
    return {
        percent: progress.percent ?? 0,
        bytesPerSecond: progress.bytesPerSecond ?? 0,
        transferred: progress.transferred ?? 0,
        total: progress.total ?? 0,
    };
}

function normalizeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const compact = raw.replace(/\s+/g, " ").trim();

    if (/app-update\.yml/i.test(raw)) {
        return "当前打包产物缺少 app-update.yml，只有正式 NSIS 发布包才能检查更新。";
    }

    if (/releases\.atom/i.test(raw) && /\b404\b/.test(raw)) {
        return "未找到 GitHub Releases 元数据（404）。请确认仓库、发布页和 latest.yml 已公开发布。";
    }

    if (/(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|network error|net::ERR)/i.test(raw)) {
        return "连接 GitHub Releases 失败，请检查网络连接后重试。";
    }

    if (!compact) {
        return "检查更新失败，请稍后重试。";
    }

    const summary = compact.split(/\s+Headers:/i)[0]?.trim() ?? compact;
    return summary.length > 280 ? `${summary.slice(0, 277)}...` : summary;
}

export function setupAutoUpdater(options: SetupAutoUpdaterOptions = {}): AppUpdaterService {
    const updater = options.updater ?? autoUpdater;
    const getWindows = options.getWindows ?? (() => BrowserWindow.getAllWindows() as BrowserWindowLike[]);
    const currentVersion = options.currentVersion ?? app.getVersion();
    const autoUpdateEnabled = options.autoUpdateEnabled ?? __PI_DESKTOP_AUTO_UPDATE_ENABLED__;
    const packaged = options.isPackaged ?? app.isPackaged;
    const state = createState(currentVersion);

    const broadcast = () => {
        for (const win of getWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send("updater:state-changed", { ...state });
            }
        }
    };

    const patch = (updates: Partial<AppUpdaterState>) => {
        Object.assign(state, updates);
        broadcast();
    };

    if (!packaged) {
        patch({
            phase: "disabled",
            disabledReason: "开发环境不检查应用更新。",
        });
        return {
            getState: () => ({ ...state }),
            checkForUpdates: async () => ({ ...state }),
            downloadUpdate: async () => ({ ...state }),
            installUpdate: async () => ({ ...state }),
            dispose: () => {},
        };
    }

    if (!autoUpdateEnabled) {
        patch({
            phase: "disabled",
            disabledReason: "当前构建未启用签名自动更新，请从 GitHub Releases 手动下载。",
        });
        return {
            getState: () => ({ ...state }),
            checkForUpdates: async () => ({ ...state }),
            downloadUpdate: async () => ({ ...state }),
            installUpdate: async () => ({ ...state }),
            dispose: () => {},
        };
    }

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;

    updater.on("checking-for-update", () => {
        log.info("[AutoUpdater] checking for update");
        patch({
            phase: "checking",
            error: null,
            lastCheckedAt: Date.now(),
        });
    });

    updater.on("update-available", (info: unknown) => {
        const typedInfo = info as UpdateInfo;
        log.info(`[AutoUpdater] update available: ${typedInfo.version}`);
        patch({
            phase: "available",
            latestVersion: typedInfo.version ?? state.latestVersion,
            updateAvailable: true,
            releaseNotes: normalizeReleaseNotes(typedInfo.releaseNotes),
            progress: null,
            error: null,
            lastCheckedAt: Date.now(),
        });
    });

    updater.on("update-not-available", (info: unknown) => {
        const typedInfo = info as UpdateInfo;
        log.info("[AutoUpdater] no update available");
        patch({
            phase: "not-available",
            latestVersion: typedInfo.version ?? state.currentVersion,
            updateAvailable: false,
            releaseNotes: normalizeReleaseNotes(typedInfo.releaseNotes),
            progress: null,
            error: null,
            lastCheckedAt: Date.now(),
        });
    });

    updater.on("download-progress", (progress: unknown) => {
        const typedProgress = progress as ProgressInfo;
        patch({
            phase: "downloading",
            progress: normalizeProgress(typedProgress),
            error: null,
        });
    });

    updater.on("update-downloaded", (info: unknown) => {
        const typedInfo = info as UpdateInfo;
        log.info(`[AutoUpdater] update downloaded: ${typedInfo.version}`);
        patch({
            phase: "downloaded",
            latestVersion: typedInfo.version ?? state.latestVersion,
            updateAvailable: true,
            releaseNotes: normalizeReleaseNotes(typedInfo.releaseNotes),
            progress: {
                percent: 100,
                bytesPerSecond: state.progress?.bytesPerSecond ?? 0,
                transferred: state.progress?.total ?? state.progress?.transferred ?? 0,
                total: state.progress?.total ?? state.progress?.transferred ?? 0,
            },
            error: null,
        });
    });

    updater.on("error", (error: unknown) => {
        const message = normalizeErrorMessage(error);
        log.error("[AutoUpdater] error:", error);
        patch({
            phase: "error",
            error: message,
            progress: null,
            lastCheckedAt: Date.now(),
        });
    });

    // SubTask 40.10: retain timer handles so dispose() can cancel them.
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let periodicTimer: ReturnType<typeof setInterval> | null = null;

    if (options.scheduleChecks !== false) {
        startupTimer = setTimeout(() => {
            void updater.checkForUpdates().catch((error) => {
                const message = normalizeErrorMessage(error);
                log.error("[AutoUpdater] startup check failed:", error);
                patch({ phase: "error", error: message, lastCheckedAt: Date.now() });
            });
        }, STARTUP_CHECK_DELAY_MS);

        periodicTimer = setInterval(() => {
            void updater.checkForUpdates().catch((error) => {
                const message = normalizeErrorMessage(error);
                log.error("[AutoUpdater] periodic check failed:", error);
                patch({ phase: "error", error: message, lastCheckedAt: Date.now() });
            });
        }, PERIODIC_CHECK_MS);
    }

    return {
        getState: () => ({ ...state }),
        checkForUpdates: async () => {
            try {
                await updater.checkForUpdates();
            } catch (error) {
                const message = normalizeErrorMessage(error);
                patch({ phase: "error", error: message, lastCheckedAt: Date.now() });
            }
            return { ...state };
        },
        downloadUpdate: async () => {
            if (!state.updateAvailable) return { ...state };
            try {
                await updater.downloadUpdate();
            } catch (error) {
                const message = normalizeErrorMessage(error);
                patch({ phase: "error", error: message });
            }
            return { ...state };
        },
        installUpdate: async () => {
            if (state.phase === "downloaded") {
                updater.quitAndInstall(false, true);
            }
            return { ...state };
        },
        dispose: () => {
            if (startupTimer) {
                clearTimeout(startupTimer);
                startupTimer = null;
            }
            if (periodicTimer) {
                clearInterval(periodicTimer);
                periodicTimer = null;
            }
            updater.removeAllListeners();
        },
    };
}
