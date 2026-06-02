// WorkspaceRegistry (M1 Task 6, v1.0.1 refactor)
// 多 workspace 编排: workspaceId -> AgentSession 映射
// 每次 get() 复用 session; 首次创建时 lazy-init bridge + interceptor + 订阅一次
// (修复 v1.0 之前的订阅泄漏: 每次 pi:send 都新建 + 订阅, 永不取消)
// v1.0.5: event 类型用 @shared/events PiEvent, 去掉 as any

import { createWorkspaceSession, type WorkspaceSession } from "./factory";
import { createEventBridge, type IpcSender } from "./event-bridge";
import { createApprovalInterceptor } from "../approval/interceptor";
import type { PiEvent } from "@shared/events";
import type { PendingEdits } from "../approval/pending-edits";

/** 内部存储: session + 已初始化的 bridge/interceptor/subscription */
interface WorkspaceEntry {
    session: WorkspaceSession;
    subscribed: boolean;
}

export class WorkspaceRegistry {
    private entries = new Map<string, WorkspaceEntry>();

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

        if (send && pendingEdits) {
            this.ensureSubscribed(entry, workspaceId, workspacePath, pendingEdits, send);
        }

        return session;
    }

    has(workspaceId: string): boolean {
        return this.entries.has(workspaceId);
    }

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
        // 外部包 @earendil-works/pi-coding-agent 的 subscribe 签名是 (cb: (event: unknown) => void)
        // 这里把它当 PiEvent 用 (类型安全)
        entry.session.session.subscribe(async (rawEvent) => {
            const event = rawEvent as unknown as PiEvent;
            try {
                await interceptor.handleEvent(event);
            } catch (err) {
                console.error("[chat.ipc] interceptor error:", err);
            }
            try {
                bridge.handleEvent(event);
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
