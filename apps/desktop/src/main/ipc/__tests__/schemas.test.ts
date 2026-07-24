// IPC zod schema tests (security hardening slice)
// 验证 5 个最高危 IPC handler 的入参 schema:
//   1. workspace:create  (name, path 都是 string)
//   2. settings:set      (settings 是 object)
//   3. git:commit        (workspacePath, message 都是 string)
//   4. git:add           (workspacePath 是 string, files 是 string[])
//   5. terminal:input    (terminalId, data 都是 string)
// 有效输入 -> parse() 不抛; 无效输入 -> 抛 z.ZodError.

import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
    workspaceCreateSchema,
    settingsSetSchema,
    gitCommitSchema,
    gitPushSchema,
    gitAddSchema,
    gitDiffSchema,
    gitDiffStagedSchema,
    gitUndoSchema,
    gitCheckoutSchema,
    gitCreateBranchSchema,
    gitLogSchema,
    gitStatusSchema,
    packageSourceSchema,
    terminalCreateSchema,
    terminalInputSchema,
    terminalResizeSchema,
    getFileTreeSchema,
    readTextFileSchema,
    searchFilesSchema,
    listFilesSchema,
    writeTextFileSchema,
    archiveSessionSchema,
    updateSessionMetadataSchema,
    packageSearchSchema,
    projectDetectSchema,
    projectFileTreeSchema,
    appendMessageSchema,
    updateToolCallSchema,
    agentsCreateSchema,
    agentsPromptSchema,
    agentsIdSchema,
    agentsSetThinkingSchema,
    codexScanSchema,
    codexImportSchema,
    claudeScanSchema,
    claudeImportSchema,
    workbenchSetActiveFileSchema,
    PlanCreateSchema,
    PlanUpdateSchema,
    PlanListOptionsSchema,
    PlanFilenameSchema,
    gitBranchesSchema,
    gitOriginalContentSchema,
    gitChangedFilesSchema,
    updateMessageSchema,
    TaskCreateSchema,
    TaskListSchema,
    TaskGetSchema,
    TaskStartSchema,
    TaskRenameSchema,
    GoalEvaluateSchema,
    SubagentListTypesSchema,
    SubagentListInstancesSchema,
    SubagentCancelSchema,
} from "../schemas";

describe("workspaceCreateSchema", () => {
    it("accepts two non-empty strings", () => {
        expect(() => workspaceCreateSchema.parse(["my-ws", "C:/projects/foo"])).not.toThrow();
    });

    it("rejects non-string name", () => {
        expect(() => workspaceCreateSchema.parse([123, "C:/projects/foo"])).toThrow(ZodError);
    });

    it("rejects non-string path", () => {
        expect(() => workspaceCreateSchema.parse(["my-ws", null])).toThrow(ZodError);
    });

    it("rejects empty name", () => {
        expect(() => workspaceCreateSchema.parse(["", "C:/projects/foo"])).toThrow(ZodError);
    });

    it("rejects empty path", () => {
        expect(() => workspaceCreateSchema.parse(["my-ws", ""])).toThrow(ZodError);
    });
});

describe("settingsSetSchema", () => {
    it("accepts known AppSettings fields with valid values", () => {
        expect(() => settingsSetSchema.parse([{ theme: "dark", fontSize: 14, generatedUiEnabled: false }])).not.toThrow();
    });

    it("accepts the system theme mode", () => {
        expect(() => settingsSetSchema.parse([{ theme: "system" }])).not.toThrow();
    });

    it("accepts long-horizon capability settings", () => {
        expect(() => settingsSetSchema.parse([{
            longHorizon: {
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
            },
        }])).not.toThrow();
    });

    it("accepts persisted thinking and vision settings", () => {
        expect(() => settingsSetSchema.parse([{
            showThinking: false,
            thinkingLevel: "high",
            visionProvider: "minimax",
            visionModel: "MiniMax-VL",
        }])).not.toThrow();
    });

    it("accepts persisted sidebar grouping mode", () => {
        expect(() => settingsSetSchema.parse([{ sidebarGroupMode: "workspace" }])).not.toThrow();
        expect(() => settingsSetSchema.parse([{ sidebarGroupMode: "date" }])).not.toThrow();
    });

    it("accepts persisted shortcut overrides", () => {
        expect(() => settingsSetSchema.parse([{
            shortcutOverrides: [{ id: "open-command-palette", keys: "Ctrl+Shift+Y" }],
        }])).not.toThrow();
    });

    it("rejects invalid long-horizon budgets and unknown feature fields", () => {
        expect(() => settingsSetSchema.parse([{
            longHorizon: {
                enabled: true,
                defaultMode: "build",
                maxMode: { enabled: true, candidates: 0 },
                memory: { enabled: true },
                checkpoint: { enabled: true },
                goal: { enabled: true },
                subagents: { enabled: true },
                composeWorkflow: { enabled: true },
            },
        }])).toThrow(ZodError);
        expect(() => settingsSetSchema.parse([{
            longHorizon: {
                enabled: true,
                defaultMode: "build",
                maxMode: { enabled: true, candidates: 5 },
                memory: { enabled: true, secretBackdoor: true },
                checkpoint: { enabled: true },
                goal: { enabled: true },
                subagents: { enabled: true },
                composeWorkflow: { enabled: true },
            },
        }])).toThrow(ZodError);
    });

    it("rejects an empty object", () => {
        expect(() => settingsSetSchema.parse([{}])).toThrow(ZodError);
    });

    it("rejects unknown settings fields", () => {
        expect(() => settingsSetSchema.parse([{ theme: "dark", madeUpFlag: true }])).toThrow(ZodError);
    });

    it("rejects invalid enum and numeric ranges", () => {
        expect(() => settingsSetSchema.parse([{ theme: "solarized" }])).toThrow(ZodError);
        expect(() => settingsSetSchema.parse([{ sidebarGroupMode: "recent" }])).toThrow(ZodError);
        expect(() => settingsSetSchema.parse([{ temperature: 3 }])).toThrow(ZodError);
        expect(() => settingsSetSchema.parse([{ maxTokens: 0 }])).toThrow(ZodError);
    });

    it("rejects a non-object (string)", () => {
        expect(() => settingsSetSchema.parse(["not-an-object"])).toThrow(ZodError);
    });

    it("rejects null", () => {
        expect(() => settingsSetSchema.parse([null])).toThrow(ZodError);
    });

    it("rejects an array (not a record)", () => {
        // z.record is an object literal, not array
        expect(() => settingsSetSchema.parse([["theme", "dark"]])).toThrow(ZodError);
    });
});

describe("gitCommitSchema", () => {
    it("accepts workspacePath + non-empty message", () => {
        expect(() => gitCommitSchema.parse(["C:/repo", "fix: typo"])).not.toThrow();
    });

    it("rejects non-string message", () => {
        expect(() => gitCommitSchema.parse(["C:/repo", 42])).toThrow(ZodError);
    });

    it("rejects empty message", () => {
        // git commit -m "" 会失败; 我们的 schema 也不允许空 message
        expect(() => gitCommitSchema.parse(["C:/repo", ""])).toThrow(ZodError);
    });

    it("rejects non-string workspacePath", () => {
        expect(() => gitCommitSchema.parse([undefined, "msg"])).toThrow(ZodError);
    });
});

describe("gitPushSchema", () => {
    it("accepts a non-empty workspace path", () => {
        expect(() => gitPushSchema.parse(["C:/repo"])).not.toThrow();
    });

    it("rejects an empty workspace path", () => {
        expect(() => gitPushSchema.parse([""])).toThrow(ZodError);
    });
});
describe("gitAddSchema", () => {
    it("accepts workspacePath + string[] (non-empty)", () => {
        expect(() => gitAddSchema.parse(["C:/repo", ["a.ts", "b.ts"]])).not.toThrow();
    });

    it("accepts workspacePath + empty array (handler 走 no-op 分支)", () => {
        expect(() => gitAddSchema.parse(["C:/repo", []])).not.toThrow();
    });

    it("rejects non-array files", () => {
        expect(() => gitAddSchema.parse(["C:/repo", "a.ts"])).toThrow(ZodError);
    });

    it("rejects array containing non-string element", () => {
        expect(() => gitAddSchema.parse(["C:/repo", ["a.ts", 123]])).toThrow(ZodError);
    });

    it("rejects non-string workspacePath", () => {
        expect(() => gitAddSchema.parse([null, ["a.ts"]])).toThrow(ZodError);
    });
});

describe("gitDiffSchema", () => {
    it("accepts workspacePath with optional filePath", () => {
        expect(() => gitDiffSchema.parse(["C:/repo"])).not.toThrow();
        expect(() => gitDiffSchema.parse(["C:/repo", "src/app.ts"])).not.toThrow();
    });

    it("rejects invalid workspacePath and empty filePath", () => {
        expect(() => gitDiffSchema.parse([""])).toThrow(ZodError);
        expect(() => gitDiffSchema.parse([null, "src/app.ts"])).toThrow(ZodError);
        expect(() => gitDiffSchema.parse(["C:/repo", ""])).toThrow(ZodError);
    });
});

describe("gitDiffStagedSchema", () => {
    it("accepts workspacePath", () => {
        expect(() => gitDiffStagedSchema.parse(["C:/repo"])).not.toThrow();
    });

    it("rejects invalid workspacePath", () => {
        expect(() => gitDiffStagedSchema.parse([""])).toThrow(ZodError);
        expect(() => gitDiffStagedSchema.parse([undefined])).toThrow(ZodError);
    });
});

describe("gitUndoSchema", () => {
    it("accepts workspacePath + filePath", () => {
        expect(() => gitUndoSchema.parse(["C:/repo", "src/app.ts"])).not.toThrow();
    });

    it("rejects empty file paths", () => {
        expect(() => gitUndoSchema.parse(["C:/repo", ""])).toThrow(ZodError);
    });

    it("rejects non-string workspacePath", () => {
        expect(() => gitUndoSchema.parse([null, "src/app.ts"])).toThrow(ZodError);
    });
});

describe("terminalInputSchema", () => {
    it("accepts terminalId + non-empty data", () => {
        expect(() => terminalInputSchema.parse(["pty-1", "ls -la\n"])).not.toThrow();
    });

    it("rejects non-string data", () => {
        expect(() => terminalInputSchema.parse(["pty-1", new Uint8Array([1, 2, 3])])).toThrow(ZodError);
    });

    it("rejects non-string terminalId", () => {
        expect(() => terminalInputSchema.parse([123, "ls\n"])).toThrow(ZodError);
    });

    it("rejects empty data", () => {
        // pty.write("") 是 no-op 但仍合法, 但我们 schema 拒绝空串以暴露 bug
        // (如果真要支持空串, 改 schema 即可; 此处选严格)
        expect(() => terminalInputSchema.parse(["pty-1", ""])).toThrow(ZodError);
    });
});

describe("terminalCreateSchema", () => {
    it("accepts optional id, cwd and sane dimensions", () => {
        expect(() => terminalCreateSchema.parse([{ id: "pty_1", cwd: "C:/repo", cols: 80, rows: 24 }])).not.toThrow();
        expect(() => terminalCreateSchema.parse([{}])).not.toThrow();
    });

    it("rejects empty ids, empty cwd and unreasonable dimensions", () => {
        expect(() => terminalCreateSchema.parse([{ id: "" }])).toThrow(ZodError);
        expect(() => terminalCreateSchema.parse([{ cwd: "" }])).toThrow(ZodError);
        expect(() => terminalCreateSchema.parse([{ cols: 1, rows: 1 }])).toThrow(ZodError);
    });

    it("rejects unknown create options", () => {
        expect(() => terminalCreateSchema.parse([{ cwd: "C:/repo", shell: "cmd.exe" }])).toThrow(ZodError);
    });
});

describe("terminalResizeSchema", () => {
    it("accepts terminal id and sane dimensions", () => {
        expect(() => terminalResizeSchema.parse(["pty_1", 120, 40])).not.toThrow();
    });

    it("rejects blank ids and unreasonable dimensions", () => {
        expect(() => terminalResizeSchema.parse(["", 120, 40])).toThrow(ZodError);
        expect(() => terminalResizeSchema.parse(["pty_1", 1, 40])).toThrow(ZodError);
        expect(() => terminalResizeSchema.parse(["pty_1", 120, 1])).toThrow(ZodError);
    });
});

describe("packageSourceSchema", () => {
    it("accepts bare package names and supported source URIs", () => {
        expect(() => packageSourceSchema.parse(["pi-web-access"])).not.toThrow();
        expect(() => packageSourceSchema.parse(["@scope/pi-git"])).not.toThrow();
        expect(() => packageSourceSchema.parse(["npm:@scope/pi-git"])).not.toThrow();
        expect(() => packageSourceSchema.parse(["https://github.com/user/repo"])).not.toThrow();
        expect(() => packageSourceSchema.parse(["git:ssh://git@github.com/user/repo"])).not.toThrow();
    });

    it("rejects blank, whitespace, control chars and unsupported protocols", () => {
        expect(() => packageSourceSchema.parse([""])).toThrow(ZodError);
        expect(() => packageSourceSchema.parse([" pi-web-access"])).toThrow(ZodError);
        expect(() => packageSourceSchema.parse(["pi web access"])).toThrow(ZodError);
        expect(() => packageSourceSchema.parse(["npm:bad\nname"])).toThrow(ZodError);
        expect(() => packageSourceSchema.parse(["ftp://example.com/pkg"])).toThrow(ZodError);
    });

    it("rejects overly long sources", () => {
        expect(() => packageSourceSchema.parse(["a".repeat(257)])).toThrow(ZodError);
    });
});

describe("writeTextFileSchema", () => {
    it("accepts target path, text content and required workspace path", () => {
        expect(() => writeTextFileSchema.parse(["C:/repo/a.ts", "hello", "C:/repo"])).not.toThrow();
        expect(() => writeTextFileSchema.parse(["C:/repo/a.ts", "hello", "C:/repo", { expectedMtimeMs: 123 }])).not.toThrow();
    });

    it("rejects missing workspace path (workspacePath is required)", () => {
        expect(() => writeTextFileSchema.parse(["C:/repo/a.ts", "hello"])).toThrow(ZodError);
    });

    it("rejects blank paths and overly large content", () => {
        expect(() => writeTextFileSchema.parse(["", "hello", "C:/repo"])).toThrow(ZodError);
        expect(() => writeTextFileSchema.parse(["C:/repo/a.ts", "x".repeat(1024 * 1024 + 1), "C:/repo"])).toThrow(ZodError);
        expect(() => writeTextFileSchema.parse(["C:/repo/a.ts", "hello", "C:/repo", { expectedMtimeMs: -1 }])).toThrow(ZodError);
    });
});

describe("file IPC schemas", () => {
    it("accepts valid tree, read, search and list arguments", () => {
        expect(() => getFileTreeSchema.parse(["C:/repo", { maxDepth: 5, maxEntries: 1600 }])).not.toThrow();
        expect(() => readTextFileSchema.parse(["C:/repo/a.ts", "C:/repo"])).not.toThrow();
        expect(() => searchFilesSchema.parse(["C:/repo", "app", { limit: 80 }])).not.toThrow();
        expect(() => listFilesSchema.parse(["C:/repo", "app"])).not.toThrow();
    });

    it("rejects blank paths, blank search queries and unreasonable options", () => {
        expect(() => getFileTreeSchema.parse([""])).toThrow(ZodError);
        expect(() => getFileTreeSchema.parse(["C:/repo", { maxDepth: 99 }])).toThrow(ZodError);
        expect(() => readTextFileSchema.parse(["C:/repo/a.ts", ""])).toThrow(ZodError);
        expect(() => searchFilesSchema.parse(["C:/repo", ""])).toThrow(ZodError);
        expect(() => searchFilesSchema.parse(["C:/repo", "app", { limit: 999 }])).toThrow(ZodError);
        expect(() => listFilesSchema.parse([""])).toThrow(ZodError);
    });
});


// wave-85 residual: session/package/project IPC schema edges
describe("archiveSessionSchema", () => {
    it("accepts session id and boolean flag", () => {
        expect(() => archiveSessionSchema.parse(["sess_1", true])).not.toThrow();
        expect(() => archiveSessionSchema.parse(["sess_1", false])).not.toThrow();
    });

    it("rejects blank session id and non-boolean flag", () => {
        expect(() => archiveSessionSchema.parse(["", true])).toThrow(ZodError);
        expect(() => archiveSessionSchema.parse(["sess_1", "yes"])).toThrow(ZodError);
        expect(() => archiveSessionSchema.parse(["sess_1"])).toThrow(ZodError);
    });
});

describe("updateSessionMetadataSchema", () => {
    it("accepts known metadata fields", () => {
        expect(() =>
            updateSessionMetadataSchema.parse([
                "sess_1",
                {
                    summary: "hello",
                    favorite: true,
                    tags: ["a", "b"],
                    usage: {
                        provider: "mimo",
                        model: "m",
                        updatedAt: 1,
                    },
                    toolPermissions: { fileRead: true, shell: false },
                },
            ]),
        ).not.toThrow();
    });

    it("rejects unknown metadata keys (strict) and blank session id", () => {
        expect(() => updateSessionMetadataSchema.parse(["", { summary: "x" }])).toThrow(ZodError);
        expect(() =>
            updateSessionMetadataSchema.parse(["sess_1", { notAField: true }]),
        ).toThrow(ZodError);
        expect(() =>
            updateSessionMetadataSchema.parse([
                "sess_1",
                { usage: { updatedAt: 1, compactionStatus: "nope" } },
            ]),
        ).toThrow(ZodError);
    });
});

describe("packageSearchSchema", () => {
    it("accepts empty and short queries", () => {
        expect(() => packageSearchSchema.parse([""])).not.toThrow();
        expect(() => packageSearchSchema.parse(["pi-"])).not.toThrow();
    });

    it("rejects oversized queries", () => {
        expect(() => packageSearchSchema.parse(["q".repeat(257)])).toThrow(ZodError);
    });
});

describe("projectDetectSchema / projectFileTreeSchema", () => {
    it("accepts workspace path and capped depth", () => {
        expect(() => projectDetectSchema.parse(["C:/repo"])).not.toThrow();
        expect(() => projectFileTreeSchema.parse(["C:/repo"])).not.toThrow();
        expect(() => projectFileTreeSchema.parse(["C:/repo", 4])).not.toThrow();
        expect(() => projectFileTreeSchema.parse(["C:/repo", 20])).not.toThrow();
    });

    it("rejects blank workspace and depth above 20", () => {
        expect(() => projectDetectSchema.parse([""])).toThrow(ZodError);
        expect(() => projectFileTreeSchema.parse([""])).toThrow(ZodError);
        expect(() => projectFileTreeSchema.parse(["C:/repo", 21])).toThrow(ZodError);
        expect(() => projectFileTreeSchema.parse(["C:/repo", -1])).toThrow(ZodError);
    });
});

describe("appendMessageSchema / updateToolCallSchema", () => {
    it("accepts minimal valid append payloads", () => {
        expect(() =>
            appendMessageSchema.parse([
                "sess_1",
                {
                    id: "m1",
                    role: "user",
                    content: "hi",
                    timestamp: Date.now(),
                },
            ]),
        ).not.toThrow();
    });

    it("rejects blank session id for append", () => {
        expect(() =>
            appendMessageSchema.parse([
                "",
                { id: "m1", role: "user", content: "hi", timestamp: 1 },
            ]),
        ).toThrow(ZodError);
    });

    it("accepts tool call status updates and rejects blank ids", () => {
        expect(() =>
            updateToolCallSchema.parse([
                "sess_1",
                "m1",
                "tc1",
                { status: "completed" },
            ]),
        ).not.toThrow();
        expect(() =>
            updateToolCallSchema.parse(["", "m1", "tc1", { status: "completed" }]),
        ).toThrow(ZodError);
        expect(() =>
            updateToolCallSchema.parse(["sess_1", "", "tc1", { status: "completed" }]),
        ).toThrow(ZodError);
    });
});

// wave-94 residual — Task / Goal / Subagent IPC schemas
describe("Task IPC schemas", () => {
    it("accepts TaskCreate with nested parent task ids", () => {
        expect(() =>
            TaskCreateSchema.parse({
                workspaceId: "ws1",
                summary: "do work",
                parentId: "T1.2.3",
                owner: "agent-a",
            }),
        ).not.toThrow();
    });

    it("rejects TaskCreate without summary or invalid task id", () => {
        expect(() =>
            TaskCreateSchema.parse({ workspaceId: "ws1", summary: "" }),
        ).toThrow(ZodError);
        expect(() =>
            TaskCreateSchema.parse({
                workspaceId: "ws1",
                summary: "x",
                parentId: "task-1",
            }),
        ).toThrow(ZodError);
        expect(() =>
            TaskCreateSchema.parse({
                workspaceId: "ws1",
                summary: "x",
                extra: true,
            } as never),
        ).toThrow(ZodError);
    });

    it("accepts TaskList filters and rejects blank workspace", () => {
        expect(() =>
            TaskListSchema.parse({
                workspaceId: "ws1",
                status: "in_progress",
                includeTerminal: true,
            }),
        ).not.toThrow();
        expect(() => TaskListSchema.parse({ workspaceId: "" })).toThrow(ZodError);
        expect(() =>
            TaskListSchema.parse({ workspaceId: "ws1", status: "running" as never }),
        ).toThrow(ZodError);
    });

    it("accepts TaskGet/TaskStart/TaskRename and rejects invalid ids", () => {
        expect(() => TaskGetSchema.parse({ workspaceId: "ws1", id: "T10" })).not.toThrow();
        expect(() =>
            TaskStartSchema.parse({ workspaceId: "ws1", id: "T1", owner: "me" }),
        ).not.toThrow();
        expect(() =>
            TaskRenameSchema.parse({ workspaceId: "ws1", id: "T1", summary: "renamed" }),
        ).not.toThrow();
        expect(() => TaskGetSchema.parse({ workspaceId: "ws1", id: "1" })).toThrow(ZodError);
        expect(() =>
            TaskRenameSchema.parse({ workspaceId: "ws1", id: "T1", summary: "" }),
        ).toThrow(ZodError);
    });
});

describe("GoalEvaluateSchema", () => {
    it("accepts workspaceId with optional agentId", () => {
        expect(() => GoalEvaluateSchema.parse({ workspaceId: "ws1" })).not.toThrow();
        expect(() =>
            GoalEvaluateSchema.parse({ workspaceId: "ws1", agentId: "agent-1" }),
        ).not.toThrow();
    });

    it("rejects blank workspaceId and unknown keys", () => {
        expect(() => GoalEvaluateSchema.parse({ workspaceId: "" })).toThrow(ZodError);
        expect(() =>
            GoalEvaluateSchema.parse({ workspaceId: "ws1", extra: 1 } as never),
        ).toThrow(ZodError);
    });
});

describe("Subagent IPC schemas", () => {
    it("accepts empty list-types and optional workspaceId", () => {
        expect(() => SubagentListTypesSchema.parse({})).not.toThrow();
        expect(() =>
            SubagentListTypesSchema.parse({ workspaceId: "ws1" }),
        ).not.toThrow();
        expect(() =>
            SubagentListTypesSchema.parse({ workspaceId: "" }),
        ).toThrow(ZodError);
    });

    it("requires non-empty agentId/actorId for list/cancel", () => {
        expect(() =>
            SubagentListInstancesSchema.parse({ agentId: "main" }),
        ).not.toThrow();
        expect(() =>
            SubagentCancelSchema.parse({ agentId: "main", actorId: "a1" }),
        ).not.toThrow();
        expect(() => SubagentListInstancesSchema.parse({ agentId: "" })).toThrow(ZodError);
        expect(() =>
            SubagentCancelSchema.parse({ agentId: "main", actorId: "" }),
        ).toThrow(ZodError);
        expect(() =>
            SubagentCancelSchema.parse({ agentId: "main" } as never),
        ).toThrow(ZodError);
    });
});

// wave-116 residual
describe("git branch / log schemas residual", () => {
    it("requires non-empty workspace and branch for checkout/create", () => {
        expect(() => gitCheckoutSchema.parse(["C:/ws", "main"])).not.toThrow();
        expect(() => gitCreateBranchSchema.parse(["C:/ws", "feat/x"])).not.toThrow();
        expect(() => gitCheckoutSchema.parse(["", "main"])).toThrow(ZodError);
        expect(() => gitCheckoutSchema.parse(["C:/ws", ""])).toThrow(ZodError);
        expect(() => gitCreateBranchSchema.parse(["C:/ws", ""])).toThrow(ZodError);
    });

    it("accepts git log count within 1..1000 (tuple still requires 2 slots)", () => {
        // product: second element is .optional() but Zod tuple still needs length >= 2
        expect(() => gitLogSchema.parse(["C:/ws"])).toThrow(ZodError);
        expect(() => gitLogSchema.parse(["C:/ws", undefined])).not.toThrow();
        expect(() => gitLogSchema.parse(["C:/ws", 20])).not.toThrow();
        expect(() => gitLogSchema.parse(["C:/ws", 1000])).not.toThrow();
        expect(() => gitLogSchema.parse(["C:/ws", 0])).toThrow(ZodError);
        expect(() => gitLogSchema.parse(["C:/ws", 1001])).toThrow(ZodError);
        expect(() => gitLogSchema.parse(["C:/ws", 1.5])).toThrow(ZodError);
        expect(() => gitStatusSchema.parse(["C:/ws"])).not.toThrow();
        expect(() => gitStatusSchema.parse([""])).toThrow(ZodError);
    });
});

describe("agents IPC schemas residual", () => {
    it("requires workspaceId and allows optional model/provider/title", () => {
        expect(() => agentsCreateSchema.parse({ workspaceId: "ws1" })).not.toThrow();
        expect(() =>
            agentsCreateSchema.parse({
                workspaceId: "ws1",
                title: "t",
                model: "m",
                provider: "p",
            }),
        ).not.toThrow();
        expect(() => agentsCreateSchema.parse({ workspaceId: "" })).toThrow(ZodError);
        expect(() => agentsCreateSchema.parse({} as never)).toThrow(ZodError);
    });

    it("validates agentsPrompt streamingBehavior and thinking levels", () => {
        expect(() =>
            agentsPromptSchema.parse({ agentId: "a1", message: "hi", streamingBehavior: "steer" }),
        ).not.toThrow();
        expect(() =>
            agentsPromptSchema.parse({ agentId: "a1", message: "hi", streamingBehavior: "followUp" }),
        ).not.toThrow();
        expect(() =>
            agentsPromptSchema.parse({ agentId: "a1", message: "hi", streamingBehavior: "other" as never }),
        ).toThrow(ZodError);
        expect(() => agentsPromptSchema.parse({ agentId: "a1", message: "" })).toThrow(ZodError);

        for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"] as const) {
            expect(() => agentsSetThinkingSchema.parse(["a1", level])).not.toThrow();
        }
        expect(() => agentsSetThinkingSchema.parse(["a1", "ultra" as never])).toThrow(ZodError);
        expect(() => agentsSetThinkingSchema.parse(["", "low"])).toThrow(ZodError);
    });

    it("caps codex import sourcePaths at 100 non-empty strings", () => {
        expect(() => codexImportSchema.parse(["C:/ws", ["a.jsonl"]])).not.toThrow();
        expect(() => codexImportSchema.parse(["C:/ws", [""]])).toThrow(ZodError);
        expect(() => codexImportSchema.parse(["C:/ws", Array.from({ length: 101 }, (_, i) => `s${i}`)])).toThrow(
            ZodError,
        );
        expect(() => codexImportSchema.parse(["", ["a.jsonl"]])).toThrow(ZodError);
    });
});

// wave-117 residual
describe("agentsId / session import / workbench residual", () => {
    it("requires a non-empty agentId tuple", () => {
        expect(() => agentsIdSchema.parse(["agent-1"])).not.toThrow();
        expect(() => agentsIdSchema.parse([""])).toThrow(ZodError);
        expect(() => agentsIdSchema.parse([])).toThrow(ZodError);
        expect(() => agentsIdSchema.parse(["a", "extra"])).toThrow(ZodError);
    });

    it("accepts codex/claude scan and caps import sourcePaths at 100", () => {
        expect(() => codexScanSchema.parse(["C:/ws"])).not.toThrow();
        expect(() => claudeScanSchema.parse(["C:/ws"])).not.toThrow();
        expect(() => codexScanSchema.parse([""])).toThrow(ZodError);
        expect(() => claudeScanSchema.parse([""])).toThrow(ZodError);

        expect(() => claudeImportSchema.parse(["C:/ws", ["a.jsonl"]])).not.toThrow();
        expect(() => claudeImportSchema.parse(["C:/ws", [""]])).toThrow(ZodError);
        expect(() =>
            claudeImportSchema.parse(["C:/ws", Array.from({ length: 101 }, (_, i) => `s${i}`)]),
        ).toThrow(ZodError);
        expect(() => codexImportSchema.parse(["C:/ws", Array.from({ length: 100 }, (_, i) => `s${i}`)])).not.toThrow();
    });

    it("allows null active file for workbench while rejecting blank workspace/path", () => {
        expect(() => workbenchSetActiveFileSchema.parse(["ws1", null])).not.toThrow();
        expect(() => workbenchSetActiveFileSchema.parse(["ws1", "src/a.ts"])).not.toThrow();
        expect(() => workbenchSetActiveFileSchema.parse(["", "src/a.ts"])).toThrow(ZodError);
        expect(() => workbenchSetActiveFileSchema.parse(["ws1", ""])).toThrow(ZodError);
    });
});

describe("plan IPC schemas residual", () => {
    it("enforces slug/title/content length caps and strict objects", () => {
        expect(() =>
            PlanCreateSchema.parse({
                workspaceId: "ws1",
                slug: "my-plan",
                title: "t",
                content: "# plan",
            }),
        ).not.toThrow();
        expect(() =>
            PlanCreateSchema.parse({
                workspaceId: "ws1",
                slug: "x".repeat(201),
                title: "t",
                content: "",
            }),
        ).toThrow(ZodError);
        expect(() =>
            PlanCreateSchema.parse({
                workspaceId: "ws1",
                slug: "ok",
                title: "t".repeat(501),
                content: "",
            }),
        ).toThrow(ZodError);
        expect(() =>
            PlanCreateSchema.parse({
                workspaceId: "ws1",
                slug: "ok",
                title: "t",
                content: "",
                extra: true,
            } as never),
        ).toThrow(ZodError);
    });

    it("validates plan update status enum and list/filename shapes", () => {
        expect(() =>
            PlanUpdateSchema.parse({
                workspaceId: "ws1",
                filename: "plan.md",
                status: "draft",
            }),
        ).not.toThrow();
        expect(() =>
            PlanUpdateSchema.parse({
                workspaceId: "ws1",
                filename: "plan.md",
                status: "running" as never,
            }),
        ).toThrow(ZodError);
        expect(() =>
            PlanListOptionsSchema.parse({
                workspaceId: "ws1",
                includeCompleted: true,
                includeCancelled: false,
            }),
        ).not.toThrow();
        expect(() => PlanListOptionsSchema.parse({ workspaceId: "" })).toThrow(ZodError);
        expect(() => PlanFilenameSchema.parse({ workspaceId: "ws1", filename: "a.md" })).not.toThrow();
        expect(() => PlanFilenameSchema.parse({ workspaceId: "ws1", filename: "" })).toThrow(ZodError);
        expect(() =>
            PlanFilenameSchema.parse({ workspaceId: "ws1", filename: "f".repeat(261) }),
        ).toThrow(ZodError);
    });
});

describe("git branches / original content / update-message residual", () => {
    it("requires non-empty workspace for branches/changed-files and file path for original content", () => {
        expect(() => gitBranchesSchema.parse(["C:/ws"])).not.toThrow();
        expect(() => gitBranchesSchema.parse([""])).toThrow(ZodError);
        expect(() => gitChangedFilesSchema.parse(["C:/ws"])).not.toThrow();
        expect(() => gitOriginalContentSchema.parse(["C:/ws", "src/a.ts"])).not.toThrow();
        expect(() => gitOriginalContentSchema.parse(["C:/ws", ""])).toThrow(ZodError);
        expect(() => gitOriginalContentSchema.parse(["", "src/a.ts"])).toThrow(ZodError);
    });

    it("accepts partial updateMessage payloads and rejects blank ids", () => {
        expect(() =>
            updateMessageSchema.parse(["s1", "m1", { content: "updated" }]),
        ).not.toThrow();
        expect(() =>
            updateMessageSchema.parse(["s1", "m1", { role: "assistant", thinking: "..." }]),
        ).not.toThrow();
        expect(() => updateMessageSchema.parse(["", "m1", {}])).toThrow(ZodError);
        expect(() => updateMessageSchema.parse(["s1", "", {}])).toThrow(ZodError);
        expect(() =>
            updateMessageSchema.parse(["s1", "m1", { role: "tool" as never }]),
        ).toThrow(ZodError);
    });
});

// wave-205 residual
describe("schemas residual (wave-205)", () => {
    it("terminalCreate/Resize enforce cols/rows bounds and strict create object", () => {
        expect(() => terminalCreateSchema.parse([{ cols: 20, rows: 4 }])).not.toThrow();
        expect(() => terminalCreateSchema.parse([{ cols: 500, rows: 200 }])).not.toThrow();
        expect(() => terminalCreateSchema.parse([{ cols: 19 }])).toThrow(ZodError);
        expect(() => terminalCreateSchema.parse([{ rows: 201 }])).toThrow(ZodError);
        expect(() => terminalCreateSchema.parse([{ id: "t1", extra: true } as never])).toThrow(ZodError);
        expect(() => terminalResizeSchema.parse(["pty", 20, 4])).not.toThrow();
        expect(() => terminalResizeSchema.parse(["pty", 500, 200])).not.toThrow();
        expect(() => terminalResizeSchema.parse(["pty", 501, 40])).toThrow(ZodError);
        expect(() => terminalResizeSchema.parse(["pty", 80, 3])).toThrow(ZodError);
    });

    it("TaskCreate parentId regex and TaskList status enum", () => {
        expect(() =>
            TaskCreateSchema.parse({ workspaceId: "ws", summary: "s", parentId: "T1.2.3" }),
        ).not.toThrow();
        expect(() =>
            TaskCreateSchema.parse({ workspaceId: "ws", summary: "s", parentId: "task-1" }),
        ).toThrow(ZodError);
        expect(() =>
            TaskCreateSchema.parse({ workspaceId: "ws", summary: "s", parentId: "T" }),
        ).toThrow(ZodError);
        for (const status of ["open", "in_progress", "blocked", "done", "abandoned"] as const) {
            expect(() => TaskListSchema.parse({ workspaceId: "ws", status })).not.toThrow();
        }
        expect(() => TaskListSchema.parse({ workspaceId: "ws", status: "pending" as never })).toThrow(
            ZodError,
        );
    });

    it("GoalEvaluate and SubagentCancel strict shapes", () => {
        expect(() => GoalEvaluateSchema.parse({ workspaceId: "ws", agentId: "a1" })).not.toThrow();
        expect(() => GoalEvaluateSchema.parse({ workspaceId: "ws", agentId: "" })).not.toThrow();
        expect(() =>
            SubagentCancelSchema.parse({ agentId: "main", actorId: "actor-1" }),
        ).not.toThrow();
        expect(() =>
            SubagentCancelSchema.parse({ agentId: "", actorId: "actor-1" }),
        ).toThrow(ZodError);
        expect(() =>
            SubagentCancelSchema.parse({ agentId: "main", actorId: "a", extra: 1 } as never),
        ).toThrow(ZodError);
    });

    it("updateToolCall status enum subset and agentsSetThinking levels", () => {
        for (const status of ["pending", "running", "completed", "error"] as const) {
            expect(() =>
                updateToolCallSchema.parse(["s", "m", "tc", { status }]),
            ).not.toThrow();
        }
        expect(() =>
            updateToolCallSchema.parse(["s", "m", "tc", { status: "success" as never }]),
        ).toThrow(ZodError);
        for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"] as const) {
            expect(() => agentsSetThinkingSchema.parse(["agent", level])).not.toThrow();
        }
        expect(() => agentsSetThinkingSchema.parse(["", "low"])).toThrow(ZodError);
    });

    it("PlanUpdate allows content-only and rejects unknown status", () => {
        expect(() =>
            PlanUpdateSchema.parse({
                workspaceId: "ws",
                filename: "p.md",
                content: "# updated",
            }),
        ).not.toThrow();
        expect(() =>
            PlanUpdateSchema.parse({
                workspaceId: "ws",
                filename: "p.md",
                status: "executing",
            }),
        ).not.toThrow();
        expect(() =>
            PlanUpdateSchema.parse({
                workspaceId: "ws",
                filename: "p.md",
                status: "failed" as never,
            }),
        ).toThrow(ZodError);
        expect(() => archiveSessionSchema.parse(["sess", true])).not.toThrow();
        expect(() => archiveSessionSchema.parse(["sess", 1 as never])).toThrow(ZodError);
    });
});
