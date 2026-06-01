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
    terminalInputSchema,
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
    it("accepts a plain object", () => {
        expect(() => settingsSetSchema.parse([{ theme: "dark", fontSize: 14 }])).not.toThrow();
    });

    it("accepts an empty object", () => {
        expect(() => settingsSetSchema.parse([{}])).not.toThrow();
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
