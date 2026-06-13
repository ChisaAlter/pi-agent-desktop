// Terminal IPC
// Wraps PtyManager, exposed to renderer
// Uses node-pty instead of child_process.spawn
// Errors return IpcError (code/params/fallback)

import { ipcMain, BrowserWindow } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import { ptyManager } from "../services/shell/pty-manager";
import { getProtectedPathReason } from "../services/protected-paths";
import { terminalCreateSchema, terminalInputSchema, terminalResizeSchema } from "./schemas";

export function setupTerminalIpc(): void {
    const sendOutput = (id: string, data: string) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            win.webContents.send("terminal:output", { id, data });
        }
    };
    const sendExit = (id: string, code: number | null) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            win.webContents.send("terminal:exit", { id, code });
        }
    };

    ptyManager.onOutput(sendOutput);
    ptyManager.onExit(sendExit);

    ipcMain.handle("terminal:create", async (_event, opts: { id?: string; cwd?: string; cols?: number; rows?: number }) => {
        try {
            terminalCreateSchema.parse([opts]);
        } catch (err) {
            log.warn("[terminal.ipc] invalid create args:", err);
            return ipcError(
                "ipcErrors.terminal.createInvalid",
                `创建终端参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { cwd: opts?.cwd ?? process.cwd() },
            );
        }
        if (opts.cwd) {
            const reason = getProtectedPathReason(opts.cwd);
            if (reason) {
                return ipcError("ipcErrors.files.protectedPath", reason, { path: opts.cwd });
            }
        }
        const id = opts.id ?? ptyManager.generateId();
        if (ptyManager.has(id)) {
            return { id, reused: true };
        }
        try {
            await ptyManager.create({
                id,
                cwd: opts.cwd,
                cols: opts.cols ?? 80,
                rows: opts.rows ?? 24,
            });
            return { id, reused: false };
        } catch (err) {
            log.error("[terminal.ipc] create failed:", err);
            return ipcError(
                "ipcErrors.terminal.createFailed",
                `创建终端失败: ${err instanceof Error ? err.message : String(err)}`,
                { cwd: opts.cwd ?? process.cwd() },
            );
        }
    });

    ipcMain.handle("terminal:input", (_event, id: string, data: string) => {
        try {
            terminalInputSchema.parse([id, data]);
        } catch (err) {
            log.warn("[terminal.ipc] invalid input args:", err);
            return ipcError(
                "ipcErrors.terminal.inputInvalid",
                `终端输入参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { terminalId: id },
            );
        }
        try {
            ptyManager.write(id, data);
            return undefined;
        } catch (err) {
            log.error("[terminal.ipc] input failed:", err);
            return ipcError(
                "ipcErrors.terminal.inputFailed",
                `发送终端输入失败: ${err instanceof Error ? err.message : String(err)}`,
                { terminalId: id },
            );
        }
    });

    ipcMain.handle("terminal:resize", (_event, id: string, cols: number, rows: number) => {
        try {
            terminalResizeSchema.parse([id, cols, rows]);
        } catch (err) {
            log.warn("[terminal.ipc] invalid resize args:", err);
            return ipcError(
                "ipcErrors.terminal.resizeInvalid",
                `终端尺寸参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { terminalId: id },
            );
        }
        try {
            ptyManager.resize(id, cols, rows);
            return undefined;
        } catch (err) {
            log.error("[terminal.ipc] resize failed:", err);
            return ipcError(
                "ipcErrors.terminal.resizeFailed",
                `调整终端尺寸失败: ${err instanceof Error ? err.message : String(err)}`,
                { terminalId: id },
            );
        }
    });

    ipcMain.handle("terminal:close", (_event, id: string) => {
        ptyManager.close(id);
    });

    ipcMain.handle("terminal:list", () => {
        return ptyManager.list().map((e) => ({ id: e.id, cwd: e.cwd, title: e.title }));
    });
}
