import { app, BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import log from "electron-log/main";
import type { AppUpdaterProgress, AppUpdaterState } from "@shared";

declare const __PI_DESKTOP_AUTO_UPDATE_ENABLED__: boolean;

const RELEASE_PAGE_URL = "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest";
const RELEASE_API_URL = "https://api.github.com/repos/ChisaAlter/pi-agent-desktop/releases/latest";
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
    fetchLatestRelease?: () => Promise<GitHubReleaseMetadata>;
    getWindows?: () => BrowserWindowLike[];
    isPackaged?: boolean;
    updater?: AppUpdaterLike;
    scheduleChecks?: boolean;
}

export interface GitHubReleaseMetadata {
    tagName: string;
    body: string | null;
    pageUrl: string;
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

async function fetchLatestGitHubRelease(): Promise<GitHubReleaseMetadata> {
    const response = await fetch(RELEASE_API_URL, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Pi-Desktop-Updater",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub Releases API returned ${response.status} for ${RELEASE_API_URL}`);
    }
    const release = await response.json() as {
        tag_name?: unknown;
        body?: unknown;
        html_url?: unknown;
    };
    if (typeof release.tag_name !== "string" || !release.tag_name.trim()) {
        throw new Error("GitHub Releases API response did not include a release tag.");
    }
    return {
        tagName: release.tag_name,
        body: typeof release.body === "string" ? release.body.trim() || null : null,
        pageUrl: typeof release.html_url === "string" && release.html_url ? release.html_url : RELEASE_PAGE_URL,
    };
}

function parseVersion(version: string): { numbers: number[]; prerelease: string | null } | null {
    const normalized = version.trim().replace(/^v/i, "").split("+", 1)[0] ?? "";
    const [core = "", prerelease = null] = normalized.split("-", 2);
    const segments = core.split(".");
    if (segments.length === 0 || segments.some((segment) => !/^\d+$/.test(segment))) return null;
    return {
        numbers: segments.map(Number),
        prerelease,
    };
}

function isNewerVersion(candidate: string, current: string): boolean {
    const next = parseVersion(candidate);
    const installed = parseVersion(current);
    if (!next || !installed) return candidate.trim().replace(/^v/i, "") !== current.trim().replace(/^v/i, "");
    const length = Math.max(next.numbers.length, installed.numbers.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (next.numbers[index] ?? 0) - (installed.numbers[index] ?? 0);
        if (difference !== 0) return difference > 0;
    }
    if (next.prerelease === installed.prerelease) return false;
    if (next.prerelease === null) return true;
    if (installed.prerelease === null) return false;
    return next.prerelease > installed.prerelease;
}

function normalizeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const compact = raw.replace(/\s+/g, " ").trim();

    if (/app-update\.yml/i.test(raw)) {
        return "当前打包产物缺少 app-update.yml，只有正式 NSIS 发布包才能检查更新。";
    }

    if (/(releases\.atom|GitHub Releases API returned 404)/i.test(raw) && /\b404\b/.test(raw)) {
        return "未找到 GitHub Releases 元数据（404）。请确认仓库、发布页和 latest.yml 已公开发布。";
    }

    if (/(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|network error|net::ERR)/i.test(raw)) {
        return "连接 GitHub Releases 失败，请检查网络连接后重试。";
    }

    if (/ERR_UPDATER_INVALID_SIGNATURE|not signed by the application owner|root certificate which is not trusted/i.test(raw)) {
        return "更新包的代码签名无法通过 Windows 信任校验。请暂勿安装，并从 GitHub Releases 获取受信任签名的版本。";
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
    const fetchLatestRelease = options.fetchLatestRelease ?? fetchLatestGitHubRelease;
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

    if (!packaged || !autoUpdateEnabled) {
        patch({
            disabledReason: packaged
                ? "当前构建未启用签名自动更新；仍可检查 GitHub 最新版本，如有更新请手动下载。"
                : "开发环境可检查 GitHub 最新版本，但不能自动下载和安装更新。",
        });

        const checkLatestRelease = async (): Promise<AppUpdaterState> => {
            patch({ phase: "checking", error: null, lastCheckedAt: Date.now() });
            try {
                const release = await fetchLatestRelease();
                const latestVersion = release.tagName.trim().replace(/^v/i, "");
                const updateAvailable = isNewerVersion(latestVersion, state.currentVersion);
                log.info(`[AutoUpdater] GitHub release metadata checked: ${latestVersion}`);
                patch({
                    phase: updateAvailable ? "available" : "not-available",
                    latestVersion,
                    updateAvailable,
                    releaseNotes: release.body,
                    progress: null,
                    error: null,
                    lastCheckedAt: Date.now(),
                    releasePageUrl: release.pageUrl,
                });
            } catch (error) {
                const message = normalizeErrorMessage(error);
                log.error("[AutoUpdater] GitHub release metadata check failed:", error);
                patch({ phase: "error", error: message, progress: null, lastCheckedAt: Date.now() });
            }
            return { ...state };
        };

        let startupTimer: ReturnType<typeof setTimeout> | null = null;
        let periodicTimer: ReturnType<typeof setInterval> | null = null;
        if (packaged && options.scheduleChecks !== false) {
            startupTimer = setTimeout(() => void checkLatestRelease(), STARTUP_CHECK_DELAY_MS);
            periodicTimer = setInterval(() => void checkLatestRelease(), PERIODIC_CHECK_MS);
        }

        return {
            getState: () => ({ ...state }),
            checkForUpdates: checkLatestRelease,
            downloadUpdate: async () => ({ ...state }),
            installUpdate: async () => ({ ...state }),
            dispose: () => {
                if (startupTimer) clearTimeout(startupTimer);
                if (periodicTimer) clearInterval(periodicTimer);
                startupTimer = null;
                periodicTimer = null;
            },
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
