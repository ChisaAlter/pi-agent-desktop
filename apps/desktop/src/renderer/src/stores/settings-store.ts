// Settings Store - Manages application settings
// v1.0.5: AppSettings / PiModelInfo 跟 @shared 重复, 改用 re-export + 本地 alias 保留 store 旧代码

import { create } from 'zustand';
import type { AppSettings } from '@shared';

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

  // Actions
  updateSettings: (updates: Partial<AppSettings>) => void;
  resetSettings: () => void;
  toggleSettings: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  loadPiConfig: () => Promise<void>;
}

const defaultSettings: AppSettings = {
  theme: 'light',
  fontSize: 14,
  model: 'gpt-4',
  provider: 'openai',
  temperature: 0.7,
  maxTokens: 4096,
  autoSave: true,
  showLineNumbers: true,
  wordWrap: true
};

export const useSettingsStore = create<SettingsState>((set) => {
  // Load persisted settings from main process
  const loadSettings = async () => {
    try {
      if (window.piAPI) {
        const persisted = await window.piAPI.getSettings();
        set({ settings: { ...defaultSettings, ...persisted } });
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };
  loadSettings();

  return {
    settings: defaultSettings,
    isOpen: false,
    piModels: null,

    // 从 Pi CLI 加载本地配置
    loadPiConfig: async () => {
      try {
        if (window.piAPI && window.piAPI.loadPiConfig) {
          const config = (await window.piAPI.loadPiConfig()) as PiConfigPayload;
          if (config.models && config.models.length > 0) {
            set({ piModels: config.models });
          }
          // 如果 Pi 配置中有当前模型信息，自动更新
          if (config.currentModel) {
            set((state) => ({
              settings: {
                ...state.settings,
                model: config.currentModel!.model,
                provider: config.currentModel!.provider,
              },
            }));
          }
        }
      } catch (e) {
        console.log('Pi config not available, using defaults:', e);
      }
    },

    updateSettings: (updates: Partial<AppSettings>) => {
      set((state) => {
        const newSettings = { ...state.settings, ...updates };
        if (window.piAPI) {
          window.piAPI.setSettings(updates).catch(console.error);
        }
        return { settings: newSettings };
      });
    },

    resetSettings: () => {
      set({ settings: defaultSettings });
      if (window.piAPI) {
        window.piAPI.setSettings(defaultSettings).catch(console.error);
      }
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
  };
});