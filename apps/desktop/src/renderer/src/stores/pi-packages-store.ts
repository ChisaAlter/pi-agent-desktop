import { create } from "zustand";
import { isIpcError, type InstalledPiPackage, type PiPackageActionResult, type PiPackageInfo } from "@shared";
import { addToast } from "./toast-store";

export type PiPackageActionKind = "search" | "refresh" | "refresh-installed" | "install" | "remove" | "update";

export interface PiPackageFailedAction {
  kind: PiPackageActionKind;
  source?: string;
  label: string;
}

interface PiPackagesState {
  query: string;
  results: PiPackageInfo[];
  installed: InstalledPiPackage[];
  loading: boolean;
  installedLoading: boolean;
  actionSource: string | null;
  error: string | null;
  retryAction: (() => Promise<void>) | null;
  lastFailedAction: PiPackageFailedAction | null;
  lastAction: PiPackageActionResult | null;
  setQuery: (query: string) => void;
  search: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  install: (source: string) => Promise<void>;
  remove: (source: string) => Promise<void>;
  update: (source: string) => Promise<void>;
}

function resultMessage(value: unknown): string | null {
  if (isIpcError(value)) return value.fallback;
  return null;
}

let searchSeq = 0;

export const usePiPackagesStore = create<PiPackagesState>((set, get) => ({
  query: "",
  results: [],
  installed: [],
  loading: false,
  installedLoading: false,
  actionSource: null,
  error: null,
  retryAction: null,
  lastFailedAction: null,
  lastAction: null,

  setQuery: (query) => set({ query }),

  search: async () => {
    const requestId = ++searchSeq;
    const query = get().query;
    set({ loading: true, error: null, retryAction: null, lastFailedAction: null });
    try {
      const response = await window.piAPI?.packagesSearch(query);
      if (requestId !== searchSeq) return;
      const message = resultMessage(response);
      if (message) {
        set({ error: message, loading: false, retryAction: get().search, lastFailedAction: { kind: "search", label: "搜索" } });
        return;
      }
      set({ results: Array.isArray(response) ? response : [], loading: false });
    } catch (err) {
      if (requestId !== searchSeq) return;
      set({ error: err instanceof Error ? err.message : String(err), loading: false, retryAction: get().search, lastFailedAction: { kind: "search", label: "搜索" } });
    }
  },

  refreshCatalog: async () => {
    set({ loading: true, error: null, retryAction: null, lastFailedAction: null });
    try {
      const response = await window.piAPI?.packagesRefreshCatalog();
      const message = resultMessage(response);
      if (message) {
        set({ error: message, loading: false, retryAction: get().refreshCatalog, lastFailedAction: { kind: "refresh", label: "刷新目录" } });
        return;
      }
      set({ results: Array.isArray(response) ? response : [], loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false, retryAction: get().refreshCatalog, lastFailedAction: { kind: "refresh", label: "刷新目录" } });
    }
  },

  refreshInstalled: async () => {
    set({ installedLoading: true, error: null, retryAction: null, lastFailedAction: null });
    try {
      const response = await window.piAPI?.packagesListInstalled();
      const message = resultMessage(response);
      if (message) {
        set({ error: message, installedLoading: false, retryAction: get().refreshInstalled, lastFailedAction: { kind: "refresh-installed", label: "刷新已安装列表" } });
        addToast(message, "error", get().refreshInstalled);
        return;
      }
      set({ installed: Array.isArray(response) ? response : [], installedLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), installedLoading: false, retryAction: get().refreshInstalled, lastFailedAction: { kind: "refresh-installed", label: "刷新已安装列表" } });
    }
  },

  install: async (source) => {
    set({ actionSource: source, error: null, retryAction: null, lastFailedAction: null, lastAction: null });
    try {
      const response = await window.piAPI?.packagesInstall(source);
      const message = resultMessage(response);
      if (message) {
        set({ error: message, actionSource: null, retryAction: () => get().install(source), lastFailedAction: { kind: "install", source, label: "安装" } });
        return;
      }
      set({ lastAction: response as PiPackageActionResult, actionSource: null });
      await get().refreshInstalled();
      await get().search();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), actionSource: null, retryAction: () => get().install(source), lastFailedAction: { kind: "install", source, label: "安装" } });
    }
  },

  remove: async (source) => {
    set({ actionSource: source, error: null, retryAction: null, lastFailedAction: null, lastAction: null });
    try {
      const response = await window.piAPI?.packagesRemove(source);
      const message = resultMessage(response);
      if (message) {
        set({ error: message, actionSource: null, retryAction: () => get().remove(source), lastFailedAction: { kind: "remove", source, label: "卸载" } });
        addToast(message, "error", () => get().remove(source));
        return;
      }
      set({ lastAction: response as PiPackageActionResult, actionSource: null });
      await get().refreshInstalled();
      await get().search();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), actionSource: null, retryAction: () => get().remove(source), lastFailedAction: { kind: "remove", source, label: "卸载" } });
      addToast(err instanceof Error ? err.message : String(err), "error", () => get().remove(source));
    }
  },

  update: async (source) => {
    set({ actionSource: source, error: null, retryAction: null, lastFailedAction: null, lastAction: null });
    try {
      const response = await window.piAPI?.packagesUpdate(source);
      const message = resultMessage(response);
      if (message) {
        set({ error: message, actionSource: null, retryAction: () => get().update(source), lastFailedAction: { kind: "update", source, label: "更新" } });
        return;
      }
      set({ lastAction: response as PiPackageActionResult, actionSource: null });
      await get().refreshInstalled();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), actionSource: null, retryAction: () => get().update(source), lastFailedAction: { kind: "update", source, label: "更新" } });
      addToast(err instanceof Error ? err.message : String(err), "error", () => get().update(source));
    }
  },
}));
