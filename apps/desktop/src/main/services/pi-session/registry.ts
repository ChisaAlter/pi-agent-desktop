// WorkspaceRegistry
// Multi-workspace orchestration: workspaceId -> AgentSession mapping
// get() reuses sessions; lazy-inits bridge + interceptor + subscriptions on first call
// Event types use @shared/events PiEvent (no 'as any')

import { createWorkspaceSession, type WorkspaceSession } from "./factory";
import { createEventBridge, type IpcSender } from "./event-bridge";
import { createApprovalInterceptor } from "../approval/interceptor";
import { createExtensionUiBridge } from "../extensions/extension-ui-bridge";
import type { AgentMode } from "@shared";
import type { PiEvent } from "@shared/events";
import type { PendingEdits } from "../approval/pending-edits";
import log from "electron-log/main";

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
        getMode?: () => AgentMode,
    ): Promise<WorkspaceSession> {
        const existing = this.entries.get(workspaceId);
        if (existing) return existing.session;

        const session = await createWorkspaceSession({
            workspaceId,
            workspacePath,
            uiContext: createExtensionUiBridge(workspaceId),
        });
        const entry: WorkspaceEntry = { session, subscribed: false };
        this.entries.set(workspaceId, entry);

        if (send && pendingEdits) {
            this.ensureSubscribed(entry, workspaceId, workspacePath, pendingEdits, send, getMode);
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
        getMode?: () => AgentMode,
    ): void {
        if (entry.subscribed) return;
        const bridge = createEventBridge(workspaceId, send);
        const interceptor = createApprovalInterceptor(workspaceId, {
            abort: () => entry.session.session.abort(),
            pendingEdits,
            send,
            workspacePath,
            getMode,
        });
        // 订阅事件: 先过 interceptor (决策), 再过 bridge (推 renderer)
        // 外部包 @earendil-works/pi-coding-agent 的 subscribe 签名是 (cb: (event: unknown) => void)
        // 这里把它当 PiEvent 用 (类型安全)
        entry.session.session.subscribe(async (rawEvent) => {
            const event = rawEvent as unknown as PiEvent;
            try {
                await interceptor.handleEvent(event);
            } catch (err) {
                log.error("[chat.ipc] interceptor error:", err);
            }
            try {
                bridge.handleEvent(event);
            } catch (err) {
                log.error("[chat.ipc] event-bridge error:", err);
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
