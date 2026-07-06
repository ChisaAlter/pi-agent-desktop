// Files IPC
// File search for @ references and CommandPalette
// Errors return IpcError (code/params/fallback)

import { ipcMain, dialog, type BrowserWindow } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import { basename, dirname } from "path";
import { open, stat, writeFile } from "fs/promises";
import { scanFiles } from "../services/search/file-scanner";
import { buildFileTree } from "../file-tree";
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

// SubTask 40.4: 30s TTL cache for files:search / files:list scan results
const scanCache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL = 30_000; // 30 seconds

function getCached<T>(key: string): T | undefined {
    const entry = scanCache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
    return undefined;
}

function setCached(key: string, data: unknown): void {
    scanCache.set(key, { ts: Date.now(), data });
}

export function setupFilesIpc(opts?: { getMainWindow?: () => BrowserWindow | null }): void {
    const getMainWindow = opts?.getMainWindow ?? (() => null);

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
            return buildFileTree(workspacePath, options ?? { maxDepth: 4 });
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
            // SubTask 40.3: async + limited read (only first 512KB into memory)
            const maxBytes = 512 * 1024;
            const stats = await stat(targetPath);
            const fd = await open(targetPath, "r");
            let binary = false;
            let head = "";
            let bytesRead = 0;
            try {
                const buffer = Buffer.alloc(Math.min(stats.size, maxBytes));
                const result = await fd.read(buffer, 0, buffer.length, 0);
                bytesRead = result.bytesRead;
                binary = buffer.subarray(0, bytesRead).includes(0);
                head = buffer.subarray(0, bytesRead).toString("utf-8");
            } finally {
                await fd.close();
            }
            return {
                path: targetPath,
                name: basename(targetPath),
                content: binary ? "" : head,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                encoding: "utf-8" as const,
                truncated: stats.size > maxBytes,
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
            // Invalidate the 30s scan cache for the affected directory so the
            // next files:search / files:list sees the updated file mtime.
            // Without this, a write immediately followed by a CommandPalette
            // search would return a stale entry until the TTL elapsed.
            scanCache.delete(workspacePath ?? dirname(targetPath));
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
            // SubTask 40.4: 30s TTL cache keyed by workspacePath
            let files = getCached<string[]>(workspacePath);
            if (!files) {
                files = await scanFiles(workspacePath);
                setCached(workspacePath, files);
            }
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
            // SubTask 40.4: 30s TTL cache keyed by workspacePath
            let files = getCached<string[]>(workspacePath);
            if (!files) {
                files = await scanFiles(workspacePath);
                setCached(workspacePath, files);
            }
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

    ipcMain.handle("files:select", async (
        _event,
        selectOpts?: { multiSelections?: boolean; filters?: { name: string; extensions: string[] }[] },
    ) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) return [];
        try {
            const properties: Array<"openFile" | "multiSelections"> = ["openFile"];
            if (selectOpts?.multiSelections !== false) properties.push("multiSelections");
            const result = await dialog.showOpenDialog(mainWindow, {
                properties,
                title: "选择附件",
                filters: selectOpts?.filters,
            });
            return result.canceled ? [] : result.filePaths;
        } catch (err) {
            log.error("[files.ipc] files:select failed:", err);
            return ipcError(
                "ipcErrors.files.selectFailed",
                `打开文件选择器失败: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    });
}
