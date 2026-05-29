// Plugin Store - 管理技能和插件状态

import { create } from 'zustand';

export interface SkillData {
  name: string;
  description?: string;
  path: string;
  enabled: boolean;
}

export interface PluginData {
  name: string;
  description?: string;
  version?: string;
  enabled: boolean;
  type: 'provider' | 'extension' | 'tool';
}

interface PluginState {
  skills: SkillData[];
  plugins: PluginData[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadSkills: () => Promise<void>;
  loadPlugins: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  skills: [],
  plugins: [],
  isLoading: false,
  error: null,

  loadSkills: async () => {
    try {
      if (window.piAPI && window.piAPI.listSkills) {
        const skills = await window.piAPI.listSkills();
        set({ skills });
      }
    } catch (error) {
      console.error('Failed to load skills:', error);
      set({ error: 'Failed to load skills' });
    }
  },

  loadPlugins: async () => {
    try {
      if (window.piAPI && window.piAPI.listPlugins) {
        const plugins = await window.piAPI.listPlugins();
        set({ plugins });
      }
    } catch (error) {
      console.error('Failed to load plugins:', error);
      set({ error: 'Failed to load plugins' });
    }
  },

  refresh: async () => {
    const { loadSkills, loadPlugins } = get();
    set({ isLoading: true, error: null });
    try {
      await Promise.all([loadSkills(), loadPlugins()]);
    } finally {
      set({ isLoading: false });
    }
  }
}));