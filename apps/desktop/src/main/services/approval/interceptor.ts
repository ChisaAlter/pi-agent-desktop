// Approval Interceptor
// Intercepts session events, decides whether to show approval, calls session.abort() on reject
// Known limitation: abort kills entire turn (not single tool). Future: Pi extension for per-tool control
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

function asToolStart(e: PiEvent): PiToolExecutionStart | null {
    return e.type === "tool_execution_start" ? e : null;
}
function asToolEnd(e: PiEvent): PiToolExecutionEnd | null {
    return e.type === "tool_execution_end" ? e : null;
}

export function createApprovalInterceptor(workspaceId: string, deps: InterceptorDeps): ApprovalInterceptor {
    return {
        async handleEvent(event: PiEvent) {
            if (!event || typeof event !== "object") return;

            const start = asToolStart(event);
            if (start) {
                const { toolName, args, toolCallId } = start;
                if (!toolName) return;
                const safeArgs: Record<string, unknown> =
                    (args as Record<string, unknown> | undefined) ?? {};
                if (deps.getMode?.() === "plan" && !isPlanModeToolAllowed({
                    toolName,
                    args: safeArgs,
                    workspacePath: deps.workspacePath,
                })) {
                    deps.abort();
                    deps.send("permission:update", workspaceId, {
                        type: "error",
                        message: `Plan 模式禁止执行 ${toolName}。请先完成计划并切换到 Build 模式，或仅写入 .pi/plans/*.md。`,
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
                    const changeId = deps.pendingEdits.track(
                        toolCallId,
                        toolName as "write" | "edit",
                        filePath,
                        {
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

                const oldContent = change.newContent ?? "";
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
