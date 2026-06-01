// Frontend Type Definitions

// PiEvent now lives in @shared/events.ts (M1 cross-process event union)
import type { PiEvent } from '@shared/events';
export type { PiEvent };

export interface PiAPI {
  // M1: Chat (长连接, 走 workspace)
  sendPrompt: (workspaceId: string, message: string) => Promise<void>;
  stop: (workspaceId?: string) => Promise<void>;
  onEvent: (callback: (event: PiEvent) => void) => (() => void) | undefined;
  onError: (callback: (error: string) => void) => (() => void) | undefined;
  onPiJsonEvent: (callback: (event: Record<string, unknown>) => void) => (() => void);
  getStatus: () => Promise<PiDriverStatus>;
  refreshPiStatus: () => Promise<PiDriverStatus>;
  installPi: () => Promise<PiDriverStatus>;
  updatePi: () => Promise<PiDriverStatus>;
  uninstallPi: () => Promise<PiDriverStatus>;
  cancelPiOperation: () => Promise<void>;
  onPiStatusChanged: (callback: (status: PiDriverStatus) => void) => (() => void);
  onPiInstallProgress: (callback: (progress: PiInstallProgress) => void) => (() => void);

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
  gitDiff: (workspacePath: string, filePath?: string) => Promise<string>;
  gitDiffStaged: (workspacePath: string) => Promise<string>;
  gitAdd: (workspacePath: string, files: string[]) => Promise<void>;
  gitCommit: (workspacePath: string, message: string) => Promise<string>;
  gitLog: (workspacePath: string, count?: number) => Promise<CommitInfo[]>;
  gitBranches: (workspacePath: string) => Promise<BranchInfo[]>;
  // M1: Git undo (M3 用了, M1 引入)
  gitUndo: (workspacePath: string, filePath: string) => Promise<void>;

  // Settings
  getSettings: () => Promise<AppSettingsData>;
  setSettings: (settings: Partial<AppSettingsData>) => Promise<AppSettingsData>;

  // Pi Config
  loadPiConfig: () => Promise<PiConfigData>;

  // Skills & Plugins (M3 接入 SkillHub, 替代老的 listSkills)
  listSkills: () => Promise<SkillData[]>;
  listPlugins: () => Promise<PluginData[]>;
  getFullConfig: () => Promise<PiFullConfigData>;

  // M3: Skills 面板 (SkillHub 集成)
  skillsCheck: () => Promise<boolean>;
  skillsSearch: (query: string) => Promise<Array<{
    slug: string; name: string; description: string; version: string; source?: string;
  }>>;
  skillsInstalled: () => Promise<Array<{ slug: string; enabled: boolean }>>;
  skillsInstall: (slug: string) => Promise<{ success: boolean }>;
  skillsUninstall: (slug: string) => Promise<{ success: boolean }>;
  skillsToggle: (slug: string, enabled: boolean) => Promise<{ success: boolean }>;
  skillsGithubImport: (url: string) => Promise<{ url: string; message: string }>;

  // M2: 文件搜索
  filesList: (workspacePath: string, query?: string) => Promise<string[]>;

  // M1: Approval flow
  respondApproval: (requestId: string, approved: boolean) => void;
  onApprovalRequest: (callback: (req: { requestId: string; method: string; title: string; message?: string }) => void) => () => void;
  onApprovalDeferred: (callback: (d: { changeId: string; toolCallId: string; filePath: string; op: string; timestamp: number }) => void) => () => void;
  onApprovalReview: (callback: (r: { changeId: string; toolCallId: string; filePath: string; diff: string; newContent: string; timestamp: number }) => void) => () => void;

  // Terminal (M4: node-pty)
  createTerminal: (opts: { id?: string; cwd?: string; cols?: number; rows?: number }) => Promise<{ id: string; reused: boolean }>;
  terminalInput: (terminalId: string, data: string) => Promise<void>;
  terminalResize: (terminalId: string, cols: number, rows: number) => Promise<void>;
  closeTerminal: (terminalId: string) => Promise<void>;
  listTerminals: () => Promise<Array<{ id: string; cwd: string; title: string }>>;
  onTerminalOutput: (terminalId: string, callback: (data: string) => void) => () => void;
  onTerminalExit: (terminalId: string, callback: (code: number | null) => void) => () => void;

  // Project detection & file tree
  detectProject: (workspacePath: string) => Promise<ProjectInfo>;
  getFileTree: (workspacePath: string, maxDepth?: number) => Promise<FileTreeNode>;

  // Messaging Gateway
  gatewayStatus: () => Promise<PlatformStatus[]>;
  gatewayConnect: (platform: string) => Promise<PlatformStatus>;
  gatewayDisconnect: (platform: string) => Promise<void>;
  gatewaySend: (platform: string, chatId: string, content: string) => Promise<void>;
  gatewayMessages: () => Promise<PlatformMessage[]>;
  gatewayConfig: (config: Partial<GatewayConfig>) => Promise<void>;
  onGatewayMessage: (callback: (msg: PlatformMessage) => void) => () => void;
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

export interface ProjectInfo {
  type: 'node' | 'python' | 'rust' | 'go' | 'java' | 'unknown';
  name: string;
  version?: string;
  rootPath: string;
  configFiles: string[];
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'cargo' | 'go';
  hasGit: boolean;
  scripts?: Record<string, string>;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  extension?: string;
  size?: number;
}

export interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
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

// ── Messaging Gateway Types ──────────────────────────────────────

export type GatewayPlatform = 'wechat' | 'feishu' | 'qq';

export interface PlatformMessage {
  id: string;
  platform: GatewayPlatform;
  chatId: string;
  chatName: string;
  chatType: 'private' | 'group';
  senderId: string;
  senderName: string;
  content: string;
  contentType: 'text' | 'image' | 'file' | 'voice';
  timestamp: number;
}

export interface PlatformStatus {
  platform: string;
  connected: boolean;
  accountName?: string;
  lastMessageAt?: number;
  messageCount: number;
  error?: string;
}

export interface GatewayConfig {
  wechat: { enabled: boolean; appId?: string; appSecret?: string };
  feishu: { enabled: boolean; appId?: string; appSecret?: string };
  qq: { enabled: boolean; appId?: string; appSecret?: string };
  autoReply: boolean;
  replyMode: 'pi' | 'echo';
}

// Extend Window interface
declare global {
  interface Window {
    piAPI: PiAPI;
    nodeAPI: NodeAPI;
  }
}