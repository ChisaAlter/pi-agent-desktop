// WorkspaceRegistry (M1 Task 6, v1.0.1 refactor)
// 多 workspace 编排: workspaceId -> AgentSession 映射
// 每次 get() 复用 session; 首次创建时 lazy-init bridge + interceptor + 订阅一次
// (修复 v1.0 之前的订阅泄漏: 每次 pi:send 都新建 + 订阅, 永不取消)

import { createWorkspaceSession, type WorkspaceSession } from "./factory";
import { createEventBridge, type IpcSender } from "./event-bridge";
import { createApprovalInterceptor } from "../approval/interceptor";
import type { PendingEdits } from "../approval/pending-edits";

/** 内部存储: session + 已初始化的 bridge/interceptor/subscription */
interface WorkspaceEntry {
    session: WorkspaceSession;
    subscribed: boolean;
}

export class WorkspaceRegistry {
    private entries = new Map<string, WorkspaceEntry>();

    /**
     * 获取 workspace session. 首次调用会:
     * 1. 创建 AgentSession
     * 2. 创建 EventBridge + ApprovalInterceptor
     * 3. 订阅一次 Pi 事件 (后续调用复用)
     */
    async get(
        workspaceId: string,
        workspacePath: string,
        pendingEdits?: PendingEdits,
        send?: IpcSender,
    ): Promise<WorkspaceSession> {
        const existing = this.entries.get(workspaceId);
        if (existing) return existing.session;

        const session = await createWorkspaceSession({ workspaceId, workspacePath });
        const entry: WorkspaceEntry = { session, subscribed: false };
        this.entries.set(workspaceId, entry);

        // 懒初始化 bridge + interceptor + subscription (只在 send/pendingEdits 齐备时)
        if (send && pendingEdits) {
            this.ensureSubscribed(entry, workspaceId, workspacePath, pendingEdits, send);
        }

        return session;
    }

    has(workspaceId: string): boolean {
        return this.entries.has(workspaceId);
    }

    /** 补齐 subscription (用于 stop 后重新 send 的场景) */
    private ensureSubscribed(
        entry: WorkspaceEntry,
        workspaceId: string,
        workspacePath: string,
        pendingEdits: PendingEdits,
        send: IpcSender,
    ): void {
        if (entry.subscribed) return;
        const bridge = createEventBridge(workspaceId, send);
        const interceptor = createApprovalInterceptor(workspaceId, {
            abort: () => entry.session.session.abort(),
            pendingEdits,
            send,
            workspacePath,
        });
        // 订阅事件: 先过 interceptor (决策), 再过 bridge (推 renderer)
        entry.session.session.subscribe(async (event) => {
            try {
                await interceptor.handleEvent(event as any);
            } catch (err) {
                console.error("[chat.ipc] interceptor error:", err);
            }
            try {
                bridge.handleEvent(event as any);
            } catch (err) {
                console.error("[chat.ipc] event-bridge error:", err);
            }
        });
        entry.subscribed = true;
    }

    dispose(workspaceId: string): void {
        const entry = this.entries.get(workspaceId);
        if (entry) {
            try {
                entry.session.dispose();
            } catch {
                // 忽略 dispose 错误
            }
            this.entries.delete(workspaceId);
        }
    }

    disposeAll(): void {
        for (const entry of this.entries.values()) {
            try {
                entry.session.dispose();
            } catch {
                // 忽略
            }
        }
        this.entries.clear();
    }

    size(): number {
        return this.entries.size;
    }
}
