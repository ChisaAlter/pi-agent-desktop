import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, relative, resolve, join } from 'path';
import log from 'electron-log/main';
import { ipcError } from '@shared';
import { workspaceCreateSchema } from './schemas';
import { getProtectedPathReason } from '../services/protected-paths';

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastActiveAt?: number;
  /**
   * Per-workspace plan-mode runtime toggle. 与 `main/index.ts` 中的 Workspace
   * 类型保持一致: runtime 通过 spread 透传, 这里补字段是为了类型清晰。
   */
  planModeEnabled?: boolean;
}

type WorkspaceStore = {
  get: (key: 'workspaces') => Workspace[];
  set: (key: 'workspaces', value: Workspace[]) => void;
};

/** 共享的 workspace 串行 mutator (锁范围仅覆盖 store.get/set 的 RMW)。 */
type MutateWorkspaces = (fn: (current: Workspace[]) => Workspace[]) => Promise<Workspace[]>;

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function setupWorkspaceIpc(opts: {
  store: WorkspaceStore;
  getMainWindow: () => BrowserWindow | null;
  /** 删除 workspace 时同步释放对应 in-process Pi session (避免资源/句柄泄漏) */
  disposeWorkspaceSession?: (workspaceId: string) => void;
  /**
   * 共享的 workspace 串行 mutator。由 `main/index.ts` 注入, 与
   * `setWorkspacePlanMode` 共用同一队列, 避免并发 plan 切换 + CRUD 互相覆盖。
   * 未注入时退化为模块内的临时队列, 保持向后兼容 (例如老测试)。
   */
  mutateWorkspaces?: MutateWorkspaces;
}): void {
  const { store, getMainWindow, disposeWorkspaceSession } = opts;
  // 兼容路径: 没有注入共享队列时, 用一个本地临时队列兜底, 语义不变。
  const mutateWorkspaces: MutateWorkspaces =
    opts.mutateWorkspaces ?? createLocalMutationQueue(store);

  ipcMain.handle('workspace:list', async () => {
    const existing = store.get('workspaces');
    if (existing.length > 0) return existing;
    const seeded: Workspace[] = [{
      id: 'default',
      name: 'Default',
      path: process.cwd(),
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    }];
    return mutateWorkspaces(() => seeded);
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
    const protectedReason = getProtectedPathReason(path);
    if (protectedReason) {
      return ipcError(
        "ipcErrors.workspace.protectedPath",
        `路径受保护: ${protectedReason}`,
        { name, path },
      );
    }
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      path,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    await mutateWorkspaces((current) => [...current, workspace]);
    return workspace;
  });

  ipcMain.handle('workspace:create-empty', async (_, name: string, parentPath: string) => {
    try {
      workspaceCreateSchema.parse([name, parentPath]);
    } catch (err) {
      log.warn("[workspace.ipc] workspace:create-empty invalid args:", err);
      return ipcError(
        "ipcErrors.workspace.invalidArgs",
        `空白工作区参数无效: ${err instanceof Error ? err.message : String(err)}`,
        { name, path: parentPath },
      );
    }

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === "." || trimmedName === ".." || /[\\/]/.test(trimmedName)) {
      return ipcError(
        "ipcErrors.workspace.invalidArgs",
        `项目名无效: ${name}`,
        { name, path: parentPath },
      );
    }

    try {
      const resolvedParent = resolve(parentPath);
      const workspacePath = resolve(join(resolvedParent, trimmedName));
      const relativePath = relative(resolvedParent, workspacePath);
      if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
        return ipcError(
          "ipcErrors.workspace.invalidArgs",
          `项目路径超出父目录: ${workspacePath}`,
          { name: trimmedName, path: parentPath },
        );
      }
      const protectedReason = getProtectedPathReason(workspacePath);
      if (protectedReason) {
        return ipcError(
          "ipcErrors.workspace.protectedPath",
          `路径受保护: ${protectedReason}`,
          { name: trimmedName, path: workspacePath },
        );
      }
      if (existsSync(workspacePath)) {
        return ipcError(
          "ipcErrors.workspace.createFailed",
          `项目目录已存在: ${workspacePath}`,
          { name: trimmedName, path: workspacePath },
        );
      }

      mkdirSync(workspacePath, { recursive: false });
      const workspace: Workspace = {
        id: randomUUID(),
        name: trimmedName,
        path: workspacePath,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      await mutateWorkspaces((current) => [...current, workspace]);
      return workspace;
    } catch (err) {
      log.error("[workspace.ipc] workspace:create-empty failed:", err);
      return ipcError(
        "ipcErrors.workspace.createFailed",
        `创建空白工作区失败: ${err instanceof Error ? err.message : String(err)}`,
        { name: trimmedName, path: parentPath },
      );
    }
  });

  ipcMain.handle('workspace:delete', async (_, id: string) => {
    await mutateWorkspaces((current) => current.filter(w => w.id !== id));
    try {
      disposeWorkspaceSession?.(id);
    } catch (err) {
      log.warn("[workspace.ipc] dispose workspace session failed:", err);
    }
    return { success: true };
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
      const now = Date.now();
      let found = false;
      await mutateWorkspaces((current) => {
        const targetIndex = current.findIndex((workspace) =>
          normalizeWorkspacePath(workspace.path) === normalizeWorkspacePath(normalizedPath),
        );
        if (targetIndex < 0) return current;
        found = true;
        return current.map((workspace, index) =>
          index === targetIndex ? { ...workspace, lastActiveAt: now } : workspace,
        );
      });
      if (!found) {
        log.warn("[workspace.ipc] workspace:select unknown path:", path);
        return ipcError(
          "ipcErrors.workspace.selectFailed",
          `工作区未注册: ${path}`,
          { path },
        );
      }
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
}

/**
 * 兼容兜底: 当调用方未注入共享 `mutateWorkspaces` 时 (例如旧测试或独立调用),
 * 使用模块本地的串行队列。语义与共享版本一致: 失败不卡死后续 mutate。
 * 生产路径走 `main/index.ts` 注入的共享队列, 与 `setWorkspacePlanMode` 同锁。
 */
function createLocalMutationQueue(store: WorkspaceStore): MutateWorkspaces {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const result = tail.then(() => {
      const current = store.get('workspaces') ?? [];
      const next = fn(current);
      store.set('workspaces', next);
      return next;
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
