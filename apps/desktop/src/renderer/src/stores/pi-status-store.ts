/**
 * Pi Status Store — 管理 Pi CLI 的安装状态、检测、安装/更新进度
 */

import { create } from 'zustand';
import type { PiDriverStatus, PiInstallProgress } from '../types';

interface PiStatusState {
  // 状态
  status: PiDriverStatus | null;
  loading: boolean;
  error: string | null;

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
  _cleanup: (() => void) | null;
  setupListeners: () => void;
  cleanupListeners: () => void;
}

export const usePiStatusStore = create<PiStatusState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  progress: null,
  isOperating: false,
  _cleanup: null,

  _setStatus: (status) => set({ status, loading: false, error: null }),

  _setProgress: (progress) => {
    set({ progress });
    // 操作完成时自动刷新状态
    if (progress.stage === 'done') {
      set({ isOperating: false });
      get().refreshStatus();
    } else if (progress.stage === 'error') {
      set({ isOperating: false });
    }
  },

  setupListeners: () => {
    const api = window.piAPI;
    if (!api) return;

    const cleanup1 = api.onPiStatusChanged?.((status: PiDriverStatus) => {
      get()._setStatus(status);
    });

    const cleanup2 = api.onPiInstallProgress?.((progress: PiInstallProgress) => {
      get()._setProgress(progress);
    });

    set({
      _cleanup: () => {
        cleanup1?.();
        cleanup2?.();
      }
    });
  },

  cleanupListeners: () => {
    const cleanup = get()._cleanup;
    if (cleanup) {
      cleanup();
      set({ _cleanup: null });
    }
  },

  checkStatus: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ loading: true, error: null });
    try {
      const status = await api.getStatus();
      set({ status, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  refreshStatus: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ loading: true, error: null });
    try {
      const status = await api.refreshPiStatus();
      set({ status, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  install: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ isOperating: true, error: null, progress: { stage: 'downloading', message: '准备安装...' } });
    try {
      await api.installPi();
      set({ isOperating: false });
      await get().refreshStatus();
    } catch (err) {
      set({ error: String(err), isOperating: false });
    }
  },

  update: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ isOperating: true, error: null, progress: { stage: 'downloading', message: '准备更新...' } });
    try {
      await api.updatePi();
      set({ isOperating: false });
      await get().refreshStatus();
    } catch (err) {
      set({ error: String(err), isOperating: false });
    }
  },

  uninstall: async () => {
    const api = window.piAPI;
    if (!api) return;

    set({ isOperating: true, error: null, progress: { stage: 'downloading', message: '准备卸载...' } });
    try {
      await api.uninstallPi();
      set({ isOperating: false });
      await get().refreshStatus();
    } catch (err) {
      set({ error: String(err), isOperating: false });
    }
  },

  cancelOperation: async () => {
    const api = window.piAPI;
    if (!api) return;
    await api.cancelPiOperation();
    set({ isOperating: false, progress: null });
  },
}));
