// PendingEdits
// Tracks file_edit tool changes, shows diff to user after execution
// Used by ApprovalPanel's EditReviewList
// Supports autoApprove flag (interceptor skips approval dialog when set)

import { unlink, writeFile } from "fs/promises";
import { isAbsolute, resolve } from "path";
import { getProtectedPathReason } from "../protected-paths";

export interface TrackedEdit {
    id: string;
    toolCallId: string;
    toolName: "write" | "edit";
    filePath: string;
    oldContent?: string;
    newContent?: string;
    oldString?: string;
    newString?: string;
    diff?: string;
    timestamp: number;
}

export class PendingEdits {
    private map = new Map<string, TrackedEdit>();
    /** 最大追踪条目数, 超出按时间最旧的淘汰, 防止无界增长 */
    private static MAX_ENTRIES = 200;
    /** v1.1: 自动审批开关 (renderer 同步过来) */
    private _autoApprove = false;

    get autoApprove(): boolean {
        return this._autoApprove;
    }

    set autoApprove(value: boolean) {
        this._autoApprove = value;
    }

    track(
        toolCallId: string,
        toolName: "write" | "edit",
        filePath: string,
        args: { content?: string; old_string?: string; new_string?: string; oldContent?: string }
    ): string {
        const id = `change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.map.set(id, {
            id,
            toolCallId,
            toolName,
            filePath,
            oldContent: args.oldContent,
            newContent: args.content,
            oldString: args.old_string,
            newString: args.new_string,
            timestamp: Date.now(),
        });
        this.evictIfFull();
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
    }

    review(id: string, diff: string, finalContent: string): void {
        const change = this.map.get(id);
        if (change) {
            change.diff = diff;
            change.newContent = finalContent;
        }
    }

    approve(id: string): void {
        this.map.delete(id);
    }

    async reject(id: string, workspacePath: string): Promise<void> {
        const change = this.map.get(id);
        if (!change) return;

        const targetPath = isAbsolute(change.filePath)
            ? resolve(change.filePath)
            : resolve(workspacePath, change.filePath);
        const reason = getProtectedPathReason(targetPath, workspacePath);
        if (reason) {
            throw new Error(reason);
        }

        if (typeof change.oldContent === "string") {
            await writeFile(targetPath, change.oldContent, "utf-8");
        } else {
            await unlink(targetPath).catch((error: NodeJS.ErrnoException) => {
                if (error?.code === "ENOENT") return;
                throw error;
            });
        }
        this.map.delete(id);
    }

    remove(id: string): void {
        this.map.delete(id);
    }

    get(id: string): TrackedEdit | undefined {
        return this.map.get(id);
    }

    list(): TrackedEdit[] {
        return [...this.map.values()].sort((a, b) => b.timestamp - a.timestamp);
    }

    clear(): void {
        this.map.clear();
    }

    size(): number {
        return this.map.size;
    }
}
