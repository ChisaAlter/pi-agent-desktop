import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError } from "@shared";

const { execFileSyncMock, execFileMock } = vi.hoisted(() => ({
    execFileSyncMock: vi.fn(),
    execFileMock: vi.fn(),
}));

vi.mock("child_process", () => ({
    execFileSync: execFileSyncMock,
    execFile: execFileMock,
}));

import { gitAdd, gitCommit, gitDiff, gitDiffStaged, getGitStatus, gitUnstage } from "./git-service";

describe("git-service protected path policy", () => {
    beforeEach(() => {
        execFileSyncMock.mockReset();
        execFileMock.mockReset();
        execFileSyncMock.mockReturnValue("");
    });

    it("normalizes ordinary file paths before staging", () => {
        const result = gitAdd("C:/repo", ["src\\app.ts"]);

        expect(result).toBeUndefined();
        expect(execFileSyncMock).toHaveBeenCalledWith("git", ["add", "--", "src/app.ts"], {
            cwd: "C:/repo",
        });
    });

    it("blocks staging files outside the workspace", () => {
        const result = gitAdd("C:/repo", ["C:/outside/secret.txt"]);

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
            expect(result.fallback).toContain("不在当前工作区");
        }
        expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("blocks staging sensitive files inside the workspace", () => {
        const result = gitAdd("C:/repo", [".env.local"]);

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
            expect(result.fallback).toContain("敏感配置");
        }
        expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("blocks git operations when the workspace root itself is protected", () => {
        const result = gitCommit("C:/Users/demo/.ssh", "commit secrets");

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
            expect(result.fallback).toContain("敏感凭据目录");
        }
        expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("applies the same file guard to diff and unstage", () => {
        const diffResult = gitDiff("C:/repo", "C:/outside/app.ts");
        const unstageResult = gitUnstage("C:/repo", [".npmrc"]);

        expect(isIpcError(diffResult)).toBe(true);
        expect(isIpcError(unstageResult)).toBe(true);
        expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("uses parameterized git commands for status and staged diff", async () => {
        execFileMock
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "C:/repo\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "main\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, " M src/app.ts\n?? src/new.ts\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "origin/main\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "2\t1\n", ""));
        execFileSyncMock.mockReturnValueOnce("diff --git a/src/app.ts b/src/app.ts\n");

        const status = await getGitStatus("C:/repo");
        const staged = gitDiffStaged("C:/repo");

        expect(status).toMatchObject({
            branch: "main",
            modified: ["src/app.ts"],
            untracked: ["src/new.ts"],
            ahead: 2,
            behind: 1,
        });
        expect(staged).toContain("diff --git");
        expect(execFileMock).toHaveBeenCalledWith("git", ["status", "--porcelain"], expect.objectContaining({ cwd: "C:/repo" }), expect.any(Function));
        expect(execFileSyncMock).toHaveBeenCalledWith("git", ["diff", "--staged"], expect.objectContaining({ cwd: "C:/repo" }));
    });

    it("keeps staged-only changes out of unstaged status buckets", async () => {
        execFileMock
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "C:/repo\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "main\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "M  src/staged-only.ts\nMM src/staged-and-unstaged.ts\nA  src/staged-new.ts\n D src/deleted-worktree.ts\n?? src/untracked.ts\n", ""))
            .mockImplementationOnce((_file, _args, _options, callback) => callback(new Error("no upstream"), "", ""));

        const status = await getGitStatus("C:/repo");

        expect(status).toMatchObject({
            branch: "main",
            modified: ["src/staged-and-unstaged.ts"],
            added: [],
            deleted: ["src/deleted-worktree.ts"],
            untracked: ["src/untracked.ts"],
            ahead: 0,
            behind: 0,
        });
    });
});
