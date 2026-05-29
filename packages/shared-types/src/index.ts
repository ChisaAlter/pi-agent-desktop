// Shared Types for Pi Desktop

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastActiveAt?: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string | Date;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  args?: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: Date;
  endTime?: Date;
}

export interface PiConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  fontSize: number;
  model: string;
  provider: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  autoSave: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
  language?: string;
  piConfig?: PiConfig;
}

// Pi event types for IPC communication
export type PiEventType = 'text_start' | 'text_delta' | 'turn_end' | 'error' | 'toolcall_start' | 'toolcall_end';

export interface PiEvent {
  type: PiEventType;
  text?: string;
  message?: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
}
