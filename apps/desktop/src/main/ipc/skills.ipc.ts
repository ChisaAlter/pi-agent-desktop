// Skills IPC (M3 Task M3-2)
// 包装 SkillHub adapter, 暴露给 renderer

import { ipcMain } from "electron";
import {
    searchSkills,
    listInstalled,
    installSkill,
    uninstallSkill,
    checkSkillhubInstalled,
} from "../services/skills/skillhub-adapter";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

interface SkillsIpcDeps {
    /** workspace path (cwd for skillhub install) */
    getWorkspacePath: () => string | undefined;
    /** 启用状态持久化文件路径 */
    getStateFile: () => string;
}

const STATE_FILE_VERSION = 1;
interface SkillsState {
    version: number;
    disabled: string[]; // slugs that are disabled
}

function loadState(file: string): SkillsState {
    if (!existsSync(file)) return { version: STATE_FILE_VERSION, disabled: [] };
    try {
        return JSON.parse(readFileSync(file, "utf-8"));
    } catch {
        return { version: STATE_FILE_VERSION, disabled: [] };
    }
}

function saveState(file: string, state: SkillsState): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2), "utf-8");
}

export function setupSkillsIpc(deps: SkillsIpcDeps): void {
    ipcMain.handle("skills:check", async () => {
        try {
            return await checkSkillhubInstalled();
        } catch {
            return false;
        }
    });

    ipcMain.handle("skills:search", async (_event, query: string) => {
        return await searchSkills(query);
    });

    ipcMain.handle("skills:installed", async () => {
        const slugs = await listInstalled();
        const state = loadState(deps.getStateFile());
        return slugs.map((slug) => ({
            slug,
            enabled: !state.disabled.includes(slug),
        }));
    });

    ipcMain.handle("skills:install", async (_event, slug: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) throw new Error("No workspace selected");
        await installSkill(slug, cwd);
        return { success: true };
    });

    ipcMain.handle("skills:uninstall", async (_event, slug: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) throw new Error("No workspace selected");
        await uninstallSkill(slug, cwd);
        return { success: true };
    });

    ipcMain.handle("skills:toggle", async (_event, slug: string, enabled: boolean) => {
        const state = loadState(deps.getStateFile());
        if (enabled) {
            state.disabled = state.disabled.filter((s) => s !== slug);
        } else {
            if (!state.disabled.includes(slug)) state.disabled.push(slug);
        }
        saveState(deps.getStateFile(), state);
        return { success: true };
    });

    ipcMain.handle("skills:github-import", async (_event, repoUrl: string) => {
        // M3 简版: 返回 URL, 让用户在浏览器打开, 实际产品应该 git clone + 解析 SKILL.md
        return { url: repoUrl, message: "请用 git clone 仓库到 skills/ 目录" };
    });
}
