// Workspace Store - Manages workspaces
// v1.0.5: 本地类型保留 (Date) 避免下游连锁改; lastActiveAt 用类型守卫
// v1.0.6: console 换 logger
// v1.0.9: 类型守卫收进 utils/format (复用)

import { create } from 'zustand';
import { logger } from '../utils/logger';
import { isNumberOrUndefined } from '../utils/format';
import { isIpcError } from '@shared';
import { useSessionStore } from './session-store';
import { useAttachmentsStore } from './attachments-store';
import { addToast } from './toast-store';
import { i18n } from '../i18n';
import { getPiAPI } from '../utils/pi-api';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: Date;
  lastActiveAt: Date;
  gitBranch?: string;
  gitStatus?: GitStatus;
}

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  lastError: string | null;
  loaded: boolean;

  // Actions
  addWorkspace: (name: string, path: string, id?: string) => Workspace;
  createWorkspace: (name: string, path: string) => Promise<Workspace | null>;
  createEmptyWorkspace: (name: string, parentPath: string) => Promise<Workspace | null>;
  removeWorkspace: (workspaceId: string) => void;
  setCurrentWorkspace: (workspaceId: string) => void;
  updateWorkspace: (workspaceId: string, updates: Partial<Workspace>) => void;
  updateGitStatus: (workspaceId: string, gitStatus: GitStatus) => void;
  getCurrentWorkspace: () => Workspace | null;
  clearError: () => void;
  init: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Load workspaces from main process on init
  const loadWorkspaces = async () => {
    try {
      const piAPI = getPiAPI();
      if (!piAPI) {
        set({ loaded: true });
        return;
      }
      const wsList = await piAPI.listWorkspaces();
      if (isIpcError(wsList)) {
        logger.error('[workspace-store] listWorkspaces failed:', wsList.fallback);
        set({ lastError: wsList.fallback, loaded: true });
        return;
      }
      const workspaces = wsList.map((ws) => {
        const w = ws as { id: string; name: string; path: string; createdAt: number; lastActiveAt?: number };
        // v1.0.9: 守卫复用 isNumberOrUndefined — undefined 时降级 createdAt
        const lastActive = w.lastActiveAt ?? w.createdAt;
        return {
          id: w.id,
          name: w.name,
          path: w.path,
          createdAt: new Date(w.createdAt),
          lastActiveAt: new Date(isNumberOrUndefined(lastActive) ? lastActive : w.createdAt),
        };
      });
      const currentWorkspace = workspaces
        .slice()
        .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())[0];
      set({ workspaces, currentWorkspaceId: currentWorkspace?.id ?? null, lastError: null, loaded: true });
    } catch (e) {
      logger.error('[workspace-store] Failed to load workspaces:', e);
      set({ lastError: e instanceof Error ? e.message : String(e), loaded: true });
      addToast(i18n.t("errors.workspaceLoadFailed"), "error");
    }
  };

  return {
  workspaces: [],
  currentWorkspaceId: null,
  lastError: null,
  loaded: false,
  init: () => { void loadWorkspaces(); },

  addWorkspace: (name: string, path: string, id?: string) => {
    const now = new Date();
    const newWorkspace: Workspace = {
      id: id ?? Date.now().toString(),
      name,
      path,
      createdAt: now,
      lastActiveAt: now
    };
    const previousWorkspaceId = get().currentWorkspaceId;
    if (previousWorkspaceId && previousWorkspaceId !== newWorkspace.id) {
      useSessionStore.getState().clearCurrentSession();
    }

    set(state => ({
      workspaces: state.workspaces.some((w) => w.path === path)
        ? state.workspaces.map((w) =>
            w.path === path
              ? { ...w, id: newWorkspace.id, name, lastActiveAt: now }
              : w
          )
        : [...state.workspaces, newWorkspace],
      currentWorkspaceId: newWorkspace.id
    }));

    return newWorkspace;
  },

  createWorkspace: async (name: string, path: string) => {
    const piAPI = getPiAPI();
    try {
      if (!piAPI?.createWorkspace) {
        return get().addWorkspace(name, path);
      }
      const result = await piAPI.createWorkspace(name, path);
      if (isIpcError(result)) {
        logger.error('[workspace-store] createWorkspace failed:', result.fallback);
        set({ lastError: result.fallback });
        return null;
      }
      return get().addWorkspace(result.name, result.path, result.id);
    } catch (e) {
      logger.error('[workspace-store] createWorkspace failed:', e);
      set({ lastError: e instanceof Error ? e.message : String(e) });
      addToast(e instanceof Error ? e.message : "创建工作区失败", "error");
      return null;
    }
  },

  createEmptyWorkspace: async (name: string, parentPath: string) => {
    const piAPI = getPiAPI();
    try {
      if (!piAPI?.createEmptyWorkspace) {
        const fullPath = `${parentPath.replace(/[\\/]+$/, "")}\\${name}`;
        return get().addWorkspace(name, fullPath);
      }
      const result = await piAPI.createEmptyWorkspace(name, parentPath);
      if (isIpcError(result)) {
        logger.error('[workspace-store] createEmptyWorkspace failed:', result.fallback);
        set({ lastError: result.fallback });
        return null;
      }
      return get().addWorkspace(result.name, result.path, result.id);
    } catch (e) {
      logger.error('[workspace-store] createEmptyWorkspace failed:', e);
      set({ lastError: e instanceof Error ? e.message : String(e) });
      addToast(e instanceof Error ? e.message : "创建空白工作区失败", "error");
      return null;
    }
  },

  removeWorkspace: (workspaceId: string) => {
    const before = get();
    set(state => {
      const newWorkspaces = state.workspaces.filter(w => w.id !== workspaceId);
      const newCurrentId = state.currentWorkspaceId === workspaceId
        ? (newWorkspaces.length > 0 ? newWorkspaces[0].id : null)
        : state.currentWorkspaceId;

      return {
        workspaces: newWorkspaces,
        currentWorkspaceId: newCurrentId,
        lastError: null,
      };
    });

    // Cascade: 清理该 workspace 下残留的附件, 避免内存泄漏 + 串到新 workspace
    useAttachmentsStore.getState().clear(workspaceId);

    // Sync to main process
    const piAPI = getPiAPI();
    if (piAPI) {
      piAPI.deleteWorkspace(workspaceId)
        .then((result) => {
          if (isIpcError(result)) {
            logger.error('[workspace-store] deleteWorkspace failed:', result.fallback);
            set({
              workspaces: before.workspaces,
              currentWorkspaceId: before.currentWorkspaceId,
              lastError: result.fallback,
            });
            addToast(result.fallback, "error");
          }
        })
        .catch((e) => {
          logger.error('[workspace-store] deleteWorkspace failed:', e);
          set({
            workspaces: before.workspaces,
            currentWorkspaceId: before.currentWorkspaceId,
            lastError: e instanceof Error ? e.message : String(e),
          });
          addToast(e instanceof Error ? e.message : "删除工作区失败", "error");
        });
    }
  },
  
  setCurrentWorkspace: (workspaceId: string) => {
    if (get().currentWorkspaceId && get().currentWorkspaceId !== workspaceId) {
      useSessionStore.getState().clearCurrentSession();
    }
    set(state => ({
      currentWorkspaceId: workspaceId,
      workspaces: state.workspaces.map(w =>
        w.id === workspaceId ? { ...w, lastActiveAt: new Date() } : w
      )
    }));
  },
  
  updateWorkspace: (workspaceId: string, updates: Partial<Workspace>) => {
    set(state => ({
      workspaces: state.workspaces.map(w => 
        w.id === workspaceId ? { ...w, ...updates } : w
      )
    }));
  },
  
  updateGitStatus: (workspaceId: string, gitStatus: GitStatus) => {
    set(state => ({
      workspaces: state.workspaces.map(w => 
        w.id === workspaceId ? { ...w, gitStatus } : w
      )
    }));
  },
  
  getCurrentWorkspace: () => {
    const state = get();
    return state.workspaces.find(w => w.id === state.currentWorkspaceId) || null;
  },

  clearError: () => set({ lastError: null }),
  };
});

// Trigger initial load at module load time (preserves original behavior:
// in tests window.piAPI is not yet set up, so getPiAPI() returns undefined
// and loadWorkspaces() is a no-op; in production it loads from main process).
useWorkspaceStore.getState().init();
