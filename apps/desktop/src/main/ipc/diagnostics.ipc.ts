import { dialog, ipcMain, type BrowserWindow, type SaveDialogOptions } from "electron";
import { writeFile } from "fs/promises";
import log from "electron-log/main";
import { ipcError } from "@shared";

export function setupDiagnosticsIpc(opts: {
    getMainWindow: () => BrowserWindow | null;
    buildReport: () => unknown | Promise<unknown>;
}): void {
    ipcMain.handle("diagnostics:export", async () => {
        try {
            const dialogOptions: SaveDialogOptions = {
                title: "导出 Pi Desktop 诊断报告",
                defaultPath: `pi-desktop-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
                filters: [{ name: "JSON", extensions: ["json"] }],
            };
            const mainWindow = opts.getMainWindow();
            const selection = mainWindow
                ? await dialog.showSaveDialog(mainWindow, dialogOptions)
                : await dialog.showSaveDialog(dialogOptions);
            if (selection.canceled || !selection.filePath) return { cancelled: true };

            const report = await opts.buildReport();
            await writeFile(selection.filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
            return { cancelled: false, path: selection.filePath };
        } catch (error) {
            log.error("[diagnostics.ipc] export failed:", error);
            return ipcError(
                "ipcErrors.diagnostics.exportFailed",
                `导出诊断报告失败: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    });
}
