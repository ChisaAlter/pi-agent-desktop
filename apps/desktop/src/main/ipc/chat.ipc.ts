// Chat IPC Handler (M1 Task 9)
// 替换老的 pi:prompt / pi:stop 一次性 spawn 模式
// 走 AgentSession 长连接 + ApprovalInterceptor + EventBridge

import { ipcMain, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { execFileSync } from "child_process";
import { WorkspaceRegistry } from "../services/pi-session/registry";
import type { IpcSender } from "../services/pi-session/event-bridge";
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
    const send: IpcSender = (channel, workspaceId, payload) => {
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

        // registry.get() 内部会 lazy-init: 第一次创建 session + bridge + interceptor
        // 并只订阅一次 Pi 事件 (修复之前的订阅泄漏 + 重复处理 bug)
        const wsSession = await deps.registry.get(ws.id, ws.path, deps.pendingEdits, send);
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
    // 用 execFileSync 参数化 (避免 shell 注入)
    ipcMain.handle("git:undo", async (_event, workspacePath: string, filePath: string) => {
        try {
            // 先试 git checkout (tracked file)
            execFileSync("git", ["checkout", "--", filePath], { cwd: workspacePath, stdio: "ignore" });
        } catch {
            // fallback: rm (untracked new file) — 参数化, 安全
            try {
                execFileSync("rm", [filePath], { cwd: workspacePath, stdio: "ignore" });
            } catch {
                // ignore
            }
        }
    });
}
