// Workspace Store - Manages workspaces

import { create } from 'zustand';

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
  
  // Actions
  addWorkspace: (name: string, path: string) => Workspace;
  removeWorkspace: (workspaceId: string) => void;
  setCurrentWorkspace: (workspaceId: string) => void;
  updateWorkspace: (workspaceId: string, updates: Partial<Workspace>) => void;
  updateGitStatus: (workspaceId: string, gitStatus: GitStatus) => void;
  getCurrentWorkspace: () => Workspace | null;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Load workspaces from main process on init
  const loadWorkspaces = async () => {
    try {
      if (window.piAPI) {
        const wsList = await window.piAPI.listWorkspaces();
        const workspaces = wsList.map(ws => ({
          ...ws,
          createdAt: new Date(ws.createdAt),
          lastActiveAt: new Date((ws as any).lastActiveAt || ws.createdAt)
        }));
        set({ workspaces, currentWorkspaceId: workspaces[0]?.id || null });
      }
    } catch (e) {
      console.error('Failed to load workspaces:', e);
    }
  };
  loadWorkspaces();

  return {
  workspaces: [],
  currentWorkspaceId: null,

  addWorkspace: (name: string, path: string) => {
    const newWorkspace: Workspace = {
      id: Date.now().toString(),
      name,
      path,
      createdAt: new Date(),
      lastActiveAt: new Date()
    };

    set(state => ({
      workspaces: [...state.workspaces, newWorkspace],
      currentWorkspaceId: newWorkspace.id
    }));

    return newWorkspace;
  },

  removeWorkspace: (workspaceId: string) => {
    set(state => {
      const newWorkspaces = state.workspaces.filter(w => w.id !== workspaceId);
      const newCurrentId = state.currentWorkspaceId === workspaceId
        ? (newWorkspaces.length > 0 ? newWorkspaces[0].id : null)
        : state.currentWorkspaceId;

      return {
        workspaces: newWorkspaces,
        currentWorkspaceId: newCurrentId
      };
    });

    // Sync to main process
    if (window.piAPI) {
      window.piAPI.deleteWorkspace(workspaceId).catch(console.error);
    }
  },
  
  setCurrentWorkspace: (workspaceId: string) => {
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
  }
  };
});