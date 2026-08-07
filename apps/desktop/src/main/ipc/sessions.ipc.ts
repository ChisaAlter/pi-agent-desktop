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
    type Workspace,
} from "@shared";
import type {
    SessionMetadataUpdates,
    SessionRepository,
} from "../services/session-repository";
import type { SessionAttachmentStore } from "../services/session-attachment-store";
import {
    appendMessageSchema,
    archiveSessionSchema,
    updateSessionMetadataSchema,
    updateMessageSchema,
    updateToolCallSchema,
} from "./schemas";
import { normalizeLegacyMessagePayload } from "./tool-call-normalization";
import { z } from "zod";

export interface SessionsIpcDeps {
    repository: SessionRepository;
    attachmentStore?: SessionAttachmentStore;
    onSessionUpdated?: (session: Session) => void;
    onSessionDeleted?: (sessionId: string, workspaceId?: string) => void;
    renameNativeSession?: (sessionId: string, title: string) => Promise<void>;
    deleteNativeSession?: (sessionId: string) => Promise<void>;
    forkNativeSession?: (input: {
        sourceSessionId: string;
        targetSessionId: string;
        workspaceId: string;
        fromMessageId?: string;
        messages: Message[];
    }) => Promise<void>;
    /**
     * Resolves a workspace by id. When provided, `session:create` verifies
     * the target workspace exists before inserting — 曾缺失该校验, 渲染层可
     * 为任意/已删除的 workspaceId 创建悬挂会话行, 污染 session:list。
     */
    getWorkspace?: (workspaceId: string) => Workspace | undefined;
}

const saveAttachmentsSchema = z.object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1).optional(),
    images: z.array(z.object({
        name: z.string().min(1),
        mimeType: z.string().min(1),
        data: z.string().min(1),
        size: z.number().int().nonnegative().optional(),
    })).min(1).max(6),
});

const getAttachmentSchema = z.object({
    sessionId: z.string().min(1),
    storageKey: z.string().min(1),
});

function toMessage(raw: unknown): Message {
    // zod 已经校验过 id/role/content/timestamp;passthrough 允许其他字段
    return raw as Message;
}

function toToolCallUpdate(raw: unknown): Partial<ToolCall> {
    return raw as Partial<ToolCall>;
}

const sessionOperationTails = new Map<string, Promise<void>>();

async function withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = sessionOperationTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    sessionOperationTails.set(sessionId, current);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (sessionOperationTails.get(sessionId) === current) sessionOperationTails.delete(sessionId);
    }
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
            // 安全审查 I3: session:create 曾是唯一零校验的会话 handler —
            // 渲染层可伪造任意 id 污染原生 JSONL 命名空间 (原生文件名是 id 的确定函数),
            // 或为不存在的 workspace 创建悬挂行. 这里与 session-path.ts 的
            // DESKTOP_SESSION_ID_PATTERN 对齐, 并校验 workspace 存在.
            if (typeof workspaceId !== "string" || !workspaceId.trim()) {
                return ipcError("ipcErrors.session.invalidWorkspace", "workspaceId must be a non-empty string");
            }
            if (id !== undefined && (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(id))) {
                return ipcError("ipcErrors.session.invalidId", "session id must match [A-Za-z0-9._-]+ (max 120)");
            }
            // 安全审查 I3: 注释声称"校验 workspace 存在" — 补上真实校验,
            // 防止为不存在的 workspaceId 创建悬挂会话行。
            if (deps.getWorkspace && !deps.getWorkspace(workspaceId)) {
                return ipcError("ipcErrors.session.workspaceNotFound", `Workspace not found: ${workspaceId}`, { id: workspaceId });
            }
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
        "session:fork-context",
        async (_event, sourceSessionId: string, targetSessionId: string, workspaceId: string, fromMessageId?: string) => {
            if (!sourceSessionId || !targetSessionId || !workspaceId || !deps.forkNativeSession) {
                return ipcError("ipcErrors.session.forkContextInvalid", "续接会话参数无效");
            }
            try {
                const source = await repository.getSession(sourceSessionId);
                if (!source) return ipcError("ipcErrors.session.notFound", `会话不存在: ${sourceSessionId}`);
                await deps.forkNativeSession({
                    sourceSessionId,
                    targetSessionId,
                    workspaceId,
                    fromMessageId,
                    messages: source.messages,
                });
                return undefined;
            } catch (error) {
                log.error("[sessions.ipc] session:fork-context failed:", error);
                return ipcError(
                    "ipcErrors.session.forkContextFailed",
                    error instanceof Error ? error.message : String(error),
                );
            }
        },
    );

    ipcMain.handle(
        "session:rename",
        async (_event, id: string, title: string) => {
            return withSessionLock(id, async () => {
                try {
                    const previous = await repository.getSession(id);
                    if (!previous) throw new Error(`session not found: ${id}`);
                    await deps.renameNativeSession?.(id, title);
                    try {
                        const session = await repository.renameSession(id, title);
                        deps.onSessionUpdated?.(session);
                        return session;
                    } catch (err) {
                        if (deps.renameNativeSession) {
                            try {
                                await deps.renameNativeSession(id, previous.title);
                            } catch (rollbackErr) {
                                log.warn("[sessions.ipc] native rename rollback failed:", id, rollbackErr);
                            }
                        }
                        throw err;
                    }
                } catch (err) {
                    log.error("[sessions.ipc] session:rename failed:", err);
                    return ipcError(
                        "ipcErrors.session.renameFailed",
                        `重命名会话失败: ${err instanceof Error ? err.message : String(err)}`,
                        { id },
                    );
                }
            });
        },
    );

    ipcMain.handle("session:delete", async (_event, id: string) => {
        return withSessionLock(id, async () => {
            try {
                const deletedSession = await repository.getSession(id);
                await repository.deleteSession(id);
                deps.onSessionDeleted?.(id, deletedSession?.workspaceId);
                try {
                    await deps.deleteNativeSession?.(id);
                } catch (err) {
                    log.warn("[sessions.ipc] session:delete native file cleanup failed:", id, err);
                }
                try {
                    await deps.attachmentStore?.deleteSessionAttachments(id);
                } catch (err) {
                    log.warn("[sessions.ipc] session:delete attachment cleanup failed:", id, err);
                }
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
    });

    ipcMain.handle("session:save-attachments", async (_event, raw: unknown) => {
        const parsed = saveAttachmentsSchema.safeParse(raw);
        if (!parsed.success) {
            return ipcError("ipcErrors.session.saveAttachmentsInvalid", "无效的附件参数");
        }
        if (!deps.attachmentStore) {
            return ipcError("ipcErrors.session.attachmentsUnavailable", "附件存储不可用");
        }
        try {
            const attachments = await deps.attachmentStore.saveImages(parsed.data.sessionId, parsed.data.images);
            if (parsed.data.messageId) {
                await repository.updateMessage(parsed.data.sessionId, parsed.data.messageId, { attachments });
            }
            return { attachments };
        } catch (err) {
            log.error("[sessions.ipc] session:save-attachments failed:", err);
            return ipcError(
                "ipcErrors.session.saveAttachmentsFailed",
                err instanceof Error ? err.message : String(err),
            );
        }
    });

    ipcMain.handle("session:get-attachment", async (_event, raw: unknown) => {
        const parsed = getAttachmentSchema.safeParse(raw);
        if (!parsed.success) {
            return ipcError("ipcErrors.session.getAttachmentInvalid", "无效的附件读取参数");
        }
        if (!deps.attachmentStore) {
            return ipcError("ipcErrors.session.attachmentsUnavailable", "附件存储不可用");
        }
        try {
            const dataUrl = await deps.attachmentStore.readAsDataUrl(parsed.data.sessionId, parsed.data.storageKey);
            return { dataUrl };
        } catch (err) {
            log.error("[sessions.ipc] session:get-attachment failed:", err);
            return ipcError(
                "ipcErrors.session.getAttachmentFailed",
                err instanceof Error ? err.message : String(err),
            );
        }
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
