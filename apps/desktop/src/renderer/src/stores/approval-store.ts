// Approval Store - 文件变更审批状态管理
// 管理 AI 写入/编辑文件时的变更预览和审批流程

import { create } from 'zustand';

/** 等待中的审批 Promise resolve 回调 (非序列化, 离开 zustand state) */
const pendingResolves = new Map<string, (approved: boolean) => void>();

export interface PendingChange {
  id: string;
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
  // Actions
  addChange: (change: Omit<PendingChange, 'id' | 'status' | 'timestamp'>) => string;
  approveChange: (id: string) => void;
  rejectChange: (id: string) => void;
  approveAll: () => void;
  rejectAll: () => void;
  clearChanges: () => void;
  toggleAutoApprove: () => void;
  setAutoApprove: (value: boolean) => void;
  /** 注册一个等待审批的 Promise; 超时默认 5 分钟, 超时返回 false */
  waitForApproval: (changeId: string, timeoutMs?: number) => Promise<boolean>;
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  changes: [],
  autoApprove: false,

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

  approveChange: (id) => {
    set((state) => ({
      changes: state.changes.map((c) =>
        c.id === id ? { ...c, status: 'approved' as const } : c
      ),
    }));
    // resolve pending promise
    const resolve = pendingResolves.get(id);
    if (resolve) {
      resolve(true);
      pendingResolves.delete(id);
    }
  },

  rejectChange: (id) => {
    set((state) => ({
      changes: state.changes.map((c) =>
        c.id === id ? { ...c, status: 'rejected' as const } : c
      ),
    }));
    // resolve pending promise
    const resolve = pendingResolves.get(id);
    if (resolve) {
      resolve(false);
      pendingResolves.delete(id);
    }
  },

  approveAll: () => {
    const state = get();
    const pendingIds = state.changes
      .filter((c) => c.status === 'pending')
      .map((c) => c.id);

    set((state) => ({
      changes: state.changes.map((c) =>
        c.status === 'pending' ? { ...c, status: 'approved' as const } : c
      ),
    }));

    // resolve all pending promises
    for (const id of pendingIds) {
      const resolve = pendingResolves.get(id);
      if (resolve) {
        resolve(true);
        pendingResolves.delete(id);
      }
    }
  },

  rejectAll: () => {
    const state = get();
    const pendingIds = state.changes
      .filter((c) => c.status === 'pending')
      .map((c) => c.id);

    set((state) => ({
      changes: state.changes.map((c) =>
        c.status === 'pending' ? { ...c, status: 'rejected' as const } : c
      ),
    }));

    // resolve all pending promises
    for (const id of pendingIds) {
      const resolve = pendingResolves.get(id);
      if (resolve) {
        resolve(false);
        pendingResolves.delete(id);
      }
    }
  },

  clearChanges: () => {
    // reject any remaining pending
    for (const [, resolve] of pendingResolves) {
      resolve(false);
    }
    pendingResolves.clear();
    set({ changes: [] });
  },

  toggleAutoApprove: () => {
    set((state) => ({ autoApprove: !state.autoApprove }));
  },

  setAutoApprove: (value) => {
    set({ autoApprove: value });
  },

  waitForApproval: (changeId, timeoutMs = 5 * 60 * 1000) => {
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
      pendingResolves.set(changeId, resolve);
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (pendingResolves.has(changeId)) {
            pendingResolves.delete(changeId);
            resolve(false);
          }
        }, timeoutMs);
      }
    });
  },
}));

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
