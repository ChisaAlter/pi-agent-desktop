// EventBridge (M1 Task 8)
// 转换 Pi 原生事件 → renderer 友好的简化事件
// Pi 事件文档: node_modules/@earendil-works/pi-coding-agent/docs/rpc.md

import type { PiEvent } from "@shared/events";

export type IpcSender = (channel: string, workspaceId: string, payload: unknown) => void;

export function createEventBridge(workspaceId: string, send: IpcSender) {
    return {
        handleEvent(event: PiEvent) {
            switch (event.type) {
                case "agent_start":
                case "message_start":
                case "message_update":
                case "message_end":
                case "tool_execution_start":
                case "tool_execution_end":
                case "turn_end":
                case "agent_end":
                case "extension_error":
                    send("pi:event", workspaceId, event);
                    break;

                default:
                    // 未知事件忽略 (queue_update, compaction_*, auto_retry_*, extension_error)
                    break;
            }
        },
    };
}
