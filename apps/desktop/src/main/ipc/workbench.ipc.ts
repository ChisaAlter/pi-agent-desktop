import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { workbenchSetActiveFileSchema } from './schemas';

const workbenchContext = new Map<string, string | null>();

export function getWorkbenchContext(workspaceId: string): string | null {
    return workbenchContext.get(workspaceId) ?? null;
}

export function setupWorkbenchIpc(): void {
    ipcMain.on("workbench:set-active-file", (_event, workspaceId: string, filePath: string | null) => {
        // safeParse inside a fire-and-forget ipcMain.on listener: the throwing
        // variant would surface an uncaught exception in the main process.
        const parsed = workbenchSetActiveFileSchema.safeParse([workspaceId, filePath]);
        if (!parsed.success) {
            log.warn("[workbench] invalid set-active-file payload:", parsed.error.issues);
            return;
        }
        workbenchContext.set(workspaceId, filePath);
        log.info(`[workbench] active file for workspace ${workspaceId}: ${filePath ?? '(none)'}`);
    });
}