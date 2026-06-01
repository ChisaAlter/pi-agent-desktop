// Approval Interceptor (M1 Task 7)
// 拦截 session 事件, 决定要不要发审批, 拒绝时调 session.abort()
// 已知限制: abort 杀整个 turn, 不能单工具. M3+ 可升级为真 Pi 扩展.

import type { RiskLevel } from "@shared/approval";
import { classifyToolCall } from "./classifier";
import { requestApproval } from "./approval-bridge";
import { readFile } from "fs/promises";
import { join } from "path";
import type { PendingEdits } from "./pending-edits";

export interface InterceptorDeps {
    abort: () => void;
    pendingEdits: PendingEdits;
    send: (channel: string, workspaceId: string, payload: unknown) => void;
    workspacePath: string;
}

export interface ApprovalInterceptor {
    handleEvent: (event: any) => Promise<void>;
}

export function createApprovalInterceptor(workspaceId: string, deps: InterceptorDeps): ApprovalInterceptor {
    return {
        async handleEvent(event: any) {
            if (!event || typeof event !== "object") return;

            if (event.type === "tool_execution_start") {
                const { toolName, args, toolCallId } = event;
                if (!toolName) return;

                const c = classifyToolCall({ name: toolName, args: args ?? {} });
                if (c.risk === "read") return;

                if (c.risk === "high") {
                    const approved = await requestApproval({
                        method: "confirm",
                        title: `⚠️ 允许执行高危工具: ${toolName}?`,
                        message: c.preview,
                    });
                    if (!approved) {
                        deps.abort();
                    }
                    return;
                }

                if (c.risk === "edit") {
                    const filePath = String(
                        args.file_path ?? args.path ?? args.filePath ?? ""
                    );
                    if (!filePath) return;
                    const changeId = deps.pendingEdits.track(
                        toolCallId,
                        toolName as "write" | "edit",
                        filePath,
                        {
                            content: args.content ?? args.file_text,
                            old_string: args.old_string ?? args.oldString,
                            new_string: args.new_string ?? args.newString,
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

            if (event.type === "tool_execution_end") {
                const { toolName, toolCallId } = event;
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
