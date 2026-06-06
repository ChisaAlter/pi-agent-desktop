// IPC handler zod schemas (security hardening slice)
// 每个 schema 验证对应 IPC handler 的入参, 无效输入抛 z.ZodError.
// 约束: 仅暴露 5 个最高危 handler 的最小校验, 其它 handler 留待后续切片.

import { z } from "zod";

// workspace:create — 验证 name 和 path 都是非空 string
export const workspaceCreateSchema = z.tuple([
    z.string().min(1, "name must be a non-empty string"),
    z.string().min(1, "path must be a non-empty string"),
]);

// settings:set — 验证 settings 是普通 object
// 用 z.record(z.unknown()) 而不是 z.object({}) 因为 settings 是 Partial<AppSettings>,
// keys 是动态的 (theme / fontSize / model / apiKey / ...).
export const settingsSetSchema = z.tuple([
    z.record(z.string(), z.unknown()),
]);

// git:commit — 验证 message 是非空 string
export const gitCommitSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.string().min(1, "message must be a non-empty string"),
]);

// git:add — 验证 workspacePath 是 string, files 是 string[] (允许空数组走 "no-op" 分支)
export const gitAddSchema = z.tuple([
    z.string().min(1, "workspacePath must be a non-empty string"),
    z.array(z.string()),
]);

// terminal:input — 验证 id 和 data 都是 string (ptyManager.write 需要这两个)
export const terminalInputSchema = z.tuple([
    z.string().min(1, "terminalId must be a non-empty string"),
    z.string().min(1, "data must be a non-empty string"),
]);

// ── 2026-06-06 hotfix: session messages persistence ──────────────────
// 4 个原有 session handler 的 schema 已经在上面 gitAddSchema 等里隐式覆盖
// (只是 string[] / string),不重复定义。下面是 3 个新增的 messages 持久化 schema。

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
            toolCalls: z.array(z.unknown()).optional(),
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
            toolCalls: z.array(z.unknown()).optional(),
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
