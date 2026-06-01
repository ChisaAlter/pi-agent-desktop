// Terminal IPC (M4 Task M4-1)
// 包装 PtyManager, 暴露给 renderer
// 重构老的 terminal:* IPC, 用 node-pty 替代 child_process.spawn

import { ipcMain, BrowserWindow } from "electron";
import { ptyManager } from "../services/shell/pty-manager";
import { terminalInputSchema } from "./schemas";

export function setupTerminalIpc(): void {
    const send = (channel: string, id: string, payload: unknown) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, { id, payload });
        }
    };

    ptyManager.onOutput((id, data) => send("terminal:output", id, data));
    ptyManager.onExit((id, code) => send("terminal:exit", id, code));

    ipcMain.handle("terminal:create", async (_event, opts: { id?: string; cwd?: string; cols?: number; rows?: number }) => {
        const id = opts.id ?? ptyManager.generateId();
        if (ptyManager.has(id)) {
            return { id, reused: true };
        }
        await ptyManager.create({
            id,
            cwd: opts.cwd,
            cols: opts.cols ?? 80,
            rows: opts.rows ?? 24,
        });
        return { id, reused: false };
    });

    ipcMain.handle("terminal:input", (_event, id: string, data: string) => {
        terminalInputSchema.parse([id, data]);
        ptyManager.write(id, data);
    });

    ipcMain.handle("terminal:resize", (_event, id: string, cols: number, rows: number) => {
        ptyManager.resize(id, cols, rows);
    });

    ipcMain.handle("terminal:close", (_event, id: string) => {
        ptyManager.close(id);
    });

    ipcMain.handle("terminal:list", () => {
        return ptyManager.list().map((e) => ({ id: e.id, cwd: e.cwd, title: e.title }));
    });
}
