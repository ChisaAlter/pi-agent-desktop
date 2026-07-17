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
        // Phase C Task 4: goal extended to carry judge model overrides.
        // Mirrors LongHorizonSettings.goal in @shared. Optional fields default
        // to fallback behavior at runtime (judgeProvider/judgeModel unset →
        // use workspace active model; evaluateInterval unset → 0 = stop-gate;
        // maxReact unset → MAX_GOAL_REACT = 12).
        goal: longHorizonToggleSchema.extend({
            judgeProvider: z.string().optional(),
            judgeModel: z.string().optional(),
            evaluateInterval: z.number().int().min(0).optional(),
            maxReact: z.number().int().min(1).max(100).optional(),
        }),
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
        schemaVersion: z.number().int().min(1),
        language: z.string().optional(),
        piConfig: piConfigSchema.optional(),
        permissionLevel: permissionModeSchema.optional(),
        managedRuntimePath: z.string().optional(),
        runtimeChannel: z.enum(["stable", "latest"]).optional(),
        autoCompactionEnabled: z.boolean().optional(),
        generatedUiEnabled: z.boolean().optional(),
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
        .passthrough(), // 允许额外字段,真值由 SessionRepository 决定
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

// project:detect — (workspacePath: string)
// audit round 3, Task 11.1: explicit Zod gate before any project-detector work.
export const projectDetectSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
]);

// project:file-tree — (workspacePath: string, maxDepth?: number 0-20, default 4)
// audit round 3, Task 11.1: cap maxDepth to 20 (mirrors getFileTreeSchema) so a
// renderer-supplied huge maxDepth can't force an unbounded filesystem walk.
export const projectFileTreeSchema = z.union([
    z.tuple([z.string().min(1, "workspacePath must be a non-empty string")]),
    z.tuple([
        z.string().min(1, "workspacePath must be a non-empty string"),
        z.number().int().min(0).max(20),
    ]),
]);

// readTextFileSchema — (targetPath, workspacePath) workspacePath is REQUIRED
// (audit round 3, Task 1.1): removing the single-element tuple form closes the
// workspace-boundary bypass where renderer could omit workspacePath and skip
// the isPathInside check inside getProtectedPathReason.
export const readTextFileSchema = z.tuple([
    z.string().min(1, "targetPath must be a non-empty string"),
    z.string().min(1, "workspacePath must be a non-empty string"),
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

// writeTextFileSchema — (targetPath, content, workspacePath, options?)
// workspacePath is REQUIRED (audit round 3, Task 1.1): the two legacy forms
// without workspacePath are removed so the workspace-boundary check in
// getProtectedPathReason can never be skipped.
export const writeTextFileSchema = z.union([
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

// ── Plan file CRUD schemas (Task 4.2) ──────────────────────
// 6 个 plan IPC handler 入参校验. workspaceId 必填且非空, slug / filename 非空,
// status 必须是 PlanStatus 枚举. content / title 允许空串 (UI 兜底为默认文案).

const MAX_PLAN_SLUG_LENGTH = 200;
const MAX_PLAN_TITLE_LENGTH = 500;
const MAX_PLAN_FILENAME_LENGTH = 260;
const MAX_PLAN_CONTENT_LENGTH = 1024 * 1024;

export const PlanCreateSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    slug: z.string().min(1, "slug must be a non-empty string").max(MAX_PLAN_SLUG_LENGTH, "slug is too long"),
    title: z.string().max(MAX_PLAN_TITLE_LENGTH, "title is too long"),
    content: z.string().max(MAX_PLAN_CONTENT_LENGTH, "content is too large"),
}).strict();

export const PlanUpdateSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    filename: z.string().min(1, "filename must be a non-empty string").max(MAX_PLAN_FILENAME_LENGTH, "filename is too long"),
    content: z.string().max(MAX_PLAN_CONTENT_LENGTH, "content is too large").optional(),
    status: z.enum(["draft", "executing", "completed", "cancelled"]).optional(),
    title: z.string().max(MAX_PLAN_TITLE_LENGTH, "title is too long").optional(),
}).strict();

export const PlanListOptionsSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    includeCompleted: z.boolean().optional(),
    includeCancelled: z.boolean().optional(),
}).strict();

// plan:get / plan:complete / plan:delete — 仅 (workspaceId, filename)
export const PlanFilenameSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    filename: z.string().min(1, "filename must be a non-empty string").max(MAX_PLAN_FILENAME_LENGTH, "filename is too long"),
}).strict();

// ── Task IPC schemas (Phase B Task 4) ─────────────────────
// 9 个 task IPC handler 入参校验. workspaceId 必填且非空,
// id 必须匹配 T<n>(.<m>)* 格式, status 必须是 TaskStatus 枚举.

const TaskIdSchema = z.string().regex(/^T\d+(\.\d+)*$/, "Task ID must be Tn or Tn.m...");
const TaskStatusSchema = z.enum(["open", "in_progress", "blocked", "done", "abandoned"]);

export const TaskCreateSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    summary: z.string().min(1, "summary must be a non-empty string"),
    parentId: TaskIdSchema.optional(),
    owner: z.string().optional(),
}).strict();

export const TaskListSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    status: TaskStatusSchema.optional(),
    includeTerminal: z.boolean().optional(),
    includeArchived: z.boolean().optional(),
}).strict();

export const TaskGetSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    id: TaskIdSchema,
}).strict();

export const TaskStartSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    id: TaskIdSchema,
    owner: z.string().optional(),
    eventSummary: z.string().optional(),
}).strict();

export const TaskBlockSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    id: TaskIdSchema,
    eventSummary: z.string().optional(),
}).strict();

// task:unblock / task:done / task:abandon — 与 task:block 同 shape
export const TaskUnblockSchema = TaskBlockSchema;
export const TaskDoneSchema = TaskBlockSchema;
export const TaskAbandonSchema = TaskBlockSchema;

export const TaskRenameSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    id: TaskIdSchema,
    summary: z.string().min(1, "summary must be a non-empty string"),
}).strict();

// ── Goal evaluate schema (Phase C Task 4) ───────────────
// Validates input for the `goal:evaluate` IPC handler. workspaceId is required
// and non-empty; agentId is optional (matches goal:get / goal:clear shape).
export const GoalEvaluateSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string"),
    agentId: z.string().optional(),
}).strict();

// ── Subagent IPC schemas (Phase E Task 6) ───────────────
// 3 subagent IPC handler 入参校验.
// - list-types: workspaceId 预留字段(当前忽略, 未来按工作区过滤内置类型);
//   接受空对象(返回全部 4 个内置类型), workspaceId 必须是 string.
// - list-instances: agentId 必填且非空(列出该 agent 名下的 live/terminal 实例).
// - cancel: agentId + actorId 必填且非空(幂等取消, 未知 actorId 返回 null).

export const SubagentListTypesSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId must be a non-empty string").optional(),
}).strict();

export const SubagentListInstancesSchema = z.object({
    agentId: z.string().min(1, "agentId must be a non-empty string"),
}).strict();

export const SubagentCancelSchema = z.object({
    agentId: z.string().min(1, "agentId must be a non-empty string"),
    actorId: z.string().min(1, "actorId must be a non-empty string"),
}).strict();
