// Frontend Type Definitions
// v1.0.5: 大部分类型迁移到 @shared (跨进程共享). 这里只保留 renderer 独有的
// (ProjectInfo, FileTreeNode) 和 store 内部用的旧 alias (WorkspaceData / SessionData),
// 它们正逐步替换为 @shared/Workspace / @shared/Session.

// 跨进程共享类型 re-export (Ui 组件想用 @shared 也行, 但保留这个 barrel 兼容)
export type {
    PiEvent,
    PiStatus as PiDriverStatus,
    PiInstallProgress,
    GitBranch as BranchInfo,
    GitLogEntry as CommitInfo,
    AppSettings as AppSettingsData,
} from "@shared";

// 共享 ProjectInfo: ProjectPanel 用了 ProjectInfo (renderer 独有, 不在 @shared)
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

// file tree (renderer 独有, 跟 ProjectPanel 配套)
export interface FileTreeNode {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileTreeNode[];
    extension?: string;
    size?: number;
}

// Skill/Plugin (renderer 暂时用本地类型, 后续统一到 @shared)
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
    type: "provider" | "extension" | "tool";
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

// Workspace/Session store 内部用 (v1.0.5 跟 @shared/Workspace 同一形状,
// 但 store 类型独立, 不强求 store 走 @shared, 后续 v1.0.6 慢慢替换)
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

// Pi Config (settings panel 用)
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

// ── Messaging Gateway Types (v1.0.0 残留, v1.0.1 已砍 IM 桥, 留接口防回归) ──

export type GatewayPlatform = "wechat" | "feishu" | "qq";

export interface PlatformMessage {
    id: string;
    platform: GatewayPlatform;
    chatId: string;
    chatName: string;
    chatType: "private" | "group";
    senderId: string;
    senderName: string;
    content: string;
    contentType: "text" | "image" | "file" | "voice";
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
    replyMode: "pi" | "echo";
}

// PiAPI / NodeAPI / Window — 全部从 @shared 来, 这里不再重复声明.
// 若需要扩展 renderer 独有字段, 用 interface merge:
//   import type { PiAPI as SharedPiAPI } from "@shared";
//   export interface PiAPI extends SharedPiAPI { ... }
export type { PiAPI, NodeAPI, Unsubscribe } from "@shared";
