import { ipcMain } from "electron";
import type { AppUpdaterService } from "../services/updater";
import { withUpdaterAction } from "./helpers";

export function setupUpdaterIpc(service: AppUpdaterService): void {
    ipcMain.handle("updater:get-state", () => {
        return service.getState();
    });

    ipcMain.handle("updater:check", async () => {
        return withUpdaterAction(() => service.checkForUpdates(), {
            errorKey: "ipcErrors.updater.checkFailed",
            label: "检查应用更新失败",
            logTag: "[updater.ipc] updater:check failed:",
        });
    });

    ipcMain.handle("updater:download", async () => {
        return withUpdaterAction(() => service.downloadUpdate(), {
            errorKey: "ipcErrors.updater.downloadFailed",
            label: "下载应用更新失败",
            logTag: "[updater.ipc] updater:download failed:",
        });
    });

    ipcMain.handle("updater:install", async () => {
        return withUpdaterAction(() => service.installUpdate(), {
            errorKey: "ipcErrors.updater.installFailed",
            label: "安装应用更新失败",
            logTag: "[updater.ipc] updater:install failed:",
        });
    });
}
