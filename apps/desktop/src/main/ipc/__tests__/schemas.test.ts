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
    gitAddSchema,
    gitDiffSchema,
    gitDiffStagedSchema,
    gitUndoSchema,
    packageSourceSchema,
    terminalCreateSchema,
    terminalInputSchema,
    terminalResizeSchema,
    getFileTreeSchema,
    readTextFileSchema,
    searchFilesSchema,
    listFilesSchema,
    writeTextFileSchema,
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
