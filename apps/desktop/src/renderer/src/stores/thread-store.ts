// Thread Store - Manages agent threads

import { create } from 'zustand';
import { useSessionStore } from './session-store';

export interface Thread {
  id: string;
  title: string;
  workspaceId: string;
  sessionId: string; // Associated session
  status: 'idle' | 'running' | 'completed' | 'failed';
  mode: 'local' | 'worktree'; // Run mode
  worktreePath?: string; // Worktree path
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  fileChanges: number; // Number of changed files
}

interface ThreadState {
  threads: Thread[];
  currentThreadId: string | null;

  // Actions
  createThread: (workspaceId: string, mode?: 'local' | 'worktree', title?: string) => Thread;
  deleteThread: (threadId: string) => void;
  updateThread: (threadId: string, updates: Partial<Thread>) => void;
  setCurrentThread: (threadId: string) => void;
  getThreadsByWorkspace: (workspaceId: string) => Thread[];
  getCurrentThread: () => Thread | null;
  incrementMessageCount: (threadId: string) => void;
  incrementFileChanges: (threadId: string) => void;
  setThreadStatus: (threadId: string, status: Thread['status']) => void;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  currentThreadId: null,

  createThread: (workspaceId: string, mode: 'local' | 'worktree' = 'local', title?: string) => {
    // Create associated session via session store
    const sessionStore = useSessionStore.getState();
    const session = sessionStore.createSession(workspaceId);

    const newThread: Thread = {
      id: `thread-${Date.now()}`,
      title: title || `Thread ${get().threads.filter(t => t.workspaceId === workspaceId).length + 1}`,
      workspaceId,
      sessionId: session.id,
      status: 'idle',
      mode,
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      fileChanges: 0,
    };

    set(state => ({
      threads: [...state.threads, newThread],
      currentThreadId: newThread.id,
    }));

    return newThread;
  },

  deleteThread: (threadId: string) => {
    const thread = get().threads.find(t => t.id === threadId);

    set(state => {
      const newThreads = state.threads.filter(t => t.id !== threadId);
      const newCurrentId = state.currentThreadId === threadId
        ? (newThreads.length > 0 ? newThreads[newThreads.length - 1].id : null)
        : state.currentThreadId;

      return {
        threads: newThreads,
        currentThreadId: newCurrentId,
      };
    });

    // Also delete associated session
    if (thread) {
      const sessionStore = useSessionStore.getState();
      sessionStore.deleteSession(thread.sessionId);
    }
  },

  updateThread: (threadId: string, updates: Partial<Thread>) => {
    set(state => ({
      threads: state.threads.map(t =>
        t.id === threadId ? { ...t, ...updates, updatedAt: new Date() } : t
      ),
    }));
  },

  setCurrentThread: (threadId: string) => {
    set({ currentThreadId: threadId });

    // Also switch the session store to the associated session
    const thread = get().threads.find(t => t.id === threadId);
    if (thread) {
      const sessionStore = useSessionStore.getState();
      sessionStore.setCurrentSession(thread.sessionId);
    }
  },

  getThreadsByWorkspace: (workspaceId: string) => {
    return get().threads
      .filter(t => t.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  getCurrentThread: () => {
    const state = get();
    return state.threads.find(t => t.id === state.currentThreadId) || null;
  },

  incrementMessageCount: (threadId: string) => {
    set(state => ({
      threads: state.threads.map(t =>
        t.id === threadId
          ? { ...t, messageCount: t.messageCount + 1, updatedAt: new Date() }
          : t
      ),
    }));
  },

  incrementFileChanges: (threadId: string) => {
    set(state => ({
      threads: state.threads.map(t =>
        t.id === threadId
          ? { ...t, fileChanges: t.fileChanges + 1, updatedAt: new Date() }
          : t
      ),
    }));
  },

  setThreadStatus: (threadId: string, status: Thread['status']) => {
    set(state => ({
      threads: state.threads.map(t =>
        t.id === threadId
          ? { ...t, status, updatedAt: new Date() }
          : t
      ),
    }));
  },
}));
