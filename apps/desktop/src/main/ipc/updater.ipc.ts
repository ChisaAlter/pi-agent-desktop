import { ipcMain } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import type { AppUpdaterService } from "../services/updater";

export function setupUpdaterIpc(service: AppUpdaterService): void {
    ipcMain.handle("updater:get-state", () => {
        return service.getState();
    });

    ipcMain.handle("updater:check", async () => {
        try {
            return await service.checkForUpdates();
        } catch (error) {
            log.error("[updater.ipc] updater:check failed:", error);
            return ipcError(
                "ipcErrors.updater.checkFailed",
                `检查应用更新失败: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    });

    ipcMain.handle("updater:download", async () => {
        try {
            return await service.downloadUpdate();
        } catch (error) {
            log.error("[updater.ipc] updater:download failed:", error);
            return ipcError(
                "ipcErrors.updater.downloadFailed",
                `下载应用更新失败: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    });

    ipcMain.handle("updater:install", async () => {
        try {
            return await service.installUpdate();
        } catch (error) {
            log.error("[updater.ipc] updater:install failed:", error);
            return ipcError(
                "ipcErrors.updater.installFailed",
                `安装应用更新失败: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    });
}
