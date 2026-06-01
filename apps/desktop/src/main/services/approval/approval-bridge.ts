// Approval Bridge (M1 Task 7)
// IPC 发射 + 等待 renderer 响应

import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";

interface PendingRequest {
    resolve: (value: boolean) => void;
    timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingRequest>();

export interface ApprovalRequestPayload {
    method: "confirm" | "select";
    title: string;
    message?: string;
    timeoutMs?: number;
}

/** 发送审批请求到 renderer, 等用户决策 */
export function requestApproval(req: ApprovalRequestPayload): Promise<boolean> {
    const requestId = randomUUID();
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            resolve(false); // 超时默认拒绝 (安全侧)
        }, req.timeoutMs ?? 60_000);

        pending.set(requestId, { resolve, timer });

        try {
            win.webContents.send("approval:request", {
                requestId,
                method: req.method,
                title: req.title,
                message: req.message,
            });
        } catch {
            // window 不可用, 当作拒绝
            clearTimeout(timer);
            pending.delete(requestId);
            resolve(false);
        }
    });
}

/** Renderer 调此函数响应审批 */
export function resolveApprovalRequest(requestId: string, approved: boolean): void {
    const p = pending.get(requestId);
    if (p) {
        clearTimeout(p.timer);
        pending.delete(requestId);
        p.resolve(approved);
    }
}

/** 清空所有 pending (e.g. window 关闭时) */
export function clearAllPendingApprovals(): void {
    for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.resolve(false);
    }
    pending.clear();
}

/** 测试用: 看现在有多少 pending */
export function _pendingCount(): number {
    return pending.size;
}
