// AgentSession Factory (M1 Task 5)
// 为每个 workspace 创建一个 Pi AgentSession 实例
// 不起子进程, 直接 in-process 调用

import {
    createAgentSession,
    createEventBus,
    DefaultResourceLoader,
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
    uiContext?: ExtensionUIContext;
}

export async function createWorkspaceSession(opts: CreateSessionOpts): Promise<WorkspaceSession> {
    const permissionExtensionPath = require.resolve("pi-permission-system");
    const openPlanPackageJson = require.resolve("pi-openplan/package.json");
    const openPlanExtensionPath = join(dirname(openPlanPackageJson), "extensions");
    const eventBus = createEventBus();
    const resourceLoader = new DefaultResourceLoader({
        cwd: opts.workspacePath,
        agentDir: getAgentDir(),
        eventBus,
        additionalExtensionPaths: [permissionExtensionPath, openPlanExtensionPath],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
        cwd: opts.workspacePath,
        resourceLoader,
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
