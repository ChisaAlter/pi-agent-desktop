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

export type AgentStatus = "starting" | "idle" | "running" | "error" | "closed";

export interface AgentTab {
    id: string;
    workspaceId: string;
    title: string;
    status: AgentStatus;
    sessionId?: string;
    sessionPath?: string;
    createdAt: number;
    updatedAt: number;
}

export interface AgentRuntimeState {
    agentId: string;
    status: AgentStatus;
    isStreaming: boolean;
    modelProvider?: string;
    modelId?: string;
    modelName?: string;
    thinkingLevel?: string;
    tokenUsage?: {
        input?: number;
        output?: number;
        total?: number;
    };
    sessionPath?: string;
}

export interface AgentMessage {
    id: string;
    agentId: string;
    role: "user" | "assistant" | "tool" | "system" | "error";
    content: string;
    createdAt: number;
    thinking?: string;
    meta?: Record<string, unknown>;
}

export interface CreateAgentInput {
    workspaceId: string;
    title?: string;
    sessionPath?: string;
}

export interface SendAgentPromptInput {
    agentId: string;
    message: string;
    streamingBehavior?: "steer" | "followUp";
}

export type CodexImportStatus = "new" | "current" | "outdated";

export interface CodexSessionSummary {
    id: string;
    sourcePath: string;
    targetPath: string;
    cwd: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    sourceSize: number;
    status: CodexImportStatus;
    importedSourceMtime?: number;
}

export interface CodexImportResult {
    sourcePath: string;
    targetPath?: string;
    success: boolean;
    error?: string;
}

export interface CodexImportReport {
    imported: number;
    failed: number;
    results: CodexImportResult[];
}

export interface PiModelItem {
    id: string;
    name?: string;
}

export interface PiProviderConfig {
    name?: string;
    baseUrl?: string;
    apiType?: "openai" | "responses";
    models?: PiModelItem[];
    headers?: Record<string, string>;
}

export interface PiModelsFile {
    providers: Record<string, PiProviderConfig>;
}

export interface PiAuthItem {
    type?: string;
    apiKey?: string;
}

export type PiAuthFile = Record<string, PiAuthItem>;
export type PiSettingsFile = Record<string, unknown>;

export interface ConfigValidationResult {
    valid: boolean;
    error?: string;
}

export interface ProviderTestResult {
    ok: boolean;
    status?: number;
    message: string;
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
    /** 桌面权限模式: ask=主动询问, smart=智能授权, always=始终授权 */
    permissionLevel?: PermissionMode | "read" | "partial" | "full";
}

// ── Extension UI: permissions + plan mode ─────────────────────────

export type PermissionMode = "ask" | "smart" | "always";

export type PermissionDecision =
    | "allow_once"
    | "allow_session"
    | "allow_always"
    | "deny"
    | "deny_session";

export interface ExtensionUiRequest {
    requestId: string;
    workspaceId?: string;
    kind: "select" | "confirm" | "input" | "editor";
    source: "permission" | "plan" | "extension";
    title: string;
    message?: string;
    placeholder?: string;
    options?: string[];
    createdAt: number;
}

export interface ExtensionUiResponse {
    requestId: string;
    value?: string | boolean;
    decision?: PermissionDecision;
}

export interface PlanCard {
    id: string;
    title: string;
    content: string;
    filename?: string;
    createdAt: number;
}

export interface PlanProgressItem {
    id: string;
    text: string;
    status: "pending" | "running" | "completed" | "failed" | "waiting";
}

export interface PlanProgressUpdate {
    workspaceId?: string;
    items: PlanProgressItem[];
    status?: "planning" | "waiting_decision" | "executing" | "completed" | "idle";
}

export interface PlanDecisionRequest {
    requestId: string;
    card?: PlanCard;
    workspaceId?: string;
    kind?: ExtensionUiRequest["kind"];
    source?: "plan";
    title?: string;
    message?: string;
    placeholder?: string;
    options?: string[];
    createdAt?: number;
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
    getStatus(): Promise<PiStatus | IpcError>;
    refreshPiStatus(): Promise<PiStatus | IpcError>;
    installPi(): Promise<PiStatus | IpcError>;
    updatePi(): Promise<PiStatus | IpcError>;
    uninstallPi(): Promise<PiStatus | IpcError>;
    cancelPiOperation(): Promise<void>;
    onPiStatusChanged(cb: (status: PiStatus) => void): Unsubscribe;
    onPiInstallProgress(cb: (progress: PiInstallProgress) => void): Unsubscribe;

    // Approval flow (M1)
    respondApproval(requestId: string, approved: boolean): void;
    onApprovalRequest(cb: (req: ApprovalRequest) => void): Unsubscribe;
    onApprovalDeferred(cb: (deferred: DeferredEdit) => void): Unsubscribe;
    onApprovalReview(cb: (review: FileReview) => void): Unsubscribe;
    // v1.1: 同步 autoApprove 到主进程 (fire-and-forget)
    setAutoApprove(value: boolean): void;

    // Git + Pi stop
    gitUndo(workspacePath: string, filePath: string): Promise<unknown>;
    stop(): Promise<unknown>;

    // Workspace
    listWorkspaces(): Promise<Workspace[]>;
    createWorkspace(name: string, path: string): Promise<Workspace>;
    deleteWorkspace(id: string): Promise<void>;
    selectWorkspace(path: string): Promise<unknown>;
    selectDirectory(): Promise<string | null>;
    /** v1.0.13: 多选文件,ChatInput 附件按钮 */
    selectFiles(opts?: { multiSelections?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;

    // Session
    listSessions(): Promise<Session[]>;
    createSession(workspaceId: string, title?: string, id?: string): Promise<Session>;
    renameSession(id: string, title: string): Promise<Session>;
    deleteSession(id: string): Promise<void>;
    // 2026-06-06 hotfix: session messages 持久化
    //  - appendMessage: stream 起点(user msg / 首条 assistant msg)
    //  - updateMessage: 流式累积 content / thinking,turn_end 时 flush
    //  - updateToolCall: tool call 状态变迁(running → completed/error)
    //  失败返 IpcError,fire-and-forget 由 caller 处理
    appendMessage(
        sessionId: string,
        message: Message,
    ): Promise<void | IpcError>;
    updateMessage(
        sessionId: string,
        messageId: string,
        updates: Partial<Message>,
    ): Promise<void | IpcError>;
    updateToolCall(
        sessionId: string,
        messageId: string,
        toolCallId: string,
        updates: Partial<ToolCall>,
    ): Promise<void | IpcError>;

    // Agents workbench
    agentsList(): Promise<AgentTab[]>;
    agentsCreate(input: CreateAgentInput): Promise<AgentTab>;
    agentsPrompt(input: SendAgentPromptInput): Promise<void>;
    agentsAbort(agentId: string): Promise<void>;
    agentsStop(agentId: string): Promise<void>;
    agentsRestart(agentId: string): Promise<AgentTab>;
    agentsMessages(agentId: string): Promise<AgentMessage[]>;
    agentsRuntimeState(agentId: string): Promise<AgentRuntimeState>;
    onAgentsState(cb: (agents: AgentTab[]) => void): Unsubscribe;
    onAgentMessages(cb: (payload: { agentId: string; messages: AgentMessage[] }) => void): Unsubscribe;
    onAgentEvent(cb: (payload: { agentId: string; workspaceId: string; event: PiEvent }) => void): Unsubscribe;

    // Extension UI bridge
    permissionSetMode(mode: PermissionMode): Promise<void>;
    permissionRespond(requestId: string, response: ExtensionUiResponse | PermissionDecision | boolean | string): void;
    onPermissionRequest(cb: (req: ExtensionUiRequest) => void): Unsubscribe;
    onPermissionUpdate(cb: (payload: unknown) => void): Unsubscribe;

    planSetEnabled(workspaceId: string, enabled: boolean): Promise<void>;
    planRespond(requestId: string, decision: "execute" | "refine" | "cancel", text?: string): void;
    onPlanCard(cb: (card: PlanCard) => void): Unsubscribe;
    onPlanDecisionRequest(cb: (req: PlanDecisionRequest) => void): Unsubscribe;
    onPlanProgress(cb: (update: PlanProgressUpdate) => void): Unsubscribe;

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

    // Pi config center
    configGetModels(): Promise<{ raw: string; parsed: PiModelsFile }>;
    configGetAuth(): Promise<{ raw: string; parsed: PiAuthFile }>;
    configGetSettings(): Promise<{ raw: string; parsed: PiSettingsFile }>;
    configSaveModels(data: PiModelsFile): Promise<ConfigValidationResult>;
    configSaveAuth(data: PiAuthFile): Promise<ConfigValidationResult>;
    configSaveSettings(data: PiSettingsFile): Promise<ConfigValidationResult>;
    configSaveRaw(fileName: string, rawJson: string): Promise<ConfigValidationResult>;
    configExport(): Promise<string>;
    configImport(packageJson: string): Promise<ConfigValidationResult>;
    configFetchModels(baseUrl: string, apiKey?: string, apiType?: string): Promise<PiModelItem[]>;
    configTestProvider(input: {
        baseUrl: string;
        apiKey?: string;
        modelId?: string;
        apiType?: string;
        headers?: Record<string, string>;
    }): Promise<ProviderTestResult>;

    // Codex session import
    codexSessionsScan(workspacePath: string): Promise<CodexSessionSummary[]>;
    codexSessionsImport(workspacePath: string, sourcePaths: string[]): Promise<CodexImportReport>;

    // Skills
    listSkills(): Promise<InstalledSkillInfo[]>;

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
    skillsWriteSkill(name: string, content: string): Promise<unknown>;

    // Terminal (M4: node-pty)
    createTerminal(opts: {
        id?: string;
        cwd?: string;
        agentId?: string;
        cols?: number;
        rows?: number;
    }): Promise<TerminalInfo>;
    terminalInput(terminalId: string, data: string): Promise<void>;
    terminalResize(terminalId: string, cols: number, rows: number): Promise<void>;
    closeTerminal(terminalId: string): Promise<void>;
    listTerminals(): Promise<TerminalInfo[]>;
    onTerminalOutput(terminalId: string, cb: (data: string) => void): Unsubscribe;
    onTerminalExit(terminalId: string, cb: (code: number | null) => void): Unsubscribe;

    // v1.0.10 (H3): renderer 日志转发主进程 electron-log 落文件
    // fire-and-forget, 同步即可, 不阻塞 UI. main 端用 log[level] 接收.
    log(level: "error" | "warn" | "info" | "debug", message: string, extra?: string[]): void;

    // v1.1.0: 窗口控制(无 native frame,renderer 接管 title bar)
    windowMinimize(): Promise<void>;
    windowToggleMaximize(): Promise<void>;
    windowIsMaximized(): Promise<boolean>;
    windowClose(): Promise<void>;
    onWindowMaximizeChanged(cb: (maximized: boolean) => void): Unsubscribe;
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
