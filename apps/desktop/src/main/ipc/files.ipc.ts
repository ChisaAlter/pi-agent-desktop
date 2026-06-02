// Files IPC (M2 Task M2-1)
// 文件搜索 IPC, 给 @ 引用和 CommandPalette 用
// v1.0.6: console 换 electron-log
// v1.0.6.1: 错误返 IpcError (code/params/fallback), 渲染层 t() 翻译

import { ipcMain } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import { scanFiles } from "../services/search/file-scanner";

export function setupFilesIpc(): void {
    ipcMain.handle("files:list", async (_event, workspacePath: string, query?: string) => {
        try {
            const files = scanFiles(workspacePath);
            if (!query) return files.slice(0, 100);
            const q = query.toLowerCase();
            return files.filter((f) => f.toLowerCase().includes(q)).slice(0, 50);
        } catch (err) {
            log.error("[files.ipc] scan error:", err);
            return ipcError(
                "ipcErrors.files.scanFailed",
                `文件扫描失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: workspacePath },
            );
        }
    });
}
