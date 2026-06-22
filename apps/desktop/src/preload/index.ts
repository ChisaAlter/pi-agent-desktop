// Electron Preload Script - Secure API Bridge
// v1.0.5: 返回类型用 @shared/PiAPI 强类型化, 去掉所有 :any / as any

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
    PiStatus,
    IpcError,
    PiInstallProgress,
    ApprovalRequest,
    DeferredEdit,
    FileReview,
    PiEvent,
    ExtensionUiRequest,
    ExtensionUiResponse,
    PermissionDecision,
    PermissionMode,
    PlanCard,
    PlanDecisionRequest,
    PlanProgressUpdate,
    AgentMessage,
    AgentRuntimeState,
    AgentTab,
    CodexImportReport,
    CodexSessionSummary,
    ClaudeImportReport,
    ClaudeSessionSummary,
    ConfigValidationResult,
    ManagedModelDeleteInput,
    ManagedModelSaveInput,
    ManagedModelsResult,
    PiAuthFile,
    PiModelItem,
    PiModelsFile,
    PiSettingsFile,
    ProviderTestResult,
    GitStatus,
    GitLogEntry,
    GitBranch,
    GitChangedFile,
    Workspace,
    GoalSetInput,
    GoalState,
} from "@shared";

// 内部 helper: 把 ipcRenderer.on 的 (_event, payload) 签名转成 (payload)
type UnsubFn = () => void;
function subscribe<T>(channel: string, cb: (payload: T) => void): UnsubFn {
    const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.removeListener(channel, handler);
    };
}

type PiAPI = import("@shared").PiAPI;
type NodeAPI = import("@shared").NodeAPI;

const piAPI: PiAPI = {
    // M1: 长连接 Pi session
    sendPrompt: (workspaceId, message, options) => ipcRenderer.invoke("pi:send", workspaceId, message, options),

    onEvent: (cb) => subscribe<PiEvent>("pi:event", cb),
    onError: (cb) => subscribe<string>("pi:error", cb),
    onPiJsonEvent: (cb) => subscribe<Record<string, unknown>>("pi:json-event", cb),

    // Pi Driver 状态
    getStatus: () => ipcRenderer.invoke("pi:status") as Promise<PiStatus | IpcError>,
    refreshPiStatus: () => ipcRenderer.invoke("pi:refresh-status") as Promise<PiStatus | IpcError>,
    installPi: () => ipcRenderer.invoke("pi:install") as Promise<PiStatus | IpcError>,
    updatePi: () => ipcRenderer.invoke("pi:update") as Promise<PiStatus | IpcError>,
    uninstallPi: () => ipcRenderer.invoke("pi:uninstall") as Promise<PiStatus | IpcError>,
    cancelPiOperation: () => ipcRenderer.invoke("pi:cancel-operation"),

    onPiStatusChanged: (cb) => subscribe<PiStatus>("pi:status-changed", cb),
    onPiInstallProgress: (cb) => subscribe<PiInstallProgress>("pi:install-progress", cb),

    // M1: Approval flow
    respondApproval: (requestId, approved) => {
        ipcRenderer.send("approval:respond", requestId, approved);
    },
    onApprovalRequest: (cb) => subscribe<ApprovalRequest>("approval:request", cb),
    onApprovalDeferred: (cb) => subscribe<DeferredEdit>("approval:deferred", cb),
    onApprovalReview: (cb) => subscribe<FileReview>("approval:review", cb),
    // v1.1: 同步 autoApprove 到主进程
    setAutoApprove: (value: boolean) => {
        ipcRenderer.send("approval:set-auto-approve", value);
    },

    // Git
    gitUndo: (workspacePath, filePath) =>
        ipcRenderer.invoke("git:undo", workspacePath, filePath) as Promise<void | IpcError>,

    // Pi stop
    stop: (workspaceId) => ipcRenderer.invoke("pi:stop", workspaceId),

    // Workspace
    listWorkspaces: () => ipcRenderer.invoke("workspace:list") as Promise<Workspace[] | IpcError>,
    createWorkspace: (name, path) => ipcRenderer.invoke("workspace:create", name, path) as Promise<Workspace | IpcError>,
    deleteWorkspace: (id) => ipcRenderer.invoke("workspace:delete", id),
    selectWorkspace: (path) => ipcRenderer.invoke("workspace:select", path) as Promise<void | IpcError>,
    selectDirectory: () => ipcRenderer.invoke("workspace:select-directory") as Promise<string | null | IpcError>,

    // Session
    listSessions: () => ipcRenderer.invoke("session:list"),
    createSession: (workspaceId, title, id) => ipcRenderer.invoke("session:create", workspaceId, title, id),
    renameSession: (id, title) => ipcRenderer.invoke("session:rename", id, title),
    deleteSession: (id) => ipcRenderer.invoke("session:delete", id),
    archiveSession: (id, archived) => ipcRenderer.invoke("session:archive", id, archived),
    updateSessionMetadata: (id, updates) =>
        ipcRenderer.invoke("session:update-metadata", id, updates),
    // 2026-06-06 hotfix: session messages 持久化桥接
    // fire-and-forget,失败由 caller 走 .catch + logger.error,不阻塞 UI 流式响应
    appendMessage: (sessionId, message) =>
        ipcRenderer.invoke("session:append-message", sessionId, message),
    updateMessage: (sessionId, messageId, updates) =>
        ipcRenderer.invoke("session:update-message", sessionId, messageId, updates),
    updateToolCall: (sessionId, messageId, toolCallId, updates) =>
        ipcRenderer.invoke(
            "session:update-tool-call",
            sessionId,
            messageId,
            toolCallId,
            updates,
        ),

    // Agents workbench
    agentsList: () => ipcRenderer.invoke("agents:list") as Promise<AgentTab[]>,
    agentsCreate: (input) => ipcRenderer.invoke("agents:create", input) as Promise<AgentTab>,
    agentsPrompt: (input) => ipcRenderer.invoke("agents:prompt", input) as Promise<void>,
    agentsAbort: (agentId) => ipcRenderer.invoke("agents:abort", agentId) as Promise<void>,
    agentsStop: (agentId) => ipcRenderer.invoke("agents:stop", agentId) as Promise<void>,
    agentsRestart: (agentId) => ipcRenderer.invoke("agents:restart", agentId) as Promise<AgentTab>,
    agentsMessages: (agentId) => ipcRenderer.invoke("agents:messages", agentId) as Promise<AgentMessage[]>,
    agentsRuntimeState: (agentId) =>
        ipcRenderer.invoke("agents:runtime-state", agentId) as Promise<AgentRuntimeState>,
    agentsSetThinking: (agentId, level) =>
        ipcRenderer.invoke("agents:set-thinking", agentId, level) as Promise<void>,
    onAgentsState: (cb) => subscribe<AgentTab[]>("agents:state", cb),
    onAgentMessages: (cb) =>
        subscribe<{ agentId: string; messages: AgentMessage[] }>("agents:message", cb),
    onAgentEvent: (cb) =>
        subscribe<{ agentId: string; workspaceId: string; event: PiEvent }>("agents:event", cb),

    listSlashCommands: (workspaceId, agentId, mode) =>
        ipcRenderer.invoke("pi:list-slash-commands", workspaceId, agentId, mode),
    runBuiltinSlashCommand: (input) =>
        ipcRenderer.invoke("pi:run-builtin-slash-command", input),

    permissionSetMode: (mode: PermissionMode) => ipcRenderer.invoke("permission:set-mode", mode),
    permissionRespond: (
        requestId: string,
        response: ExtensionUiResponse | PermissionDecision | boolean | string,
    ) => {
        ipcRenderer.send("permission:respond", requestId, response);
    },
    onPermissionRequest: (cb) => subscribe<ExtensionUiRequest>("permission:request", cb),
    onPermissionUpdate: (cb) => subscribe<unknown>("permission:update", cb),

    planSetEnabled: (workspaceId, enabled) => ipcRenderer.invoke("plan:set-enabled", workspaceId, enabled),
    planRespond: (requestId, decision, text) => {
        ipcRenderer.send("plan:respond", requestId, decision, text);
    },
    onPlanCard: (cb) => subscribe<PlanCard>("plan:card", cb),
    onPlanDecisionRequest: (cb) => subscribe<PlanDecisionRequest>("plan:decision-request", cb),
    onPlanProgress: (cb) => subscribe<PlanProgressUpdate>("plan:progress", cb),
    goalSet: (input: GoalSetInput) => ipcRenderer.invoke("goal:set", input) as Promise<GoalState | IpcError>,
    goalClear: (workspaceId, agentId) => ipcRenderer.invoke("goal:clear", workspaceId, agentId) as Promise<GoalState | IpcError>,
    goalGet: (workspaceId, agentId) => ipcRenderer.invoke("goal:get", workspaceId, agentId) as Promise<GoalState | null | IpcError>,
    onGoalChanged: (cb) => subscribe<GoalState>("goal:changed", cb),

    // Git
    getGitStatus: (workspacePath) => ipcRenderer.invoke("git:status", workspacePath) as Promise<GitStatus | null | IpcError>,
    gitDiff: (workspacePath, filePath) =>
        ipcRenderer.invoke("git:diff", workspacePath, filePath) as Promise<string | IpcError>,
    gitDiffStaged: (workspacePath) => ipcRenderer.invoke("git:diff-staged", workspacePath) as Promise<string | IpcError>,
    gitAdd: (workspacePath, files) => ipcRenderer.invoke("git:add", workspacePath, files) as Promise<void | IpcError>,
    gitUnstage: (workspacePath, files) => ipcRenderer.invoke("git:unstage", workspacePath, files),
    gitCommit: (workspacePath, message) => ipcRenderer.invoke("git:commit", workspacePath, message) as Promise<string | IpcError>,
    gitLog: (workspacePath, count) => ipcRenderer.invoke("git:log", workspacePath, count) as Promise<GitLogEntry[] | IpcError>,
    gitBranches: (workspacePath) => ipcRenderer.invoke("git:branches", workspacePath) as Promise<GitBranch[] | IpcError>,
    gitCheckout: (workspacePath, branch) => ipcRenderer.invoke("git:checkout", workspacePath, branch) as Promise<GitBranch[] | IpcError>,
    gitCreateBranch: (workspacePath, branchName) => ipcRenderer.invoke("git:create-branch", workspacePath, branchName) as Promise<GitBranch[] | IpcError>,
    gitOriginalContent: (workspacePath, filePath) => ipcRenderer.invoke("git:original-content", workspacePath, filePath) as Promise<string | IpcError>,
    gitChangedFiles: (workspacePath) => ipcRenderer.invoke("git:changed-files", workspacePath) as Promise<GitChangedFile[] | IpcError>,

    // Project detection
    detectProject: (workspacePath) => ipcRenderer.invoke("project:detect", workspacePath),
    getFileTree: (workspacePath, maxDepth) =>
        ipcRenderer.invoke("project:file-tree", workspacePath, maxDepth),

    // Settings
    getSettings: () => ipcRenderer.invoke("settings:get"),
    setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
    onSettingsChanged: (cb) => subscribe("settings:changed", cb),
    loadPiConfig: () => ipcRenderer.invoke("settings:load-pi-config"),
    getFullConfig: () => ipcRenderer.invoke("pi:get-full-config"),

    // Pi config center
    configGetModels: () =>
        ipcRenderer.invoke("config:get-models") as Promise<{ raw: string; parsed: PiModelsFile }>,
    configGetAuth: () =>
        ipcRenderer.invoke("config:get-auth") as Promise<{ raw: string; parsed: PiAuthFile }>,
    configGetSettings: () =>
        ipcRenderer.invoke("config:get-settings") as Promise<{ raw: string; parsed: PiSettingsFile }>,
    configSaveModels: (data) =>
        ipcRenderer.invoke("config:save-models", data) as Promise<ConfigValidationResult>,
    configSaveAuth: (data) =>
        ipcRenderer.invoke("config:save-auth", data) as Promise<ConfigValidationResult>,
    configSaveSettings: (data) =>
        ipcRenderer.invoke("config:save-settings", data) as Promise<ConfigValidationResult>,
    configSaveRaw: (fileName, rawJson) =>
        ipcRenderer.invoke("config:save-raw", fileName, rawJson) as Promise<ConfigValidationResult>,
    configExport: () => ipcRenderer.invoke("config:export") as Promise<string>,
    configImport: (packageJson) =>
        ipcRenderer.invoke("config:import", packageJson) as Promise<ConfigValidationResult>,
    configListManagedModels: () =>
        ipcRenderer.invoke("config:list-managed-models") as Promise<ManagedModelsResult>,
    configSaveManagedModel: (input: ManagedModelSaveInput) =>
        ipcRenderer.invoke("config:save-managed-model", input) as Promise<ConfigValidationResult>,
    configDeleteManagedModel: (input: ManagedModelDeleteInput) =>
        ipcRenderer.invoke("config:delete-managed-model", input) as Promise<ConfigValidationResult>,
    configSetDefaultModel: (providerId, modelId) =>
        ipcRenderer.invoke("config:set-default-model", providerId, modelId) as Promise<ConfigValidationResult>,
    configFetchModels: (baseUrl, apiKey, apiType) =>
        ipcRenderer.invoke("config:fetch-models", baseUrl, apiKey, apiType) as Promise<PiModelItem[] | IpcError>,
    configTestProvider: (input) =>
        ipcRenderer.invoke("config:test-provider", input) as Promise<ProviderTestResult | IpcError>,

    // Codex session import
    codexSessionsScan: (workspacePath) =>
        ipcRenderer.invoke("codex-sessions:scan", workspacePath) as Promise<CodexSessionSummary[]>,
    codexSessionsImport: (workspacePath, sourcePaths) =>
        ipcRenderer.invoke("codex-sessions:import", workspacePath, sourcePaths) as Promise<CodexImportReport>,

    // Claude session import
    claudeSessionsScan: (workspacePath) =>
        ipcRenderer.invoke("claude-sessions:scan", workspacePath) as Promise<ClaudeSessionSummary[]>,
    claudeSessionsImport: (workspacePath, sourcePaths) =>
        ipcRenderer.invoke("claude-sessions:import", workspacePath, sourcePaths) as Promise<ClaudeImportReport>,

    // Skills
    listSkills: () => ipcRenderer.invoke("pi:list-skills"),

    // M2: 文件搜索
    filesList: (workspacePath, query) => ipcRenderer.invoke("files:list", workspacePath, query),
    filesGetTree: (workspacePath, options) => ipcRenderer.invoke("files:getTree", workspacePath, options),
    filesReadTextFile: (path, workspacePath) => ipcRenderer.invoke("files:readTextFile", path, workspacePath),
    filesWriteTextFile: (path, content, workspacePath, options) => ipcRenderer.invoke("files:writeTextFile", path, content, workspacePath, options),
    filesSearch: (workspacePath, query, options) => ipcRenderer.invoke("files:search", workspacePath, query, options),

    // v1.0.13: 多选文件,ChatInput 附件按钮
    selectFiles: (opts) => ipcRenderer.invoke("files:select", opts) as Promise<string[] | IpcError>,

    // M3: SkillHub
    skillsCheck: () => ipcRenderer.invoke("skills:check"),
    skillsSearch: (query) => ipcRenderer.invoke("skills:search", query),
    skillsInstalled: () => ipcRenderer.invoke("skills:installed"),
    skillsInstall: (slug) => ipcRenderer.invoke("skills:install", slug),
    skillsUninstall: (slug) => ipcRenderer.invoke("skills:uninstall", slug),
    skillsToggle: (slug, enabled) => ipcRenderer.invoke("skills:toggle", slug, enabled),
    skillsGithubImport: (url) => ipcRenderer.invoke("skills:github-import", url),
    skillsWriteSkill: (name, content) => ipcRenderer.invoke("skills:write-skill", name, content),

    packagesSearch: (query) => ipcRenderer.invoke("packages:search", query),
    packagesListInstalled: () => ipcRenderer.invoke("packages:list-installed"),
    packagesInstall: (source) => ipcRenderer.invoke("packages:install", source),
    packagesRemove: (source) => ipcRenderer.invoke("packages:remove", source),
    packagesUpdate: (source) => ipcRenderer.invoke("packages:update", source),
    packagesRefreshCatalog: () => ipcRenderer.invoke("packages:refresh-catalog"),

    openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
    revealPath: (path) => ipcRenderer.invoke("shell:reveal-path", path),

    // M4: Terminal
    createTerminal: (opts) => ipcRenderer.invoke("terminal:create", opts),
    terminalInput: (terminalId, data) =>
        ipcRenderer.invoke("terminal:input", terminalId, data) as Promise<void | IpcError>,
    terminalResize: (terminalId, cols, rows) =>
        ipcRenderer.invoke("terminal:resize", terminalId, cols, rows) as Promise<void | IpcError>,
    closeTerminal: (terminalId) => ipcRenderer.invoke("terminal:close", terminalId),
    listTerminals: () => ipcRenderer.invoke("terminal:list"),

    onTerminalOutput: (terminalId, cb) =>
        subscribe<{ id: string; data: string }>("terminal:output", (payload) => {
            if (payload.id === terminalId) cb(payload.data);
        }),
    onTerminalExit: (terminalId, cb) =>
        subscribe<{ id: string; code: number | null }>("terminal:exit", (payload) => {
            if (payload.id === terminalId) cb(payload.code);
        }),

    // v1.0.10 (H3): renderer 日志转主进程 electron-log, fire-and-forget
    log: (level, message, extra) => {
        ipcRenderer.send("log:write", level, message, extra ?? []);
    },

    // v1.1.0: 窗口控制
    windowMinimize: () => ipcRenderer.invoke("window:minimize"),
    windowToggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    windowIsMaximized: () => ipcRenderer.invoke("window:is-maximized") as Promise<boolean>,
    windowClose: () => ipcRenderer.invoke("window:close"),
    onWindowMaximizeChanged: (cb) => subscribe<boolean>("window:maximize-changed", cb),

    // v1.2: Workbench context — renderer tells main which file user is viewing
    setWorkbenchContext: (workspaceId, filePath) => {
        ipcRenderer.send("workbench:set-active-file", workspaceId, filePath);
    },

    // Settings independent window
    openSettingsWindow: () => ipcRenderer.invoke("settings:open-window"),
    closeSettingsWindow: () => ipcRenderer.invoke("settings:close-window"),

    // v2.0: Generic invoke for low-frequency channels without dedicated piAPI methods
    invoke: (channel: string, ...args: unknown[]) => {
        const ALLOWED = [
            "settings:load-pi-config",
            "pi:get-full-config",
            "config:save-raw",
            "config:export",
            "config:import",
            "pi:describe-images",
            "log:write",
            "workbench:set-active-file",
            "approval:respond",
            "approval:set-auto-approve",
            "plan:respond",
            "goal:set",
            "goal:clear",
            "goal:get",
            "permission:respond",
        ];
        if (!ALLOWED.includes(channel)) {
            throw new Error(`Channel not allowed: ${channel}`);
        }
        return ipcRenderer.invoke(channel, ...args);
    },
};

const nodeAPI: NodeAPI = {
    platform: process.platform,
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron,
    },
};

contextBridge.exposeInMainWorld("piAPI", piAPI);
contextBridge.exposeInMainWorld("nodeAPI", nodeAPI);

export { piAPI };
