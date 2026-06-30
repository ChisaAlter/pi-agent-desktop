// Settings Store - Manages application settings
// v1.0.5: AppSettings / PiModelInfo 跟 @shared 重复, 改用 re-export + 本地 alias 保留 store 旧代码
// v1.0.6: console 换 logger
// v1.0.9: 写错误经 _onError listener 走 IpcError 路径, 设置窗口统一显示
// v1.0.15: default model/provider 改成空串 — 不再 hardcode 'gpt-4' / 'openai' 假数据;
//          启动时由 loadPiConfig 真从 Pi CLI 配置读;读不到时 Pi ChatInput / 设置页走空态

import { create } from 'zustand';
import { DEFAULT_LONG_HORIZON_SETTINGS, isIpcError, type AppSettings, type IpcError, type ShortcutOverride, type ToolPermissions } from '@shared';
import { logger } from '../utils/logger';
import { addToast } from './toast-store';
import { applyFontSize, applyTheme, getInitialFontSize, getInitialTheme, normalizeFontSize, type Theme } from '../utils/theme';
import { getPiAPI } from '../utils/pi-api';

export type { AppSettings };

export interface PiModelInfo {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  description: string;
  maxTokens?: number;
}

/** loadPiConfig 返的形状 (主进程 settings:load-pi-config 还没强类型化, 临时结构) */
interface PiConfigPayload {
  models?: PiModelInfo[];
  currentModel?: { model: string; provider: string } | null;
}

interface SettingsState {
  settings: AppSettings;
  piModels: PiModelInfo[] | null;
  /** v1.0.9: 最近一次写错误 (IpcError | string | null). 设置窗口订阅后翻译显示. */
  lastWriteError: IpcError | string | null;
  rightRailCollapsed: boolean;
  sidebarGroupMode: 'date' | 'workspace';

  // Actions
  updateSettings: (updates: Partial<AppSettings>) => void;
  flushPendingSettingsWrite: () => Promise<void>;
  resetSettings: () => void;
  loadPiConfig: () => Promise<void>;
  /** 清除最近写错误 (用户点 close 后清) */
  clearWriteError: () => void;
  getWorkspaceToolDefaults: (workspaceId?: string | null) => ToolPermissions;
  updateWorkspaceToolDefaults: (workspaceId: string, permissions: ToolPermissions) => void;
  setTheme: (theme: Theme) => void;
  toggleRightRail: () => void;
  setSidebarGroupMode: (mode: 'date' | 'workspace') => void;
}

const SHORTCUT_OVERRIDE_STORAGE_KEY = "pi-desktop-shortcut-overrides";

function sanitizeShortcutOverrides(value: unknown): ShortcutOverride[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ShortcutOverride =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as Partial<ShortcutOverride>).id === "string" &&
      typeof (item as Partial<ShortcutOverride>).keys === "string",
    )
    .map((item) => ({ id: item.id, keys: item.keys }));
}

function readCachedShortcutOverrides(): ShortcutOverride[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage?.getItem(SHORTCUT_OVERRIDE_STORAGE_KEY);
    return raw ? sanitizeShortcutOverrides(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function cacheShortcutOverrides(overrides: readonly ShortcutOverride[] | undefined): void {
  try {
    if (typeof window === "undefined") return;
    const normalized = sanitizeShortcutOverrides(overrides);
    if (normalized.length === 0) {
      window.localStorage?.removeItem(SHORTCUT_OVERRIDE_STORAGE_KEY);
      return;
    }
    window.localStorage?.setItem(SHORTCUT_OVERRIDE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore unavailable localStorage in restricted renderer contexts.
  }
}

const defaultSettings: AppSettings = {
  theme: getInitialTheme(),
  fontSize: getInitialFontSize(),
  model: '',
  provider: '',
  temperature: 0.7,
  maxTokens: 4096,
  autoSave: true,
  showLineNumbers: true,
  wordWrap: true,
  permissionLevel: 'smart',
  runtimeChannel: 'stable',
  autoCompactionEnabled: false,
  workspaceToolDefaults: {},
  sidebarGroupMode: 'date',
  shortcutOverrides: readCachedShortcutOverrides(),
  showThinking: true,
  thinkingLevel: 'medium',
  longHorizon: DEFAULT_LONG_HORIZON_SETTINGS,
};

function cacheTheme(theme: Theme): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("pi-desktop-theme", theme);
    }
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }
}

function applyAndCacheTheme(theme: Theme): void {
  applyTheme(theme);
  cacheTheme(theme);
}

function cacheFontSize(fontSize: number): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("pi-desktop-font-size", String(fontSize));
    }
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }
}

function applyAndCacheFontSize(fontSize: number): void {
  const normalized = applyFontSize(fontSize);
  cacheFontSize(normalized);
}

const SETTINGS_WRITE_DEBOUNCE_MS = 120;

export const TOOL_PERMISSION_PRESETS: Record<"minimal" | "development" | "all", ToolPermissions> = {
  minimal: {
    fileRead: true,
    fileWrite: false,
    shell: false,
    git: false,
    network: false,
    extensions: false,
  },
  development: {
    fileRead: true,
    fileWrite: true,
    shell: true,
    git: true,
    network: false,
    extensions: true,
  },
  all: {
    fileRead: true,
    fileWrite: true,
    shell: true,
    git: true,
    network: true,
    extensions: true,
  },
};

/** 内部 helper: 把 setSettings 返的 (void | IpcError) / throw 统一成 lastWriteError */
function reportWriteError(e: unknown): IpcError | string {
  if (isIpcError(e)) return e;
    return String(e);
}

function shouldSyncPiDefaultModel(updates: Partial<AppSettings>, next: AppSettings): boolean {
  return (updates.model !== undefined || updates.provider !== undefined) && Boolean(next.model && next.provider);
}

async function syncPiDefaultModel(piAPI: Window["piAPI"], next: AppSettings): Promise<void> {
  const result = await piAPI.configSetDefaultModel(next.provider, next.model);
  if (isIpcError(result)) {
    throw new Error(result.fallback);
  }
  if (!result.valid) {
    throw new Error(result.error ?? "同步 Pi 默认模型失败");
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  let pendingSettingsWriteTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSettingsUpdates: Partial<AppSettings> | null = null;
  let pendingPreviousSettings: AppSettings | null = null;
  let pendingMergedSettings: AppSettings | null = null;
  let pendingSyncModelDefault = false;
  let settingsWriteRevision = 0;

  const clearPendingSettingsWrite = (): void => {
    if (pendingSettingsWriteTimer) {
      clearTimeout(pendingSettingsWriteTimer);
      pendingSettingsWriteTimer = null;
    }
    pendingSettingsUpdates = null;
    pendingPreviousSettings = null;
    pendingMergedSettings = null;
    pendingSyncModelDefault = false;
  };

  const consumePendingSettingsWrite = (): {
    updatesToSave: Partial<AppSettings>;
    previousSettings: AppSettings;
    mergedSettings: AppSettings;
    syncModelDefault: boolean;
    revision: number;
  } | null => {
    const updatesToSave = pendingSettingsUpdates;
    const previousSettings = pendingPreviousSettings;
    const mergedSettings = pendingMergedSettings;
    const syncModelDefault = pendingSyncModelDefault && Boolean(mergedSettings?.model && mergedSettings.provider);
    const revision = settingsWriteRevision;
    clearPendingSettingsWrite();
    if (!updatesToSave || !previousSettings || !mergedSettings) return null;
    return {
      updatesToSave,
      previousSettings,
      mergedSettings,
      syncModelDefault,
      revision,
    };
  };

  const commitSettingsWrite = async (
    piAPI: Window["piAPI"],
    {
      updatesToSave,
      previousSettings,
      mergedSettings,
      syncModelDefault,
      revision,
    }: {
      updatesToSave: Partial<AppSettings>;
      previousSettings: AppSettings;
      mergedSettings: AppSettings;
      syncModelDefault: boolean;
      revision: number;
    },
  ): Promise<void> => {
    try {
      const result = await piAPI.setSettings(updatesToSave);
      if (isIpcError(result)) {
        if (revision === settingsWriteRevision) {
          if (updatesToSave.theme !== undefined) {
            applyAndCacheTheme(previousSettings.theme as Theme);
          }
          if (updatesToSave.fontSize !== undefined) {
            applyAndCacheFontSize(previousSettings.fontSize);
          }
          if (updatesToSave.shortcutOverrides !== undefined) {
            cacheShortcutOverrides(previousSettings.shortcutOverrides);
          }
          set({
            settings: previousSettings,
            sidebarGroupMode: previousSettings.sidebarGroupMode ?? 'date',
            lastWriteError: result,
          });
        } else {
          set({ lastWriteError: result });
        }
        return;
      }
      if (syncModelDefault) {
        await syncPiDefaultModel(piAPI, mergedSettings);
      }
      set({ lastWriteError: null });
    } catch (e) {
      logger.error('[settings-store] setSettings failed:', e);
      if (revision === settingsWriteRevision) {
        if (updatesToSave.theme !== undefined) {
          applyAndCacheTheme(previousSettings.theme as Theme);
        }
        if (updatesToSave.fontSize !== undefined) {
          applyAndCacheFontSize(previousSettings.fontSize);
        }
        if (updatesToSave.shortcutOverrides !== undefined) {
          cacheShortcutOverrides(previousSettings.shortcutOverrides);
        }
        set({
          settings: previousSettings,
          sidebarGroupMode: previousSettings.sidebarGroupMode ?? 'date',
          lastWriteError: reportWriteError(e),
        });
      } else {
        set({ lastWriteError: reportWriteError(e) });
      }
      if (syncModelDefault && revision === settingsWriteRevision) {
        void piAPI.setSettings({ model: previousSettings.model, provider: previousSettings.provider })
          .catch((restoreError) => {
            logger.error('[settings-store] restore model settings failed:', restoreError);
          });
      }
      addToast(e instanceof Error ? e.message : "保存设置失败", "error");
    }
  };

  const scheduleSettingsWrite = (
    piAPI: Window["piAPI"],
    updates: Partial<AppSettings>,
    previous: AppSettings,
    merged: AppSettings,
  ): void => {
    settingsWriteRevision += 1;
    const revision = settingsWriteRevision;
    pendingSettingsUpdates = { ...(pendingSettingsUpdates ?? {}), ...updates };
    pendingPreviousSettings ??= previous;
    pendingMergedSettings = merged;
    pendingSyncModelDefault = pendingSyncModelDefault || shouldSyncPiDefaultModel(updates, merged);

    if (pendingSettingsWriteTimer) clearTimeout(pendingSettingsWriteTimer);
    pendingSettingsWriteTimer = setTimeout(() => {
      const payload = consumePendingSettingsWrite();
      if (!payload) return;

      void (async () => {
        await commitSettingsWrite(piAPI, { ...payload, revision });
      })();
    }, SETTINGS_WRITE_DEBOUNCE_MS);
  };

  // Load persisted settings from main process
  const loadSettings = async () => {
    try {
      const piAPI = getPiAPI();
      if (piAPI) {
        const persisted = await piAPI.getSettings();
        const next = { ...defaultSettings, ...persisted };
        applyAndCacheTheme(next.theme as Theme);
        applyAndCacheFontSize(next.fontSize);
        cacheShortcutOverrides(next.shortcutOverrides);
        set({ settings: next, sidebarGroupMode: next.sidebarGroupMode ?? 'date' });
      }
    } catch (e) {
      logger.error('[settings-store] Failed to load settings:', e);
    }
  };
  loadSettings();

  getPiAPI()?.onSettingsChanged?.((settings) => {
    const next = { ...defaultSettings, ...settings };
    // 多窗口写竞态保护: 若本地有尚未落盘的乐观更新 (pendingSettingsUpdates),
    // 把这些 key 重新叠加到广播值上, 避免慢窗口的编辑被另一窗口的广播静默回退.
    const pending = pendingSettingsUpdates;
    const reconciled = pending ? { ...next, ...pending } : next;
    applyAndCacheTheme(reconciled.theme as Theme);
    applyAndCacheFontSize(reconciled.fontSize);
    cacheShortcutOverrides(reconciled.shortcutOverrides);
    set({
      settings: reconciled,
      sidebarGroupMode: reconciled.sidebarGroupMode ?? 'date',
      lastWriteError: null,
    });
  });

  // TODO: Phase 3 SubTask 35.4 DEFER — settings-store init refactor
  // (listener registration + 6 closure variables make this too risky to extract now)
  getPiAPI()?.onPiConfigChanged?.(() => {
    void get().loadPiConfig();
  });

  return {
    settings: defaultSettings,
    piModels: null,
    lastWriteError: null,
    rightRailCollapsed: true,
    sidebarGroupMode: defaultSettings.sidebarGroupMode ?? 'date',

    // 从 Pi CLI 加载本地配置
    loadPiConfig: async () => {
      try {
        const piAPI = getPiAPI();
        if (piAPI?.loadPiConfig) {
          const config = (await piAPI.loadPiConfig()) as PiConfigPayload;
          const models = Array.isArray(config.models) ? config.models : [];
          set({ piModels: models });
          // 如果 Pi 配置中有当前模型信息，自动更新
          if (config.currentModel) {
            const next = {
              model: config.currentModel.model,
              provider: config.currentModel.provider,
            };
            set((state) => ({
              settings: {
                ...state.settings,
                ...next,
              },
            }));
            void piAPI.setSettings(next)
              .then((result) => {
                if (isIpcError(result)) {
                  set({ lastWriteError: result });
                }
              })
              .catch((e) => {
                set({ lastWriteError: reportWriteError(e) });
                addToast(e instanceof Error ? e.message : "同步模型配置失败", "error");
              });
          } else if (get().settings.model || get().settings.provider) {
            const next = { model: "", provider: "" };
            set((state) => ({
              settings: {
                ...state.settings,
                ...next,
              },
            }));
            void piAPI.setSettings(next)
              .then((result) => {
                if (isIpcError(result)) {
                  set({ lastWriteError: result });
                }
              })
              .catch((e) => {
                set({ lastWriteError: reportWriteError(e) });
                addToast(e instanceof Error ? e.message : "同步模型配置失败", "error");
              });
          }
        }
      } catch (e) {
        logger.info('[settings-store] Pi config not available, using defaults:', e);
      }
    },

    updateSettings: (updates: Partial<AppSettings>) => {
      const previous = get().settings;
      const merged = { ...previous, ...updates };
      if (updates.theme !== undefined) {
        applyAndCacheTheme(updates.theme as Theme);
      }
      if (updates.fontSize !== undefined) {
        applyAndCacheFontSize(normalizeFontSize(updates.fontSize));
      }
      if (updates.shortcutOverrides !== undefined) {
        cacheShortcutOverrides(updates.shortcutOverrides);
      }
      // 乐观更新: 立刻改本地, 失败时回滚
      set({
        settings: merged,
        ...(updates.sidebarGroupMode ? { sidebarGroupMode: updates.sidebarGroupMode } : {}),
      });
      const piAPI = getPiAPI();
      if (!piAPI) return;
      scheduleSettingsWrite(piAPI, updates, previous, merged);
    },

    flushPendingSettingsWrite: async () => {
      const piAPI = getPiAPI();
      if (!piAPI) {
        clearPendingSettingsWrite();
        return;
      }
      const payload = consumePendingSettingsWrite();
      if (!payload) return;
      await commitSettingsWrite(piAPI, payload);
    },

    resetSettings: () => {
      const previous = get().settings;
      settingsWriteRevision += 1;
      clearPendingSettingsWrite();
      applyAndCacheTheme(defaultSettings.theme as Theme);
      applyAndCacheFontSize(defaultSettings.fontSize);
      cacheShortcutOverrides(defaultSettings.shortcutOverrides);
      set({ settings: defaultSettings, sidebarGroupMode: defaultSettings.sidebarGroupMode ?? 'date' });
      const piAPI = getPiAPI();
      if (!piAPI) return;
      piAPI.setSettings(defaultSettings)
        .then((result) => {
            if (isIpcError(result)) {
            applyAndCacheTheme(previous.theme as Theme);
            applyAndCacheFontSize(previous.fontSize);
            cacheShortcutOverrides(previous.shortcutOverrides);
            set({
              settings: previous,
              sidebarGroupMode: previous.sidebarGroupMode ?? 'date',
              lastWriteError: result,
            });
            addToast(result.fallback, "error");
          } else {
            set({ lastWriteError: null });
          }
        })
        .catch((e) => {
          logger.error('[settings-store] setSettings (reset) failed:', e);
          applyAndCacheTheme(previous.theme as Theme);
          applyAndCacheFontSize(previous.fontSize);
          cacheShortcutOverrides(previous.shortcutOverrides);
          set({
            settings: previous,
            sidebarGroupMode: previous.sidebarGroupMode ?? 'date',
            lastWriteError: reportWriteError(e),
          });
          addToast(e instanceof Error ? e.message : "重置设置失败", "error");
        });
    },

    clearWriteError: () => {
      set({ lastWriteError: null });
    },

    getWorkspaceToolDefaults: (workspaceId?: string | null) => {
      if (!workspaceId) return TOOL_PERMISSION_PRESETS.development;
      return get().settings.workspaceToolDefaults?.[workspaceId] ?? TOOL_PERMISSION_PRESETS.development;
    },

    updateWorkspaceToolDefaults: (workspaceId: string, permissions: ToolPermissions) => {
      const current = get().settings.workspaceToolDefaults ?? {};
      get().updateSettings({
        workspaceToolDefaults: {
          ...current,
          [workspaceId]: permissions,
        },
      });
    },

    setTheme: (theme: Theme) => {
      get().updateSettings({ theme });
    },

    toggleRightRail: () => set((state) => ({ rightRailCollapsed: !state.rightRailCollapsed })),
    setSidebarGroupMode: (mode: 'date' | 'workspace') => {
      set({ sidebarGroupMode: mode });
      get().updateSettings({ sidebarGroupMode: mode });
    },
  };
});
