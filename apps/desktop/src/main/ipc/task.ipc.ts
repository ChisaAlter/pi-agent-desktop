// Task IPC Handler (Phase B Task 4)
// 暴露 9 个 task 通道给渲染层,委托 TaskRegistry 操作 SQLite:
//   - task:create   → TaskRegistry.create(sessionId, input)
//   - task:list     → TaskRegistry.list(sessionId, options)
//   - task:get      → TaskRegistry.get(sessionId, id)
//   - task:start    → TaskRegistry.start(sessionId, id, options)
//   - task:block    → TaskRegistry.block(sessionId, id, options)
//   - task:unblock  → TaskRegistry.unblock(sessionId, id, options)
//   - task:done     → TaskRegistry.done(sessionId, id, options)
//   - task:abandon  → TaskRegistry.abandon(sessionId, id, options)
//   - task:rename   → TaskRegistry.rename(sessionId, id, input)
//
// 错误处理 (与 plan.ipc / chat.ipc 风格一致):
//   - workspace 无对应 session → ipcError("ipcErrors.task.sessionNotFound", ..., { id })
//   - Zod 校验失败             → ipcError("ipcErrors.task.invalidInput", ...)
//   - TaskRegistry 抛 not found → ipcError("ipcErrors.task.notFound", ..., { id })
//   - TaskRegistry 抛状态错误   → ipcError("ipcErrors.task.invalidState", ..., { id, status? })
//   - 其它内部错误             → ipcError("ipcErrors.task.failed", ...)
//
// 不抛异常,所有错误都返回 IpcError 形状由渲染层 isIpcError() 识别.

import { ipcMain } from "electron";
import log from "electron-log/main";
import type { ZodError } from "zod";
import { ipcError, type IpcError } from "@shared";
import type { TaskRegistry } from "../services/long-horizon/task-registry";
import {
    TaskAbandonSchema,
    TaskBlockSchema,
    TaskCreateSchema,
    TaskDoneSchema,
    TaskGetSchema,
    TaskListSchema,
    TaskRenameSchema,
    TaskStartSchema,
    TaskUnblockSchema,
} from "./schemas";

export interface TaskIpcDeps {
    /** TaskRegistry 实例 (主进程单例, 由 main/index.ts 注入). */
    taskRegistry: TaskRegistry;
    /**
     * Legacy workspace-only resolver. It remains the fallback for callers that
     * have not yet supplied an explicit sessionId.
     */
    getWorkspaceSessionId: (workspaceId: string) => string | null;
    /** Optional validation/resolution for explicit session identities. */
    resolveSessionId?: (workspaceId: string, sessionId: string) => string | null | Promise<string | null>;
}

async function resolveTaskSessionId(
    deps: TaskIpcDeps,
    workspaceId: string,
    explicitSessionId?: string,
): Promise<string | null> {
    if (explicitSessionId) {
        return deps.resolveSessionId
            ? await deps.resolveSessionId(workspaceId, explicitSessionId)
            : explicitSessionId;
    }
    return deps.getWorkspaceSessionId(workspaceId);
}

function invalidInput(err: ZodError | Error): IpcError {
    return ipcError(
        "ipcErrors.task.invalidInput",
        `task 入参无效: ${err instanceof Error ? err.message : String(err)}`,
    );
}

/**
 * 把 TaskRegistry 抛出的 Error 分类为对应的 IpcError.
 *  - message 含 "not found"     → notFound
 *  - message 含 "terminal state" / "not blocked" → invalidState
 *  - 其它                       → failed
 */
function classifyRegistryError(err: unknown, taskId?: string): IpcError {
    const message = err instanceof Error ? err.message : String(err);
    const params: Record<string, string | number | boolean> = {};
    if (taskId) params.id = taskId;
    if (/not found/i.test(message)) {
        return ipcError(
            "ipcErrors.task.notFound",
            `Task 不存在: ${message}`,
            params,
        );
    }
    if (/terminal state|not blocked/i.test(message)) {
        return ipcError(
            "ipcErrors.task.invalidState",
            `Task 状态非法: ${message}`,
            params,
        );
    }
    return ipcError(
        "ipcErrors.task.failed",
        `Task 操作失败: ${message}`,
        params,
    );
}

export function setupTaskIpc(deps: TaskIpcDeps): void {
    // ── task:create ───────────────────────────────────────────────
    ipcMain.handle("task:create", async (_event, input: unknown) => {
        let parsed: {
            workspaceId: string;
            sessionId?: string;
            summary: string;
            parentId?: string;
            owner?: string;
        };
        try {
            parsed = TaskCreateSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:create invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.create({
                sessionId,
                summary: parsed.summary,
                parentId: parsed.parentId,
                owner: parsed.owner,
            });
        } catch (err) {
            log.error("[task.ipc] task:create failed:", err);
            return classifyRegistryError(err);
        }
    });

    // ── task:list ─────────────────────────────────────────────────
    ipcMain.handle("task:list", async (_event, input: unknown) => {
        let parsed: {
            workspaceId: string;
            sessionId?: string;
            status?: "open" | "in_progress" | "blocked" | "done" | "abandoned";
            includeTerminal?: boolean;
            includeArchived?: boolean;
        };
        try {
            parsed = TaskListSchema.parse(input ?? {});
        } catch (err) {
            log.warn("[task.ipc] task:list invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.list({
                sessionId,
                status: parsed.status,
                includeTerminal: parsed.includeTerminal,
                includeArchived: parsed.includeArchived,
            });
        } catch (err) {
            log.error("[task.ipc] task:list failed:", err);
            return classifyRegistryError(err);
        }
    });

    // ── task:get ──────────────────────────────────────────────────
    ipcMain.handle("task:get", async (_event, input: unknown) => {
        let parsed: { workspaceId: string; sessionId?: string; id: string };
        try {
            parsed = TaskGetSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:get invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            // registry.get 返回 null 表示 task 不存在 — 透传给渲染层 (null 是合法值,非错误).
            return await deps.taskRegistry.get(sessionId, parsed.id);
        } catch (err) {
            log.error("[task.ipc] task:get failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });

    // ── task:start ────────────────────────────────────────────────
    ipcMain.handle("task:start", async (_event, input: unknown) => {
        let parsed: {
            workspaceId: string;
            sessionId?: string;
            id: string;
            owner?: string;
            eventSummary?: string;
        };
        try {
            parsed = TaskStartSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:start invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.start({
                sessionId,
                id: parsed.id,
                owner: parsed.owner,
                eventSummary: parsed.eventSummary,
            });
        } catch (err) {
            log.error("[task.ipc] task:start failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });

    // ── task:block ────────────────────────────────────────────────
    ipcMain.handle("task:block", async (_event, input: unknown) => {
        let parsed: { workspaceId: string; sessionId?: string; id: string; eventSummary?: string };
        try {
            parsed = TaskBlockSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:block invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.block({
                sessionId,
                id: parsed.id,
                eventSummary: parsed.eventSummary,
            });
        } catch (err) {
            log.error("[task.ipc] task:block failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });

    // ── task:unblock ─────────────────────────────────────────────
    ipcMain.handle("task:unblock", async (_event, input: unknown) => {
        let parsed: { workspaceId: string; sessionId?: string; id: string; eventSummary?: string };
        try {
            parsed = TaskUnblockSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:unblock invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.unblock({
                sessionId,
                id: parsed.id,
                eventSummary: parsed.eventSummary,
            });
        } catch (err) {
            log.error("[task.ipc] task:unblock failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });

    // ── task:done ─────────────────────────────────────────────────
    ipcMain.handle("task:done", async (_event, input: unknown) => {
        let parsed: { workspaceId: string; sessionId?: string; id: string; eventSummary?: string };
        try {
            parsed = TaskDoneSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:done invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.done({
                sessionId,
                id: parsed.id,
                eventSummary: parsed.eventSummary,
            });
        } catch (err) {
            log.error("[task.ipc] task:done failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });

    // ── task:abandon ─────────────────────────────────────────────
    ipcMain.handle("task:abandon", async (_event, input: unknown) => {
        let parsed: { workspaceId: string; sessionId?: string; id: string; eventSummary?: string };
        try {
            parsed = TaskAbandonSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:abandon invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.abandon({
                sessionId,
                id: parsed.id,
                eventSummary: parsed.eventSummary,
            });
        } catch (err) {
            log.error("[task.ipc] task:abandon failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });

    // ── task:rename ───────────────────────────────────────────────
    ipcMain.handle("task:rename", async (_event, input: unknown) => {
        let parsed: { workspaceId: string; sessionId?: string; id: string; summary: string };
        try {
            parsed = TaskRenameSchema.parse(input);
        } catch (err) {
            log.warn("[task.ipc] task:rename invalid input:", err);
            return invalidInput(err as ZodError);
        }
        const sessionId = await resolveTaskSessionId(deps, parsed.workspaceId, parsed.sessionId);
        if (!sessionId) {
            return ipcError(
                "ipcErrors.task.sessionNotFound",
                `Workspace 无对应 session: ${parsed.workspaceId}`,
                { id: parsed.workspaceId },
            );
        }
        try {
            return await deps.taskRegistry.rename({
                sessionId,
                id: parsed.id,
                summary: parsed.summary,
            });
        } catch (err) {
            log.error("[task.ipc] task:rename failed:", err);
            return classifyRegistryError(err, parsed.id);
        }
    });
}
