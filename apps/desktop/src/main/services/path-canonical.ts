// 路径 canonical 化与工作区边界校验 (IPC 共用)。
//
// 背景: `protected-paths.ts` 的 `isPathInside` 仅做词法 `path.resolve` 比较,
// 工作区内的 symlink / Windows junction 指向区外时仍能通过校验, 导致
// `files:readTextFile` / `files:writeTextFile` / `localfile://` 可能读/写
// 工作区之外的目标。Agent 侧工具 (`permission/guarded-tools.ts`) 已使用
// `realpath` + `resolveCanonicalTarget` 做双重校验 —— 本模块把同样的逻辑
// 抽出共享, 让 IPC 与 agent tools 保持一致的安全标准。
//
// 仅在「文件读写」类 IPC 使用; 文件树/搜索/列目录仍用 `getProtectedPathReason`
// 的词法检查以避免扫树性能回退。

import { lstat, readlink, realpath } from "fs/promises";
import { basename, dirname, resolve } from "path";
import { getProtectedPathReason } from "./protected-paths";

/**
 * 解析路径到 canonical 形式, 跟随符号链接。对尚不存在的尾部段 (例如
 * 正要写入的新文件) 会向上回溯直到存在的祖先, 再拼接缺失段 —— 与 agent
 * 工具 `guarded-tools.ts` 行为一致, 保证「将要写入的合法新文件」不会被误拒。
 *
 * 检测符号链接循环并抛错, 避免无限递归。
 */
export async function resolveCanonicalTarget(
    targetPath: string,
    visitedLinks = new Set<string>(),
): Promise<string> {
    let ancestor = targetPath;
    const missingSegments: string[] = [];

    while (true) {
        try {
            const canonicalAncestor = await realpath(ancestor);
            return resolve(canonicalAncestor, ...missingSegments.reverse());
        } catch (error) {
            if (!isMissingPathError(error)) throw error;

            const linkTarget = await readLinkTarget(ancestor);
            if (linkTarget) {
                const linkKey = resolve(ancestor);
                if (visitedLinks.has(linkKey)) {
                    throw new Error(`Symbolic link cycle detected at "${ancestor}"`);
                }
                visitedLinks.add(linkKey);
                const canonicalLinkTarget = await resolveCanonicalTarget(linkTarget, visitedLinks);
                return resolve(canonicalLinkTarget, ...missingSegments.reverse());
            }

            const parent = dirname(ancestor);
            if (parent === ancestor) throw error;
            missingSegments.push(basename(ancestor));
            ancestor = parent;
        }
    }
}

/** 如果 `path` 是 symlink 返回其解析后的绝对目标, 否则返回 undefined。 */
export async function readLinkTarget(path: string): Promise<string | undefined> {
    try {
        const stats = await lstat(path);
        if (!stats.isSymbolicLink()) return undefined;
        const target = await readlink(path);
        return resolve(dirname(path), target);
    } catch (error) {
        if (isMissingPathError(error)) return undefined;
        throw error;
    }
}

function isMissingPathError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = Reflect.get(error, "code");
    return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * 双重校验 `targetPath` 是否允许在 `workspacePath` 工作区内访问:
 *
 * 1. 词法校验 (`getProtectedPathReason`): 快速拒绝明显越界 / 敏感路径。
 * 2. canonical 校验: `realpath(workspace)` + `resolveCanonicalTarget(target)`
 *    再次调用 `getProtectedPathReason`, 拦截 symlink / junction 逃逸。
 *
 * 返回:
 *   - `{ allowed: true, canonicalPath }` — 调用方应使用 `canonicalPath` 做 IO,
 *     确保读写的是通过校验的真实目标。
 *   - `{ allowed: false, reason }` — 调用方应返回 `ipcError(..., reason, ...)`。
 *
 * 与 `guarded-tools.ts` 的 `guardPathTool` 使用同一套双重校验, 保持
 * 「IPC 与 agent tools 安全标准一致」。
 */
export async function assertWorkspacePathAllowed(
    targetPath: string,
    workspacePath: string,
): Promise<{ allowed: true; canonicalPath: string } | { allowed: false; reason: string }> {
    const lexicalReason = getProtectedPathReason(targetPath, workspacePath);
    if (lexicalReason) return { allowed: false, reason: lexicalReason };

    try {
        const canonicalRoot = await realpath(workspacePath);
        const canonicalTarget = await resolveCanonicalTarget(resolve(targetPath));
        const reason = getProtectedPathReason(canonicalTarget, canonicalRoot);
        if (reason) return { allowed: false, reason };
        return { allowed: true, canonicalPath: canonicalTarget };
    } catch (error) {
        // realpath 失败通常意味着 workspace 本身不存在或不可达; 保守拒绝。
        const message = error instanceof Error ? error.message : String(error);
        return { allowed: false, reason: `无法解析工作区路径: ${message}` };
    }
}