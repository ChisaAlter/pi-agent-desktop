// Pi CLI JSON Event Types
// These represent the structured JSONL event stream from `pi --mode json`

// ── Assistant Message Sub-Events ─────────────────────────────────────

export interface PiThinkingStartEvent {
  type: 'thinking_start';
  contentIndex?: number;
}

export interface PiThinkingDeltaEvent {
  type: 'thinking_delta';
  contentIndex?: number;
  delta?: string;
  partial?: Record<string, unknown>;
}

export interface PiThinkingEndEvent {
  type: 'thinking_end';
  contentIndex?: number;
}

export interface PiTextStartEvent {
  type: 'text_start';
  contentIndex?: number;
}

export interface PiTextDeltaEvent {
  type: 'text_delta';
  contentIndex?: number;
  delta?: string;
  partial?: Record<string, unknown>;
}

export interface PiToolcallStartEvent {
  type: 'toolcall_start';
  contentIndex?: number;
}

export interface PiToolcallDeltaEvent {
  type: 'toolcall_delta';
  contentIndex?: number;
  delta?: string;
  partial?: Record<string, unknown>;
}

export interface PiToolcallEndEvent {
  type: 'toolcall_end';
  contentIndex?: number;
}

export type PiAssistantMessageEventType =
  | PiThinkingStartEvent
  | PiThinkingDeltaEvent
  | PiThinkingEndEvent
  | PiTextStartEvent
  | PiTextDeltaEvent
  | PiToolcallStartEvent
  | PiToolcallDeltaEvent
  | PiToolcallEndEvent;

// ── Message Content Block ────────────────────────────────────────────

export interface PiMessageContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

// ── Usage Info ───────────────────────────────────────────────────────

export interface PiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

// ── Message Object (shared across events) ────────────────────────────

export interface PiMessage {
  role: 'user' | 'assistant' | 'system';
  content: PiMessageContentBlock[];
  model?: string;
  usage?: PiUsage;
  [key: string]: unknown;
}

// ── Top-Level Events ─────────────────────────────────────────────────

export interface PiSessionEvent {
  type: 'session';
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

export interface PiAgentStartEvent {
  type: 'agent_start';
}

export interface PiTurnStartEvent {
  type: 'turn_start';
}

export interface PiMessageStartEvent {
  type: 'message_start';
  message: PiMessage;
}

export interface PiMessageUpdateEvent {
  type: 'message_update';
  assistantMessageEvent: PiAssistantMessageEventType;
  message: PiMessage;
}

export interface PiMessageEndEvent {
  type: 'message_end';
  message: PiMessage;
}

export interface PiToolExecutionStartEvent {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface PiToolExecutionEndEvent {
  type: 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  result: {
    content: PiMessageContentBlock[];
    isError: boolean;
  };
}

export interface PiTurnEndEvent {
  type: 'turn_end';
  message?: PiMessage;
  toolResults?: Array<{
    toolCallId: string;
    result: unknown;
  }>;
}

// ── Union Type ───────────────────────────────────────────────────────

export type PiEvent =
  | PiSessionEvent
  | PiAgentStartEvent
  | PiTurnStartEvent
  | PiTurnEndEvent
  | PiMessageStartEvent
  | PiMessageUpdateEvent
  | PiMessageEndEvent
  | PiToolExecutionStartEvent
  | PiToolExecutionEndEvent;
