/**
 * Pi Status Store — 管理 Pi CLI 的安装状态、检测、安装/更新进度
 * v1.0.8: 错误类型从 string 改为 IpcError | string | null — 走 IpcError 时由 UI 层 t() 翻译
 */

import { create } from 'zustand';
import { type IpcError } from '@shared';
import type { PiDriverStatus, PiInstallProgress } from '../types';
import { partition } from '../utils/ipc';

/** setupListeners 的 cleanup 函数 (非序列化, 离开 zustand state) */
let cleanupFn: (() => void) | null = null;

interface PiStatusState {
  // 状态
  status: PiDriverStatus | null;
  loading: boolean;
  /** v1.0.8: IpcError 走 i18n code, string 兜底 (兼容老 throw 路径 / 内部异常) */
  error: IpcError | string | null;

  // 安装/更新进度
  progress: PiInstallProgress | null;
  isOperating: boolean; // 是否正在安装/更新/卸载

  // Actions
  checkStatus: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  install: () => Promise<void>;
  update: () => Promise<void>;
  uninstall: () => Promise<void>;
  cancelOperation: () => Promise<void>;

  // 内部
  _setStatus: (status: PiDriverStatus) => void;
  _setProgress: (progress: PiInstallProgress) => void;
  setupListeners: () => void;
  cleanupListeners: () => void;
}

export const usePiStatusStore = create<PiStatusState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  progress: null,
  isOperating: false,

  _setStatus: (status) => set({ status, loading: false, error: null }),

  // v1.0.10 (M3): _setProgress 只管 progress 状态, 不再清 isOperating
  // isOperating 的 reset 由 install/update/uninstall/cancelOperation 自己负责
  // (避免跟 install() 里的 set({ isOperating: false }) 重复 / 竞态)
  _setProgress: (progress) => {
    set({ progress });
    if (progress.stage === 'done') {
      // 操作完成: 拉一次最新状态. isOperating 由对应 action 重置.
      void get().refreshStatus();
    }
  },

  setupListeners: () => {
    if (cleanupFn) return; // 幂等: 已注册过则跳过
    const api = window.piAPI;
    if (!api) return;

    const cleanup1 = api.onPiStatusChanged?.((status: PiDriverStatus) => {
      get()._setStatus(status);
    });

    const cleanup2 = api.onPiInstallProgress?.((progress: PiInstallProgress) => {
      get()._setProgress(progress);
    });

    cleanupFn = () => {
      cleanup1?.();
      cleanup2?.();
    };
  },

  cleanupListeners: () => {
    const cleanup = cleanupFn;
    if (cleanup) {
      cleanup();
      cleanupFn = null;
    }
  },

  checkStatus: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ loading: true, error: null });
    try {
      const result = await api.getStatus();
      const p = partition(result);
      if (p.ok) set({ status: p.data, loading: false });
      else set({ error: p.err, loading: false });
    } catch (e) {
      // 兜底: 老 throw 路径 / preload 未桥接等
      set({ error: String(e), loading: false });
    }
  },

  refreshStatus: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ loading: true, error: null });
    try {
      const result = await api.refreshPiStatus();
      const p = partition(result);
      if (p.ok) set({ status: p.data, loading: false });
      else set({ error: p.err, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  install: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ isOperating: true, error: null, progress: { stage: 'downloading', message: '准备安装...' } });
    try {
      const result = await api.installPi();
      const p = partition(result);
      if (p.ok) {
        set({ isOperating: false });
        await get().refreshStatus();
      } else {
        set({ error: p.err, isOperating: false });
      }
    } catch (e) {
      set({ error: String(e), isOperating: false });
    }
  },

  update: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ isOperating: true, error: null, progress: { stage: 'downloading', message: '准备更新...' } });
    try {
      const result = await api.updatePi();
      const p = partition(result);
      if (p.ok) {
        set({ isOperating: false });
        await get().refreshStatus();
      } else {
        set({ error: p.err, isOperating: false });
      }
    } catch (e) {
      set({ error: String(e), isOperating: false });
    }
  },

  uninstall: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ isOperating: true, error: null, progress: { stage: 'downloading', message: '准备卸载...' } });
    try {
      const result = await api.uninstallPi();
      const p = partition(result);
      if (p.ok) {
        set({ isOperating: false });
        await get().refreshStatus();
      } else {
        set({ error: p.err, isOperating: false });
      }
    } catch (e) {
      set({ error: String(e), isOperating: false });
    }
  },

  cancelOperation: async () => {
    const api = window.piAPI;
    if (!api) return;
    await api.cancelPiOperation();
    set({ isOperating: false, progress: null });
  },
}));
