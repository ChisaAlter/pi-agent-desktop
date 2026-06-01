// 文件扫描器 (M2 Task M2-1)
// 扫 workspace 下的文件, 给 @ 引用和 CommandPalette 用
// 跳过常见噪声目录 (node_modules, .git, dist, ...)

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
}

export function scanFiles(root: string, opts: ScanOpts = {}): string[] {
    const recursive = opts.recursive ?? true;
    const maxDepth = opts.maxDepth ?? 6;
    const maxResults = opts.maxResults ?? 500;
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
            if (entry.startsWith(".") && entry !== ".well-known") continue; // 隐藏文件全跳过

            const fullPath = join(dir, entry);
            let isDir: boolean;
            try {
                isDir = statSync(fullPath).isDirectory();
            } catch {
                continue;
            }

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
