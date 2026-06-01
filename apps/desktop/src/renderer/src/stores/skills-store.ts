// Skills Store (M3 Task M3-3)
// Zustand store for Skills panel

import { create } from "zustand";
import type { SkillInfo } from "../../../main/services/skills/skillhub-adapter";

interface InstalledSkill {
    slug: string;
    enabled: boolean;
}

interface SkillsState {
    /** skillhub CLI 是否安装 */
    skillhubAvailable: boolean | null;
    /** 市场 tab 当前查询 */
    marketQuery: string;
    /** 市场 tab 当前结果 */
    marketResults: SkillInfo[];
    marketLoading: boolean;
    /** 我的 tab 已装列表 */
    installed: InstalledSkill[];
    installedLoading: boolean;
    /** 状态 */
    error: string | null;

    // Actions
    setMarketQuery: (q: string) => void;
    searchMarket: () => Promise<void>;
    refreshInstalled: () => Promise<void>;
    checkAvailability: () => Promise<void>;
    installSkill: (slug: string) => Promise<void>;
    uninstallSkill: (slug: string) => Promise<void>;
    toggleSkill: (slug: string, enabled: boolean) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
    skillhubAvailable: null,
    marketQuery: "",
    marketResults: [],
    marketLoading: false,
    installed: [],
    installedLoading: false,
    error: null,

    setMarketQuery: (q) => set({ marketQuery: q }),

    checkAvailability: async () => {
        try {
            const available = (await window.piAPI?.skillsCheck()) ?? false;
            set({ skillhubAvailable: available });
        } catch {
            set({ skillhubAvailable: false });
        }
    },

    searchMarket: async () => {
        const q = get().marketQuery;
        if (!q.trim()) {
            set({ marketResults: [] });
            return;
        }
        set({ marketLoading: true, error: null });
        try {
            const results = (await window.piAPI?.skillsSearch(q)) ?? [];
            set({ marketResults: results, marketLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, marketLoading: false });
        }
    },

    refreshInstalled: async () => {
        set({ installedLoading: true, error: null });
        try {
            const installed = (await window.piAPI?.skillsInstalled()) ?? [];
            set({ installed, installedLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, installedLoading: false });
        }
    },

    installSkill: async (slug) => {
        set({ error: null });
        try {
            await window.piAPI?.skillsInstall(slug);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
            throw err;
        }
    },

    uninstallSkill: async (slug) => {
        set({ error: null });
        try {
            await window.piAPI?.skillsUninstall(slug);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    toggleSkill: async (slug, enabled) => {
        try {
            await window.piAPI?.skillsToggle(slug, enabled);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },
}));
