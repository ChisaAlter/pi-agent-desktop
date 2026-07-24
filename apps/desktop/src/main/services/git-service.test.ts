import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError } from "@shared";

const { mockResults, execFileMock } = vi.hoisted(() => {
    // Queue of fake execFile results. Each entry is either a stdout string
    // (success) or an Error (rejects the execGit promise). Tests push results
    // in call order; the mock shifts one off per invocation.
    const mockResults: Array<string | Error> = [];
    const execFileMock = vi.fn((...args: any[]) => {
        const callback = args[args.length - 1];
        const mockResult = mockResults.shift() ?? "";
        if (typeof callback !== "function") return;
        if (mockResult instanceof Error) {
            callback(mockResult, "");
        } else {
            callback(null, mockResult);
        }
    });
    return { mockResults, execFileMock };
});

vi.mock("child_process", () => ({
    execFile: execFileMock,
}));

import {
    gitAdd,
    gitChangedFiles,
    gitCheckout,
    gitCommit,
    gitCreateBranch,
    gitDiff,
    gitDiffStaged,
    gitOriginalContent,
    gitPush,
    getGitStatus,
    gitUnstage,
} from "./git-service";

describe("git-service protected path policy", () => {
    beforeEach(() => {
        execFileMock.mockClear();
        mockResults.length = 0;
    });

    it("normalizes ordinary file paths before staging", async () => {
        const result = await gitAdd("C:/repo", ["src\\app.ts"]);

        expect(result).toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["add", "--", "src/app.ts"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("blocks staging files outside the workspace", async () => {
        const result = await gitAdd("C:/repo", ["C:/outside/secret.txt"]);

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
            expect(result.fallback).toContain("不在当前工作区");
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("blocks staging sensitive files inside the workspace", async () => {
        const result = await gitAdd("C:/repo", [".env.local"]);

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
            expect(result.fallback).toContain("敏感配置");
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("blocks git operations when the workspace root itself is protected", async () => {
        const result = await gitCommit("C:/Users/demo/.ssh", "commit secrets");

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
            expect(result.fallback).toContain("敏感凭据目录");
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("pushes through a parameterized non-blocking git command", async () => {
        mockResults.push("Everything up-to-date\n");

        const result = await gitPush("C:/repo");

        expect(result).toContain("Everything up-to-date");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["push"],
            expect.objectContaining({ cwd: "C:/repo", timeout: 60_000 }),
            expect.any(Function),
        );
    });

    it("validates and checks out a local branch as a branch, not a path", async () => {
        mockResults.push("feature/right-rail\n", "abc123\n", "Switched to branch 'feature/right-rail'\n");

        const result = await gitCheckout("C:/repo", "feature/right-rail");

        expect(result).toBeUndefined();
        expect(execFileMock).toHaveBeenNthCalledWith(
            1,
            "git",
            ["check-ref-format", "--branch", "feature/right-rail"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
        expect(execFileMock).toHaveBeenNthCalledWith(
            2,
            "git",
            ["rev-parse", "--verify", "refs/heads/feature/right-rail^{commit}"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
        expect(execFileMock).toHaveBeenNthCalledWith(
            3,
            "git",
            ["checkout", "feature/right-rail"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });
    it("applies the same file guard to diff and unstage", async () => {
        const diffResult = await gitDiff("C:/repo", "C:/outside/app.ts");
        const unstageResult = await gitUnstage("C:/repo", [".npmrc"]);

        expect(isIpcError(diffResult)).toBe(true);
        expect(isIpcError(unstageResult)).toBe(true);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("uses parameterized git commands for status and staged diff", async () => {
        mockResults.push(
            "C:/repo\n", // findGitRoot: rev-parse --show-toplevel
            "main\n", // rev-parse --abbrev-ref HEAD
            " M src/app.ts\n?? src/new.ts\n", // status --porcelain
            "origin/main\n", // rev-parse --abbrev-ref @{u}
            "2\t1\n", // rev-list --left-right --count HEAD...origin/main
            "diff --git a/src/app.ts b/src/app.ts\n", // gitDiffStaged: diff --staged
        );

        const status = await getGitStatus("C:/repo");
        const staged = await gitDiffStaged("C:/repo");

        expect(status).toMatchObject({
            branch: "main",
            modified: ["src/app.ts"],
            untracked: ["src/new.ts"],
            ahead: 2,
            behind: 1,
        });
        expect(staged).toContain("diff --git");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["status", "--porcelain"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff", "--staged"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("keeps staged-only changes out of unstaged status buckets", async () => {
        mockResults.push(
            "C:/repo\n", // findGitRoot
            "main\n", // branch
            "M  src/staged-only.ts\nMM src/staged-and-unstaged.ts\nA  src/staged-new.ts\n D src/deleted-worktree.ts\n?? src/untracked.ts\n", // status --porcelain
            new Error("no upstream"), // rev-parse --abbrev-ref @{u} rejects
        );

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

    // wave-140 residual
    it("no-ops gitAdd/gitUnstage for empty file lists without invoking git", async () => {
        await expect(gitAdd("C:/repo", [])).resolves.toBeUndefined();
        await expect(gitUnstage("C:/repo", [])).resolves.toBeUndefined();
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("rejects createBranch names with illegal characters", async () => {
        const bad = await gitCreateBranch("C:/repo", "feat branch");
        expect(isIpcError(bad)).toBe(true);
        if (isIpcError(bad)) {
            expect(bad.code).toBe("ipcErrors.git.invalidArgs");
            expect(bad.fallback).toContain("非法字符");
        }
        expect(execFileMock).not.toHaveBeenCalled();

        mockResults.push("Switched to a new branch 'feature/ok-1'\n");
        const ok = await gitCreateBranch("C:/repo", "feature/ok-1");
        expect(ok).toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["checkout", "-b", "feature/ok-1"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("returns invalidArgs when checkout target branch does not exist", async () => {
        mockResults.push(new Error("invalid ref"));
        const result = await gitCheckout("C:/repo", "missing-branch");
        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.invalidArgs");
            expect(result.fallback).toContain("分支不存在");
            expect(result.fallback).toContain("missing-branch");
        }
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["check-ref-format", "--branch", "missing-branch"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
        // No checkout after validation failure.
        expect(execFileMock.mock.calls.some((c) => Array.isArray(c[1]) && c[1][0] === "checkout")).toBe(
            false,
        );
    });

    it("returns empty original content when not a git repo or show fails", async () => {
        mockResults.push(new Error("not a git repository"));
        await expect(gitOriginalContent("C:/repo", "src/app.ts")).resolves.toBe("");

        mockResults.push("C:/repo\n", new Error("path not in HEAD"));
        await expect(gitOriginalContent("C:/repo", "src/missing.ts")).resolves.toBe("");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["-C", "C:/repo", "show", "HEAD:src/missing.ts"],
            expect.objectContaining({ cwd: "C:/repo", maxBuffer: 32 * 1024 * 1024 }),
            expect.any(Function),
        );
    });

    it("blocks original content for protected paths without invoking show", async () => {
        mockResults.push("C:/repo\n");
        const result = await gitOriginalContent("C:/repo", ".env");
        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
        }
        expect(
            execFileMock.mock.calls.some((c) => Array.isArray(c[1]) && c[1].includes("show")),
        ).toBe(false);
    });

    it("parses -z porcelain renames and untracked as added for changed files", async () => {
        mockResults.push(
            "C:/repo\n",
            // XY path\0 for rename uses next token as destination; trailing \0
            "R  old-name.ts\0src/new-name.ts\0?? src/untracked.ts\0M  src/mod.ts\0",
        );
        const files = await gitChangedFiles("C:/repo");
        expect(Array.isArray(files)).toBe(true);
        if (!Array.isArray(files)) return;
        expect(files).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: "C:/repo/src/new-name.ts", status: "renamed" }),
                expect.objectContaining({ path: "C:/repo/src/untracked.ts", status: "added" }),
                expect.objectContaining({ path: "C:/repo/src/mod.ts", status: "modified" }),
            ]),
        );
        expect(files.every((f) => !f.path.includes("\\"))).toBe(true);
    });

    it("returns null status when git root cannot be resolved", async () => {
        mockResults.push(new Error("fatal: not a git repository"));
        await expect(getGitStatus("C:/repo")).resolves.toBeNull();
    });

    it("uses destination path for porcelain rename lines in status lists", async () => {
        mockResults.push(
            "C:/repo\n",
            "main\n",
            " R old.ts -> new.ts\n?? other.ts\n",
            new Error("no upstream"),
        );
        const status = await getGitStatus("C:/repo");
        expect(status).toMatchObject({
            untracked: ["other.ts"],
        });
        // Worktree rename ' R' → worktreeStatus 'R' is not M/A/D; only untracked bucketed.
        if (status && !isIpcError(status)) {
            expect(status.modified).not.toContain("old.ts");
            expect(status.modified).not.toContain("new.ts");
        }
    });

    // wave-192 residual
    it("buckets worktree deleted/added and keeps staged-only out of unstaged lists", async () => {
        mockResults.push(
            "C:/repo\n",
            "feature\n",
            " D gone.ts\n A new.ts\nM  staged-only.ts\n M unstaged.ts\n",
            new Error("no upstream"),
        );
        const status = await getGitStatus("C:/repo");
        expect(status).not.toBeNull();
        if (!status || isIpcError(status)) return;
        expect(status.branch).toBe("feature");
        expect(status.deleted).toContain("gone.ts");
        expect(status.added).toContain("new.ts");
        expect(status.modified).toContain("unstaged.ts");
        // staged-only 'M ' has worktree column space → not in modified
        expect(status.modified).not.toContain("staged-only.ts");
        expect(status.ahead).toBe(0);
        expect(status.behind).toBe(0);
    });

    it("returns empty changed-files list when not a git repository", async () => {
        mockResults.push(new Error("fatal: not a git repository"));
        await expect(gitChangedFiles("C:/repo")).resolves.toEqual([]);
    });

    it("maps -z porcelain deleted and copy-rename destination", async () => {
        mockResults.push(
            "C:/repo\n",
            " D src/gone.ts\0R  src/old.ts\0src/renamed.ts\0",
        );
        const files = await gitChangedFiles("C:/repo");
        expect(Array.isArray(files)).toBe(true);
        if (!Array.isArray(files)) return;
        expect(files).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: "C:/repo/src/gone.ts", status: "deleted" }),
                expect.objectContaining({ path: "C:/repo/src/renamed.ts", status: "renamed" }),
            ]),
        );
        expect(files.some((f) => f.path.endsWith("old.ts"))).toBe(false);
    });

    // wave-199 residual
    it("parses ahead/behind from rev-list left-right counts", async () => {
        mockResults.push(
            "C:/repo\n",
            "main\n",
            "\n",
            "origin/main\n",
            "3\t5\n",
        );
        const status = await getGitStatus("C:/repo");
        expect(status).not.toBeNull();
        if (!status || isIpcError(status)) return;
        expect(status.ahead).toBe(3);
        expect(status.behind).toBe(5);
        expect(status.branch).toBe("main");
    });

    it("keeps branch default when rev-parse HEAD fails and maps non-numeric ahead/behind to 0", async () => {
        mockResults.push(
            "C:/repo\n",
            new Error("detached"),
            "\n",
            "origin/main\n",
            "x\ty\n",
        );
        const status = await getGitStatus("C:/repo");
        expect(status).not.toBeNull();
        if (!status || isIpcError(status)) return;
        // product: catch on abbrev-ref keeps default "main"
        expect(status.branch).toBe("main");
        expect(status.ahead).toBe(0);
        expect(status.behind).toBe(0);
    });

    it("gitDiff without filePath runs plain git diff; with file uses -- separator", async () => {
        mockResults.push("diff --git a/a b/a\n");
        await expect(gitDiff("C:/repo")).resolves.toContain("diff --git");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );

        mockResults.push("diff --git a/src/app.ts b/src/app.ts\n");
        await expect(gitDiff("C:/repo", "src\\app.ts")).resolves.toContain("src/app.ts");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff", "--", "src/app.ts"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("blocks gitDiff for sensitive paths without invoking git", async () => {
        const result = await gitDiff("C:/repo", ".env");
        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("gitCommit runs parameterized -m message", async () => {
        mockResults.push("[main abc] msg\n");
        const out = await gitCommit("C:/repo", "feat: wave-199");
        // product returns git stdout; message is only in argv
        expect(out).toContain("[main abc]");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["commit", "-m", "feat: wave-199"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("allows createBranch names with slash and dot segments", async () => {
        mockResults.push("");
        const result = await gitCreateBranch("C:/repo", "feature/wave-199.1");
        expect(result).toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["checkout", "-b", "feature/wave-199.1"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    // wave-217 residual
    it("gitUnstage uses restore --staged -- paths; gitDiffStaged uses --staged", async () => {
        mockResults.push("");
        const unstage = await gitUnstage("C:/repo", ["src\\a.ts"]);
        expect(unstage).toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["restore", "--staged", "--", "src/a.ts"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );

        mockResults.push("diff --staged\n");
        await expect(gitDiffStaged("C:/repo")).resolves.toContain("diff --staged");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff", "--staged"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("gitAdd aborts entire batch when any path is protected; no git invoked", async () => {
        const result = await gitAdd("C:/repo", ["src/ok.ts", ".env.local"]);
        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.git.protectedPath");
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("createBranch rejects spaces/unicode; checkout fails when check-ref-format rejects", async () => {
        const badName = await gitCreateBranch("C:/repo", "bad branch");
        expect(isIpcError(badName)).toBe(true);
        if (isIpcError(badName)) {
            expect(badName.code).toBe("ipcErrors.git.invalidArgs");
        }
        expect(execFileMock).not.toHaveBeenCalled();

        mockResults.push(new Error("bad ref"));
        const checkout = await gitCheckout("C:/repo", "??");
        expect(isIpcError(checkout)).toBe(true);
        if (isIpcError(checkout)) {
            expect(checkout.code).toBe("ipcErrors.git.invalidArgs");
            expect(String(checkout.fallback)).toContain("??");
            expect(checkout.params?.branch).toBe("??");
        }
        // only check-ref-format ran; no checkout after fail
        expect(execFileMock).toHaveBeenCalledTimes(1);
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["check-ref-format", "--branch", "??"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    it("status ignores staged-only rows (index dirty, worktree clean)", async () => {
        // findGitRoot, branch, status porcelain, upstream fail
        mockResults.push(
            "C:/repo\n",
            "feature\n",
            "M  staged-only.ts\n M worktree-mod.ts\n",
            new Error("no upstream"),
        );
        const status = await getGitStatus("C:/repo");
        expect(status).not.toBeNull();
        if (!status || isIpcError(status)) return;
        expect(status.branch).toBe("feature");
        // worktree column only: "M " → not modified; " M" → modified
        expect(status.modified).toEqual(["worktree-mod.ts"]);
        expect(status.modified).not.toContain("staged-only.ts");
        expect(status.ahead).toBe(0);
        expect(status.behind).toBe(0);
    });

    // wave-253 residual
    it("status buckets untracked/deleted/added from worktree column; rename keeps destination", async () => {
        mockResults.push(
            "C:/repo\n",
            "main\n",
            "?? new.txt\n D gone.ts\n A added.ts\nR  old.ts -> renamed.ts\n M dirty.ts\n",
            new Error("no upstream"),
        );
        const status = await getGitStatus("C:/repo");
        expect(status).not.toBeNull();
        if (!status || isIpcError(status)) return;
        expect(status.untracked).toEqual(["new.txt"]);
        expect(status.deleted).toEqual(["gone.ts"]);
        expect(status.added).toEqual(["added.ts"]);
        // rename "R " is staged-only (worktree space) → not in modified; destination still listed if worktree dirty separately
        expect(status.modified).toEqual(["dirty.ts"]);
        expect(status.modified).not.toContain("old.ts");
    });

    it("gitCommit/gitPush invoke expected args; gitDiff with file path normalizes separators", async () => {
        mockResults.push("abc123\n");
        await expect(gitCommit("C:/repo", "msg")).resolves.toContain("abc123");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["commit", "-m", "msg"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );

        mockResults.push("ok\n");
        await expect(gitPush("C:/repo")).resolves.toContain("ok");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["push"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );

        mockResults.push("diff out\n");
        await expect(gitDiff("C:/repo", "src\\x.ts")).resolves.toContain("diff out");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff", "--", "src/x.ts"],
            expect.objectContaining({ cwd: "C:/repo" }),
            expect.any(Function),
        );
    });

    // wave-269 residual
    it("gitPush uses 60s timeout; gitOriginalContent uses HEAD:path and larger maxBuffer", async () => {
        mockResults.push("pushed\n");
        await expect(gitPush("C:/repo")).resolves.toContain("pushed");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["push"],
            expect.objectContaining({ cwd: "C:/repo", timeout: 60_000 }),
            expect.any(Function),
        );

        mockResults.push("C:/repo\n", "file body\n");
        await expect(gitOriginalContent("C:/repo", "src\\a.ts")).resolves.toBe("file body\n");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["-C", "C:/repo", "show", "HEAD:src/a.ts"],
            expect.objectContaining({ cwd: "C:/repo", maxBuffer: 32 * 1024 * 1024 }),
            expect.any(Function),
        );
    });

    it("gitChangedFiles maps staged X priority, untracked as added, and dedupes paths", async () => {
        mockResults.push(
            "C:/repo\n",
            "M  staged.ts\0?? new.ts\0 M dirty.ts\0A  added.ts\0D  gone.ts\0",
        );
        const files = await gitChangedFiles("C:/repo");
        expect(isIpcError(files)).toBe(false);
        if (isIpcError(files)) return;
        const byName = Object.fromEntries(files.map((f) => [f.path.split("/").pop()!, f.status]));
        expect(byName["staged.ts"]).toBe("modified");
        expect(byName["new.ts"]).toBe("added");
        expect(byName["dirty.ts"]).toBe("modified");
        expect(byName["added.ts"]).toBe("added");
        expect(byName["gone.ts"]).toBe("deleted");
        expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    });

    // wave-282 residual
    it("default execGit timeout 10s + 10MB maxBuffer; empty gitAdd no-ops; multi-file add", async () => {
        mockResults.push("ok\n");
        await expect(gitCommit("C:/repo", "wave-282")).resolves.toContain("ok");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["commit", "-m", "wave-282"],
            expect.objectContaining({
                cwd: "C:/repo",
                timeout: 10_000,
                maxBuffer: 10 * 1024 * 1024,
                encoding: "utf-8",
            }),
            expect.any(Function),
        );

        execFileMock.mockClear();
        mockResults.length = 0;
        await expect(gitAdd("C:/repo", [])).resolves.toBeUndefined();
        expect(execFileMock).not.toHaveBeenCalled();

        mockResults.push("\n");
        await expect(gitAdd("C:/repo", ["src\\a.ts", "src\\b.ts"])).resolves.toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["add", "--", "src/a.ts", "src/b.ts"],
            expect.objectContaining({ cwd: "C:/repo", timeout: 10_000 }),
            expect.any(Function),
        );
    });

    it("gitDiff without filePath uses bare diff; staged diff default timeout; unstage empty no-op", async () => {
        mockResults.push("full-diff\n");
        await expect(gitDiff("C:/repo")).resolves.toBe("full-diff\n");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff"],
            expect.objectContaining({ cwd: "C:/repo", timeout: 10_000, maxBuffer: 10 * 1024 * 1024 }),
            expect.any(Function),
        );

        mockResults.push("staged\n");
        await expect(gitDiffStaged("C:/repo")).resolves.toContain("staged");
        expect(execFileMock).toHaveBeenCalledWith(
            "git",
            ["diff", "--staged"],
            expect.objectContaining({ cwd: "C:/repo", timeout: 10_000 }),
            expect.any(Function),
        );

        execFileMock.mockClear();
        await expect(gitUnstage("C:/repo", [])).resolves.toBeUndefined();
        expect(execFileMock).not.toHaveBeenCalled();
    });



});
