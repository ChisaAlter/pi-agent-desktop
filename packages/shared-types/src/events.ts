// Pi RPC 事件类型 (从 @earendil-works/pi-coding-agent 文档反推)
// 完整列表见 node_modules/@earendil-works/pi-coding-agent/docs/rpc.md §Events

export type PiEventType =
    | "agent_start"
    | "agent_end"
    | "turn_start"
    | "turn_end"
    | "message_start"
    | "message_update"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_update"
    | "tool_execution_end"
    | "queue_update"
    | "compaction_start"
    | "compaction_end"
    | "auto_retry_start"
    | "auto_retry_end"
    | "extension_error";

/** message_update 时的子类型 (assistantMessageEvent.type) */
export type MessageUpdateSubtype =
    | "start"
    | "text_start"
    | "text_delta"
    | "text_end"
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | "done"
    | "error";

export interface PiMessageUpdateTextDelta {
    type: "message_update";
    subtype: "text_delta";
    delta: string;
}

export interface PiMessageUpdateThinkingDelta {
    type: "message_update";
    subtype: "thinking_delta";
    delta: string;
}

export interface PiMessageUpdateToolStart {
    type: "message_update";
    subtype: "toolcall_start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface PiMessageUpdateToolEnd {
    type: "message_update";
    subtype: "toolcall_end";
    toolCallId: string;
    toolName: string;
    result?: unknown;
}

export type PiTextDeltaEvent = PiMessageUpdateTextDelta;
export type PiThinkingDeltaEvent = PiMessageUpdateThinkingDelta;
export type PiToolStartEvent = PiMessageUpdateToolStart;
export type PiToolEndEvent = PiMessageUpdateToolEnd;

export interface PiToolExecutionStart {
    type: "tool_execution_start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface PiToolExecutionUpdate {
    type: "tool_execution_update";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    partialResult?: unknown;
}

export interface PiToolExecutionEnd {
    type: "tool_execution_end";
    toolCallId: string;
    toolName: string;
    result?: unknown;
    isError: boolean;
}

export interface PiTurnEnd {
    type: "turn_end";
}

export interface PiAgentEnd {
    type: "agent_end";
    messages?: unknown[];
}

export interface PiQueueUpdate {
    type: "queue_update";
    steering: readonly string[];
    followUp: readonly string[];
}

/** Pi 事件的 union 类型 (M1 关心的子集) */
export type PiEvent =
    | { type: "agent_start" }
    | PiAgentEnd
    | { type: "turn_start" }
    | PiTurnEnd
    | { type: "message_start" }
    | PiTextDeltaEvent
    | PiThinkingDeltaEvent
    | PiToolStartEvent
    | PiToolEndEvent
    | { type: "message_end" }
    | PiToolExecutionStart
    | PiToolExecutionUpdate
    | PiToolExecutionEnd
    | PiQueueUpdate
    | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
    | { type: "compaction_end" }
    | { type: "auto_retry_start" }
    | { type: "auto_retry_end" }
    | { type: "extension_error" };
