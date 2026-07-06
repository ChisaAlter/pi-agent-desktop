// Shared Types for Pi Desktop
// 集中定义 IPC 边界 + 跨进程数据结构 + Window 全局类型.
// 任何新 IPC 通道必须先在这里加类型, 再在 preload + main + renderer 里实现.
// TODO: split into domain files (workspace/session/agent/...)

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
    generatedUi?: GeneratedUiCardV1;
    customCard?: CustomMessageCard;
    planAction?: PlanMessageAction;
    /** v1.2: Parent message ID for tree-structured conversations (Pi JSONL v3 branching). undefined = root message. */
    parentId?: string;
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
    generatedUi?: GeneratedUiCardV1;
    planAction?: PlanMessageAction;
    meta?: Record<string, unknown>;
}

export interface CreateAgentInput {
    workspaceId: string;
    title?: string;
    sessionPath?: string;
    sessionId?: string;
}

export type AgentMode = "build" | "plan" | "compose";

export interface SendPromptOptions {
    mode?: AgentMode;
}

export interface SendAgentPromptInput {
    agentId: string;
    message: string;
    streamingBehavior?: "steer" | "followUp";
    mode?: AgentMode;
}

export type PiSlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

export type PiSlashDesktopAction =
    | "open-settings"
    | "open-models"
    | "open-sessions"
    | "open-hotkeys"
    | "new-session"
    | "compact"
    | "reload"
    | "export"
    | "copy"
    | "quit"
    | "unsupported";

export interface PiSlashCommand {
    name: string;
    description?: string;
    source: PiSlashCommandSource;
    desktopAction?: PiSlashDesktopAction;
    requiresArgument?: boolean;
}

export interface RunBuiltinSlashCommandInput {
    workspaceId: string;
    agentId?: string;
    command: string;
    args: string;
}

export type LongHorizonToggle = { enabled: boolean };
export type LongHorizonLoadedFrom = "desktop" | "pi-openplan" | "disabled" | "unsupported";

export interface LongHorizonRuntimeMeta {
    supported: boolean;
    loadedFrom: LongHorizonLoadedFrom;
    reason?: string;
}

export type LongHorizonRuntimeToggle = LongHorizonToggle & LongHorizonRuntimeMeta;
export type LongHorizonMemoryLayer = "checkpoints" | "session_memory" | "project_memory" | "global_memory" | "history";

export interface LongHorizonSettings {
    enabled: boolean;
    defaultMode: AgentMode;
    planMode: LongHorizonToggle;
    composeMode: LongHorizonToggle;
    maxMode: LongHorizonToggle & {
        candidates?: number;
    };
    memory: LongHorizonToggle & {
        ccIndex?: boolean;
        reconcileOnSearch?: boolean;
        searchScoreFloor?: number;
    };
    history: LongHorizonToggle;
    checkpoint: LongHorizonToggle;
    /**
     * Goal stop-gate / judge configuration.
     *
     * Extended in Phase C Task 4 to carry judge model overrides:
     *  - `judgeProvider` / `judgeModel`: explicit judge model. When either is
     *    unset, GoalService falls back to the workspace's active provider/model.
     *  - `evaluateInterval`: 0 (default) = stop-gate mode (evaluate on every
     *    `turn_end`); N > 0 = periodic mode, evaluate every Nth turn_end.
     *  - `maxReact`: cap on judge-driven re-entries per goal. Defaults to
     *    `MAX_GOAL_REACT` (12) when unset.
     *
     * `DEFAULT_LONG_HORIZON_SETTINGS.goal` keeps `{ enabled: true }` so omitted
     * optional fields fall back to the documented defaults.
     */
    goal: LongHorizonToggle & {
        judgeProvider?: string;
        judgeModel?: string;
        evaluateInterval?: number;
        maxReact?: number;
    };
    subagents: LongHorizonToggle;
    task: LongHorizonToggle;
    actor: LongHorizonToggle;
    workflow: LongHorizonToggle & {
        maxConcurrentAgents?: number;
        maxLifecycleAgents?: number;
        maxDepth?: number;
    };
    dream: LongHorizonToggle & { auto?: boolean; intervalDays?: number };
    distill: LongHorizonToggle & { auto?: boolean; intervalDays?: number };
    composeWorkflow: LongHorizonToggle;
}

export const DEFAULT_LONG_HORIZON_SETTINGS: LongHorizonSettings = {
    enabled: true,
    defaultMode: "build",
    planMode: { enabled: true },
    composeMode: { enabled: true },
    maxMode: { enabled: true, candidates: 5 },
    memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
    history: { enabled: true },
    checkpoint: { enabled: true },
    goal: { enabled: true },
    subagents: { enabled: true },
    task: { enabled: true },
    actor: { enabled: true },
    workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
    dream: { enabled: false },
    distill: { enabled: false },
    composeWorkflow: { enabled: true },
};

export function normalizeLongHorizonSettings(value?: Partial<LongHorizonSettings> | null): LongHorizonSettings {
    const workflow = value?.workflow ?? value?.composeWorkflow;
    const normalizedDefaultMode = value?.defaultMode === "plan" || value?.defaultMode === "compose"
        ? value.defaultMode
        : "build";
    return {
        ...DEFAULT_LONG_HORIZON_SETTINGS,
        ...value,
        defaultMode: normalizedDefaultMode,
        planMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.planMode, ...value?.planMode },
        composeMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.composeMode, ...value?.composeMode },
        maxMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.maxMode, ...value?.maxMode },
        memory: { ...DEFAULT_LONG_HORIZON_SETTINGS.memory, ...value?.memory },
        history: { ...DEFAULT_LONG_HORIZON_SETTINGS.history, ...value?.history },
        checkpoint: { ...DEFAULT_LONG_HORIZON_SETTINGS.checkpoint, ...value?.checkpoint },
        goal: { ...DEFAULT_LONG_HORIZON_SETTINGS.goal, ...value?.goal },
        subagents: { ...DEFAULT_LONG_HORIZON_SETTINGS.subagents, ...value?.subagents },
        task: { ...DEFAULT_LONG_HORIZON_SETTINGS.task, ...value?.task },
        actor: { ...DEFAULT_LONG_HORIZON_SETTINGS.actor, ...value?.actor },
        workflow: { ...DEFAULT_LONG_HORIZON_SETTINGS.workflow, ...workflow },
        dream: { ...DEFAULT_LONG_HORIZON_SETTINGS.dream, ...value?.dream },
        distill: { ...DEFAULT_LONG_HORIZON_SETTINGS.distill, ...value?.distill },
        composeWorkflow: { ...DEFAULT_LONG_HORIZON_SETTINGS.composeWorkflow, ...value?.composeWorkflow },
    };
}

export interface LongHorizonMemoryRecord {
    id: string;
    scope: "project" | "session" | "global";
    layer: LongHorizonMemoryLayer;
    kind: "note" | "checkpoint" | "task-progress" | "summary" | "history";
    text: string;
    parentId?: string;
    workspaceId?: string;
    sessionId?: string;
    tags?: string[];
    createdAt: number;
    updatedAt?: number;
    score?: number;
}

export interface LongHorizonTaskRecord {
    id: string;
    workspaceId: string;
    agentId?: string;
    source: "goal" | "plan";
    text: string;
    status: "pending" | "running" | "completed" | "failed" | "waiting" | "blocked";
    ordinal: number;
    createdAt: number;
    updatedAt: number;
}

export interface MiMoCodeRuntimeFeatureState {
    primaryAgents: Array<{
        id: string;
        mode: "primary" | "subagent";
        native: boolean;
        description: string;
        permissionProfile: string;
    }>;
    systemAgents: Array<{
        id: string;
        mode: "primary" | "subagent";
        native: boolean;
        description: string;
        permissionProfile: string;
    }>;
    enabledToolIds: string[];
    features: {
        planMode: LongHorizonRuntimeToggle;
        composeMode: LongHorizonRuntimeToggle;
        maxMode: LongHorizonRuntimeMeta & { enabled: boolean; candidates: number };
        memory: LongHorizonRuntimeMeta & { enabled: boolean; ccIndex: boolean; reconcileOnSearch: boolean; searchScoreFloor: number };
        history: LongHorizonRuntimeToggle;
        checkpoint: LongHorizonRuntimeToggle;
        goal: LongHorizonRuntimeToggle;
        task: LongHorizonRuntimeToggle;
        actor: LongHorizonRuntimeToggle;
        subagents: LongHorizonRuntimeToggle;
        workflow: LongHorizonRuntimeMeta & { enabled: boolean; maxConcurrentAgents: number; maxLifecycleAgents: number; maxDepth: number };
        dream: LongHorizonRuntimeToggle;
        distill: LongHorizonRuntimeToggle;
    };
}

export interface LongHorizonMemorySearchInput {
    workspaceId?: string;
    sessionId?: string;
    query: string;
    limit?: number;
}

export interface LongHorizonMemoryRecentInput {
    workspaceId?: string;
    sessionId?: string;
    limit?: number;
}

export interface LongHorizonTaskListInput {
    workspaceId: string;
    agentId?: string;
}

export type GoalStatus = "running" | "checking" | "satisfied" | "impossible" | "cleared";

export interface GoalState {
    id: string;
    workspaceId: string;
    agentId?: string;
    condition: string;
    status: GoalStatus;
    reason?: string;
    createdAt?: number;
    updatedAt: number;
}

export interface GoalJudgeResult {
    ok: boolean;
    impossible?: boolean;
    reason?: string;
}

/**
 * Structured verdict returned by `GoalService.evaluate()` after the judge LLM
 * decides whether the active goal is satisfied. Mirrors the verdict shape used
 * internally by GoalService — Task 4 migrated this from a local type in
 * goal-service.ts to the shared-types authority source.
 *
 *  - `verdict: "satisfied"` ⟺ judge returned `ok === true`
 *  - `verdict: "failed"` ⟺ judge returned `ok === false && impossible === true`
 *  - `verdict: "inconclusive"` ⟺ judge returned `ok === false && impossible !== true`
 */
export type GoalVerdict = {
    verdict: "satisfied" | "failed" | "inconclusive";
    reason: string;
    confidence?: number;
    raw?: unknown;
};

/**
 * Payload of the `goal:evaluation` IPC event. Broadcast to the renderer
 * whenever `GoalService.evaluate()` completes (including fail-open inconclusive
 * results) so the UI can render a per-turn judge marker.
 */
export interface GoalEvaluationEvent {
    workspaceId: string;
    agentId?: string;
    verdict: GoalVerdict["verdict"];
    reason: string;
    attempt: number;
    judgedMessageId?: string;
    error?: boolean;
}

/** Input shape for the `goal:evaluate` IPC handler. */
export interface GoalEvaluateInput {
    workspaceId: string;
    agentId?: string;
}

export interface GoalSetInput {
    workspaceId: string;
    agentId?: string;
    condition: string;
}

export interface SlashCommandRunResult {
    handled: boolean;
    command: string;
    action?: PiSlashDesktopAction;
    message?: string;
    tone?: "success" | "error" | "info";
    keepInput?: boolean;
    forwardToAgent?: boolean;
    content?: string;
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

export type ClaudeImportStatus = "new" | "current" | "outdated";

export interface ClaudeSessionSummary {
    id: string;
    sourcePath: string;
    targetPath: string;
    cwd: string;
    title: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    sourceSize: number;
    status: ClaudeImportStatus;
    importedSourceMtime?: number;
}

export interface ClaudeImportResult {
    id: string;
    sourcePath: string;
    targetPath?: string;
    title?: string;
    success: boolean;
    overwritten?: boolean;
    messageCount?: number;
    error?: string;
}

export interface ClaudeImportReport {
    imported: number;
    failed: number;
    results: ClaudeImportResult[];
}

export interface PiModelItem {
    id: string;
    name?: string;
    api?: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    cost?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface PiProviderConfig {
    name?: string;
    baseUrl?: string;
    apiType?: string;
    api?: string;
    apiKey?: string;
    models?: PiModelItem[];
    headers?: Record<string, string>;
    _piDesktopDeletedModels?: string[];
    [key: string]: unknown;
}

export interface PiModelsFile {
    providers: Record<string, PiProviderConfig>;
}

export interface PiAuthItem {
    type?: string;
    apiKey?: string;
    key?: string;
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

export type ManagedModelSource = "json" | "yaml";

export interface ManagedModelEntry {
    providerId: string;
    providerName: string;
    modelId: string;
    modelName: string;
    baseUrl?: string;
    apiType?: string;
    api?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    input?: string[];
    source: ManagedModelSource;
    isDefault: boolean;
    hasApiKey: boolean;
    apiKeyPreview?: string;
    headers?: Record<string, string>;
}

export interface ManagedModelsResult {
    configDir: string;
    defaultProvider: string;
    defaultModel: string;
    models: ManagedModelEntry[];
}

export interface ManagedModelSaveInput {
    originalProviderId?: string;
    originalModelId?: string;
    providerId: string;
    providerName?: string;
    baseUrl?: string;
    apiType?: string;
    api?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    headers?: Record<string, string>;
    modelId: string;
    modelName?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    input?: string[];
    setDefault?: boolean;
}

export interface ManagedModelDeleteInput {
    providerId: string;
    modelId: string;
}

// ── Pi Config + Settings ──────────────────────────────────────────

export interface PiConfig {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
}

export interface AppSettings {
    theme: "light" | "dark" | "system";
    fontSize: number;
    model: string;
    provider: string;
    apiKey?: string;
    temperature: number;
    maxTokens: number;
    autoSave: boolean;
    showLineNumbers: boolean;
    wordWrap: boolean;
    /** 设置 schema 版本号, 用于将来迁移. 当前固定为 1. */
    schemaVersion: number;
    language?: string;
    piConfig?: PiConfig;
    /** 桌面权限模式: ask=主动询问, smart=智能授权, always=始终授权 */
    permissionLevel?: PermissionMode | "read" | "partial" | "full";
    managedRuntimePath?: string;
    runtimeChannel?: "stable" | "latest";
    autoCompactionEnabled?: boolean;
    workspaceToolDefaults?: Record<string, ToolPermissions>;
    sidebarGroupMode?: "date" | "workspace";
    /** 识图功能: 视觉模型提供商 */
    visionProvider?: string;
    /** 识图功能: 视觉模型名称 */
    visionModel?: string;
    /** 是否展示 agent 思考过程 */
    showThinking?: boolean;
    /** 思考级别: none / low / medium / high */
    thinkingLevel?: "none" | "low" | "medium" | "high";
    /** 用户自定义快捷键覆盖。 */
    shortcutOverrides?: ShortcutOverride[];
    /** 长程能力：MiMoCode 风格 mode/goal/memory/checkpoint/task/max 适配层 */
    longHorizon?: LongHorizonSettings;
}

export interface ShortcutOverride {
    id: string;
    keys: string;
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

export interface GeneratedUiAction {
    id: string;
    label: string;
    kind: "slash-command" | "open-file" | "copy-text" | "switch-view" | "refresh";
    value: string;
}

export interface GeneratedUiListItem {
    id: string;
    label: string;
    status?: string;
    description?: string;
    path?: string;
}

export interface GeneratedUiKeyValueItem {
    id: string;
    key: string;
    value: string;
}

export type GeneratedUiSection =
    | { id: string; kind: "summary"; content: string }
    | { id: string; kind: "status_list"; items: GeneratedUiListItem[] }
    | { id: string; kind: "steps"; items: GeneratedUiListItem[] }
    | { id: string; kind: "key_value"; items: GeneratedUiKeyValueItem[] }
    | { id: string; kind: "file_list"; items: GeneratedUiListItem[] }
    | { id: string; kind: "action_bar"; actions: GeneratedUiAction[] }
    | { id: string; kind: "markdown"; content: string };

export interface GeneratedUiCardV1 {
    version: "v1";
    id: string;
    title?: string;
    sections: GeneratedUiSection[];
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
    agentId?: string;
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

/**
 * v1.0.5 (Task 24.2): payload shape for the `permission:update` IPC channel.
 * 主进程 extension-ui-bridge 通过此通道下发 4 种更新:
 *  - mode 更新: `{ mode }`
 *  - notify: `{ message, type, workspaceId, agentId }`
 *  - setStatus: `{ key, text, workspaceId, agentId }`
 *  - setTitle: `{ title, workspaceId, agentId }`
 * 各字段可选, 由发送端按调用点填充. 渲染层订阅时按需 narrow.
 */
export interface PermissionUpdatePayload {
    mode?: PermissionMode;
    message?: string;
    type?: "info" | "warning" | "error";
    key?: string;
    text?: string;
    title?: string;
    workspaceId?: string;
    agentId?: string;
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
    status: "pending" | "running" | "completed" | "failed" | "waiting" | "blocked";
}

export interface PlanProgressUpdate {
    workspaceId?: string;
    agentId?: string;
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

// ── Plan file persistence (Task 4: plan IPC surface) ────────────────
// 主进程 PlanFileService 落盘 .pi/plans/*.md,IPC 层用这些类型与渲染层
// 交换数据. shared-types 是权威源,主进程通过 @shared 引入.

export type PlanStatus = "draft" | "executing" | "completed" | "cancelled";

export interface PlanRecord {
    id: string;
    filename: string;
    path: string;
    title: string;
    status: PlanStatus;
    createdAt: number;
    updatedAt: number;
    content: string;
}

export interface PlanCreateInput {
    slug: string;
    title: string;
    content: string;
}

export interface PlanUpdateInput {
    content?: string;
    status?: PlanStatus;
    title?: string;
}

export interface PlanListOptions {
    includeCompleted?: boolean;
    includeCancelled?: boolean;
}

// ── Task IPC surface (Phase B Task 4) ───────────────────────────
// 主进程 TaskRegistry 落盘 task / task_event 表 (SQLite), IPC 层用这些
// 类型与渲染层交换数据. shared-types 是权威源,主进程通过 @shared 引入.
// 字段名 camelCase, 与 task-registry.ts 的 TaskRecord 结构一致.
// 注意: input/options 类型不含 sessionId/id — 这些由 IPC handler 从
// workspaceId 参数解析后注入 registry 调用.

export type TaskStatus = "open" | "in_progress" | "blocked" | "done" | "abandoned";
export type TaskEventKind =
    | "created"
    | "started"
    | "unstarted"
    | "blocked"
    | "unblocked"
    | "done"
    | "abandoned"
    | "renamed";

export interface TaskRecord {
    id: string;
    sessionId: string;
    parentTaskId?: string;
    status: TaskStatus;
    summary: string;
    owner?: string;
    createdAt: number;
    lastEventAt: number;
    endedAt?: number;
    cleanupAfter?: number;
}

export interface TaskCreateInput {
    summary: string;
    parentId?: string;
    owner?: string;
}

export interface TaskListOptions {
    status?: TaskStatus;
    includeTerminal?: boolean;
    includeArchived?: boolean;
}

export interface TaskStartOptions {
    owner?: string;
    eventSummary?: string;
}

export interface TaskBlockOptions {
    eventSummary?: string;
}

export interface TaskRenameInput {
    summary: string;
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

export type AppUpdaterPhase =
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";

export interface AppUpdaterProgress {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
}

export interface AppUpdaterState {
    phase: AppUpdaterPhase;
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    releaseNotes: string | null;
    progress: AppUpdaterProgress | null;
    lastCheckedAt: number | null;
    disabledReason: string | null;
    error: string | null;
    releasePageUrl: string;
}

// Pi 事件 — 走 @shared/events 那个跨进程 union 类型, 不在这里重新定义
// (避免两套 PiEvent 互相 conflict)
import type { PiEvent, PiEventType } from "./events";
export type { PiEvent, PiEventType };

// ── IPC 错误契约 (v1.0.6.1) ──────────────────────────────────────
// 主进程 IPC handler 失败时返回 IpcError 形状, 渲染层根据 code 走 t() 翻译.
// 不要 throw 中文 Error: 用户切到 en-US 看到的还是中文.
export interface IpcError {
    /**
     * 品牌标记 (discriminated union brand): 强制 IpcError 只能经 ipcError() 工厂构造,
     * 避免普通 { code, fallback } 形状被误判为 IpcError. 编译期 nominal 类型,
     * 运行期由 isIpcError() 优先识别.
     */
    __brand: "IpcError";
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
    return { __brand: "IpcError", code, fallback, params };
}

/**
 * 类型守卫: 判断 unknown 是否是 IpcError (供渲染层 .catch 用).
 * 优先匹配 `__brand === "IpcError"` (ipcError() 工厂产物);
 * 兼容回退到 `code+fallback` 形状, 以识别旧 test mock / 序列化数据 / 未走工厂的构造.
 * 迁移完成 (全部改用 ipcError() 工厂) 后可移除回退分支, 收紧为纯品牌判等.
 */
export function isIpcError(value: unknown): value is IpcError {
    if (value === null || typeof value !== "object") return false;
    const v = value as { __brand?: unknown; code?: unknown; fallback?: unknown };
    if (v.__brand === "IpcError") return true;
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

export interface GitChangedFile {
    path: string;
    status: "modified" | "added" | "deleted" | "renamed";
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

export interface InlinePlanMaterializeInput {
    workspaceId: string;
    title: string;
    content: string;
    preferredFilename?: string;
}

export interface InlinePlanMaterializeResult {
    filename: string;
    path: string;
}

// ── Window.piAPI / nodeAPI 全局类型 ───────────────────────────────

export type Unsubscribe = () => void;

export interface PiAPI {
    // Pi Driver
    sendPrompt(workspaceId: string, message: string, options?: SendPromptOptions): Promise<unknown>;
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
    updaterGetState(): Promise<AppUpdaterState | IpcError>;
    updaterCheck(): Promise<AppUpdaterState | IpcError>;
    updaterDownload(): Promise<AppUpdaterState | IpcError>;
    updaterInstall(): Promise<AppUpdaterState | IpcError>;
    onUpdaterStateChanged(cb: (state: AppUpdaterState) => void): Unsubscribe;

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
    createEmptyWorkspace(name: string, parentPath: string): Promise<Workspace | IpcError>;
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
    agentsSetThinking(agentId: string, level: "none" | "low" | "medium" | "high"): Promise<void>;
    onAgentsState(cb: (agents: AgentTab[]) => void): Unsubscribe;
    onAgentMessages(cb: (payload: { agentId: string; messages: AgentMessage[] }) => void): Unsubscribe;
    onAgentEvent(cb: (payload: { agentId: string; workspaceId: string; event: PiEvent }) => void): Unsubscribe;

    listSlashCommands(workspaceId: string, agentId?: string, mode?: AgentMode): Promise<PiSlashCommand[] | IpcError>;
    runBuiltinSlashCommand(input: RunBuiltinSlashCommandInput): Promise<SlashCommandRunResult | IpcError>;
    runtimeFeatureState(): Promise<MiMoCodeRuntimeFeatureState | IpcError>;
    memorySearch(input: LongHorizonMemorySearchInput): Promise<LongHorizonMemoryRecord[] | IpcError>;
    memoryListRecent(input: LongHorizonMemoryRecentInput): Promise<LongHorizonMemoryRecord[] | IpcError>;
    /** @deprecated Legacy per-source snapshot list — use taskList(workspaceId, options?) for the new registry-backed API. */
    legacyTaskList(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord[] | IpcError>;
    /** @deprecated Legacy active lookup — use taskGet(workspaceId, id) for the new registry-backed API. */
    legacyTaskGetActive(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord | null | IpcError>;
    // Phase B Task 4: task IPC surface — 9 methods backed by TaskRegistry.
    // workspaceId is resolved to sessionId in the IPC handler (Task 1 migration:
    // session_id = workspace_id).
    taskCreate(workspaceId: string, input: TaskCreateInput): Promise<TaskRecord | IpcError>;
    taskList(workspaceId: string, options?: TaskListOptions): Promise<TaskRecord[] | IpcError>;
    taskGet(workspaceId: string, id: string): Promise<TaskRecord | null | IpcError>;
    taskStart(workspaceId: string, id: string, options?: TaskStartOptions): Promise<TaskRecord | IpcError>;
    taskBlock(workspaceId: string, id: string, options?: TaskBlockOptions): Promise<TaskRecord | IpcError>;
    taskUnblock(workspaceId: string, id: string, options?: TaskBlockOptions): Promise<TaskRecord | IpcError>;
    taskDone(workspaceId: string, id: string, options?: TaskBlockOptions): Promise<TaskRecord | IpcError>;
    taskAbandon(workspaceId: string, id: string, options?: TaskBlockOptions): Promise<TaskRecord | IpcError>;
    taskRename(workspaceId: string, id: string, input: TaskRenameInput): Promise<TaskRecord | IpcError>;

    // Extension UI bridge
    permissionSetMode(mode: PermissionMode): Promise<void>;
    permissionRespond(requestId: string, response: ExtensionUiResponse | PermissionDecision): void;
    onPermissionRequest(cb: (req: ExtensionUiRequest) => void): Unsubscribe;
    onPermissionUpdate(cb: (payload: PermissionUpdatePayload) => void): Unsubscribe;

    planSetEnabled(workspaceId: string, enabled: boolean): Promise<void>;
    planMaterialize(input: InlinePlanMaterializeInput): Promise<InlinePlanMaterializeResult | IpcError>;
    // Task 4: plan file CRUD IPC surface (delegated to PlanFileService).
    planCreate(workspaceId: string, input: PlanCreateInput): Promise<PlanRecord | IpcError>;
    planList(workspaceId: string, options?: PlanListOptions): Promise<PlanRecord[] | IpcError>;
    planGet(workspaceId: string, filename: string): Promise<PlanRecord | null | IpcError>;
    planUpdate(workspaceId: string, filename: string, input: PlanUpdateInput): Promise<PlanRecord | IpcError>;
    planComplete(workspaceId: string, filename: string): Promise<PlanRecord | IpcError>;
    planDelete(workspaceId: string, filename: string): Promise<void | IpcError>;
    planRespond(requestId: string, decision: "execute" | "refine" | "cancel", text?: string): void;
    onPlanCard(cb: (card: PlanCard) => void): Unsubscribe;
    onPlanDecisionRequest(cb: (req: PlanDecisionRequest) => void): Unsubscribe;
    onPlanProgress(cb: (update: PlanProgressUpdate) => void): Unsubscribe;
    goalSet(input: GoalSetInput): Promise<GoalState | IpcError>;
    goalClear(workspaceId: string, agentId?: string): Promise<GoalState | IpcError>;
    goalGet(workspaceId: string, agentId?: string): Promise<GoalState | null | IpcError>;
    // Phase C Task 4: manually trigger the judge LLM against the active goal.
    // Returns the GoalVerdict (or IpcError when goal/workspace missing / disabled).
    // The verdict is also broadcast via onGoalEvaluation so the UI can render a
    // per-turn judge marker even for manual invocations.
    goalEvaluate(workspaceId: string, agentId?: string): Promise<GoalVerdict | IpcError>;
    /** Subscribe to goal:evaluation events (judge verdict broadcast). Returns an unsubscribe. */
    onGoalEvaluation(cb: (event: GoalEvaluationEvent) => void): Unsubscribe;
    onGoalChanged(cb: (goal: GoalState) => void): Unsubscribe;

    // Git
    getGitStatus(workspacePath: string): Promise<GitStatus | null | IpcError>;
    gitDiff(workspacePath: string, filePath?: string): Promise<string | IpcError>;
    gitDiffStaged(workspacePath: string): Promise<string | IpcError>;
    gitAdd(workspacePath: string, files: string[]): Promise<void | IpcError>;
    gitUnstage(workspacePath: string, files: string[]): Promise<void | IpcError>;
    gitCommit(workspacePath: string, message: string): Promise<string | IpcError>;
    gitLog(workspacePath: string, count?: number): Promise<GitLogEntry[] | IpcError>;
    gitBranches(workspacePath: string): Promise<GitBranch[] | IpcError>;
    gitCheckout(workspacePath: string, branch: string): Promise<GitBranch[] | IpcError>;
    gitCreateBranch(workspacePath: string, branchName: string): Promise<GitBranch[] | IpcError>;
    gitOriginalContent(workspacePath: string, filePath: string): Promise<string | IpcError>;
    gitChangedFiles(workspacePath: string): Promise<GitChangedFile[] | IpcError>;

    // Project detection & file tree
    detectProject(workspacePath: string): Promise<ProjectInfo | IpcError>;
    getFileTree(workspacePath: string, maxDepth?: number): Promise<FileTreeNode | IpcError>;

    // Settings
    getSettings(): Promise<AppSettings>;
    setSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
    onSettingsChanged(cb: (settings: AppSettings) => void): Unsubscribe;
    onPiConfigChanged(cb: () => void): Unsubscribe;
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
    configListManagedModels(): Promise<ManagedModelsResult>;
    configSaveManagedModel(input: ManagedModelSaveInput): Promise<ConfigValidationResult>;
    configDeleteManagedModel(input: ManagedModelDeleteInput): Promise<ConfigValidationResult>;
    configSetDefaultModel(providerId: string, modelId: string): Promise<ConfigValidationResult>;
    configFetchModels(baseUrl: string, apiKey?: string, apiType?: string): Promise<PiModelItem[] | IpcError>;
    configTestProvider(input: {
        baseUrl: string;
        providerId?: string;
        apiKey?: string;
        modelId?: string;
        apiType?: string;
        api?: string;
        headers?: Record<string, string>;
    }): Promise<ProviderTestResult | IpcError>;

    // Codex session import
    codexSessionsScan(workspacePath: string): Promise<CodexSessionSummary[]>;
    codexSessionsImport(workspacePath: string, sourcePaths: string[]): Promise<CodexImportReport>;
    claudeSessionsScan(workspacePath: string): Promise<ClaudeSessionSummary[]>;
    claudeSessionsImport(workspacePath: string, sourcePaths: string[]): Promise<ClaudeImportReport>;

    // Skills
    listSkills(input?: { workspaceId?: string }): Promise<InstalledSkillInfo[] | IpcError>;

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

    // v1.2: Workbench context — renderer pushes currently-viewed file to main
    setWorkbenchContext(workspaceId: string, filePath: string | null): void;

    // Settings independent window
    openSettingsWindow(): Promise<void>;
    closeSettingsWindow(): Promise<void>;

    // v1.1.0: 识图功能 (vision)
    describeImages?(images: Array<{
        name: string;
        dataUrl: string;
        mimeType?: string;
    }>): Promise<{ text: string }>;

    // v2.0: Generic invoke for low-frequency channels (converged from 60+ direct methods)
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    // v2.1: Generic send for fire-and-forget channels (ipcMain.on). Never await, never hang.
    send(channel: string, ...args: unknown[]): void;
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

// ── Subagent (Phase E) ──────────────────────────────────────────
// Authority source for subagent type/instance/result shapes consumed by
// `services/subagent/*` (registry / session / manager / actor-tool /
// auto-scheduler). Shapes are inferred from actual usage in those files —
// do not narrow without updating the consuming switch/exhaustive checks.

export type SubagentTypeID = "explore" | "dream" | "distill" | "checkpoint-writer";

export type SubagentStatus = "pending" | "running" | "idle" | "cancelled" | "failed" | "timeout";

/**
 * Static definition of a subagent type. Mirrors `BUILTIN_SUBAGENTS` in
 * `services/subagent/registry.ts` — `name` is the discriminant (used as the
 * `SubagentTypeID` map key), `hidden` excludes a type from `listSpawnable()`
 * (so the `actor` tool's enum refuses it), and `interactive` is informational
 * (reserved for the Phase F+ permission engine).
 */
export interface SubagentType {
    name: SubagentTypeID;
    description: string;
    prompt: string;
    toolAllowlist: string[];
    hidden?: boolean;
    interactive?: boolean;
}

/**
 * Live runtime snapshot of a spawned subagent, mirrored from
 * `SubagentSessionSnapshot` (defined locally in `services/subagent/session.ts`
 * — that interface is NOT shared). `SubagentManager` keeps a flat
 * `Map<actorId, SubagentInstance>` for fast `status()` / `listInstances()`
 * lookups without touching the underlying session.
 */
export interface SubagentInstance {
    actorId: string;
    agentId: string;
    workspaceId: string;
    subagentType: SubagentTypeID;
    description: string;
    status: SubagentStatus;
    turnCount: number;
    createdAt: number;
    lastTurnTime?: number;
    lastOutcome?: string;
    terminatedAt?: number;
}

/**
 * Terminal outcome of a subagent run. Constructed by `SubagentSession.run()`
 * (success path) and the catch blocks of `run()` / `SubagentManager.spawn()`
 * (failure paths). `status` is the exhaustive union consumed by
 * `actor-tool.ts`'s `formatResult` switch — keep the literal union exact.
 */
export interface SubagentResult {
    actorId: string;
    status: "success" | "cancelled" | "timeout" | "failed";
    lastAssistantText?: string;
    error?: string;
    turnCount: number;
    startedAt: number;
    endedAt: number;
}

// ── Permission (Phase E) ────────────────────────────────────────
// Authority source for the 4-layer permission model consumed by
// `services/permission/*` (types.ts re-exports these) and
// `services/agent-modes/agent-info.ts` (`AgentInfo.permission` /
// `hardPermission`). `PermissionAskInput` / `PermissionReplyInput` remain
// main-process-only (defined locally in permission/types.ts).

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionRule {
    permission: string;
    pattern: string;
    action: PermissionAction;
    reason?: string;
}

export type PermissionRuleset = readonly PermissionRule[];

export type PermissionReply = "allow" | "deny";

/**
 * Shared subset of `PermissionAskInput` (main-process-only fields like
 * `sessionID` / `ruleset` / `interactive` are kept optional so this type
 * carries only the renderer-visible request shape).
 */
export interface PermissionRequest {
    id: string;
    sessionID?: string;
    permission: string;
    patterns: readonly string[];
    metadata?: Record<string, unknown>;
    always?: readonly string[];
    tool?: {
        messageID: string;
        callID: string;
    };
    ruleset?: PermissionRuleset;
    interactive?: boolean;
}

// ── Session Summary (Phase E) ───────────────────────────────────
// Consumed by `services/subagent/session-summary-service.ts` and
// `services/subagent/tools/session-summary-tools.ts`. Field names match the
// `toSummary` / `toSessionMessage` helper output exactly (NOT the spec
// skeleton — the actual implementation uses `text` / `createdAt` rather than
// `content` / `timestamp`).

export interface SessionMessage {
    role: string;
    text: string;
    createdAt: number;
    toolNames?: string[];
}

export interface SessionSummary {
    sessionId: string;
    workspaceId: string;
    title?: string;
    createdAt: number;
    lastMessageAt: number;
    messageCount: number;
}
