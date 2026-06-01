// EventBridge (M1 Task 8)
// 转换 Pi 原生事件 → renderer 友好的简化事件
// Pi 事件文档: node_modules/@earendil-works/pi-coding-agent/docs/rpc.md

import type { PiEvent } from "@shared/events";

export type IpcSender = (channel: string, workspaceId: string, payload: unknown) => void;

export function createEventBridge(workspaceId: string, send: IpcSender) {
    return {
        handleEvent(event: PiEvent) {
            switch (event.type) {
                case "message_update":
                    if (event.subtype === "text_delta") {
                        send("pi:event", workspaceId, { type: "text_delta", text: event.delta });
                    } else if (event.subtype === "thinking_delta") {
                        send("pi:event", workspaceId, { type: "thinking_delta", text: event.delta });
                    } else if (event.subtype === "toolcall_start") {
                        send("pi:event", workspaceId, {
                            type: "toolcall_start",
                            id: event.toolCallId,
                            tool: event.toolName,
                            input: event.args,
                        });
                    } else if (event.subtype === "toolcall_end") {
                        send("pi:event", workspaceId, {
                            type: "toolcall_end",
                            id: event.toolCallId,
                            tool: event.toolName,
                            result: event.result,
                        });
                    }
                    break;

                case "tool_execution_start":
                    send("pi:event", workspaceId, {
                        type: "toolcall_start",
                        id: event.toolCallId,
                        tool: event.toolName,
                        input: event.args,
                    });
                    break;

                case "tool_execution_end":
                    send("pi:event", workspaceId, {
                        type: "toolcall_end",
                        id: event.toolCallId,
                        tool: event.toolName,
                        result: event.result,
                    });
                    break;

                case "turn_end":
                    send("pi:event", workspaceId, { type: "turn_end" });
                    break;

                case "agent_end":
                    send("pi:event", workspaceId, { type: "agent_end" });
                    break;

                default:
                    // 未知事件忽略 (queue_update, compaction_*, auto_retry_*, extension_error)
                    break;
            }
        },
    };
}
