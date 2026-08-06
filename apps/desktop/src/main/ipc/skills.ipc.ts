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
import { isSafeUrl } from "../services/ssrf-guard";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "fs";
import { dirname, basename, join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

interface SkillsIpcDeps {
    /** workspace path (cwd for skillhub install) */
    getWorkspacePath: () => string | undefined;
    /** 启用状态持久化文件路径 */
    getStateFile: () => string;
}

const skillImportTails = new Map<string, Promise<void>>();

async function withSkillImportLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = skillImportTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    skillImportTails.set(key, current);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (skillImportTails.get(key) === current) skillImportTails.delete(key);
    }
}

function replaceDirectoryWithBackup(stagingPath: string, targetPath: string): void {
    const backupPath = `${targetPath}.backup-${process.pid}-${Date.now()}`;
    let backedUp = false;
    try {
        if (existsSync(targetPath)) {
            renameSync(targetPath, backupPath);
            backedUp = true;
        }
        renameSync(stagingPath, targetPath);
        if (backedUp) rmSync(backupPath, { recursive: true, force: true });
    } catch (error) {
        try {
            if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
            if (backedUp && existsSync(backupPath)) renameSync(backupPath, targetPath);
        } catch (rollbackError) {
            throw new Error(`Skill import replacement failed and rollback failed: ${String(rollbackError)}`, { cause: error });
        }
        throw error;
    }
}

const STATE_FILE_VERSION = 1;
const SKILL_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
interface SkillsState {
    version: number;
    disabled: string[]; // slugs that are disabled
}

// Module-level mutex: 序列化 skills:toggle 的 read-modify-write, 避免并发 toggle 丢更新
let skillsToggleChain: Promise<unknown> = Promise.resolve();
function withSkillsLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = skillsToggleChain.then(fn, fn);
    skillsToggleChain = next.catch(() => {}); // prevent unhandled rejection
    return next;
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
        if (!SKILL_SLUG_PATTERN.test(slug)) {
            return invalidSlugError(slug);
        }
        try {
            return await withSkillsLock(() => {
                const state = loadState(deps.getStateFile());
                if (enabled) {
                    state.disabled = state.disabled.filter((s) => s !== slug);
                } else {
                    if (!state.disabled.includes(slug)) state.disabled.push(slug);
                }
                saveState(deps.getStateFile(), state);
                return { success: true };
            });
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

        // SSRF 防护: 复用共享 isSafeUrl 校验, 阻断云元数据端点/链路本地地址
        if (!isSafeUrl(repoUrl)) {
            return ipcError("ipcErrors.skills.invalidUrl", "URL 不安全", { url: repoUrl });
        }

        // 从 URL 解析仓库名 (e.g., "https://github.com/user/repo" → "repo")
        const repoName = basename(repoUrl.replace(/\.git$/, "")).replace(/\/$/, "");
        // 安全: repoName 会直接拼进 <workspace>/.agents/skills/<repoName> 并参与
        // 备份替换目录运算。URL 正则允许 "." / ".." 路径段, basename("https://
        // github.com/attacker/..") === ".." 会把替换目标解析到 skills 根目录
        // 甚至 .agents 目录本身 (备份后删除 = 用户全部技能被摧毁)。因此必须
        // 用 SKILL_SLUG_PATTERN 拒绝 "." / ".." / 含路径分隔符的任何仓库名。
        if (!repoName || !SKILL_SLUG_PATTERN.test(repoName)) {
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

        // 先 clone 到同目录下的临时 staging 目录, 全部成功后再原子替换:
        // 失败时已安装的旧版本保持不变 (旧实现先删旧目录再 clone, 失败即
        // 丢失可用技能), 成功替换也顺带清除旧版本的残留文件。
        return withSkillImportLock(targetPath, async () => {
        const stagingPath = join(skillsDir, `.tmp-${repoName}-${process.pid}-${Date.now()}`);
        mkdirSync(skillsDir, { recursive: true });
        try {
            // git clone — 禁用仓库自带 hooks, 防止克隆未审计仓库时 post-checkout 等钩子
            // 在工作区内执行任意代码 (供应链风险). 用空 GIT_TEMPLATE_DIR 阻止 git 安装
            // 模板钩子, 并用 -c core.hooksPath 指向一个空目录禁用仓库内钩子 (跨平台).
            // emptyHooksDir 放在系统临时目录下 (避免污染工作区), 用 PID+时间戳避免并发冲突.
            const emptyHooksDir = join(tmpdir(), `pi-empty-hooks-${process.pid}-${Date.now()}`);
            mkdirSync(emptyHooksDir, { recursive: true });
            try {
                execFileSync("git", [
                    "clone",
                    "-c", `core.hooksPath=${emptyHooksDir}`,
                    repoUrl,
                    stagingPath,
                ], {
                    cwd,
                    timeout: 60_000,
                    stdio: ["pipe", "pipe", "pipe"],
                    env: { ...process.env, GIT_TEMPLATE_DIR: emptyHooksDir },
                });
            } finally {
                try {
                    rmSync(emptyHooksDir, { recursive: true, force: true });
                } catch (cleanupErr) {
                    log.warn("[skills.ipc] failed to clean up empty hooks dir:", cleanupErr);
                }
            }

            // 检查 SKILL.md 是否存在
            const skillMdPath = join(stagingPath, "SKILL.md");
            const skillMdFound = existsSync(skillMdPath);

            // 也检查 .pi/skills/<repoName>/SKILL.md
            const piSkillMdPath = join(cwd, ".pi", "skills", repoName, "SKILL.md");
            const piSkillMdFound = existsSync(piSkillMdPath);

            // 全部成功: backup swap + rollback。
            replaceDirectoryWithBackup(stagingPath, targetPath);

            return {
                success: true,
                path: targetPath,
                skillMdFound: skillMdFound || piSkillMdFound,
                slug: repoName,
            };
        } catch (err) {
            try {
                rmSync(stagingPath, { recursive: true, force: true });
            } catch (cleanupErr) {
                log.warn("[skills.ipc] failed to clean up staging dir:", cleanupErr);
            }
            log.error("[skills.ipc] github import failed:", err);
            const msg = err instanceof Error ? err.message : String(err);
            return ipcError(
                "ipcErrors.skills.githubImportFailed",
                `GitHub 导入失败: ${msg}`,
                { url: repoUrl },
            );
        }
        });
    });

    // v1.0.17: 写 SKILL.md 到磁盘 (而非只复制到剪贴板)
    ipcMain.handle("skills:write-skill", async (_event, name: string, content: string) => {
        // 安全审查: content 无大小上限会把任意尺寸字符串写盘 — 与 writeTextFileSchema 对齐, 上限 1MB
        if (typeof content !== "string" || content.length > 1024 * 1024) {
            return ipcError(
                "ipcErrors.skills.writeSkillFailed",
                "技能内容过大, 上限 1MB",
            );
        }
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
