// Electron Preload Script - Secure API Bridge
// v1.0.5: 返回类型用 @shared/PiAPI 强类型化, 去掉所有 :any / as any

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
    PiStatus,
    PiInstallProgress,
    ApprovalRequest,
    DeferredEdit,
    FileReview,
    PiEvent,
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
    sendPrompt: (workspaceId, message) => ipcRenderer.invoke("pi:send", workspaceId, message),

    onEvent: (cb) => subscribe<PiEvent>("pi:event", cb),
    onError: (cb) => subscribe<string>("pi:error", cb),
    onPiJsonEvent: (cb) => subscribe<Record<string, unknown>>("pi:json-event", cb),

    // Pi Driver 状态
    getStatus: () => ipcRenderer.invoke("pi:status") as Promise<PiStatus>,
    refreshPiStatus: () => ipcRenderer.invoke("pi:refresh-status") as Promise<PiStatus>,
    installPi: () => ipcRenderer.invoke("pi:install") as Promise<PiStatus>,
    updatePi: () => ipcRenderer.invoke("pi:update") as Promise<PiStatus>,
    uninstallPi: () => ipcRenderer.invoke("pi:uninstall") as Promise<PiStatus>,
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

    // Git
    gitUndo: (workspacePath, filePath) =>
        ipcRenderer.invoke("git:undo", workspacePath, filePath),

    // Pi stop
    stop: () => ipcRenderer.invoke("pi:stop"),

    // Workspace
    listWorkspaces: () => ipcRenderer.invoke("workspace:list"),
    createWorkspace: (name, path) => ipcRenderer.invoke("workspace:create", name, path),
    deleteWorkspace: (id) => ipcRenderer.invoke("workspace:delete", id),
    selectWorkspace: (path) => ipcRenderer.invoke("workspace:select", path),
    selectDirectory: () => ipcRenderer.invoke("workspace:select-directory"),

    // Session
    listSessions: () => ipcRenderer.invoke("session:list"),
    createSession: (workspaceId, title) => ipcRenderer.invoke("session:create", workspaceId, title),
    deleteSession: (id) => ipcRenderer.invoke("session:delete", id),

    // Git
    getGitStatus: (workspacePath) => ipcRenderer.invoke("git:status", workspacePath),
    gitDiff: (workspacePath, filePath) =>
        ipcRenderer.invoke("git:diff", workspacePath, filePath),
    gitDiffStaged: (workspacePath) => ipcRenderer.invoke("git:diff-staged", workspacePath),
    gitAdd: (workspacePath, files) => ipcRenderer.invoke("git:add", workspacePath, files),
    gitCommit: (workspacePath, message) => ipcRenderer.invoke("git:commit", workspacePath, message),
    gitLog: (workspacePath, count) => ipcRenderer.invoke("git:log", workspacePath, count),
    gitBranches: (workspacePath) => ipcRenderer.invoke("git:branches", workspacePath),

    // Project detection
    detectProject: (workspacePath) => ipcRenderer.invoke("project:detect", workspacePath),
    getFileTree: (workspacePath, maxDepth) =>
        ipcRenderer.invoke("project:file-tree", workspacePath, maxDepth),

    // Settings
    getSettings: () => ipcRenderer.invoke("settings:get"),
    setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
    loadPiConfig: () => ipcRenderer.invoke("settings:load-pi-config"),
    getFullConfig: () => ipcRenderer.invoke("pi:get-full-config"),

    // Skills & Plugins
    listSkills: () => ipcRenderer.invoke("pi:list-skills"),
    listPlugins: () => ipcRenderer.invoke("pi:list-plugins"),

    // M2: 文件搜索
    filesList: (workspacePath, query) => ipcRenderer.invoke("files:list", workspacePath, query),

    // M3: SkillHub
    skillsCheck: () => ipcRenderer.invoke("skills:check"),
    skillsSearch: (query) => ipcRenderer.invoke("skills:search", query),
    skillsInstalled: () => ipcRenderer.invoke("skills:installed"),
    skillsInstall: (slug) => ipcRenderer.invoke("skills:install", slug),
    skillsUninstall: (slug) => ipcRenderer.invoke("skills:uninstall", slug),
    skillsToggle: (slug, enabled) => ipcRenderer.invoke("skills:toggle", slug, enabled),
    skillsGithubImport: (url) => ipcRenderer.invoke("skills:github-import", url),

    // M4: Terminal
    createTerminal: (opts) => ipcRenderer.invoke("terminal:create", opts),
    terminalInput: (terminalId, data) => ipcRenderer.invoke("terminal:input", terminalId, data),
    terminalResize: (terminalId, cols, rows) =>
        ipcRenderer.invoke("terminal:resize", terminalId, cols, rows),
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
