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
    | "usage_update"
    | "context_update"
    | "custom_message"
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

export interface PiAssistantMessageTextDelta {
    type: "text_delta";
    delta: string;
}

export interface PiAssistantMessageThinkingDelta {
    type: "thinking_delta";
    delta: string;
}

export interface PiAssistantMessageToolStart {
    type: "toolcall_start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface PiAssistantMessageToolEnd {
    type: "toolcall_end";
    toolCallId: string;
    toolName?: string;
    result?: unknown;
}

export type PiAssistantMessageEvent =
    | PiAssistantMessageTextDelta
    | PiAssistantMessageThinkingDelta
    | PiAssistantMessageToolStart
    | PiAssistantMessageToolEnd
    | { type: Exclude<MessageUpdateSubtype, "text_delta" | "thinking_delta" | "toolcall_start" | "toolcall_end">; [key: string]: unknown };

export interface PiMessageUpdateSdk {
    type: "message_update";
    message?: unknown;
    assistantMessageEvent: PiAssistantMessageEvent;
}

// Legacy flattened shape kept for older adapters/tests.
// 以下扁平事件类型为 pre-v1.0 形状 (PiMessageUpdateSdk 出现前), 仅旧适配器/测试在用.
// 新代码请走 PiMessageUpdateSdk + PiAssistantMessageEvent (见上方).

/** @deprecated since v1.0, removed in v1.3. 用 PiMessageUpdateSdk + PiAssistantMessageEvent (type:"text_delta") 替代. */
export interface PiMessageUpdateTextDelta {
    type: "message_update";
    subtype: "text_delta";
    delta: string;
}

/** @deprecated since v1.0, removed in v1.3. 用 PiMessageUpdateSdk + PiAssistantMessageEvent (type:"thinking_delta") 替代. */
export interface PiMessageUpdateThinkingDelta {
    type: "message_update";
    subtype: "thinking_delta";
    delta: string;
}

/** @deprecated since v1.0, removed in v1.3. 用 PiMessageUpdateSdk + PiAssistantMessageEvent (type:"toolcall_start") 替代. */
export interface PiMessageUpdateToolStart {
    type: "message_update";
    subtype: "toolcall_start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

/** @deprecated since v1.0, removed in v1.3. 用 PiMessageUpdateSdk + PiAssistantMessageEvent (type:"toolcall_end") 替代. */
export interface PiMessageUpdateToolEnd {
    type: "message_update";
    subtype: "toolcall_end";
    toolCallId: string;
    toolName: string;
    result?: unknown;
}

/** @deprecated since v1.0, removed in v1.3. 见 PiMessageUpdateTextDelta. */
export type PiTextDeltaEvent = PiMessageUpdateTextDelta;
/** @deprecated since v1.0, removed in v1.3. 见 PiMessageUpdateThinkingDelta. */
export type PiThinkingDeltaEvent = PiMessageUpdateThinkingDelta;
/** @deprecated since v1.0, removed in v1.3. 见 PiMessageUpdateToolStart. */
export type PiToolStartEvent = PiMessageUpdateToolStart;
/** @deprecated since v1.0, removed in v1.3. 见 PiMessageUpdateToolEnd. */
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
    | PiMessageUpdateSdk
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
    | { type: "usage_update"; [key: string]: unknown }
    | { type: "context_update"; [key: string]: unknown }
    | { type: "custom_message"; [key: string]: unknown }
    | { type: "extension_error" };
