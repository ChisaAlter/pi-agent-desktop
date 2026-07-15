// Session messages persistence IPC
// 4 session handlers (list/create/rename/delete) + 3 message handlers (append/update/update-tool-call)
// All args zod-validated, errors return IpcError; persistence is delegated to SessionRepository.
//
// 设计:
//  - 把现有 index.ts 里 4 个 session handler 重构过来,保持 channel 名不变(向后兼容)
//  - 新增 3 个 channel 也保持字面量(no-duplicate-ipc.test.ts 静态扫描能找到)
//  - store 实例从 main 注入,模块本身不持有 store
//  - 所有错误用 ipcError 工厂,i18n code + 中文 fallback

import { ipcMain } from "electron";
import log from "electron-log/main";
import {
    ipcError,
    type Message,
    type Session,
    type SessionSearchInput,
    type ToolCall,
} from "@shared";
import type {
    SessionMetadataUpdates,
    SessionRepository,
} from "../services/session-repository";
import {
    appendMessageSchema,
    archiveSessionSchema,
    updateSessionMetadataSchema,
    updateMessageSchema,
    updateToolCallSchema,
} from "./schemas";
import { normalizeLegacyMessagePayload } from "./tool-call-normalization";

export interface SessionsIpcDeps {
    repository: SessionRepository;
    onSessionUpdated?: (session: Session) => void;
    onSessionDeleted?: (sessionId: string) => void;
}

function toMessage(raw: unknown): Message {
    // zod 已经校验过 id/role/content/timestamp;passthrough 允许其他字段
    return raw as Message;
}

function toToolCallUpdate(raw: unknown): Partial<ToolCall> {
    return raw as Partial<ToolCall>;
}

export function setupSessionsIpc(deps: SessionsIpcDeps): void {
    const { repository } = deps;

    // ── 原有 4 个 handler(从 index.ts 搬过来,行为不变)───────────────

    ipcMain.handle("session:list", async () => {
        return repository.listSessions();
    });

    ipcMain.handle("session:list-summaries", async () => {
        return repository.listSessionSummaries();
    });

    ipcMain.handle("session:get", async (_event, id: string) => {
        try {
            return (await repository.getSession(id)) ?? ipcError(
                "ipcErrors.session.notFound",
                `会话不存在: ${id}`,
                { id },
            );
        } catch (err) {
            return ipcError(
                "ipcErrors.session.getFailed",
                `读取会话失败: ${err instanceof Error ? err.message : String(err)}`,
                { id },
            );
        }
    });

    ipcMain.handle("session:search", async (_event, raw: SessionSearchInput) => {
        if (!raw || typeof raw.query !== "string" || !raw.query.trim()) return [];
        try {
            return await repository.searchSessionMessages(raw);
        } catch (err) {
            return ipcError(
                "ipcErrors.session.searchFailed",
                `搜索会话失败: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    });

    ipcMain.handle(
        "session:create",
        async (_event, workspaceId: string, title?: string, id?: string) => {
            try {
                const session = await repository.createSession(workspaceId, title, id);
                deps.onSessionUpdated?.(session);
                return session;
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
                const session = await repository.renameSession(id, title);
                deps.onSessionUpdated?.(session);
                return session;
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
            await repository.deleteSession(id);
            deps.onSessionDeleted?.(id);
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

    ipcMain.handle("session:archive", async (_event, id: string, archived: boolean) => {
        const parsed = archiveSessionSchema.safeParse([id, archived]);
        if (!parsed.success) {
            return ipcError(
                "ipcErrors.session.archiveInvalid",
                "归档会话参数无效",
                { reason: parsed.error.issues[0]?.message ?? "unknown" },
            );
        }
        try {
            const session = await repository.archiveSession(id, archived);
            deps.onSessionUpdated?.(session);
            return session;
        } catch (err) {
            log.error("[sessions.ipc] session:archive failed:", err);
            return ipcError(
                "ipcErrors.session.archiveFailed",
                `归档会话失败: ${err instanceof Error ? err.message : String(err)}`,
                { id },
            );
        }
    });

    ipcMain.handle("session:update-metadata", async (_event, id: string, raw: unknown) => {
        const parsed = updateSessionMetadataSchema.safeParse([id, raw]);
        if (!parsed.success) {
            return ipcError(
                "ipcErrors.session.updateMetadataInvalid",
                "更新会话元数据参数无效",
                { reason: parsed.error.issues[0]?.message ?? "unknown" },
            );
        }
        try {
            const session = await repository.updateSessionMetadata(id, raw as SessionMetadataUpdates);
            deps.onSessionUpdated?.(session);
            return session;
        } catch (err) {
            log.error("[sessions.ipc] session:update-metadata failed:", err);
            return ipcError(
                "ipcErrors.session.updateMetadataFailed",
                `更新会话元数据失败: ${err instanceof Error ? err.message : String(err)}`,
                { id },
            );
        }
    });

    // ── 新增 3 个 handler(消息持久化)───────────────────────────────

    ipcMain.handle(
        "session:append-message",
        async (_event, sessionId: string, raw: unknown) => {
            const normalizedRaw = normalizeLegacyMessagePayload(raw);
            const parsed = appendMessageSchema.safeParse([sessionId, normalizedRaw]);
            if (!parsed.success) {
                log.warn("[sessions.ipc] session:append-message invalid args:", parsed.error);
                return ipcError(
                    "ipcErrors.session.appendMessageInvalid",
                    "追加消息参数无效",
                    { reason: parsed.error.issues[0]?.message ?? "unknown" },
                );
            }
            try {
                const [, message] = parsed.data;
                await repository.appendMessage(sessionId, toMessage(message));
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
            const normalizedRaw = normalizeLegacyMessagePayload(raw);
            const parsed = updateMessageSchema.safeParse([sessionId, messageId, normalizedRaw]);
            if (!parsed.success) {
                log.warn("[sessions.ipc] session:update-message invalid args:", parsed.error);
                return ipcError(
                    "ipcErrors.session.updateMessageInvalid",
                    "更新消息参数无效",
                    { reason: parsed.error.issues[0]?.message ?? "unknown" },
                );
            }
            try {
                const [, , updates] = parsed.data;
                await repository.updateMessage(sessionId, messageId, toMessage(updates));
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
                await repository.updateToolCall(
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
}
