import { create } from "zustand";
import { isIpcError, type AppUpdaterState, type IpcError } from "@shared";

interface UpdaterStoreState {
  state: AppUpdaterState | null;
  loading: boolean;
  error: IpcError | string | null;
  _cleanup: (() => void) | null;
  hydrate: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setupListeners: () => void;
  cleanupListeners: () => void;
}

function getPiAPI(): Window["piAPI"] | undefined {
  return typeof window !== "undefined" ? window.piAPI : undefined;
}

function partition<T>(result: T | IpcError): { ok: true; data: T } | { ok: false; err: IpcError } {
  if (isIpcError(result)) return { ok: false, err: result };
  return { ok: true, data: result };
}

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => ({
  state: null,
  loading: false,
  error: null,
  _cleanup: null,

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
    if (get()._cleanup) return;
    const cleanup = piAPI.onUpdaterStateChanged((state) => {
      set({ state, loading: false, error: null });
    });
    set({ _cleanup: cleanup });
  },

  cleanupListeners: () => {
    const cleanup = get()._cleanup;
    cleanup?.();
    set({ _cleanup: null });
  },
}));
