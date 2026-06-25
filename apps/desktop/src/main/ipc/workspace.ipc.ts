import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import log from 'electron-log/main';
import { ipcError } from '@shared';
import { workspaceCreateSchema } from './schemas';

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastActiveAt?: number;
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function setupWorkspaceIpc(opts: {
  store: { get: (key: 'workspaces') => Workspace[]; set: (key: 'workspaces', value: Workspace[]) => void };
  getMainWindow: () => BrowserWindow | null;
  /** 删除 workspace 时同步释放对应 in-process Pi session (避免资源/句柄泄漏) */
  disposeWorkspaceSession?: (workspaceId: string) => void;
}): void {
  const { store, getMainWindow, disposeWorkspaceSession } = opts;

  ipcMain.handle('workspace:list', async () => {
    let workspaces = store.get('workspaces');
    if (workspaces.length === 0) {
      workspaces = [{
        id: 'default',
        name: 'Default',
        path: process.cwd(),
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      }];
      store.set('workspaces', workspaces);
    }
    return workspaces;
  });

  ipcMain.handle('workspace:create', async (_, name: string, path: string) => {
    try {
      workspaceCreateSchema.parse([name, path]);
    } catch (err) {
      log.warn("[workspace.ipc] workspace:create invalid args:", err);
      return ipcError(
        "ipcErrors.workspace.invalidArgs",
        `工作区参数无效: ${err instanceof Error ? err.message : String(err)}`,
        { name, path },
      );
    }
    const workspace = {
      id: randomUUID(),
      name,
      path,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    const workspaces = store.get('workspaces');
    workspaces.push(workspace);
    store.set('workspaces', workspaces);
    return workspace;
  });

  ipcMain.handle('workspace:delete', async (_, id: string) => {
    const workspaces = store.get('workspaces').filter(w => w.id !== id);
    store.set('workspaces', workspaces);
    try {
      disposeWorkspaceSession?.(id);
    } catch (err) {
      log.warn("[workspace.ipc] dispose workspace session failed:", err);
    }
  });

  ipcMain.handle('workspace:select', async (_, path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return ipcError(
        "ipcErrors.workspace.invalidArgs",
        "工作区路径不能为空",
        { path },
      );
    }
    try {
      const workspaces = store.get('workspaces');
      const targetIndex = workspaces.findIndex((workspace) =>
        normalizeWorkspacePath(workspace.path) === normalizeWorkspacePath(normalizedPath),
      );
      if (targetIndex < 0) {
        log.warn("[workspace.ipc] workspace:select unknown path:", path);
        return ipcError(
          "ipcErrors.workspace.selectFailed",
          `工作区未注册: ${path}`,
          { path },
        );
      }
      const now = Date.now();
      store.set('workspaces', workspaces.map((workspace, index) =>
        index === targetIndex ? { ...workspace, lastActiveAt: now } : workspace,
      ));
      log.info('Workspace selected:', path);
      return undefined;
    } catch (err) {
      log.error("[workspace.ipc] workspace:select failed:", err);
      return ipcError(
        "ipcErrors.workspace.selectFailed",
        `切换工作区失败: ${err instanceof Error ? err.message : String(err)}`,
        { path },
      );
    }
  });

  ipcMain.handle('workspace:select-directory', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Workspace Directory'
      });
      return result.canceled ? null : result.filePaths[0];
    } catch (err) {
      log.error("[workspace.ipc] workspace:select-directory failed:", err);
      return ipcError(
        "ipcErrors.workspace.selectDirectoryFailed",
        `打开目录选择器失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('files:select', async (
    _,
    opts?: { multiSelections?: boolean; filters?: { name: string; extensions: string[] }[] },
  ) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return [];
    try {
      const properties: Array<'openFile' | 'multiSelections'> = ['openFile'];
      if (opts?.multiSelections !== false) properties.push('multiSelections');
      const result = await dialog.showOpenDialog(mainWindow, {
        properties,
        title: '选择附件',
        filters: opts?.filters,
      });
      return result.canceled ? [] : result.filePaths;
    } catch (err) {
      log.error("[workspace.ipc] files:select failed:", err);
      return ipcError(
        "ipcErrors.files.selectFailed",
        `打开文件选择器失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
