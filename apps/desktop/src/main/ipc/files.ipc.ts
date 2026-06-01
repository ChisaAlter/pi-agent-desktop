// Files IPC (M2 Task M2-1)
// 文件搜索 IPC, 给 @ 引用和 CommandPalette 用

import { ipcMain } from "electron";
import { scanFiles } from "../services/search/file-scanner";

export function setupFilesIpc(): void {
    ipcMain.handle("files:list", async (_event, workspacePath: string, query?: string) => {
        try {
            const files = scanFiles(workspacePath);
            if (!query) return files.slice(0, 100);
            const q = query.toLowerCase();
            return files.filter((f) => f.toLowerCase().includes(q)).slice(0, 50);
        } catch (err) {
            console.error("[files.ipc] scan error:", err);
            return [];
        }
    });
}
