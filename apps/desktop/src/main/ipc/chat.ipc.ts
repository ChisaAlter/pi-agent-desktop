// Chat IPC Handler (M1 Task 9)
// 替换老的 pi:prompt / pi:stop 一次性 spawn 模式
// 走 AgentSession 长连接 + ApprovalInterceptor + EventBridge

import { ipcMain, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { execSync } from "child_process";
import { WorkspaceRegistry } from "../services/pi-session/registry";
import { createEventBridge } from "../services/pi-session/event-bridge";
import { createApprovalInterceptor } from "../services/approval/interceptor";
import { PendingEdits } from "../services/approval/pending-edits";
import { resolveApprovalRequest } from "../services/approval/approval-bridge";

interface WorkspaceLite {
    id: string;
    name: string;
    path: string;
}

interface ChatIpcDeps {
    registry: WorkspaceRegistry;
    /** 同步拿 workspace path 用 */
    getWorkspace: (id: string) => WorkspaceLite | undefined;
    /** 同步拿 default workspace 路径 (workspaceId 为空时兜底) */
    getDefaultWorkspace: () => WorkspaceLite | undefined;
    /** 持久化 PendingEdits 状态 (可选, 用于窗口重启时恢复) */
    pendingEdits: PendingEdits;
}

export function setupChatIpc(deps: ChatIpcDeps): void {
    const send = (channel: string, workspaceId: string, payload: unknown) => {
        const win: BrowserWindowType | null = BrowserWindow.getAllWindows()[0] ?? null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, { workspaceId, payload });
        }
    };

    // 监听 renderer 响应审批
    ipcMain.on("approval:respond", (_event, requestId: string, approved: boolean) => {
        resolveApprovalRequest(requestId, approved);
    });

    ipcMain.handle("pi:send", async (_event, workspaceId: string, text: string) => {
        const ws = deps.getWorkspace(workspaceId) ?? deps.getDefaultWorkspace();
        if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);

        const wsSession = await deps.registry.get(ws.id, ws.path);
        const bridge = createEventBridge(ws.id, send);
        const interceptor = createApprovalInterceptor(ws.id, {
            abort: () => wsSession.session.abort(),
            pendingEdits: deps.pendingEdits,
            send,
            workspacePath: ws.path,
        });

        // 订阅事件: 先过 interceptor (决策), 再过 bridge (推 renderer)
        wsSession.session.subscribe(async (event) => {
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

        await wsSession.session.prompt(text);
    });

    ipcMain.handle("pi:stop", async (_event, workspaceId: string) => {
        const ws = deps.getWorkspace(workspaceId) ?? deps.getDefaultWorkspace();
        if (!ws) return;
        if (!deps.registry.has(ws.id)) return;
        const wsSession = await deps.registry.get(ws.id, ws.path);
        wsSession.session.abort();
    });

    // M1: Git undo (撤销 file_edit 类改动)
    ipcMain.handle("git:undo", async (_event, workspacePath: string, filePath: string) => {
        try {
            // 先试 git checkout (tracked file)
            execSync(`git checkout -- "${filePath}"`, { cwd: workspacePath, stdio: "ignore" });
        } catch {
            // fallback: rm (untracked new file)
            try {
                execSync(`rm "${filePath}"`, { cwd: workspacePath, stdio: "ignore" });
            } catch {
                // ignore
            }
        }
    });
}
