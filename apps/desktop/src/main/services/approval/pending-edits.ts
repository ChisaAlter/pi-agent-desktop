// PendingEdits
// Tracks file_edit tool changes, shows diff to user after execution
// Used by ApprovalPanel's EditReviewList
// Supports autoApprove flag (interceptor skips approval dialog when set)
// Undo support: track() records a pre-change content snapshot; undo()
// restores it (write back, or delete when the file did not exist before).

import { createHash } from "crypto";
import { readFile, writeFile, unlink, realpath } from "fs/promises";
import { dirname, resolve, sep } from "path";

export interface TrackedEdit {
    id: string;
    toolCallId: string;
    toolName: "write" | "edit";
    filePath: string;
    /** 所属 workspace, 撤销时解析绝对路径并校验归属 */
    workspaceId?: string;
    newContent?: string;
    oldString?: string;
    newString?: string;
    diff?: string;
    /**
     * 变更前文件内容快照: string = 原内容; null = 原文件不存在;
     * undefined = 未记录 (无法撤销)
     */
    oldContent?: string | null;
    /** tool_execution_end 时文件实际内容的 sha256; undo 前用于冲突检测 */
    postContentHash?: string;
    timestamp: number;
}

export class PendingEdits {
    private map = new Map<string, TrackedEdit>();
    /** 最大追踪条目数, 超出按时间最旧的淘汰, 防止无界增长 */
    private static MAX_ENTRIES = 200;
    /** v1.1: 自动审批开关 (renderer 同步过来) */
    private _autoApprove = false;
    /** SubTask 40.8: cached sorted list, invalidated on every mutation */
    private listCache: TrackedEdit[] | null = null;
    /** 同一 changeId 的 keep/undo 互斥锁 */
    private inFlight = new Set<string>();

    get autoApprove(): boolean {
        return this._autoApprove;
    }

    set autoApprove(value: boolean) {
        this._autoApprove = value;
    }

    private invalidateCache(): void {
        this.listCache = null;
    }

    track(
        toolCallId: string,
        toolName: "write" | "edit",
        filePath: string,
        args: { content?: string; old_string?: string; new_string?: string },
        oldContent?: string | null,
        workspaceId?: string
    ): string {
        const id = `change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.map.set(id, {
            id,
            toolCallId,
            toolName,
            filePath,
            workspaceId,
            newContent: args.content,
            oldString: args.old_string,
            newString: args.new_string,
            oldContent,
            timestamp: Date.now(),
        });
        this.evictIfFull();
        this.invalidateCache();
        return id;
    }

    private evictIfFull(): void {
        if (this.map.size <= PendingEdits.MAX_ENTRIES) return;
        // 按时间最旧的淘汰至容量内
        const sorted = [...this.map.values()].sort((a, b) => a.timestamp - b.timestamp);
        const excess = this.map.size - PendingEdits.MAX_ENTRIES;
        for (let i = 0; i < excess; i++) {
            this.map.delete(sorted[i].id);
        }
        this.invalidateCache();
    }

    review(id: string, diff: string, finalContent: string): void {
        const change = this.map.get(id);
        if (change) {
            change.diff = diff;
            change.newContent = finalContent;
            change.postContentHash = hashContent(finalContent);
            this.invalidateCache();
        }
    }

    private claim(id: string): { ok: true; change: TrackedEdit } | { ok: false; error: string } {
        const change = this.map.get(id);
        if (!change) return { ok: false, error: "变更不存在或已处理" };
        if (this.inFlight.has(id)) return { ok: false, error: "该变更正在处理中, 请稍候" };
        this.inFlight.add(id);
        return { ok: true, change };
    }

    private release(id: string): void {
        this.inFlight.delete(id);
    }

    approve(id: string): void {
        if (this.inFlight.has(id)) return;
        this.map.delete(id);
        this.invalidateCache();
    }

    reject(id: string): void {
        this.map.delete(id);
        this.invalidateCache();
    }

    remove(id: string): void {
        this.map.delete(id);
        this.invalidateCache();
    }

    /**
     * 撤销一笔变更: 用变更前快照恢复文件。
     *  - oldContent = string → 写回原内容
     *  - oldContent = null → 原文件不存在 → 删除新建文件 (ENOENT 视为已达成)
     *  - oldContent = undefined → 无快照, 拒绝撤销
     * 校验 (全部通过才执行):
     *  1. 词法: resolve 后必须在 workspaceRoot 内 (防 `..` 逃逸)
     *  2. canonical: realpath 后必须在 workspaceRoot 内 (防 symlink 指向工作区外)
     *  3. 归属: 传入 workspaceId 时, change 必须属于该 workspace
     * 成功后条目作废; 失败保留条目以便重试。
     */
    async assertPathInsideWorkspace(filePath: string, workspaceRoot: string): Promise<string> {
        const root = resolve(workspaceRoot);
        const absPath = resolve(root, filePath);
        if (absPath !== root && !absPath.startsWith(root + sep)) {
            throw new Error("目标路径不在工作区内, 已拒绝操作");
        }
        await this.assertCanonicalInside(absPath, root);
        return absPath;
    }

    async undo(
        id: string,
        workspaceRoot: string,
        workspaceId?: string
    ): Promise<{ ok: true } | { ok: false; error: string }> {
        const claimed = this.claim(id);
        if (!claimed.ok) return claimed;
        const change = claimed.change;
        try {
            if (change.oldContent === undefined) return { ok: false, error: "该变更没有可回滚的快照" };
            if (workspaceId && change.workspaceId && change.workspaceId !== workspaceId) {
                return { ok: false, error: "变更不属于该工作区, 已拒绝撤销" };
            }

            const root = resolve(workspaceRoot);
            const absPath = await this.assertPathInsideWorkspace(change.filePath, root);

            // 只有文件仍保持本次 tool_execution_end 的结果时才允许整文件恢复;
            // 用户或后续工具已改动则返回 conflict, 不覆盖新内容。
            if (change.postContentHash !== undefined) {
                let current: string;
                try {
                    current = await readFile(absPath, "utf-8");
                } catch (err) {
                    if (change.oldContent === null && (err as NodeJS.ErrnoException).code === "ENOENT") {
                        current = "";
                    } else {
                        return { ok: false, error: "文件在变更后已不可读取, 无法安全撤销" };
                    }
                }
                if (hashContent(current) !== change.postContentHash) {
                    return { ok: false, error: "文件已被后续修改, 请先处理最新变更" };
                }
            }

            if (change.oldContent === null) {
                try {
                    await unlink(absPath);
                } catch (err) {
                    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
                }
            } else {
                await writeFile(absPath, change.oldContent, "utf-8");
            }
            this.map.delete(id);
            this.invalidateCache();
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
            this.release(id);
        }
    }

    private async assertCanonicalInside(absPath: string, root: string): Promise<void> {
        let canonicalTarget: string;
        try {
            canonicalTarget = await realpath(absPath);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
            canonicalTarget = await realpathOfNearestAncestor(absPath, root);
        }
        const normalize = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
        const target = normalize(canonicalTarget);
        const base = normalize(root);
        if (target !== base && !target.startsWith(base + sep)) {
            throw new Error("目标路径解析到工作区外, 已拒绝撤销");
        }
    }

    get(id: string): TrackedEdit | undefined {
        return this.map.get(id);
    }

    /** SubTask 40.8: linear scan by toolCallId (bounded at MAX_ENTRIES=200). */
    getByToolCallId(toolCallId: string): TrackedEdit | undefined {
        for (const edit of this.map.values()) {
            if (edit.toolCallId === toolCallId) return edit;
        }
        return undefined;
    }

    list(): TrackedEdit[] {
        if (this.listCache) return this.listCache;
        this.listCache = [...this.map.values()].sort((a, b) => b.timestamp - a.timestamp);
        return this.listCache;
    }

    clear(): void {
        this.map.clear();
        this.invalidateCache();
    }

    clearWorkspace(workspaceId: string): string[] {
        const removed: string[] = [];
        for (const [id, change] of this.map) {
            if (change.workspaceId !== workspaceId) continue;
            this.map.delete(id);
            removed.push(id);
        }
        if (removed.length > 0) this.invalidateCache();
        return removed;
    }

    size(): number {
        return this.map.size;
    }
}

function hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * 目标路径不存在时 (撤销新建文件场景), 从 absPath 逐级向上找最近存在的
 * 祖先做 realpath, 防 symlink 目录把操作导向工作区外。
 * 整条链都不存在 → 返回 stop (workspace root) 本身作为名义 canonical。
 */
async function realpathOfNearestAncestor(absPath: string, stop: string): Promise<string> {
    let current = absPath;
    while (true) {
        try {
            return await realpath(current);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        if (current === stop) break;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return resolve(stop);
}
