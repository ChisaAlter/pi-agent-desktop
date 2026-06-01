// AgentSession Factory (M1 Task 5)
// 为每个 workspace 创建一个 Pi AgentSession 实例
// 不起子进程, 直接 in-process 调用

import { createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";

export interface WorkspaceSession {
    workspaceId: string;
    session: AgentSession;
    dispose: () => void;
}

export interface CreateSessionOpts {
    workspaceId: string;
    workspacePath: string;
    modelId?: string;
    provider?: string;
}

export async function createWorkspaceSession(opts: CreateSessionOpts): Promise<WorkspaceSession> {
    const { session } = await createAgentSession({
        cwd: opts.workspacePath,
    });

    return {
        workspaceId: opts.workspaceId,
        session,
        dispose: () => {
            try {
                session.dispose();
            } catch {
                // 忽略 dispose 错误
            }
        },
    };
}
