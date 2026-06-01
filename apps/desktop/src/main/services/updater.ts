// AutoUpdater (M5 Task M5-1)
// 集成 electron-updater, 从 GitHub Releases 检查更新

import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import log from "electron-log/main";

export interface UpdaterDeps {
    getMainWindow: () => BrowserWindow | null;
}

export function setupAutoUpdater(deps: UpdaterDeps): void {
    // 配置: 开发环境不检查
    if (!app.isPackaged) {
        log.info("[AutoUpdater] Skipping in dev mode");
        return;
    }

    autoUpdater.autoDownload = true; // 自动下载
    autoUpdater.autoInstallOnAppQuit = true; // 退出时自动装

    autoUpdater.on("checking-for-update", () => {
        log.info("[AutoUpdater] Checking for update...");
        deps.getMainWindow()?.webContents.send("updater:checking");
    });

    autoUpdater.on("update-available", (info: UpdateInfo) => {
        log.info(`[AutoUpdater] Update available: v${info.version}`);
        deps.getMainWindow()?.webContents.send("updater:available", info);
    });

    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
        log.info(`[AutoUpdater] No update available (current: v${info.version})`);
        deps.getMainWindow()?.webContents.send("updater:not-available", info);
    });

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
        deps.getMainWindow()?.webContents.send("updater:progress", progress);
    });

    autoUpdater.on("update-downloaded", async (info: UpdateInfo) => {
        log.info(`[AutoUpdater] Update downloaded: v${info.version}`);
        const win = deps.getMainWindow();
        if (!win) return;
        const choice = await dialog.showMessageBox(win, {
            type: "info",
            title: "更新已下载",
            message: `新版本 v${info.version} 已下载, 重启后生效`,
            buttons: ["立即重启", "下次再说"],
            defaultId: 0,
            cancelId: 1,
        });
        if (choice.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });

    autoUpdater.on("error", (err: Error) => {
        log.error("[AutoUpdater] Error:", err);
        deps.getMainWindow()?.webContents.send("updater:error", err.message);
    });

    // 启动时检查 (延迟 3s 避免启动阻塞)
    setTimeout(() => {
        void autoUpdater.checkForUpdates();
    }, 3_000);

    // 每 6 小时检查
    setInterval(() => {
        void autoUpdater.checkForUpdates();
    }, 6 * 60 * 60 * 1000);
}

export function checkForUpdatesManually(): Promise<unknown> {
    return autoUpdater.checkForUpdates();
}
