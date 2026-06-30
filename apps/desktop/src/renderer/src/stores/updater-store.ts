import { create } from "zustand";
import { type AppUpdaterState, type IpcError } from "@shared";
import { getPiAPI } from "../utils/pi-api";
import { partition } from "../utils/ipc";

/** setupListeners 的 cleanup 函数 (非序列化, 离开 zustand state) */
let cleanupFn: (() => void) | null = null;

interface UpdaterStoreState {
  state: AppUpdaterState | null;
  loading: boolean;
  error: IpcError | string | null;
  hydrate: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setupListeners: () => void;
  cleanupListeners: () => void;
}

export const useUpdaterStore = create<UpdaterStoreState>((set) => ({
  state: null,
  loading: false,
  error: null,

  hydrate: async () => {
    const piAPI = getPiAPI();
    if (!piAPI?.updaterGetState) return;
    set({ loading: true, error: null });
    try {
      const result = await piAPI.updaterGetState();
      const parsed = partition(result);
      if (parsed.ok) {
        set({ state: parsed.data, loading: false, error: null });
      } else {
        set({ error: parsed.err, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  checkForUpdates: async () => {
    const piAPI = getPiAPI();
    if (!piAPI?.updaterCheck) return;
    set({ loading: true, error: null });
    try {
      const result = await piAPI.updaterCheck();
      const parsed = partition(result);
      if (parsed.ok) {
        set({ state: parsed.data, loading: false, error: null });
      } else {
        set({ error: parsed.err, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  downloadUpdate: async () => {
    const piAPI = getPiAPI();
    if (!piAPI?.updaterDownload) return;
    set({ loading: true, error: null });
    try {
      const result = await piAPI.updaterDownload();
      const parsed = partition(result);
      if (parsed.ok) {
        set({ state: parsed.data, loading: false, error: null });
      } else {
        set({ error: parsed.err, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  installUpdate: async () => {
    const piAPI = getPiAPI();
    if (!piAPI?.updaterInstall) return;
    set({ loading: true, error: null });
    try {
      const result = await piAPI.updaterInstall();
      const parsed = partition(result);
      if (parsed.ok) {
        set({ state: parsed.data, loading: false, error: null });
      } else {
        set({ error: parsed.err, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  setupListeners: () => {
    const piAPI = getPiAPI();
    if (!piAPI?.onUpdaterStateChanged) return;
    if (cleanupFn) return;
    const cleanup = piAPI.onUpdaterStateChanged((state) => {
      set({ state, loading: false, error: null });
    });
    cleanupFn = cleanup;
  },

  cleanupListeners: () => {
    const cleanup = cleanupFn;
    cleanup?.();
    cleanupFn = null;
  },
}));
