// Approval Bridge (M1 Task 7)
// IPC 发射 + 等待 renderer 响应
// Phase 2 Task 17.3: pending map is isolated per workspaceId to prevent
// cross-workspace state corruption when multiple windows are open.

import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";

interface PendingRequest {
    resolve: (value: boolean) => void;
    timer: NodeJS.Timeout;
}

// Per-workspaceId pending map. Keyed by workspaceId; each inner Map is keyed
// by requestId. The empty-string workspaceId ("") is used as a legacy bucket
// for callers that don't supply one.
const pendingByWorkspace = new Map<string, Map<string, PendingRequest>>();

function getWorkspaceApprovals(workspaceId: string): Map<string, PendingRequest> {
    let m = pendingByWorkspace.get(workspaceId);
    if (!m) {
        m = new Map();
        pendingByWorkspace.set(workspaceId, m);
    }
    return m;
}

/** Renderer only sends `requestId` (no workspaceId), so scan all workspaces. */
function findPending(requestId: string): { pending: PendingRequest; map: Map<string, PendingRequest> } | null {
    for (const map of pendingByWorkspace.values()) {
        const pending = map.get(requestId);
        if (pending) return { pending, map };
    }
    return null;
}

export interface ApprovalRequestPayload {
    method: "confirm" | "select";
    title: string;
    message?: string;
    timeoutMs?: number;
    /** Optional workspaceId for per-workspace isolation. */
    workspaceId?: string;
}

/** 发送审批请求到 renderer, 等用户决策 */
export function requestApproval(req: ApprovalRequestPayload): Promise<boolean> {
    const requestId = randomUUID();
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return Promise.resolve(false);

    const workspaceId = req.workspaceId ?? "";
    const map = getWorkspaceApprovals(workspaceId);

    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            map.delete(requestId);
            resolve(false); // 超时默认拒绝 (安全侧)
        }, req.timeoutMs ?? 60_000);

        map.set(requestId, { resolve, timer });

        try {
            win.webContents.send("approval:request", {
                requestId,
                method: req.method,
                title: req.title,
                message: req.message,
                workspaceId,
            });
        } catch {
            // window 不可用, 当作拒绝
            clearTimeout(timer);
            map.delete(requestId);
            resolve(false);
        }
    });
}

/** Renderer 调此函数响应审批 */
export function resolveApprovalRequest(requestId: string, approved: boolean): void {
    const found = findPending(requestId);
    if (!found) return;
    const { pending, map } = found;
    clearTimeout(pending.timer);
    map.delete(requestId);
    pending.resolve(approved);
}

/** 清空所有 pending (e.g. window 关闭时) */
export function clearAllPendingApprovals(): void {
    for (const map of pendingByWorkspace.values()) {
        for (const [, p] of map) {
            clearTimeout(p.timer);
            p.resolve(false);
        }
        map.clear();
    }
    pendingByWorkspace.clear();
}

/** 测试用: 看现在有多少 pending */
export function _pendingCount(): number {
    let total = 0;
    for (const map of pendingByWorkspace.values()) {
        total += map.size;
    }
    return total;
}
