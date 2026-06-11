// Chat IPC Handler (M1 Task 9)
// 替换老的 pi:prompt / pi:stop 一次性 spawn 模式
// 走 AgentSession 长连接 + ApprovalInterceptor + EventBridge
// v1.0.6.1: 错误返 IpcError (code/params/fallback), 不再 throw 中文

import { ipcMain, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { execFileSync } from "child_process";
import { rmSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import log from "electron-log/main";
import { ipcError } from "@shared";
import { WorkspaceRegistry } from "../services/pi-session/registry";
import type { IpcSender } from "../services/pi-session/event-bridge";
import { PendingEdits } from "../services/approval/pending-edits";
import { resolveApprovalRequest } from "../services/approval/approval-bridge";
import {
    resolveExtensionUiRequest,
    setDesktopPermissionMode,
} from "../services/extensions/extension-ui-bridge";
import type { ExtensionUiResponse, PermissionDecision, PermissionMode } from "@shared";
import type { AgentRuntimeRegistry } from "../services/agent-runtime/registry";
import { getProtectedPathReason } from "../services/protected-paths";
import { gitUndoSchema } from "./schemas";

interface WorkspaceLite {
    id: string;
    name: string;
    path: string;
}

interface ChatIpcDeps {
    registry: WorkspaceRegistry;
    /** 同步拿 workspace path 用 */
    getWorkspace: (id: string) => WorkspaceLite | undefined;
    /** 同步拿 default workspace 路径 (legacy callers only) */
    getDefaultWorkspace: () => WorkspaceLite | undefined;
    /** 持久化 PendingEdits 状态 (可选, 用于窗口重启时恢复) */
    pendingEdits: PendingEdits;
    /** 新工作台运行时；存在时 legacy pi:* 入口转发到 agent 语义 */
    agentRegistry?: AgentRuntimeRegistry;
}

export function setupChatIpc(deps: ChatIpcDeps): void {
    const planModeByWorkspace = new Map<string, boolean>();
    const send: IpcSender = (channel, _workspaceId, payload) => {
        const win: BrowserWindowType | null = BrowserWindow.getAllWindows()[0] ?? null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    // 监听 renderer 响应审批
    ipcMain.on("approval:respond", (_event, requestId: string, approved: boolean) => {
        resolveApprovalRequest(requestId, approved);
    });

    ipcMain.handle("permission:set-mode", async (_event, mode: PermissionMode) => {
        setDesktopPermissionMode(mode);
    });

    ipcMain.on(
        "permission:respond",
        (_event, requestId: string, response: ExtensionUiResponse | PermissionDecision | boolean | string) => {
            resolveExtensionUiRequest(requestId, response);
        },
    );

    ipcMain.handle("plan:set-enabled", async (_event, workspaceId: string, enabled: boolean) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        planModeByWorkspace.set(ws.id, enabled);
        return undefined;
    });

    ipcMain.on("plan:respond", (_event, requestId: string, decision: string, text?: string) => {
        resolveExtensionUiRequest(requestId, { requestId, value: decision === "execute" ? true : text ?? "" });
    });

    // v1.1: renderer 同步 autoApprove 标志到主进程
    ipcMain.on("approval:set-auto-approve", (_event, value: boolean) => {
        deps.pendingEdits.autoApprove = value;
        log.info(`[chat.ipc] autoApprove set to: ${value}`);
    });

    ipcMain.handle("pi:send", async (_event, workspaceId: string, text: string) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }

        try {
            if (deps.agentRegistry) {
                let agent = deps.agentRegistry.findDefaultAgent(ws.id);
                if (!agent) {
                    agent = await deps.agentRegistry.create({
                        workspaceId: ws.id,
                        title: `${ws.name} Agent`,
                    });
                }
                await deps.agentRegistry.prompt({ agentId: agent.id, message: text });
                return undefined;
            }
            // registry.get() 内部会 lazy-init: 第一次创建 session + bridge + interceptor
            // 并只订阅一次 Pi 事件 (修复之前的订阅泄漏 + 重复处理 bug)
            const wsSession = await deps.registry.get(ws.id, ws.path, deps.pendingEdits, send);
            await wsSession.session.prompt(text);
            return undefined; // 显式返 void 满足 TS 全部路径 return 一致
        } catch (err) {
            log.error("[chat.ipc] prompt failed:", err);
            return ipcError(
                "ipcErrors.chat.promptFailed",
                `Pi 消息发送失败: ${err instanceof Error ? err.message : String(err)}`,
                { workspace: ws.name },
            );
        }
    });

    ipcMain.handle("pi:stop", async (_event, workspaceId: string) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        if (deps.agentRegistry) {
            const agent = deps.agentRegistry.findDefaultAgent(ws.id);
            if (agent) await deps.agentRegistry.abort(agent.id);
            return undefined;
        }
        if (!deps.registry.has(ws.id)) return undefined;
        const wsSession = await deps.registry.get(ws.id, ws.path);
        wsSession.session.abort();
        return undefined;
    });

    // M1: Git undo (撤销 file_edit 类改动)
    // 用 execFileSync 参数化 (避免 shell 注入)
    ipcMain.handle("git:undo", async (_event, workspacePath: string, filePath: string) => {
        try {
            gitUndoSchema.parse([workspacePath, filePath]);
        } catch (err) {
            log.warn("[chat.ipc] git:undo invalid args:", err);
            return ipcError(
                "ipcErrors.chat.gitUndoInvalid",
                `撤销文件改动参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(filePath ?? "") },
            );
        }

        const workspaceRoot = resolve(workspacePath);
        const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath);
        const reason = getProtectedPathReason(targetPath, workspaceRoot);
        if (reason) {
            return ipcError("ipcErrors.files.protectedPath", reason, { path: targetPath });
        }
        const gitPath = relative(workspaceRoot, targetPath).replace(/\\/g, "/");

        try {
            // 先试 git checkout (tracked file)
            execFileSync("git", ["checkout", "--", gitPath], { cwd: workspaceRoot, stdio: "ignore" });
        } catch {
            // fallback: remove an untracked new file using Node APIs under the same workspace guard.
            try {
                rmSync(join(workspaceRoot, gitPath), { force: true });
            } catch (err) {
                log.error("[chat.ipc] git:undo failed:", err);
                return ipcError(
                    "ipcErrors.chat.gitUndoFailed",
                    `撤销文件改动失败: ${err instanceof Error ? err.message : String(err)}`,
                    { path: gitPath },
                );
            }
        }
        return undefined; // 显式 void 让 TS happy (handler 必须 return 一致)
    });
}
