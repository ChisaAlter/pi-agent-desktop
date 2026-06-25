// Files IPC
// File search for @ references and CommandPalette
// Errors return IpcError (code/params/fallback)

import { ipcMain } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import { basename } from "path";
import { readFile, stat, writeFile } from "fs/promises";
import { scanFiles } from "../services/search/file-scanner";
import { buildFileTreeAsync } from "../file-tree";
import { getProtectedPathReason } from "../services/protected-paths";
import { getFileTreeSchema, listFilesSchema, readTextFileSchema, searchFilesSchema, writeTextFileSchema } from "./schemas";

function toFileEntry(path: string) {
    const name = path.split(/[\\/]/).pop() ?? path;
    return {
        path,
        name,
        size: 0,
        isDirectory: false,
    };
}

export function setupFilesIpc(): void {
    ipcMain.handle("files:getTree", async (_event, workspacePath: string, options?: { maxDepth?: number; maxEntries?: number }) => {
        try {
            getFileTreeSchema.parse(options === undefined ? [workspacePath] : [workspacePath, options]);
        } catch (err) {
            log.warn("[files.ipc] getTree invalid args:", err);
            return ipcError(
                "ipcErrors.files.treeInvalid",
                `文件树参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(workspacePath ?? "") },
            );
        }
        try {
            const reason = getProtectedPathReason(workspacePath);
            if (reason) {
                return ipcError("ipcErrors.files.protectedPath", reason, { path: workspacePath });
            }
            return await buildFileTreeAsync(workspacePath, options ?? { maxDepth: 4 });
        } catch (err) {
            log.error("[files.ipc] tree error:", err);
            return ipcError(
                "ipcErrors.files.treeFailed",
                `文件树读取失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: workspacePath },
            );
        }
    });

    ipcMain.handle("files:readTextFile", async (_event, targetPath: string, workspacePath?: string) => {
        try {
            readTextFileSchema.parse(workspacePath === undefined ? [targetPath] : [targetPath, workspacePath]);
        } catch (err) {
            log.warn("[files.ipc] readTextFile invalid args:", err);
            return ipcError(
                "ipcErrors.files.readInvalid",
                `文件读取参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(targetPath ?? "") },
            );
        }
        try {
            const reason = getProtectedPathReason(targetPath, workspacePath);
            if (reason) {
                return ipcError("ipcErrors.files.protectedPath", reason, { path: targetPath });
            }
            const stats = await stat(targetPath);
            const maxBytes = 512 * 1024;
            const buffer = await readFile(targetPath);
            const head = buffer.subarray(0, Math.min(buffer.length, maxBytes));
            const binary = head.includes(0);
            return {
                path: targetPath,
                name: basename(targetPath),
                content: binary ? "" : head.toString("utf-8"),
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                encoding: "utf-8" as const,
                truncated: buffer.length > maxBytes,
                binary,
            };
        } catch (err) {
            log.error("[files.ipc] readTextFile error:", err);
            return ipcError(
                "ipcErrors.files.readFailed",
                `文件读取失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
    });

    ipcMain.handle("files:writeTextFile", async (_event, targetPath: string, content: string, workspacePath?: string, options?: { expectedMtimeMs?: number }) => {
        try {
            const args = options ? [targetPath, content, workspacePath, options] : workspacePath ? [targetPath, content, workspacePath] : [targetPath, content];
            writeTextFileSchema.parse(args);
        } catch (err) {
            log.warn("[files.ipc] writeTextFile invalid args:", err);
            return ipcError(
                "ipcErrors.files.writeInvalid",
                `文件写入参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
        try {
            const reason = getProtectedPathReason(targetPath, workspacePath);
            if (reason) {
                return ipcError("ipcErrors.files.protectedPath", reason, { path: targetPath });
            }
            if (options?.expectedMtimeMs !== undefined) {
                const beforeStats = await stat(targetPath);
                if (Math.abs(beforeStats.mtimeMs - options.expectedMtimeMs) > 1) {
                    return ipcError(
                        "ipcErrors.files.writeConflict",
                        "文件已被其他进程修改。请重新读取文件后再保存，当前草稿已保留。",
                        { path: targetPath },
                    );
                }
            }
            await writeFile(targetPath, content, "utf-8");
            const stats = await stat(targetPath);
            return {
                path: targetPath,
                size: stats.size,
                savedAt: Date.now(),
                mtimeMs: stats.mtimeMs,
            };
        } catch (err) {
            log.error("[files.ipc] writeTextFile error:", err);
            return ipcError(
                "ipcErrors.files.writeFailed",
                `文件写入失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
    });

    ipcMain.handle("files:search", async (_event, workspacePath: string, query: string, options?: { limit?: number }) => {
        try {
            searchFilesSchema.parse(options === undefined ? [workspacePath, query] : [workspacePath, query, options]);
        } catch (err) {
            log.warn("[files.ipc] search invalid args:", err);
            return ipcError(
                "ipcErrors.files.searchInvalid",
                `文件搜索参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(workspacePath ?? "") },
            );
        }
        try {
            const reason = getProtectedPathReason(workspacePath);
            if (reason) {
                return ipcError("ipcErrors.files.protectedPath", reason, { path: workspacePath });
            }
            const q = query.toLowerCase();
            const limit = Math.max(1, Math.min(options?.limit ?? 80, 200));
            const files = await scanFiles(workspacePath, { hiddenMode: "critical" });
            return files
                .filter((f) => f.toLowerCase().includes(q))
                .slice(0, limit)
                .map(toFileEntry);
        } catch (err) {
            log.error("[files.ipc] search error:", err);
            return ipcError(
                "ipcErrors.files.searchFailed",
                `文件搜索失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: workspacePath },
            );
        }
    });

    ipcMain.handle("files:list", async (_event, workspacePath: string, query?: string) => {
        try {
            listFilesSchema.parse(query === undefined ? [workspacePath] : [workspacePath, query]);
        } catch (err) {
            log.warn("[files.ipc] list invalid args:", err);
            return ipcError(
                "ipcErrors.files.listInvalid",
                `文件列表参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(workspacePath ?? "") },
            );
        }
        try {
            const reason = getProtectedPathReason(workspacePath);
            if (reason) {
                return ipcError("ipcErrors.files.protectedPath", reason, { path: workspacePath });
            }
            const files = await scanFiles(workspacePath, { hiddenMode: "critical" });
            if (!query) return files.slice(0, 100).map(toFileEntry);
            const q = query.toLowerCase();
            return files.filter((f) => f.toLowerCase().includes(q)).slice(0, 50).map(toFileEntry);
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
