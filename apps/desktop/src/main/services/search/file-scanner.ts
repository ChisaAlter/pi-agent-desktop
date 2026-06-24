// 文件扫描器 (M2 Task M2-1)
// 扫 workspace 下的文件, 给 @ 引用和 CommandPalette 用
// 跳过常见噪声目录 (node_modules, .git, dist, ...)

import { readdir, stat } from "fs/promises";
import { readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

const IGNORED_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", ".next", ".cache",
    "coverage", ".turbo", ".vite", "release", ".pi-desktop",
    "node_modules.cache",
]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

export interface ScanOpts {
    recursive?: boolean;
    maxDepth?: number;
    maxResults?: number;
    hiddenMode?: "none" | "critical" | "all";
}

const CRITICAL_HIDDEN_DIRS = new Set([
    ".github",
    ".vscode",
    ".husky",
    ".devcontainer",
    ".changeset",
    ".well-known",
]);

const CRITICAL_HIDDEN_FILE_PATTERNS = [
    /^\.gitignore$/i,
    /^\.gitattributes$/i,
    /^\.editorconfig$/i,
    /^\.dockerignore$/i,
    /^\.npmignore$/i,
    /^\.nvmrc$/i,
    /^\.tool-versions$/i,
    /^\.prettier(?:rc(?:\..+)?)?$/i,
    /^\.eslintrc(?:\..+)?$/i,
];

function shouldIncludeHiddenEntry(entry: string, isDir: boolean, hiddenMode: NonNullable<ScanOpts["hiddenMode"]>): boolean {
    if (!entry.startsWith(".")) return true;
    if (hiddenMode === "all") return true;
    if (hiddenMode === "none") return false;
    if (isDir) return CRITICAL_HIDDEN_DIRS.has(entry);
    return CRITICAL_HIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(entry));
}

// 异步版本 - 不阻塞主进程事件循环
export async function scanFiles(root: string, opts: ScanOpts = {}): Promise<string[]> {
    const recursive = opts.recursive ?? true;
    const maxDepth = opts.maxDepth ?? 6;
    const maxResults = opts.maxResults ?? 500;
    const hiddenMode = opts.hiddenMode ?? "critical";
    const results: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
        if (depth > maxDepth) return;
        if (results.length >= maxResults) return;

        let entries: string[];
        try {
            entries = await readdir(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxResults) return;
            if (IGNORED_FILES.has(entry)) continue;

            const fullPath = join(dir, entry);
            let isDir: boolean;
            try {
                const st = await stat(fullPath);
                isDir = st.isDirectory();
            } catch {
                continue;
            }
            if (!shouldIncludeHiddenEntry(entry, isDir, hiddenMode)) continue;

            if (isDir) {
                if (IGNORED_DIRS.has(entry)) continue;
                if (recursive) await walk(fullPath, depth + 1);
            } else {
                results.push(relative(root, fullPath).split(sep).join("/"));
            }
        }
    }

    await walk(root, 0);
    return results;
}

// 同步版本 - 保持向后兼容
export function scanFilesSync(root: string, opts: ScanOpts = {}): string[] {
    const recursive = opts.recursive ?? true;
    const maxDepth = opts.maxDepth ?? 6;
    const maxResults = opts.maxResults ?? 500;
    const hiddenMode = opts.hiddenMode ?? "critical";
    const results: string[] = [];

    function walk(dir: string, depth: number) {
        if (depth > maxDepth) return;
        if (results.length >= maxResults) return;

        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxResults) return;
            if (IGNORED_FILES.has(entry)) continue;

            const fullPath = join(dir, entry);
            let isDir: boolean;
            try {
                isDir = statSync(fullPath).isDirectory();
            } catch {
                continue;
            }
            if (!shouldIncludeHiddenEntry(entry, isDir, hiddenMode)) continue;

            if (isDir) {
                if (IGNORED_DIRS.has(entry)) continue;
                if (recursive) walk(fullPath, depth + 1);
            } else {
                results.push(relative(root, fullPath).split(sep).join("/"));
            }
        }
    }

    walk(root, 0);
    return results;
}
