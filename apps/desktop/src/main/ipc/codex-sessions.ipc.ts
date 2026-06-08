import { ipcMain } from "electron";
import type { CodexSessionImporter } from "../services/codex-session/importer";

export function setupCodexSessionsIpc(importer: CodexSessionImporter): void {
    ipcMain.handle("codex-sessions:scan", async (_event, workspacePath: string) => importer.scan(workspacePath));
    ipcMain.handle("codex-sessions:import", async (_event, workspacePath: string, sourcePaths: string[]) =>
        importer.import(workspacePath, sourcePaths),
    );
}
