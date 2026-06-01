// Shared Types for Pi Desktop

export * from "./events";
export * from "./approval";

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

// Pi Driver 状态
export interface PiStatus {
  installed: boolean;
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  executablePath: string | null;
  installMethod: string;
  configExists: boolean;
  defaultProvider: string | null;
  defaultModel: string | null;
}

export interface PiInstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error';
  message: string;
  percent?: number;
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
