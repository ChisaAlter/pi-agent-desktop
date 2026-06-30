import { ipcMain } from "electron";
import {
    fetchPackageCatalog,
    installPackage,
    listInstalledPackages,
    removePackage,
    searchPackages,
    updatePackage,
} from "../services/pi-packages/pi-package-adapter";
import { packageSearchSchema, packageSourceSchema } from "./schemas";
import { withAction, withValidation } from "./helpers";

export function setupPackagesIpc(): void {
    ipcMain.handle("packages:search", async (_event, query: string) => {
        return withValidation(packageSearchSchema, [query], {
            invalidErrorKey: "ipcErrors.packages.searchInvalid",
            invalidFallback: "搜索插件参数无效",
            failedErrorKey: "ipcErrors.packages.searchFailed",
            failedLabel: "搜索 Pi 插件失败",
            logTag: "[packages.ipc] search failed:",
            context: { query },
        }, () => searchPackages(query));
    });

    ipcMain.handle("packages:refresh-catalog", async () => {
        return withAction(() => fetchPackageCatalog(), {
            failedErrorKey: "ipcErrors.packages.refreshFailed",
            failedLabel: "刷新 Pi 插件市场失败",
            logTag: "[packages.ipc] refresh catalog failed:",
        });
    });

    ipcMain.handle("packages:list-installed", async () => {
        return withAction(() => listInstalledPackages(), {
            failedErrorKey: "ipcErrors.packages.listFailed",
            failedLabel: "列出 Pi 插件失败",
            logTag: "[packages.ipc] list installed failed:",
        });
    });

    ipcMain.handle("packages:install", async (_event, source: string) => {
        return withValidation(packageSourceSchema, [source], {
            invalidErrorKey: "ipcErrors.packages.installInvalid",
            invalidFallback: "安装插件参数无效",
            failedErrorKey: "ipcErrors.packages.installFailed",
            failedLabel: "安装 Pi 插件失败",
            logTag: "[packages.ipc] install failed:",
            context: { source },
        }, () => installPackage(source));
    });

    ipcMain.handle("packages:remove", async (_event, source: string) => {
        return withValidation(packageSourceSchema, [source], {
            invalidErrorKey: "ipcErrors.packages.removeInvalid",
            invalidFallback: "卸载插件参数无效",
            failedErrorKey: "ipcErrors.packages.removeFailed",
            failedLabel: "卸载 Pi 插件失败",
            logTag: "[packages.ipc] remove failed:",
            context: { source },
        }, () => removePackage(source));
    });

    ipcMain.handle("packages:update", async (_event, source: string) => {
        return withValidation(packageSourceSchema, [source], {
            invalidErrorKey: "ipcErrors.packages.updateInvalid",
            invalidFallback: "更新插件参数无效",
            failedErrorKey: "ipcErrors.packages.updateFailed",
            failedLabel: "更新 Pi 插件失败",
            logTag: "[packages.ipc] update failed:",
            context: { source },
        }, () => updatePackage(source));
    });
}
