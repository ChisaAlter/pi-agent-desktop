// IPC handler zod schemas (security hardening)
// 每个 schema 验证对应 IPC handler 的入参, 无效输入抛 z.ZodError.
// 覆盖范围: 文件操作, git, 终端, 会话, 设置, 工作区, 代理, codex 导入, 工作台上下文.

import { z } from "zod";

// workspace:create — 验证 name 和 path 都是非空 string
export const workspaceCreateSchema = z.tuple([
    z.string().min(1, "name must be a non-empty string"),
    z.string().min(1, "path must be a non-empty string"),
]);

const permissionModeSchema = z.enum(["ask", "smart", "always", "read", "partial", "full"]);
const agentModeSchema = z.enum(["build", "plan", "compose"]);

const piConfigSchema = z
    .object({
        provider: z.string(),
        model: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
    })
    .strict();

const longHorizonToggleSchema = z.object({ enabled: z.boolean() }).strict();

const longHorizonSchema = z
    .object({
        enabled: z.boolean(),
        defaultMode: agentModeSchema,
        planMode: longHorizonToggleSchema,
        composeMode: longHorizonToggleSchema,
        maxMode: longHorizonToggleSchema.extend({
            candidates: z.number().int().min(1).max(20).optional(),
        }),
        memory: longHorizonToggleSchema.extend({
            ccIndex: z.boolean().optional(),
            reconcileOnSearch: z.boolean().optional(),
            searchScoreFloor: z.number().min(0).max(1).optional(),
        }),
        history: longHorizonToggleSchema,
        checkpoint: longHorizonToggleSchema,
        goal: longHorizonToggleSchema,
        subagents: longHorizonToggleSchema,
        task: longHorizonToggleSchema,
        actor: longHorizonToggleSchema,
        workflow: longHorizonToggleSchema.extend({
            maxConcurrentAgents: z.number().int().min(1).max(64).optional(),
            maxLifecycleAgents: z.number().int().min(1).max(1000).optional(),
            maxDepth: z.number().int().min(1).max(16).optional(),
        }),
        dream: longHorizonToggleSchema,
        distill: longHorizonToggleSchema,
        composeWorkflow: longHorizonToggleSchema.optional(),
    })
    .strict();

const shortcutOverrideSchema = z.object({
    id: z.string().min(1).max(128),
    keys: z.string().min(1).max(64),
}).strict();

const appSettingsSchema = z
    .object({
        theme: z.enum(["light", "dark", "system"]),
        fontSize: z.number().int().min(10).max(32),
        model: z.string(),
        provider: z.string(),
        apiKey: z.string().optional(),
        temperature: z.number().min(0).max(2),
        maxTokens: z.number().int().min(1).max(262144),
        autoSave: z.boolean(),
        showLineNumbers: z.boolean(),
        wordWrap: z.boolean(),
        language: z.string().optional(),
        piConfig: piConfigSchema.optional(),
        permissionLevel: permissionModeSchema.optional(),
        managedRuntimePath: z.string().optional(),
        runtimeChannel: z.enum(["stable", "latest"]).optional(),
        autoCompactionEnabled: z.boolean().optional(),
        sidebarGroupMode: z.enum(["date", "workspace"]).optional(),
        visionProvider: z.string().optional(),
        visionModel: z.string().optional(),
        showThinking: z.boolean().optional(),
        thinkingLevel: z.enum(["none", "low", "medium", "high"]).optional(),
        shortcutOverrides: z.array(shortcutOverrideSchema).max(200).optional(),
        workspaceToolDefaults: z.record(z.string(), z.record(z.enum([
            "fileRead",
            "fileWrite",
            "shell",
            "git",
            "network",
            "extensions",
        ]), z.boolean())).optional(),
        longHorizon: longHorizonSchema.optional(),
    })
    .strict();

// settings:set — 只允许 AppSettings 已知字段和值域,避免 renderer 保存虚假运行时状态.
export const settingsSetSchema = z.tuple([
    appSettingsSchema.partial().refine((value) => Object.keys(value).length > 0, {
        message: "settings update must include at least one known field",
    }),
]);

// git:commit — 验证 message 是非空 string
export const gitCommitSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.string().min(1, "message must be a non-empty string"),
]);

// git:add — 验证 workspacePath 是 string, files 是 string[] (允许空数组走 "no-op" 分支)
export const gitAddSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.array(z.string()).max(10000, "files array is too large"),
]);

export const gitDiffSchema = z.union([
    z.tuple([z.string().min(1, "workspacePath must be a non-empty string")]),
    z.tuple([
        z.string().min(1, "workspacePath must be a non-empty string"),
        z.string().min(1, "filePath must be a non-empty string"),
    ]),
]);

export const gitDiffStagedSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

// git:undo — 撤销单个文件改动, filePath 允许 git 相对路径或绝对路径, handler 再做 workspace/protected 校验
export const gitUndoSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.string().min(1, "filePath must be a non-empty string"),
]);

export const gitCheckoutSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.string().min(1, "branch must be a non-empty string"),
]);

export const gitCreateBranchSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.string().min(1, "branchName must be a non-empty string"),
]);

export const gitOriginalContentSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.string().min(1, "filePath must be a non-empty string"),
]);

export const gitChangedFilesSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

// git:status — (workspacePath: string) git working tree status
export const gitStatusSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

// git:log — (workspacePath: string, count?: number = 20) commit history
export const gitLogSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.number().int().min(1, "count must be a positive integer").max(1000, "count is too large").optional(),
]);

// git:branches — (workspacePath: string) list local + remote branches
export const gitBranchesSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

// terminal:input — 验证 id 和 data 都是 string (ptyManager.write 需要这两个)
export const terminalCreateSchema = z.tuple([
    z
        .object({
            id: z.string().min(1, "terminalId must be a non-empty string").optional(),
            cwd: z.string().min(1, "cwd must be a non-empty string").optional(),
            cols: z.number().int().min(20).max(500).optional(),
            rows: z.number().int().min(4).max(200).optional(),
        })
        .strict(),
]);

export const terminalInputSchema = z.tuple([
    z.string().min(1, "terminalId must be a non-empty string"),
    z.string().min(1, "data must be a non-empty string"),
]);

export const terminalResizeSchema = z.tuple([
    z.string().min(1, "terminalId must be a non-empty string"),
    z.number().int().min(20).max(500),
    z.number().int().min(4).max(200),
]);

// ── Tool call schema ──────────────────────────────────────
// Validates tool call entries embedded in session messages.
const toolCallSchema = z.object({
    id: z.string(),
    name: z.string(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    // Allow the union of all status values used across ToolCall variants in shared-types
    // (pending/running/completed/error/success/failed/refining/executing/pausing/paused/executed/cancelled/waiting/blocked).
    // Keeping this permissive avoids rejecting persisted tool calls during appendMessage.
    status: z.string().optional(),
});

// ── Session messages persistence schemas ──────────────────
// Session CRUD schemas are defined above (string[]/string).
// Below are the 3 message persistence schemas.

// session:append-message — (sessionId: string, message: object)
export const appendMessageSchema = z.tuple([
    z.string().min(1, "sessionId must be a non-empty string"),
    z
        .object({
            id: z.string().min(1),
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
            timestamp: z.union([z.string(), z.date(), z.number()]),
            thinking: z.string().optional(),
            toolCalls: z.array(toolCallSchema).max(1000).optional(),
        })
        .passthrough(), // 允许额外字段,真值由 services/session-store 决定
]);

// session:update-message — (sessionId, messageId, updates: Partial<Message>)
export const updateMessageSchema = z.tuple([
    z.string().min(1, "sessionId must be a non-empty string"),
    z.string().min(1, "messageId must be a non-empty string"),
    z
        .object({
            id: z.string().optional(),
            role: z.enum(["user", "assistant", "system"]).optional(),
            content: z.string().optional(),
            timestamp: z.union([z.string(), z.date(), z.number()]).optional(),
            thinking: z.string().optional(),
            toolCalls: z.array(toolCallSchema).max(1000).optional(),
        })
        .passthrough(),
]);

// session:update-tool-call — (sessionId, messageId, toolCallId, updates: Partial<ToolCall>)
export const updateToolCallSchema = z.tuple([
    z.string().min(1, "sessionId must be a non-empty string"),
    z.string().min(1, "messageId must be a non-empty string"),
    z.string().min(1, "toolCallId must be a non-empty string"),
    z
        .object({
            id: z.string().optional(),
            name: z.string().optional(),
            input: z.unknown().optional(),
            output: z.unknown().optional(),
            status: z.enum(["pending", "running", "completed", "error"]).optional(),
            startTime: z.union([z.string(), z.date(), z.number()]).optional(),
            endTime: z.union([z.string(), z.date(), z.number()]).optional(),
        })
        .passthrough(),
]);

export const archiveSessionSchema = z.tuple([
    z.string().min(1, "sessionId must be a non-empty string"),
    z.boolean(),
]);

export const updateSessionMetadataSchema = z.tuple([
    z.string().min(1, "sessionId must be a non-empty string"),
    z
        .object({
            summary: z.string().optional(),
            lastOutputPaths: z.array(z.string()).max(1000, "lastOutputPaths array is too large").optional(),
            favorite: z.boolean().optional(),
            tags: z.array(z.string()).max(1000, "tags array is too large").optional(),
            archived: z.boolean().optional(),
            readOnly: z.boolean().optional(),
            lastOpenedAt: z.number().nonnegative("lastOpenedAt must be non-negative").optional(),
            usage: z
                .object({
                    provider: z.string().optional(),
                    model: z.string().optional(),
                    contextWindow: z.number().optional(),
                    inputTokens: z.number().optional(),
                    outputTokens: z.number().optional(),
                    totalTokens: z.number().optional(),
                    estimatedCostUsd: z.number().optional(),
                    compactionStatus: z.enum(["idle", "running", "completed", "unsupported"]).optional(),
                    updatedAt: z.number(),
                })
                .optional(),
            toolPermissions: z.record(z.enum([
                "fileRead",
                "fileWrite",
                "shell",
                "git",
                "network",
                "extensions",
            ]), z.boolean()).optional(),
            parentSessionId: z.string().optional(),
            forkedFromMessageId: z.string().optional(),
            forkedAt: z.number().optional(),
        })
        .strict(),
]);

const packageSourceValueSchema = z
    .string()
    .min(1, "package source must be a non-empty string")
    .max(256, "package source is too long")
    .refine((value) => value.trim() === value, "package source must not have surrounding whitespace")
    .refine((value) => {
        for (const ch of value) {
            const code = ch.charCodeAt(0);
            if (/\s/.test(ch) || code < 32 || code === 127) return false;
        }
        return true;
    }, "package source must not contain whitespace or control characters")
    .refine((value) => {
        if (/^(npm|git|https?|ssh|file):/.test(value)) return true;
        return /^(?:@[\w.-]+\/)?[\w.-]+$/.test(value);
    }, "package source must be a package name or supported source URI");

export const packageSourceSchema = z.tuple([packageSourceValueSchema]);

export const packageSearchSchema = z.tuple([
    z.string().max(256, "search query is too long"),
]);

const fileTreeOptionsSchema = z
    .object({
        maxDepth: z.number().int().min(0).max(20).optional(),
        maxEntries: z.number().int().min(1).max(10000).optional(),
    })
    .strict();

const fileSearchOptionsSchema = z
    .object({
        limit: z.number().int().min(1).max(200).optional(),
    })
    .strict();

export const getFileTreeSchema = z.union([
    z.tuple([z.string().min(1, "workspacePath must be a non-empty string")]),
    z.tuple([
        z.string().min(1, "workspacePath must be a non-empty string"),
        fileTreeOptionsSchema,
    ]),
]);

export const readTextFileSchema = z.union([
    z.tuple([z.string().min(1, "targetPath must be a non-empty string")]),
    z.tuple([
        z.string().min(1, "targetPath must be a non-empty string"),
        z.string().min(1, "workspacePath must be a non-empty string"),
    ]),
]);

export const searchFilesSchema = z.union([
    z.tuple([
        z.string().min(1, "workspacePath must be a non-empty string"),
        z.string().min(1, "query must be a non-empty string").max(256, "query is too long"),
    ]),
    z.tuple([
        z.string().min(1, "workspacePath must be a non-empty string"),
        z.string().min(1, "query must be a non-empty string").max(256, "query is too long"),
        fileSearchOptionsSchema,
    ]),
]);

export const listFilesSchema = z.union([
    z.tuple([z.string().min(1, "workspacePath must be a non-empty string")]),
    z.tuple([
        z.string().min(1, "workspacePath must be a non-empty string"),
        z.string(),
    ]),
]);

export const writeTextFileSchema = z.union([
    z.tuple([
        z.string().min(1, "targetPath must be a non-empty string"),
        z.string().max(1024 * 1024, "content is too large"),
    ]),
    z.tuple([
        z.string().min(1, "targetPath must be a non-empty string"),
        z.string().max(1024 * 1024, "content is too large"),
        z.string().min(1, "workspacePath must be a non-empty string"),
    ]),
    z.tuple([
        z.string().min(1, "targetPath must be a non-empty string"),
        z.string().max(1024 * 1024, "content is too large"),
        z.string().min(1, "workspacePath must be a non-empty string"),
        z
            .object({
                expectedMtimeMs: z.number().finite().nonnegative().optional(),
            })
            .strict(),
    ]),
]);

// ── Agent IPC schemas ──────────────────────────────────────

export const agentsCreateSchema = z.object({
    workspaceId: z.string().min(1),
    title: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    sessionPath: z.string().min(1).optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
});

export const agentsPromptSchema = z.object({
    agentId: z.string().min(1, "agentId must be a non-empty string"),
    message: z.string().min(1, "message must be a non-empty string"),
    streamingBehavior: z.enum(["steer", "followUp"]).optional(),
    mode: agentModeSchema.optional(),
});

export const agentsIdSchema = z.tuple([
    z.string().min(1, "agentId must be a non-empty string"),
]);

export const agentsSetThinkingSchema = z.tuple([
    z.string().min(1, "agentId must be a non-empty string"),
    z.enum(["none", "low", "medium", "high"]),
]);

// ── Codex session import schemas ──────────────────────────

export const codexScanSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

export const codexImportSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.array(z.string().min(1), { message: "sourcePaths must be an array of non-empty strings" }).max(100, "sourcePaths array is too large"),
]);

export const claudeScanSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

export const claudeImportSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.array(z.string().min(1), { message: "sourcePaths must be an array of non-empty strings" }).max(100, "sourcePaths array is too large"),
]);

// ── Workbench context schema ───────────────────────────────

export const workbenchSetActiveFileSchema = z.tuple([
    z.string().min(1, "workspaceId must be a non-empty string"),
    z.union([z.string().min(1), z.null()]),
]);
