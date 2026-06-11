// Skills Store (M3 Task M3-3)
// Zustand store for Skills panel
// v1.0.5: PiAPI 在 @shared 里把 skillsCheck/Search/Installed 都标 Promise<unknown>,
// 这里用本地 interface 收窄 (主进程 IPC 还没强类型化, 后续 zod 化)

import { create } from "zustand";
import type { SkillInfo } from "../../../main/services/skills/skillhub-adapter";
import { addToast } from "./toast-store";

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

// 窄化主进程 IPC 返回 (Promise<unknown> → 实际形状)
function narrowCheck(v: unknown): boolean {
    return typeof v === "boolean" ? v : Boolean(v);
}
function narrowSearch(v: unknown): SkillInfo[] {
    return Array.isArray(v) ? (v as SkillInfo[]) : [];
}
function narrowInstalled(v: unknown): InstalledSkill[] {
    return Array.isArray(v) ? (v as InstalledSkill[]) : [];
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
            if (!window.piAPI?.skillsCheck) throw new Error("SkillHub availability IPC unavailable");
            const available = narrowCheck(await window.piAPI.skillsCheck());
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
            if (!window.piAPI?.skillsSearch) throw new Error("Skill search IPC unavailable");
            const results = narrowSearch(await window.piAPI.skillsSearch(q));
            set({ marketResults: results, marketLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, marketLoading: false });
        }
    },

    refreshInstalled: async () => {
        set({ installedLoading: true, error: null });
        try {
            if (!window.piAPI?.skillsInstalled) throw new Error("Installed skills IPC unavailable");
            const installed = narrowInstalled(await window.piAPI.skillsInstalled());
            set({ installed, installedLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, installedLoading: false });
        }
    },

    installSkill: async (slug) => {
        set({ error: null });
        try {
            if (!window.piAPI?.skillsInstall) throw new Error("Skill install IPC unavailable");
            await window.piAPI.skillsInstall(slug);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
            throw err;
        }
    },

    uninstallSkill: async (slug) => {
        set({ error: null });
        try {
            if (!window.piAPI?.skillsUninstall) throw new Error("Skill uninstall IPC unavailable");
            await window.piAPI.skillsUninstall(slug);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
            addToast(`卸载技能失败: ${(err as Error).message}`, "error");
        }
    },

    toggleSkill: async (slug, enabled) => {
        try {
            if (!window.piAPI?.skillsToggle) throw new Error("Skill toggle IPC unavailable");
            await window.piAPI.skillsToggle(slug, enabled);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
            addToast(`切换技能失败: ${(err as Error).message}`, "error");
        }
    },
}));
