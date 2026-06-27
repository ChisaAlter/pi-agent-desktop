import { ipcMain, shell } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import { buildFileTree } from "../file-tree";
import { detectProject } from "../project-detector";
import { getProtectedPathReason } from "../services/protected-paths";

function protectedPathError(path: string, reason: string) {
    return ipcError("ipcErrors.files.protectedPath", reason, { path });
}

function isExternalUrl(target: string): boolean {
    return /^https?:\/\//i.test(target);
}

export function setupProjectShellIpc(): void {
    ipcMain.handle("project:detect", async (_event, workspacePath: string) => {
        const reason = getProtectedPathReason(workspacePath);
        if (reason) return protectedPathError(workspacePath, reason);
        return detectProject(workspacePath);
    });

    ipcMain.handle("project:file-tree", async (_event, workspacePath: string, maxDepth?: number) => {
        const reason = getProtectedPathReason(workspacePath);
        if (reason) return protectedPathError(workspacePath, reason);
        return buildFileTree(workspacePath, { maxDepth: maxDepth || 4 });
    });

    ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
        try {
            if (isExternalUrl(targetPath)) {
                await shell.openExternal(targetPath);
                return "";
            }
            const reason = getProtectedPathReason(targetPath);
            if (reason) return protectedPathError(targetPath, reason);
            const result = await shell.openPath(targetPath);
            if (result) {
                return ipcError(
                    "ipcErrors.shell.openPathFailed",
                    `打开路径失败: ${result}`,
                    { path: targetPath },
                );
            }
            return "";
        } catch (err) {
            log.error("[project-shell.ipc] shell:open-path failed:", err);
            return ipcError(
                "ipcErrors.shell.openPathFailed",
                `打开路径失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
    });

    ipcMain.handle("shell:reveal-path", async (_event, targetPath: string) => {
        const reason = getProtectedPathReason(targetPath);
        if (reason) return protectedPathError(targetPath, reason);
        try {
            shell.showItemInFolder(targetPath);
        } catch (err) {
            log.error("[project-shell.ipc] shell:reveal-path failed:", err);
            return ipcError(
                "ipcErrors.shell.revealPathFailed",
                `定位路径失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
        return undefined;
    });
}
