// PendingEdits
// Tracks file_edit tool changes, shows diff to user after execution
// Used by ApprovalPanel's EditReviewList
// Supports autoApprove flag (interceptor skips approval dialog when set)

export interface TrackedEdit {
    id: string;
    toolCallId: string;
    toolName: "write" | "edit";
    filePath: string;
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
    /** SubTask 40.8: cached sorted list, invalidated on every mutation */
    private listCache: TrackedEdit[] | null = null;

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
        args: { content?: string; old_string?: string; new_string?: string }
    ): string {
        const id = `change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.map.set(id, {
            id,
            toolCallId,
            toolName,
            filePath,
            newContent: args.content,
            oldString: args.old_string,
            newString: args.new_string,
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
            this.invalidateCache();
        }
    }

    approve(id: string): void {
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

    size(): number {
        return this.map.size;
    }
}
