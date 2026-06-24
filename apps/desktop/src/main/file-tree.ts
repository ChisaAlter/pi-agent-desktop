import { readdirSync, statSync } from "fs";
import { readdir, stat } from "fs/promises";
import { extname, basename, join } from "path";
import { getProtectedPathReason } from "./services/protected-paths";

export interface FileTreeNode {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileTreeNode[];
    extension?: string;
    size?: number;
    truncated?: boolean;
}

const DEFAULT_IGNORES = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    ".cache",
    ".next",
    ".turbo",
    "coverage",
]);

export interface FileTreeOptions {
    maxDepth?: number;
    maxEntries?: number;
}

function sortNodes(a: FileTreeNode, b: FileTreeNode): number {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function normalizeFileTreeOptions(maxDepthOrOptions: number | FileTreeOptions): Required<FileTreeOptions> {
    const options = typeof maxDepthOrOptions === "number"
        ? { maxDepth: maxDepthOrOptions }
        : maxDepthOrOptions;
    return {
        maxDepth: Math.max(1, Math.min(options.maxDepth ?? 4, 8)),
        maxEntries: Math.max(50, Math.min(options.maxEntries ?? 1200, 5000)),
    };
}

export function buildFileTree(workspacePath: string, maxDepthOrOptions: number | FileTreeOptions = 4): FileTreeNode {
    const { maxDepth, maxEntries } = normalizeFileTreeOptions(maxDepthOrOptions);
    let visited = 0;

    const walk = (targetPath: string, depth: number): FileTreeNode => {
        const stats = statSync(targetPath);
        const name = basename(targetPath) || targetPath;
        if (!stats.isDirectory()) {
            return {
                name,
                path: targetPath,
                type: "file",
                extension: extname(name).replace(/^\./, ""),
                size: stats.size,
            };
        }

        const node: FileTreeNode = {
            name,
            path: targetPath,
            type: "directory",
            children: [],
        };

        if (depth >= maxDepth || visited >= maxEntries) {
            node.truncated = true;
            return node;
        }

        const children: FileTreeNode[] = [];
        for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
            if (DEFAULT_IGNORES.has(entry.name)) continue;
            if (visited >= maxEntries) {
                node.truncated = true;
                break;
            }
            visited += 1;
            const childPath = join(targetPath, entry.name);
            if (getProtectedPathReason(childPath, workspacePath)) continue;
            try {
                if (entry.isDirectory() || entry.isFile()) {
                    children.push(walk(childPath, depth + 1));
                }
            } catch {
                children.push({
                    name: entry.name,
                    path: childPath,
                    type: entry.isDirectory() ? "directory" : "file",
                    truncated: true,
                });
            }
        }

        node.children = children.sort(sortNodes);
        return node;
    };

    return {
        ...walk(workspacePath, 0),
        name: basename(workspacePath) || workspacePath,
    };
}

export async function buildFileTreeAsync(workspacePath: string, maxDepthOrOptions: number | FileTreeOptions = 4): Promise<FileTreeNode> {
    const { maxDepth, maxEntries } = normalizeFileTreeOptions(maxDepthOrOptions);
    let visited = 0;

    const walk = async (targetPath: string, depth: number): Promise<FileTreeNode> => {
        const stats = await stat(targetPath);
        const name = basename(targetPath) || targetPath;
        if (!stats.isDirectory()) {
            return {
                name,
                path: targetPath,
                type: "file",
                extension: extname(name).replace(/^\./, ""),
                size: stats.size,
            };
        }

        const node: FileTreeNode = {
            name,
            path: targetPath,
            type: "directory",
            children: [],
        };

        if (depth >= maxDepth || visited >= maxEntries) {
            node.truncated = true;
            return node;
        }

        const children: FileTreeNode[] = [];
        for (const entry of await readdir(targetPath, { withFileTypes: true })) {
            if (DEFAULT_IGNORES.has(entry.name)) continue;
            if (visited >= maxEntries) {
                node.truncated = true;
                break;
            }
            visited += 1;
            const childPath = join(targetPath, entry.name);
            if (getProtectedPathReason(childPath, workspacePath)) continue;
            try {
                if (entry.isDirectory() || entry.isFile()) {
                    children.push(await walk(childPath, depth + 1));
                }
            } catch {
                children.push({
                    name: entry.name,
                    path: childPath,
                    type: entry.isDirectory() ? "directory" : "file",
                    truncated: true,
                });
            }
        }

        node.children = children.sort(sortNodes);
        return node;
    };

    return {
        ...(await walk(workspacePath, 0)),
        name: basename(workspacePath) || workspacePath,
    };
}
