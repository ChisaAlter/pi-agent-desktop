// Approval Store - 文件变更审批状态管理
// 管理 AI 写入/编辑文件时的变更预览和审批流程

import { create } from 'zustand';
import type { DeferredEdit, FileReview, PiAPI } from '@shared';
import { isIpcError } from '@shared';

export interface PendingChange {
  id: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: 'write' | 'edit';
  filePath: string;
  status: 'pending' | 'approved' | 'rejected';
  /** write 操作: 全新文件内容 */
  newContent?: string;
  /** write 操作: 原始文件内容 (用于 diff) */
  oldContent?: string;
  /** edit 操作: 被替换的字符串 */
  oldString?: string;
  /** edit 操作: 新的字符串 */
  newString?: string;
  /** 预览 diff (unified diff 格式) */
  diff?: string;
  timestamp: Date;
}

interface ApprovalState {
  changes: PendingChange[];
  autoApprove: boolean;
  /** 等待中的审批 Promise resolve 回调 */
  _pendingResolves: Map<string, (approved: boolean) => void>;
  // Actions
  addChange: (change: Omit<PendingChange, 'id' | 'status' | 'timestamp'>) => string;
  upsertDeferredChange: (deferred: DeferredEdit) => void;
  applyReview: (review: FileReview) => void;
  approveChange: (id: string) => Promise<void>;
  rejectChange: (id: string) => Promise<void>;
  approveAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  clearChanges: () => Promise<void>;
  toggleAutoApprove: () => void;
  setAutoApprove: (value: boolean) => void;
  /** 注册一个等待审批的 Promise */
  waitForApproval: (changeId: string) => Promise<boolean>;
}

function getPiApi(api?: Pick<PiAPI, 'invoke'>): Pick<PiAPI, 'invoke'> | undefined {
  if (api) return api;
  if (typeof window === 'undefined') return undefined;
  return window.piAPI;
}

async function invokeApprovalChannel(
  change: PendingChange | undefined,
  channel: 'approval:approve' | 'approval:reject' | 'approval:remove',
  api?: Pick<PiAPI, 'invoke'>,
): Promise<boolean> {
  if (!change?.workspaceId) return true;
  const piAPI = getPiApi(api);
  if (!piAPI?.invoke) return true;
  const result = await piAPI.invoke(channel, change.workspaceId, change.id);
  return !isIpcError(result);
}

function resolvePendingChange(
  get: () => ApprovalState,
  set: (
    partial:
      | Partial<ApprovalState>
      | ((state: ApprovalState) => Partial<ApprovalState>)
  ) => void,
  id: string,
  approved: boolean,
): void {
  const resolve = get()._pendingResolves.get(id);
  if (resolve) {
    resolve(approved);
    const newResolves = new Map(get()._pendingResolves);
    newResolves.delete(id);
    set({ _pendingResolves: newResolves });
  }
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  changes: [],
  autoApprove: false,
  _pendingResolves: new Map(),

  addChange: (change) => {
    const id = `change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newChange: PendingChange = {
      ...change,
      id,
      status: 'pending',
      timestamp: new Date(),
    };
    set((state) => ({ changes: [...state.changes, newChange] }));
    return id;
  },

  upsertDeferredChange: (deferred) => {
    set((state) => {
      const existing = state.changes.find((change) => change.id === deferred.changeId);
      const timestamp = new Date(deferred.timestamp);
      if (existing) {
        return {
          changes: state.changes.map((change) =>
            change.id === deferred.changeId
              ? {
                  ...change,
                  workspaceId: deferred.workspaceId,
                  toolCallId: deferred.toolCallId,
                  toolName: deferred.op,
                  filePath: deferred.filePath,
                  timestamp,
                }
              : change,
          ),
        };
      }
      return {
        changes: [
          ...state.changes,
          {
            id: deferred.changeId,
            workspaceId: deferred.workspaceId,
            toolCallId: deferred.toolCallId,
            toolName: deferred.op,
            filePath: deferred.filePath,
            status: 'pending',
            timestamp,
          },
        ],
      };
    });
  },

  applyReview: (review) => {
    set((state) => ({
      changes: state.changes.map((change) =>
        change.id === review.changeId
          ? {
              ...change,
              workspaceId: review.workspaceId,
              toolCallId: review.toolCallId,
              filePath: review.filePath,
              diff: review.diff,
              newContent: review.newContent,
              timestamp: new Date(review.timestamp),
            }
          : change,
      ),
    }));
  },

  approveChange: async (id) => {
    const change = get().changes.find((c) => c.id === id);
    const ok = await invokeApprovalChannel(change, 'approval:approve');
    if (!ok) return;
    set((state) => ({
      changes: state.changes.map((c) =>
        c.id === id ? { ...c, status: 'approved' as const } : c
      ),
    }));
    resolvePendingChange(get, set, id, true);
  },

  rejectChange: async (id) => {
    const change = get().changes.find((c) => c.id === id);
    const ok = await invokeApprovalChannel(change, 'approval:reject');
    if (!ok) return;
    set((state) => ({
      changes: state.changes.map((c) =>
        c.id === id ? { ...c, status: 'rejected' as const } : c
      ),
    }));
    resolvePendingChange(get, set, id, false);
  },

  approveAll: async () => {
    const pendingIds = get().changes
      .filter((c) => c.status === 'pending')
      .map((c) => c.id);
    for (const id of pendingIds) {
      await get().approveChange(id);
    }
  },

  rejectAll: async () => {
    const pendingIds = get().changes
      .filter((c) => c.status === 'pending')
      .map((c) => c.id);
    for (const id of pendingIds) {
      await get().rejectChange(id);
    }
  },

  clearChanges: async () => {
    const handled = get().changes.filter((change) => change.status !== 'pending');
    for (const change of handled) {
      const ok = await invokeApprovalChannel(change, 'approval:remove');
      if (!ok) return;
    }
    const handledIds = new Set(handled.map((change) => change.id));
    set((state) => ({
      changes: state.changes.filter((change) => !handledIds.has(change.id)),
    }));
  },

  toggleAutoApprove: () => {
    set((state) => ({ autoApprove: !state.autoApprove }));
  },

  setAutoApprove: (value) => {
    set({ autoApprove: value });
  },

  waitForApproval: (changeId) => {
    return new Promise<boolean>((resolve) => {
      const state = get();

      // 如果已经是 approved/rejected，直接返回
      const change = state.changes.find((c) => c.id === changeId);
      if (change) {
        if (change.status === 'approved') {
          resolve(true);
          return;
        }
        if (change.status === 'rejected') {
          resolve(false);
          return;
        }
      }

      // 如果 autoApprove，直接批准
      if (state.autoApprove) {
        set((s) => ({
          changes: s.changes.map((c) =>
            c.id === changeId ? { ...c, status: 'approved' as const } : c
          ),
        }));
        resolve(true);
        return;
      }

      // 否则注册等待回调
      const newResolves = new Map(state._pendingResolves);
      newResolves.set(changeId, resolve);
      set({ _pendingResolves: newResolves });
    });
  },
}));

export function bindApprovalEventSubscriptions(
  api: Pick<PiAPI, 'onApprovalDeferred' | 'onApprovalReview'> | undefined =
    typeof window !== 'undefined' ? window.piAPI : undefined,
): () => void {
  if (!api) return () => undefined;
  const unsubscribers: Array<() => void> = [];
  if (typeof api.onApprovalDeferred === 'function') {
    unsubscribers.push(api.onApprovalDeferred((deferred) => {
      useApprovalStore.getState().upsertDeferredChange(deferred);
    }));
  }
  if (typeof api.onApprovalReview === 'function') {
    unsubscribers.push(api.onApprovalReview((review) => {
      useApprovalStore.getState().applyReview(review);
    }));
  }
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

/**
 * 为 write 操作生成 unified diff
 */
export function generateWriteDiff(
  filePath: string,
  oldContent: string | undefined,
  newContent: string
): string {
  const oldLines = (oldContent || '').split('\n');
  const newLines = newContent.split('\n');

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  let diff = `diff --git a/${fileName} b/${fileName}\n`;

  if (!oldContent) {
    diff += `new file mode 100644\n`;
    diff += `--- /dev/null\n`;
    diff += `+++ b/${fileName}\n`;
  } else {
    diff += `--- a/${fileName}\n`;
    diff += `+++ b/${fileName}\n`;
  }

  diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

  // Simple line-by-line diff
  if (!oldContent) {
    // New file: all lines are additions
    for (const line of newLines) {
      diff += `+${line}\n`;
    }
  } else {
    // Show context around changes (simple approach: show all lines)
    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (i >= oldLines.length) {
        diff += `+${newLines[i]}\n`;
      } else if (i >= newLines.length) {
        diff += `-${oldLines[i]}\n`;
      } else if (oldLines[i] !== newLines[i]) {
        diff += `-${oldLines[i]}\n`;
        diff += `+${newLines[i]}\n`;
      } else {
        diff += ` ${oldLines[i]}\n`;
      }
    }
  }

  return diff;
}

/**
 * 为 edit 操作生成 unified diff (old_string -> new_string 替换)
 */
export function generateEditDiff(
  filePath: string,
  oldString: string,
  newString: string
): string {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  let diff = `diff --git a/${fileName} b/${fileName}\n`;
  diff += `--- a/${fileName}\n`;
  diff += `+++ b/${fileName}\n`;
  diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

  for (const line of oldLines) {
    diff += `-${line}\n`;
  }
  for (const line of newLines) {
    diff += `+${line}\n`;
  }

  return diff;
}
