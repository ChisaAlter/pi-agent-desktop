// Skills IPC
// Wraps SkillHub adapter, exposed to renderer
// Errors return IpcError (code/params/fallback)

import { ipcMain } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import {
    searchSkills,
    listInstalled,
    installSkill,
    uninstallSkill,
    checkSkillhubInstalled,
} from "../services/skills/skillhub-adapter";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, basename, join } from "path";
import { execFileSync } from "child_process";

interface SkillsIpcDeps {
    /** workspace path (cwd for skillhub install) */
    getWorkspacePath: () => string | undefined;
    /** 启用状态持久化文件路径 */
    getStateFile: () => string;
}

const STATE_FILE_VERSION = 1;
const SKILL_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
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

function invalidSlugError(slug: string) {
    return ipcError(
        "ipcErrors.skills.invalidSlug",
        `技能标识无效: ${slug}，只允许字母、数字、连字符和下划线`,
        { slug },
    );
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
        try {
            return await searchSkills(query);
        } catch (err) {
            log.error("[skills.ipc] search failed:", err);
            return ipcError(
                "ipcErrors.skills.searchFailed",
                `搜索技能失败: ${err instanceof Error ? err.message : String(err)}`,
                { query },
            );
        }
    });

    ipcMain.handle("skills:installed", async () => {
        try {
            const workspacePath = deps.getWorkspacePath();
            const slugs = await listInstalled(workspacePath);
            const state = loadState(deps.getStateFile());
            return slugs.map((slug) => ({
                slug,
                enabled: !state.disabled.includes(slug),
            }));
        } catch (err) {
            log.error("[skills.ipc] listInstalled failed:", err);
            return ipcError(
                "ipcErrors.skills.listFailed",
                `列出已装技能失败: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    });

    ipcMain.handle("skills:install", async (_event, slug: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) {
            return ipcError(
                "ipcErrors.skills.noWorkspace",
                "请先选择工作区再安装技能",
            );
        }
        if (!SKILL_SLUG_PATTERN.test(slug)) {
            return invalidSlugError(slug);
        }
        try {
            await installSkill(slug, cwd);
            return { success: true };
        } catch (err) {
            log.error("[skills.ipc] install failed:", err);
            return ipcError(
                "ipcErrors.skills.installFailed",
                `安装技能失败: ${err instanceof Error ? err.message : String(err)}`,
                { slug },
            );
        }
    });

    ipcMain.handle("skills:uninstall", async (_event, slug: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) {
            return ipcError(
                "ipcErrors.skills.noWorkspace",
                "请先选择工作区再卸载技能",
            );
        }
        // 安全校验: slug 只允许字母、数字、连字符和下划线，防止路径遍历
        if (!SKILL_SLUG_PATTERN.test(slug)) {
            return invalidSlugError(slug);
        }
        try {
            await uninstallSkill(slug, cwd);
            return { success: true };
        } catch (err) {
            log.error("[skills.ipc] uninstall failed:", err);
            return ipcError(
                "ipcErrors.skills.uninstallFailed",
                `卸载技能失败: ${err instanceof Error ? err.message : String(err)}`,
                { slug },
            );
        }
    });

    ipcMain.handle("skills:toggle", async (_event, slug: string, enabled: boolean) => {
        try {
            const state = loadState(deps.getStateFile());
            if (enabled) {
                state.disabled = state.disabled.filter((s) => s !== slug);
            } else {
                if (!state.disabled.includes(slug)) state.disabled.push(slug);
            }
            saveState(deps.getStateFile(), state);
            return { success: true };
        } catch (err) {
            log.error("[skills.ipc] toggle failed:", err);
            return ipcError(
                "ipcErrors.skills.toggleFailed",
                `切换技能状态失败: ${err instanceof Error ? err.message : String(err)}`,
                { slug },
            );
        }
    });

    ipcMain.handle("skills:github-import", async (_event, repoUrl: string) => {
        // v1.0.17: 真正 git clone + 检查 SKILL.md
        const cwd = deps.getWorkspacePath();
        if (!cwd) {
            return ipcError(
                "ipcErrors.skills.noWorkspace",
                "请先选择工作区再导入技能",
            );
        }

        // 安全校验: repoUrl 必须是合法的 https:// 或 git@ 地址，防止 git 参数注入
        const isValidUrl = /^https:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(repoUrl) ||
            /^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._~/-]+\.git$/.test(repoUrl);
        if (!isValidUrl) {
            return ipcError(
                "ipcErrors.skills.invalidUrl",
                `无效的仓库地址: ${repoUrl}，只支持 https:// 或 git@ 格式`,
                { url: repoUrl },
            );
        }

        // 从 URL 解析仓库名 (e.g., "https://github.com/user/repo" → "repo")
        const repoName = basename(repoUrl.replace(/\.git$/, "")).replace(/\/$/, "");
        if (!repoName) {
            return ipcError(
                "ipcErrors.skills.githubImportFailed",
                `无法从 URL 解析仓库名: ${repoUrl}`,
                { url: repoUrl },
            );
        }

        // 目标路径: <workspace>/.agents/skills/<repoName>/
        // 也尝试 <workspace>/.pi/skills/<repoName>/ (Pi 原生路径)
        const skillsDir = join(cwd, ".agents", "skills");
        const targetPath = join(skillsDir, repoName);

        // 如果目录已存在, 先删掉 (覆盖式安装)
        // rmSync 已从 "fs" 顶部 import (writeFileSync 旁边的)
        // 注意: rmSync 在 Node 14.14+ 可用, 本项目要求 Node >= 22
        if (existsSync(targetPath)) {
            const { rmSync } = await import("fs");
            rmSync(targetPath, { recursive: true, force: true });
        }

        try {
            // git clone
            execFileSync("git", ["clone", repoUrl, targetPath], {
                cwd,
                timeout: 60_000,
                stdio: ["pipe", "pipe", "pipe"],
            });

            // 检查 SKILL.md 是否存在
            const skillMdPath = join(targetPath, "SKILL.md");
            const skillMdFound = existsSync(skillMdPath);

            // 也检查 .pi/skills/<repoName>/SKILL.md
            const piSkillMdPath = join(cwd, ".pi", "skills", repoName, "SKILL.md");
            const piSkillMdFound = existsSync(piSkillMdPath);

            return {
                success: true,
                path: targetPath,
                skillMdFound: skillMdFound || piSkillMdFound,
                slug: repoName,
            };
        } catch (err) {
            log.error("[skills.ipc] github import failed:", err);
            const msg = err instanceof Error ? err.message : String(err);
            return ipcError(
                "ipcErrors.skills.githubImportFailed",
                `GitHub 导入失败: ${msg}`,
                { url: repoUrl },
            );
        }
    });

    // v1.0.17: 写 SKILL.md 到磁盘 (而非只复制到剪贴板)
    ipcMain.handle("skills:write-skill", async (_event, name: string, content: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) {
            return ipcError(
                "ipcErrors.skills.noWorkspace",
                "请先选择工作区再保存技能",
            );
        }

        // 安全化 name: 只允许 kebab-case 字符
        const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase();
        if (!safeName) {
            return ipcError(
                "ipcErrors.skills.writeSkillFailed",
                "技能名称无效, 只允许字母、数字、连字符和下划线",
                { name },
            );
        }

        // 目标路径: <workspace>/.agents/skills/<name>/SKILL.md
        const skillDir = join(cwd, ".agents", "skills", safeName);
        const skillMdPath = join(skillDir, "SKILL.md");

        try {
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(skillMdPath, content, "utf-8");
            return { success: true, path: skillMdPath, slug: safeName };
        } catch (err) {
            log.error("[skills.ipc] write skill failed:", err);
            return ipcError(
                "ipcErrors.skills.writeSkillFailed",
                `保存技能失败: ${err instanceof Error ? err.message : String(err)}`,
                { name, path: skillMdPath },
            );
        }
    });
}
