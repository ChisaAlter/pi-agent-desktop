// Settings Store - Manages application settings
// v1.0.5: AppSettings / PiModelInfo 跟 @shared 重复, 改用 re-export + 本地 alias 保留 store 旧代码
// v1.0.6: console 换 logger
// v1.0.9: 写错误经 _onError listener 走 IpcError 路径, SettingsPanel 翻译后显示
// v1.0.15: default model/provider 改成空串 — 不再 hardcode 'gpt-4' / 'openai' 假数据;
//          启动时由 loadPiConfig 真从 Pi CLI 配置读;读不到时 Pi ChatInput / SettingsPanel 走空态

import { create } from 'zustand';
import { DEFAULT_LONG_HORIZON_SETTINGS, isIpcError, type AppSettings, type IpcError, type ToolPermissions } from '@shared';
import { logger } from '../utils/logger';
import { addToast } from './toast-store';
import { applyTheme, getInitialTheme, resolveTheme, type Theme } from '../utils/theme';

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
  isOpen: boolean;
  piModels: PiModelInfo[] | null;
  /** v1.0.9: 最近一次写错误 (IpcError | string | null). SettingsPanel 订阅后翻译显示. */
  lastWriteError: IpcError | string | null;
  rightRailCollapsed: boolean;
  sidebarGroupMode: 'date' | 'workspace';

  // Actions
  updateSettings: (updates: Partial<AppSettings>) => void;
  resetSettings: () => void;
  toggleSettings: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  loadPiConfig: () => Promise<void>;
  /** 清除最近写错误 (用户点 close 后清) */
  clearWriteError: () => void;
  getWorkspaceToolDefaults: (workspaceId?: string | null) => ToolPermissions;
  updateWorkspaceToolDefaults: (workspaceId: string, permissions: ToolPermissions) => void;
  setTheme: (theme: Theme) => void;
  toggleRightRail: () => void;
  setSidebarGroupMode: (mode: 'date' | 'workspace') => void;
}

const defaultSettings: AppSettings = {
  theme: resolveTheme(getInitialTheme()),
  fontSize: 14,
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
  showThinking: true,
  thinkingLevel: 'medium',
  longHorizon: DEFAULT_LONG_HORIZON_SETTINGS,
};

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

function getPiAPI(): Window["piAPI"] | undefined {
  return typeof window !== "undefined" ? window.piAPI : undefined;
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
      const updatesToSave = pendingSettingsUpdates;
      const previousSettings = pendingPreviousSettings;
      const mergedSettings = pendingMergedSettings;
      const syncModelDefault = pendingSyncModelDefault && Boolean(mergedSettings?.model && mergedSettings.provider);
      clearPendingSettingsWrite();

      if (!updatesToSave || !previousSettings || !mergedSettings) return;

      void (async () => {
        try {
          const result = await piAPI.setSettings(updatesToSave);
          if (isIpcError(result)) {
            if (revision === settingsWriteRevision) {
              set({ settings: previousSettings, lastWriteError: result });
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
            set({ settings: previousSettings, lastWriteError: reportWriteError(e) });
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
      })();
    }, SETTINGS_WRITE_DEBOUNCE_MS);
  };

  // Load persisted settings from main process
  const loadSettings = async () => {
    try {
      const piAPI = getPiAPI();
      if (piAPI) {
        const persisted = await piAPI.getSettings();
        set({ settings: { ...defaultSettings, ...persisted } });
      }
    } catch (e) {
      logger.error('[settings-store] Failed to load settings:', e);
    }
  };
  loadSettings();

  return {
    settings: defaultSettings,
    isOpen: false,
    piModels: null,
    lastWriteError: null,
    rightRailCollapsed: true,
    sidebarGroupMode: 'date',

    // 从 Pi CLI 加载本地配置
    loadPiConfig: async () => {
      try {
        const piAPI = getPiAPI();
        if (piAPI?.loadPiConfig) {
          const config = (await piAPI.loadPiConfig()) as PiConfigPayload;
          if (config.models && config.models.length > 0) {
            set({ piModels: config.models });
          }
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
          }
        }
      } catch (e) {
        logger.info('[settings-store] Pi config not available, using defaults:', e);
      }
    },

    updateSettings: (updates: Partial<AppSettings>) => {
      const previous = get().settings;
      const merged = { ...previous, ...updates };
      // 乐观更新: 立刻改本地, 失败时回滚
      set({ settings: merged });
      const piAPI = getPiAPI();
      if (!piAPI) return;
      scheduleSettingsWrite(piAPI, updates, previous, merged);
    },

    resetSettings: () => {
      const previous = get().settings;
      settingsWriteRevision += 1;
      clearPendingSettingsWrite();
      set({ settings: defaultSettings });
      const piAPI = getPiAPI();
      if (!piAPI) return;
      piAPI.setSettings(defaultSettings)
        .then((result) => {
          if (isIpcError(result)) {
            set({ settings: previous, lastWriteError: result });
            addToast(result.fallback, "error");
          } else {
            set({ lastWriteError: null });
          }
        })
        .catch((e) => {
          logger.error('[settings-store] setSettings (reset) failed:', e);
          set({ settings: previous, lastWriteError: reportWriteError(e) });
          addToast(e instanceof Error ? e.message : "重置设置失败", "error");
        });
    },

    toggleSettings: () => {
      set((state) => ({ isOpen: !state.isOpen }));
    },

    openSettings: () => {
      set({ isOpen: true });
    },

    closeSettings: () => {
      set({ isOpen: false });
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
      applyTheme(theme);
      get().updateSettings({ theme: theme as AppSettings["theme"] });
      localStorage.setItem("pi-desktop-theme", theme);
    },

    toggleRightRail: () => set((state) => ({ rightRailCollapsed: !state.rightRailCollapsed })),
    setSidebarGroupMode: (mode: 'date' | 'workspace') => set({ sidebarGroupMode: mode }),
  };
});
