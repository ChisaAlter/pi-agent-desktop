// Shared Types for Pi Desktop
// 集中定义 IPC 边界 + 跨进程数据结构 + Window 全局类型.
// 任何新 IPC 通道必须先在这里加类型, 再在 preload + main + renderer 里实现.

export * from "./events";
export * from "./command-risk";
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
    archived?: boolean;
    favorite?: boolean;
    tags?: string[];
    readOnly?: boolean;
    lastOpenedAt?: number;
    summary?: string;
    lastOutputPaths?: string[];
    usage?: SessionUsageSnapshot;
    toolPermissions?: ToolPermissions;
    parentSessionId?: string;
    forkedFromMessageId?: string;
    forkedAt?: number;
}

export interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string | Date;
    thinking?: string;
    toolCalls?: ToolCall[];
    customCard?: CustomMessageCard;
    planAction?: PlanMessageAction;
}

export interface PlanMessageAction {
    id: string;
    title: string;
    filename?: string;
    requestId?: string;
    status?: "pending" | "refining" | "executing" | "pausing" | "paused" | "executed" | "cancelled" | "failed";
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
    planAction?: PlanMessageAction;
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
    managedRuntimePath?: string;
    runtimeChannel?: "stable" | "latest";
    autoCompactionEnabled?: boolean;
    workspaceToolDefaults?: Record<string, ToolPermissions>;
    /** 识图功能: 视觉模型提供商 */
    visionProvider?: string;
    /** 识图功能: 视觉模型名称 */
    visionModel?: string;
}

export type ToolPermissionKey =
    | "fileRead"
    | "fileWrite"
    | "shell"
    | "git"
    | "network"
    | "extensions";

export type ToolPermissions = Record<ToolPermissionKey, boolean>;

export type ToolPermissionPreset = "minimal" | "development" | "all";

export interface SessionUsageSnapshot {
    provider?: string;
    model?: string;
    contextWindow?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    compactionStatus?: "idle" | "running" | "completed" | "unsupported";
    updatedAt: number;
}

export type CustomMessageCardKind =
    | "status-list"
    | "approval-actions"
    | "task-progress"
    | "result-summary"
    | "file-actions";

export interface CustomMessageCardAction {
    id: string;
    label: string;
    kind: "slash-command" | "open-file" | "copy-text" | "switch-view" | "refresh";
    value: string;
}

export interface CustomMessageCard {
    id: string;
    kind: CustomMessageCardKind | "markdown-fallback";
    title?: string;
    content?: string;
    items?: Array<{ id: string; label: string; status?: string; description?: string; path?: string }>;
    actions?: CustomMessageCardAction[];
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
    managedRuntimePath?: string | null;
    runtimeSource?: "managed" | "global" | "none";
    runtimeChannel?: "stable" | "latest";
    lastCheckedAt?: number;
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

export interface ProjectInfo {
    type: "node" | "python" | "rust" | "go" | "java" | "unknown";
    name: string;
    version?: string;
    rootPath: string;
    configFiles: string[];
    packageManager?: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "cargo" | "go";
    hasGit: boolean;
    scripts?: Record<string, string>;
}

export interface FileTreeNode {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileTreeNode[];
    extension?: string;
    size?: number;
    truncated?: boolean;
}

export interface TextFileContent {
    path: string;
    name: string;
    content: string;
    size: number;
    mtimeMs?: number;
    encoding: "utf-8";
    truncated: boolean;
    binary: boolean;
}

export interface WriteTextFileResult {
    path: string;
    size: number;
    savedAt: number;
    mtimeMs?: number;
}

export interface WriteTextFileOptions {
    expectedMtimeMs?: number;
}

export interface PiPackageInfo {
    name: string;
    source: string;
    description: string;
    url: string;
    installed: boolean;
    updatedAt?: string;
}

export interface InstalledPiPackage {
    source: string;
    name: string;
    enabled?: boolean;
    scope: "global" | "local";
}

export interface PiPackageActionResult {
    success: boolean;
    message: string;
    requiresRestart?: boolean;
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
    gitUndo(workspacePath: string, filePath: string): Promise<void | IpcError>;
    stop(workspaceId: string): Promise<unknown>;

    // Workspace
    listWorkspaces(): Promise<Workspace[] | IpcError>;
    createWorkspace(name: string, path: string): Promise<Workspace | IpcError>;
    deleteWorkspace(id: string): Promise<void>;
    selectWorkspace(path: string): Promise<void | IpcError>;
    selectDirectory(): Promise<string | null | IpcError>;
    /** v1.0.13: 多选文件,ChatInput 附件按钮 */
    selectFiles(opts?: { multiSelections?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | IpcError>;

    // Session
    listSessions(): Promise<Session[]>;
    createSession(workspaceId: string, title?: string, id?: string): Promise<Session>;
    renameSession(id: string, title: string): Promise<Session>;
    deleteSession(id: string): Promise<void>;
    archiveSession(id: string, archived: boolean): Promise<Session | IpcError>;
    updateSessionMetadata(
        id: string,
        updates: Pick<
            Partial<Session>,
            | "summary"
            | "lastOutputPaths"
            | "favorite"
            | "tags"
            | "archived"
            | "readOnly"
            | "lastOpenedAt"
            | "usage"
            | "toolPermissions"
            | "parentSessionId"
            | "forkedFromMessageId"
            | "forkedAt"
        >,
    ): Promise<Session | IpcError>;
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
    getGitStatus(workspacePath: string): Promise<GitStatus | null | IpcError>;
    gitDiff(workspacePath: string, filePath?: string): Promise<string | IpcError>;
    gitDiffStaged(workspacePath: string): Promise<string | IpcError>;
    gitAdd(workspacePath: string, files: string[]): Promise<void | IpcError>;
    gitUnstage(workspacePath: string, files: string[]): Promise<void | IpcError>;
    gitCommit(workspacePath: string, message: string): Promise<string | IpcError>;
    gitLog(workspacePath: string, count?: number): Promise<GitLogEntry[] | IpcError>;
    gitBranches(workspacePath: string): Promise<GitBranch[] | IpcError>;

    // Project detection & file tree
    detectProject(workspacePath: string): Promise<ProjectInfo | IpcError>;
    getFileTree(workspacePath: string, maxDepth?: number): Promise<FileTreeNode | IpcError>;

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
    filesList(workspacePath: string, query?: string): Promise<FileEntry[] | IpcError>;
    filesGetTree(workspacePath: string, options?: { maxDepth?: number; maxEntries?: number }): Promise<FileTreeNode | IpcError>;
    filesReadTextFile(path: string, workspacePath?: string): Promise<TextFileContent | IpcError>;
    filesWriteTextFile(path: string, content: string, workspacePath?: string, options?: WriteTextFileOptions): Promise<WriteTextFileResult | IpcError>;
    filesSearch(workspacePath: string, query: string, options?: { limit?: number }): Promise<FileEntry[] | IpcError>;

    // Skills panel (M3 / SkillHub)
    skillsCheck(): Promise<unknown>;
    skillsSearch(query: string): Promise<unknown>;
    skillsInstalled(): Promise<unknown>;
    skillsInstall(slug: string): Promise<unknown>;
    skillsUninstall(slug: string): Promise<unknown>;
    skillsToggle(slug: string, enabled: boolean): Promise<unknown>;
    skillsGithubImport(url: string): Promise<unknown>;
    skillsWriteSkill(name: string, content: string): Promise<unknown>;

    // Pi packages (native pi.dev package catalog)
    packagesSearch(query: string): Promise<PiPackageInfo[] | IpcError>;
    packagesListInstalled(): Promise<InstalledPiPackage[] | IpcError>;
    packagesInstall(source: string): Promise<PiPackageActionResult | IpcError>;
    packagesRemove(source: string): Promise<PiPackageActionResult | IpcError>;
    packagesUpdate(source: string): Promise<PiPackageActionResult | IpcError>;
    packagesRefreshCatalog(): Promise<PiPackageInfo[] | IpcError>;

    openPath(path: string): Promise<string | IpcError>;
    revealPath(path: string): Promise<void | IpcError>;

    // Terminal (M4: node-pty)
    createTerminal(opts: {
        id?: string;
        cwd?: string;
        agentId?: string;
        cols?: number;
        rows?: number;
    }): Promise<TerminalInfo | IpcError>;
    terminalInput(terminalId: string, data: string): Promise<void | IpcError>;
    terminalResize(terminalId: string, cols: number, rows: number): Promise<void | IpcError>;
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

    // v1.1.0: 识图功能 (vision)
    describeImages?(images: Array<{
        name: string;
        dataUrl: string;
        mimeType?: string;
    }>): Promise<{ text: string }>;
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
