// AgentSession Factory (M1 Task 5)
// 为每个 workspace 创建一个 Pi AgentSession 实例
// 不起子进程, 直接 in-process 调用

import {
    createAgentSession,
    createEventBus,
    DefaultResourceLoader,
    SessionManager,
    getAgentDir,
    type AgentSession,
    type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { createRequire } from "module";
import { dirname, join } from "path";

const require = createRequire(__filename);

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
    sessionPath?: string;
    uiContext?: ExtensionUIContext;
}

export async function createWorkspaceSession(opts: CreateSessionOpts): Promise<WorkspaceSession> {
    const additionalExtensionPaths = [
        safeResolve("pi-permission-system"),
        safeResolve("pi-openplan/package.json", (packageJson) => join(dirname(packageJson), "extensions")),
    ].filter((path): path is string => Boolean(path));
    const eventBus = createEventBus();
    const resourceLoader = new DefaultResourceLoader({
        cwd: opts.workspacePath,
        agentDir: getAgentDir(),
        eventBus,
        additionalExtensionPaths,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
        cwd: opts.workspacePath,
        resourceLoader,
        sessionManager: opts.sessionPath ? SessionManager.open(opts.sessionPath) : undefined,
    });
    if (opts.uiContext) {
        await session.bindExtensions({ uiContext: opts.uiContext });
    }

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

function safeResolve(packageName: string, map: (resolved: string) => string = (resolved) => resolved): string | undefined {
    try {
        return map(require.resolve(packageName));
    } catch {
        return undefined;
    }
}
