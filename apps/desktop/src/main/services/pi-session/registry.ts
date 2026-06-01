// WorkspaceRegistry (M1 Task 6)
// 多 workspace 编排: workspaceId -> AgentSession 映射
// get 复用, dispose 释放, disposeAll 退出时清空

import { createWorkspaceSession, type WorkspaceSession } from "./factory";

export class WorkspaceRegistry {
    private sessions = new Map<string, WorkspaceSession>();

    async get(workspaceId: string, workspacePath: string, modelId?: string): Promise<WorkspaceSession> {
        const existing = this.sessions.get(workspaceId);
        if (existing) return existing;
        const ws = await createWorkspaceSession({ workspaceId, workspacePath, modelId });
        this.sessions.set(workspaceId, ws);
        return ws;
    }

    has(workspaceId: string): boolean {
        return this.sessions.has(workspaceId);
    }

    dispose(workspaceId: string): void {
        const ws = this.sessions.get(workspaceId);
        if (ws) {
            try {
                ws.dispose();
            } catch {
                // 忽略 dispose 错误
            }
            this.sessions.delete(workspaceId);
        }
    }

    disposeAll(): void {
        for (const ws of this.sessions.values()) {
            try {
                ws.dispose();
            } catch {
                // 忽略
            }
        }
        this.sessions.clear();
    }

    size(): number {
        return this.sessions.size;
    }
}
