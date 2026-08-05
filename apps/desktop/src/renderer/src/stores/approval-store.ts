// Approval Store - 文件变更审批状态管理
// 管理 AI 写入/编辑文件时的变更预览和审批流程
//
// 语义 (v1.0.14 重做):
//  - 保留 (keepChange): 接受这次变更, 不改文件
//  - 撤销 (undoChange): 调主进程用变更前快照真实回滚文件
//  - 关闭面板: 只收起 UI, 不处理任何变更 (dismiss ≠ reject)

import { create } from 'zustand';
import { isIpcError, type IpcError } from '@shared';

/** 等待中的审批 Promise resolve 回调 (非序列化, 离开 zustand state) */
const pendingResolves = new Map<string, (approved: boolean) => void>();

export interface PendingChange {
  id: string;
  toolCallId: string;
  toolName: 'write' | 'edit';
  filePath: string;
  /** 所属 workspace, 撤销时传给主进程 */
  workspaceId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'undone';
  /** write 操作: 全新文件内容 */
  newContent?: string;
  /** 变更前内容快照 (string=原内容, null=原文件不存在, undefined=未记录) */
  oldContent?: string | null;
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
  /** changeId → 撤销失败原因 (IpcError 供组件按 code 翻译; 内部错误为 string) */
  undoError: Record<string, string | IpcError>;
  // Actions
  /** 主进程 review payload 必须传入 canonical id；无远端 id 时才生成兼容 id。 */
  addChange: (change: Omit<PendingChange, 'status' | 'timestamp'> & { id?: string }) => string;
  /** 保留变更: 主进程确认清理快照后再更新本地状态。 */
  keepChange: (id: string) => Promise<void>;
  /** 撤销变更: 主进程用快照回滚文件 */
  undoChange: (id: string) => Promise<void>;
  /** 撤销全部 pending 变更 */
  undoAll: () => Promise<void>;
  /** 保留全部 pending 变更 */
  keepAll: () => Promise<void>;
  // 兼容旧调用方
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

function dropUndoError(undoError: Record<string, string | IpcError>, id: string): Record<string, string | IpcError> {
  if (!(id in undoError)) return undoError;
  const next = { ...undoError };
  delete next[id];
  return next;
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  changes: [],
  autoApprove: false,
  undoError: {},

  addChange: (change) => {
    const id = change.id ?? `change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newChange: PendingChange = {
      ...change,
      id,
      status: 'pending',
      timestamp: new Date(),
    };
    set((state) => ({ changes: [...state.changes, newChange] }));
    return id;
  },

  keepChange: async (id) => {
    const change = get().changes.find((c) => c.id === id);
    if (!change || change.status !== 'pending') return;
    if (!change.workspaceId || !window.piAPI?.keepApprovalChange) {
      set((state) => ({ undoError: { ...state.undoError, [id]: '保留通道不可用' } }));
      return;
    }
    let result: Awaited<ReturnType<typeof window.piAPI.keepApprovalChange>>;
    try {
      result = await window.piAPI.keepApprovalChange(change.workspaceId, id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => ({ undoError: { ...state.undoError, [id]: message } }));
      return;
    }
    if (isIpcError(result)) {
      set((state) => ({ undoError: { ...state.undoError, [id]: result } }));
      return;
    }
    set((state) => ({
      changes: state.changes.map((c) => c.id === id ? { ...c, status: 'approved' as const } : c),
      undoError: dropUndoError(state.undoError, id),
    }));
    const resolve = pendingResolves.get(id);
    if (resolve) {
      resolve(true);
      pendingResolves.delete(id);
    }
  },

    undoChange: async (id) => {
      const change = get().changes.find((c) => c.id === id);
      if (!change || change.status !== 'pending') return;
      if (!change.workspaceId) {
        set((state) => ({ undoError: { ...state.undoError, [id]: '缺少 workspace 信息, 无法撤销' } }));
        return;
      }
      const api = window.piAPI;
      if (!api?.undoApprovalChange) {
        set((state) => ({ undoError: { ...state.undoError, [id]: '撤销通道不可用' } }));
        return;
      }
      let result: Awaited<ReturnType<typeof api.undoApprovalChange>>;
      try {
        result = await api.undoApprovalChange(change.workspaceId, id);
      } catch (err) {
        // IPC 本身异常 (窗口关闭等) → 记录错误, 条目保持 pending 可重试
        const message = err instanceof Error ? err.message : String(err);
        set((state) => ({ undoError: { ...state.undoError, [id]: message } }));
        return;
      }
      if (isIpcError(result)) {
        set((state) => ({ undoError: { ...state.undoError, [id]: result } }));
        return;
      }
      set((state) => ({
        changes: state.changes.map((c) =>
          c.id === id ? { ...c, status: 'undone' as const } : c
        ),
        undoError: dropUndoError(state.undoError, id),
      }));
      const resolve = pendingResolves.get(id);
      if (resolve) {
        resolve(false);
        pendingResolves.delete(id);
      }
    },

  undoAll: async () => {
    const pendingIds = get().changes
      .filter((c) => c.status === 'pending')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .map((c) => c.id);
    // 串行执行: 同文件多次编辑的快照是 LIFO 语义, 并行写回会乱序。
    // 单条失败不中断 (记录 undoError 后继续), 与 allSettled 行为一致。
    for (const id of pendingIds) {
      await get().undoChange(id);
    }
  },

  keepAll: async () => {
    const pendingIds = get().changes
      .filter((c) => c.status === 'pending')
      .map((c) => c.id);
    // 保持顺序并逐条由主进程结算, 单条失败不阻断后续。
    for (const id of pendingIds) {
      await get().keepChange(id);
    }
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
