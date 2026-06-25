// Approval Interceptor
// Intercepts session events for plan-mode write blocking and post-edit review telemetry.
// High-risk runtime permissions are now owned by pi-permission-system, not this interceptor.
// Event types use @shared/events PiEvent

import { classifyToolCall } from "./classifier";
import { readFile } from "fs/promises";
import { join } from "path";
import type { PiEvent, PiToolExecutionStart, PiToolExecutionEnd } from "@shared/events";
import type { PendingEdits } from "./pending-edits";
import type { AgentMode } from "@shared";
import { isPlanModeToolAllowed } from "../agent-modes";

export interface InterceptorDeps {
    abort: () => void;
    pendingEdits: PendingEdits;
    send: (channel: string, workspaceId: string, payload: unknown) => void;
    workspacePath: string;
    getMode?: () => AgentMode;
}

export interface ApprovalInterceptor {
    handleEvent: (event: PiEvent) => Promise<void>;
}

interface ToolCallArgs {
    toolCallId: string;
    args: Record<string, unknown>;
}

function asToolStart(e: PiEvent): PiToolExecutionStart | null {
    return e.type === "tool_execution_start" ? e : null;
}
function asToolEnd(e: PiEvent): PiToolExecutionEnd | null {
    return e.type === "tool_execution_end" ? e : null;
}

export function createApprovalInterceptor(workspaceId: string, deps: InterceptorDeps): ApprovalInterceptor {
    const announcedToolArgs = new Map<string, Record<string, unknown>>();

    return {
        async handleEvent(event: PiEvent) {
            if (!event || typeof event !== "object") return;

            const announced = asToolCallArgs(event);
            if (announced) announcedToolArgs.set(announced.toolCallId, announced.args);

            const start = asToolStart(event);
            if (start) {
                const { toolName, toolCallId } = start;
                if (!toolName) return;
                const eventArgs = extractToolStartArgs(start);
                const cachedArgs = announcedToolArgs.get(toolCallId);
                const safeArgs: Record<string, unknown> =
                    hasMeaningfulArgs(eventArgs) ? eventArgs : cachedArgs ?? eventArgs ?? {};
                if (deps.getMode?.() === "plan" && !isPlanModeToolAllowed({
                    toolName,
                    args: safeArgs,
                    workspacePath: deps.workspacePath,
                })) {
                    const message = `Plan 模式禁止执行 ${toolName}。请先完成计划并切换到 Build 模式，或仅写入 .pi/plans/*.md。`;
                    deps.abort();
                    deps.send("pi:event", workspaceId, {
                        type: "extension_error",
                        message,
                        workspaceId,
                        toolCallId,
                    });
                    return;
                }
                const c = classifyToolCall({ name: toolName, args: safeArgs });
                if (c.risk === "read") return;

                if (c.risk === "high") {
                    // Runtime permission decisions are handled by pi-permission-system.
                    // This interceptor now only keeps post-edit diff/review telemetry.
                    return;
                }

                if (c.risk === "edit") {
                    const filePath = String(
                        safeArgs.file_path ?? safeArgs.path ?? safeArgs.filePath ?? ""
                    );
                    if (!filePath) return;
                    // autoApprove 时跳过 deferred 编辑追踪 (用户已选择自动批准)
                    if (deps.pendingEdits.autoApprove) return;
                    let oldContent: string | undefined;
                    try {
                        const absPath = join(deps.workspacePath, filePath);
                        oldContent = await readFile(absPath, "utf-8");
                    } catch {
                        // 目标文件可能尚不存在(新建文件)；review 时按空基线处理即可
                    }
                    const changeId = deps.pendingEdits.track(
                        toolCallId,
                        toolName as "write" | "edit",
                        filePath,
                        {
                            oldContent,
                            content: typeof safeArgs.content === "string" ? safeArgs.content
                                : typeof safeArgs.file_text === "string" ? safeArgs.file_text
                                : undefined,
                            old_string: typeof safeArgs.old_string === "string" ? safeArgs.old_string
                                : typeof safeArgs.oldString === "string" ? safeArgs.oldString
                                : undefined,
                            new_string: typeof safeArgs.new_string === "string" ? safeArgs.new_string
                                : typeof safeArgs.newString === "string" ? safeArgs.newString
                                : undefined,
                        }
                    );
                    deps.send("approval:deferred", workspaceId, {
                        changeId,
                        toolCallId,
                        filePath,
                        op: toolName,
                        timestamp: Date.now(),
                    });
                    return;
                }
            }

            const end = asToolEnd(event);
            if (end) {
                const { toolName, toolCallId } = end;
                // turn 结束前每个 tool_execution_end 都清理对应缓存, 防止 announcedToolArgs 无界增长
                announcedToolArgs.delete(toolCallId);
                if (toolName !== "write" && toolName !== "edit") return;
                const change = deps.pendingEdits.list().find((c) => c.toolCallId === toolCallId);
                if (!change) return;

                let newContent = "";
                try {
                    const absPath = join(deps.workspacePath, change.filePath);
                    newContent = await readFile(absPath, "utf-8");
                } catch {
                    // 文件可能不存在 (新建失败), 用空
                }

                const oldContent = change.oldContent ?? "";
                const diff = generateUnifiedDiff(oldContent, newContent, change.filePath);
                deps.pendingEdits.review(change.id, diff, newContent);
                deps.send("approval:review", workspaceId, {
                    changeId: change.id,
                    toolCallId,
                    filePath: change.filePath,
                    diff,
                    newContent,
                    timestamp: Date.now(),
                });
            }
        },
    };
}

function asToolCallArgs(event: PiEvent): ToolCallArgs | null {
    if (event.type !== "message_update") return null;
    const eventRecord = event as unknown as Record<string, unknown>;
    const payload = isRecord(eventRecord.assistantMessageEvent)
        ? eventRecord.assistantMessageEvent
        : eventRecord.subtype === "toolcall_start"
            ? eventRecord
            : null;
    if (!payload) return null;
    const payloadType = payload.type ?? payload.subtype;
    if (payloadType !== "toolcall_start") return null;
    if (typeof payload.toolCallId !== "string") return null;
    const args = extractToolArgs(payload) ?? {};
    return { toolCallId: payload.toolCallId, args };
}

function extractToolStartArgs(start: PiToolExecutionStart): Record<string, unknown> | undefined {
    const startRecord = start as unknown as Record<string, unknown>;
    for (const key of ["args", "input", "arguments", "parameters", "params", "toolInput", "tool_input"]) {
        const args = extractToolArgs(startRecord[key]);
        if (args) return args;
    }
    return undefined;
}

function extractToolArgs(value: unknown, depth = 0): Record<string, unknown> | undefined {
    if (depth > 3) return undefined;
    if (!value) return undefined;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
        try {
            return extractToolArgs(JSON.parse(trimmed), depth + 1);
        } catch {
            return undefined;
        }
    }
    if (!isRecord(value)) return undefined;

    const record = value;
    if (hasToolArgFields(record)) return record;

    for (const key of ["args", "input", "arguments", "parameters", "params", "toolInput", "tool_input"]) {
        const nested = extractToolArgs(record[key], depth + 1);
        if (nested && (hasToolArgFields(nested) || Object.keys(nested).length > 0)) return nested;
    }

    return record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasMeaningfulArgs(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
    return !!value && Object.keys(value).length > 0;
}

function hasToolArgFields(value: Record<string, unknown>): boolean {
    return [
        "command",
        "cmd",
        "script",
        "file_path",
        "path",
        "filePath",
        "relative_path",
        "relativePath",
        "content",
        "old_string",
        "oldString",
        "new_string",
        "newString",
    ].some((key) => key in value);
}

/** 简单行 diff (M1 简版) */
export function generateUnifiedDiff(oldStr: string, newStr: string, filePath: string): string {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    let diff = `--- a/${fileName}\n+++ b/${fileName}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
        if (i >= oldLines.length) diff += `+${newLines[i]}\n`;
        else if (i >= newLines.length) diff += `-${oldLines[i]}\n`;
        else if (oldLines[i] !== newLines[i]) {
            diff += `-${oldLines[i]}\n+${newLines[i]}\n`;
        } else {
            diff += ` ${oldLines[i]}\n`;
        }
    }
    return diff;
}
