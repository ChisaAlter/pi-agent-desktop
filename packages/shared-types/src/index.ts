// Shared Types for Pi Desktop
// 集中定义 IPC 边界 + 跨进程数据结构 + Window 全局类型.
// 任何新 IPC 通道必须先在这里加类型, 再在 preload + main + renderer 里实现.

export * from "./events";
import type { ApprovalRequest, DeferredEdit, FileReview } from "./approval";
export type { ApprovalRequest, DeferredEdit, FileReview };
// 上面 re-export approval.ts 的具体类型 (解决: 后面 PiAPI 用到的 ApprovalRequest 等)
// 注: 不写 export * from "./approval" 是为了不让外层组件意外引入 ApprovalResponse 等内部细节

// ── Workspace + Session ──────────────────────────────────────────

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
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string | Date;
    thinking?: string;
    toolCalls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    name: string;
    input?: unknown;
    output?: unknown;
    args?: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "running" | "completed" | "error";
    startTime?: Date;
    endTime?: Date;
}

// ── Pi Config + Settings ──────────────────────────────────────────

export interface PiConfig {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
}

export interface AppSettings {
    theme: "light" | "dark";
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

// ── Pi Driver ─────────────────────────────────────────────────────

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
    stage: "downloading" | "installing" | "verifying" | "done" | "error";
    message: string;
    percent?: number;
}

// Pi 事件 — 走 @shared/events 那个跨进程 union 类型, 不在这里重新定义
// (避免两套 PiEvent 互相 conflict)
import type { PiEvent, PiEventType } from "./events";
export type { PiEvent, PiEventType };

// ── IPC 错误契约 (v1.0.6.1) ──────────────────────────────────────
// 主进程 IPC handler 失败时返回 IpcError 形状, 渲染层根据 code 走 t() 翻译.
// 不要 throw 中文 Error: 用户切到 en-US 看到的还是中文.
export interface IpcError {
    /** 稳定错误码, 给 t() 查 i18n 词条 (e.g. "ipcErrors.files.scanFailed") */
    code: string;
    /** t() 插值参数 (e.g. { path: "/tmp/foo", reason: "EACCES" }) */
    params?: Record<string, string | number | boolean>;
    /** 兜底中文文案, 主进程给开发期排查用. 渲染层 t() 命中时这个不显示. */
    fallback: string;
}

/** 工厂: 构造 IpcError. 强制要求 fallback 中文, 防止漏写. */
export function ipcError(
    code: string,
    fallback: string,
    params?: Record<string, string | number | boolean>,
): IpcError {
    return { code, fallback, params };
}

/** 类型守卫: 判断 unknown 是否是 IpcError (供渲染层 .catch 用) */
export function isIpcError(value: unknown): value is IpcError {
    if (value === null || typeof value !== "object") return false;
    const v = value as { code?: unknown; fallback?: unknown };
    return typeof v.code === "string" && typeof v.fallback === "string";
}

// ── File + Terminal + Git ─────────────────────────────────────────

export interface FileEntry {
    path: string;
    name: string;
    size: number;
    isDirectory: boolean;
}

export interface TerminalInfo {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
}

export interface GitStatus {
    branch: string;
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
    ahead: number;
    behind: number;
}

export interface GitBranch {
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
}

export interface GitLogEntry {
    hash: string;
    author: string;
    date: string;
    message: string;
}

// ── Skills + Pi Agent config ──────────────────────────────────────

export interface InstalledSkillInfo {
    name: string;
    description: string;
    path: string;
    enabled: boolean;
}

export interface PluginInfo {
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    type: "provider";
}

export interface PiAgentFullConfig {
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

// ── Window.piAPI / nodeAPI 全局类型 ───────────────────────────────

export type Unsubscribe = () => void;

export interface PiAPI {
    // Pi Driver
    sendPrompt(workspaceId: string, message: string): Promise<unknown>;
    onEvent(cb: (e: PiEvent) => void): Unsubscribe;
    onError(cb: (err: string) => void): Unsubscribe;
    onPiJsonEvent(cb: (data: Record<string, unknown>) => void): Unsubscribe;
    getStatus(): Promise<PiStatus>;
    refreshPiStatus(): Promise<PiStatus>;
    installPi(): Promise<PiStatus>;
    updatePi(): Promise<PiStatus>;
    uninstallPi(): Promise<PiStatus>;
    cancelPiOperation(): Promise<void>;
    onPiStatusChanged(cb: (status: PiStatus) => void): Unsubscribe;
    onPiInstallProgress(cb: (progress: PiInstallProgress) => void): Unsubscribe;

    // Approval flow (M1)
    respondApproval(requestId: string, approved: boolean): void;
    onApprovalRequest(cb: (req: ApprovalRequest) => void): Unsubscribe;
    onApprovalDeferred(cb: (deferred: DeferredEdit) => void): Unsubscribe;
    onApprovalReview(cb: (review: FileReview) => void): Unsubscribe;

    // Git + Pi stop
    gitUndo(workspacePath: string, filePath: string): Promise<unknown>;
    stop(): Promise<unknown>;

    // Workspace
    listWorkspaces(): Promise<Workspace[]>;
    createWorkspace(name: string, path: string): Promise<Workspace>;
    deleteWorkspace(id: string): Promise<void>;
    selectWorkspace(path: string): Promise<unknown>;
    selectDirectory(): Promise<string | null>;

    // Session
    listSessions(): Promise<Session[]>;
    createSession(workspaceId: string, title?: string): Promise<Session>;
    deleteSession(id: string): Promise<void>;

    // Git
    getGitStatus(workspacePath: string): Promise<GitStatus | null>;
    gitDiff(workspacePath: string, filePath?: string): Promise<string>;
    gitDiffStaged(workspacePath: string): Promise<string>;
    gitAdd(workspacePath: string, files: string[]): Promise<void>;
    gitCommit(workspacePath: string, message: string): Promise<string>;
    gitLog(workspacePath: string, count?: number): Promise<GitLogEntry[]>;
    gitBranches(workspacePath: string): Promise<GitBranch[]>;

    // Project detection & file tree
    detectProject(workspacePath: string): Promise<unknown>;
    getFileTree(workspacePath: string, maxDepth?: number): Promise<unknown>;

    // Settings
    getSettings(): Promise<AppSettings>;
    setSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
    loadPiConfig(): Promise<unknown>;
    getFullConfig(): Promise<PiAgentFullConfig>;

    // Skills & Plugins
    listSkills(): Promise<InstalledSkillInfo[]>;
    listPlugins(): Promise<PluginInfo[]>;

    // File search (M2)
    filesList(workspacePath: string, query?: string): Promise<FileEntry[]>;

    // Skills panel (M3 / SkillHub)
    skillsCheck(): Promise<unknown>;
    skillsSearch(query: string): Promise<unknown>;
    skillsInstalled(): Promise<unknown>;
    skillsInstall(slug: string): Promise<unknown>;
    skillsUninstall(slug: string): Promise<unknown>;
    skillsToggle(slug: string, enabled: boolean): Promise<unknown>;
    skillsGithubImport(url: string): Promise<unknown>;

    // Terminal (M4: node-pty)
    createTerminal(opts: {
        id?: string;
        cwd?: string;
        cols?: number;
        rows?: number;
    }): Promise<TerminalInfo>;
    terminalInput(terminalId: string, data: string): Promise<void>;
    terminalResize(terminalId: string, cols: number, rows: number): Promise<void>;
    closeTerminal(terminalId: string): Promise<void>;
    listTerminals(): Promise<TerminalInfo[]>;
    onTerminalOutput(terminalId: string, cb: (data: string) => void): Unsubscribe;
    onTerminalExit(terminalId: string, cb: (code: number | null) => void): Unsubscribe;
}

export interface NodeAPI {
    platform: NodeJS.Platform;
    versions: {
        node: string;
        chrome: string;
        electron: string;
    };
}

declare global {
    interface Window {
        piAPI: PiAPI;
        nodeAPI: NodeAPI;
    }
}
