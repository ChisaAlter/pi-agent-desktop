// Frontend Type Definitions

export interface PiAPI {
  sendPrompt: (message: string, sessionId?: string) => Promise<void>;
  onEvent: (callback: (event: PiEvent) => void) => (() => void) | undefined;
  onError: (callback: (error: string) => void) => (() => void) | undefined;
  getStatus: () => Promise<PiDriverStatus>;
  stop: () => Promise<void>;
  // Workspace
  listWorkspaces: () => Promise<WorkspaceData[]>;
  createWorkspace: (name: string, path: string) => Promise<WorkspaceData>;
  deleteWorkspace: (id: string) => Promise<void>;
  selectWorkspace: (path: string) => Promise<void>;
  selectDirectory: () => Promise<string | null>;
  // Session
  listSessions: () => Promise<SessionData[]>;
  createSession: (workspaceId: string, title?: string) => Promise<SessionData>;
  deleteSession: (id: string) => Promise<void>;
  // Git
  getGitStatus: (workspacePath: string) => Promise<GitStatusData | null>;
  // Settings
  getSettings: () => Promise<AppSettingsData>;
  setSettings: (settings: Partial<AppSettingsData>) => Promise<AppSettingsData>;
  // Pi Config
  loadPiConfig: () => Promise<PiConfigData>;
  // Skills & Plugins
  listSkills: () => Promise<SkillData[]>;
  listPlugins: () => Promise<PluginData[]>;
  getFullConfig: () => Promise<PiFullConfigData>;
}

export interface PiModelData {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  description: string;
  maxTokens?: number;
}

export interface PiConfigData {
  models: PiModelData[];
  currentModel?: {
    model: string;
    provider: string;
  } | null;
}

export interface NodeAPI {
  platform: string;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
}

export interface PiDriverStatus {
  isRunning: boolean;
  pid?: number;
  workspacePath: string;
}

export type PiEvent =
  | { type: 'text_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'toolcall_start'; tool: string; input: any }
  | { type: 'toolcall_end'; tool: string; result: any }
  | { type: 'turn_end' }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; code: number | null };

export interface WorkspaceData {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface SessionData {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
}

export interface GitStatusData {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface AppSettingsData {
  theme: 'dark' | 'light';
  fontSize: number;
  model: string;
  provider: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  autoSave: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
}

export interface SkillData {
  name: string;
  description?: string;
  path: string;
  enabled: boolean;
}

export interface PluginData {
  name: string;
  description?: string;
  version?: string;
  enabled: boolean;
  type: 'provider' | 'extension' | 'tool';
}

export interface PiFullConfigData {
  configPath: string;
  defaultProvider: string;
  defaultModel: string;
  providers: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    modelCount: number;
    hasApiKey: boolean;
  }>;
}

// Extend Window interface
declare global {
  interface Window {
    piAPI: PiAPI;
    nodeAPI: NodeAPI;
  }
}