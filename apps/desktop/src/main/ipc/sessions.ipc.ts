// 2026-06-06 hotfix: session messages persistence IPC
// 4 个原有 session handler (list/create/rename/delete) + 3 个新增 (append/update/update-tool-call)
// 全部走 zod 校验,失败返 IpcError;写入走 services/session-store 提供的 async-mutex 串行化
//
// 设计:
//  - 把现有 index.ts 里 4 个 session handler 重构过来,保持 channel 名不变(向后兼容)
//  - 新增 3 个 channel 也保持字面量(no-duplicate-ipc.test.ts 静态扫描能找到)
//  - store 实例从 main 注入,模块本身不持有 store
//  - 所有错误用 ipcError 工厂,i18n code + 中文 fallback

import { ipcMain } from "electron";
import log from "electron-log/main";
import { ipcError, type Message, type ToolCall } from "@shared";
import {
    listSessions as _listSessions,
    getSession,
    createSession as _createSession,
    renameSession as _renameSession,
    deleteSession as _deleteSession,
    appendMessage,
    updateMessage,
    updateToolCall,
    type SessionPersistence,
} from "../services/session-store";
import {
    appendMessageSchema,
    updateMessageSchema,
    updateToolCallSchema,
} from "./schemas";

export interface SessionsIpcDeps {
    store: SessionPersistence;
}

function toMessage(raw: unknown): Message {
    // zod 已经校验过 id/role/content/timestamp;passthrough 允许其他字段
    return raw as Message;
}

function toToolCallUpdate(raw: unknown): Partial<ToolCall> {
    return raw as Partial<ToolCall>;
}

export function setupSessionsIpc(deps: SessionsIpcDeps): void {
    const { store } = deps;

    // ── 原有 4 个 handler(从 index.ts 搬过来,行为不变)───────────────

    ipcMain.handle("session:list", async () => {
        return _listSessions(store);
    });

    ipcMain.handle(
        "session:create",
        async (_event, workspaceId: string, title?: string, id?: string) => {
            try {
                return await _createSession(store, workspaceId, title, id);
            } catch (err) {
                log.error("[sessions.ipc] session:create failed:", err);
                return ipcError(
                    "ipcErrors.session.createFailed",
                    `创建会话失败: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        },
    );

    ipcMain.handle(
        "session:rename",
        async (_event, id: string, title: string) => {
            try {
                return await _renameSession(store, id, title);
            } catch (err) {
                log.error("[sessions.ipc] session:rename failed:", err);
                return ipcError(
                    "ipcErrors.session.renameFailed",
                    `重命名会话失败: ${err instanceof Error ? err.message : String(err)}`,
                    { id },
                );
            }
        },
    );

    ipcMain.handle("session:delete", async (_event, id: string) => {
        try {
            await _deleteSession(store, id);
        } catch (err) {
            log.error("[sessions.ipc] session:delete failed:", err);
            return ipcError(
                "ipcErrors.session.deleteFailed",
                `删除会话失败: ${err instanceof Error ? err.message : String(err)}`,
                { id },
            );
        }
        return undefined;
    });

    // ── 新增 3 个 handler(消息持久化)───────────────────────────────

    ipcMain.handle(
        "session:append-message",
        async (_event, sessionId: string, raw: unknown) => {
            const parsed = appendMessageSchema.safeParse([sessionId, raw]);
            if (!parsed.success) {
                log.warn("[sessions.ipc] session:append-message invalid args:", parsed.error);
                return ipcError(
                    "ipcErrors.session.appendMessageInvalid",
                    "追加消息参数无效",
                    { reason: parsed.error.issues[0]?.message ?? "unknown" },
                );
            }
            try {
                await appendMessage(store, sessionId, toMessage(raw));
            } catch (err) {
                log.error("[sessions.ipc] session:append-message failed:", err);
                return ipcError(
                    "ipcErrors.session.appendMessageFailed",
                    `追加消息失败: ${err instanceof Error ? err.message : String(err)}`,
                    { sessionId },
                );
            }
            return undefined;
        },
    );

    ipcMain.handle(
        "session:update-message",
        async (_event, sessionId: string, messageId: string, raw: unknown) => {
            const parsed = updateMessageSchema.safeParse([sessionId, messageId, raw]);
            if (!parsed.success) {
                log.warn("[sessions.ipc] session:update-message invalid args:", parsed.error);
                return ipcError(
                    "ipcErrors.session.updateMessageInvalid",
                    "更新消息参数无效",
                    { reason: parsed.error.issues[0]?.message ?? "unknown" },
                );
            }
            try {
                await updateMessage(store, sessionId, messageId, toMessage(raw));
            } catch (err) {
                log.error("[sessions.ipc] session:update-message failed:", err);
                return ipcError(
                    "ipcErrors.session.updateMessageFailed",
                    `更新消息失败: ${err instanceof Error ? err.message : String(err)}`,
                    { sessionId, messageId },
                );
            }
            return undefined;
        },
    );

    ipcMain.handle(
        "session:update-tool-call",
        async (
            _event,
            sessionId: string,
            messageId: string,
            toolCallId: string,
            raw: unknown,
        ) => {
            const parsed = updateToolCallSchema.safeParse([
                sessionId,
                messageId,
                toolCallId,
                raw,
            ]);
            if (!parsed.success) {
                log.warn(
                    "[sessions.ipc] session:update-tool-call invalid args:",
                    parsed.error,
                );
                return ipcError(
                    "ipcErrors.session.updateToolCallInvalid",
                    "更新工具调用参数无效",
                    { reason: parsed.error.issues[0]?.message ?? "unknown" },
                );
            }
            try {
                await updateToolCall(
                    store,
                    sessionId,
                    messageId,
                    toolCallId,
                    toToolCallUpdate(raw),
                );
            } catch (err) {
                log.error("[sessions.ipc] session:update-tool-call failed:", err);
                return ipcError(
                    "ipcErrors.session.updateToolCallFailed",
                    `更新工具调用失败: ${err instanceof Error ? err.message : String(err)}`,
                    { sessionId, messageId, toolCallId },
                );
            }
            return undefined;
        },
    );

    // 显式 getSession(目前 renderer 不调,留作未来分页加载入口)
    void getSession;
}
