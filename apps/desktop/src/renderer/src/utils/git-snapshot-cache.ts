import type { GitStatus } from "@shared";

/**
 * Shared per-workspace Git snapshot cache (LRU, max 8 workspaces).
 *
 * Extracted from RightRail so the agent fleet's harvest view can reuse the
 * same cached status/diff without flashing a cold "无 Git" state or issuing
 * duplicate git IPC calls. Bounded to prevent cross-session growth.
 */

export interface GitSnapshotCacheEntry {
    git: GitStatus | null;
    diffStats: { additions: number; deletions: number };
    diffText: string;
    updatedAt: number;
}

const gitSnapshotCache = new Map<string, GitSnapshotCacheEntry>();
const GIT_SNAPSHOT_CACHE_MAX = 8;

export function readCachedGitSnapshot(workspacePath?: string): GitSnapshotCacheEntry | null {
    if (!workspacePath) return null;
    return gitSnapshotCache.get(workspacePath) ?? null;
}

/** 清空全部缓存 (workspace 删除时调用; 测试重置也用). */
export function clearGitSnapshotCache(): void {
    gitSnapshotCache.clear();
}

export function writeCachedGitSnapshot(
    workspacePath: string,
    git: GitStatus | null,
    diffStats: GitSnapshotCacheEntry["diffStats"],
    diffText: string,
): void {
    gitSnapshotCache.set(workspacePath, { git, diffStats, diffText, updatedAt: Date.now() });
    // LRU 淘汰: 超出上限时删除最旧的条目
    if (gitSnapshotCache.size > GIT_SNAPSHOT_CACHE_MAX) {
        let oldestKey: string | null = null;
        let oldestAt = Infinity;
        for (const [key, entry] of gitSnapshotCache) {
            if (entry.updatedAt < oldestAt) {
                oldestAt = entry.updatedAt;
                oldestKey = key;
            }
        }
        if (oldestKey) gitSnapshotCache.delete(oldestKey);
    }
}

export function countDiffStats(diff: string): GitSnapshotCacheEntry["diffStats"] {
    return diff.split(/\r?\n/).reduce<GitSnapshotCacheEntry["diffStats"]>(
        (acc, line) => {
            if (line.startsWith("+++") || line.startsWith("---")) return acc;
            if (line.startsWith("+")) acc.additions += 1;
            if (line.startsWith("-")) acc.deletions += 1;
            return acc;
        },
        { additions: 0, deletions: 0 },
    );
}
