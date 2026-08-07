// git.ipc.ts unit tests
// Mocks git-service + protected-paths; captures ipcMain.handle handlers and
// asserts return values for: normal success, git command failure (ipcError),
// empty workspacePath (schema validation), and protected-path rejection.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError } from "@shared";
import { resolve } from "path";

// vi.mock factories are hoisted above const declarations, so any variable
// referenced directly inside a factory MUST be created via vi.hoisted() to
// avoid TDZ errors. `handlers` is only referenced lazily inside a callback
// (ipcMain.handle's wrapper), so it can stay as a regular const.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const registeredWorkspacePath = resolve("C:/repo");

const { gitServiceMock, getProtectedPathReasonMock, execFileMock, execFileSyncMock } = vi.hoisted(() => ({
    // Mocked git-service functions — each test configures return/reject behavior.
    gitServiceMock: {
        getGitStatus: vi.fn(),
        gitDiff: vi.fn(),
        gitDiffStaged: vi.fn(),
        gitAdd: vi.fn(),
        gitUnstage: vi.fn(),
        gitCommit: vi.fn(),
        gitPush: vi.fn(),
        gitCheckout: vi.fn(),
        gitCreateBranch: vi.fn(),
        gitOriginalContent: vi.fn(),
        gitChangedFiles: vi.fn(),
    },
    // Mocked protected-paths guard — tests can override per-test.
    getProtectedPathReasonMock: vi.fn(() => null),
    execFileMock: vi.fn(),
    // Guard against regressions back to blocking child-process APIs.
    execFileSyncMock: vi.fn(() => ""),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

vi.mock("child_process", () => ({
    execFile: execFileMock,
    execFileSync: execFileSyncMock,
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock("../../services/git-service", () => gitServiceMock);
vi.mock("../../services/protected-paths", () => ({
    getProtectedPathReason: getProtectedPathReasonMock,
}));

import { setupGitIpc } from "../git.ipc";

function mockExecFileOutput(stdout: string): void {
    execFileMock.mockImplementationOnce((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => callback(null, stdout, ""));
}

function mockExecFileError(error: Error): void {
    execFileMock.mockImplementationOnce((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => callback(error, "", ""));
}

describe("git IPC", () => {
    beforeEach(() => {
        handlers.clear();
        Object.values(gitServiceMock).forEach((fn) => fn.mockReset());
        getProtectedPathReasonMock.mockReset();
        getProtectedPathReasonMock.mockReturnValue(null);
        execFileMock.mockReset();
        execFileMock.mockImplementation((
            _file: string,
            _args: string[],
            _options: unknown,
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => callback(null, "", ""));
        execFileSyncMock.mockReset();
        execFileSyncMock.mockReturnValue("");
        setupGitIpc({
            getRegisteredWorkspaces: () => [{ path: registeredWorkspacePath }],
        });
    });

    it("rejects Git operations for an unregistered workspace root", async () => {
        gitServiceMock.getGitStatus.mockResolvedValue({ branch: "main" });

        const result = await handlers.get("git:status")!({}, "C:/other-repo");

        expect(result).toMatchObject({ code: "ipcErrors.workspace.unregisteredPath" });
        expect(gitServiceMock.getGitStatus).not.toHaveBeenCalled();
    });

    it("rejects a registered Git root when its canonical path is protected", async () => {
        getProtectedPathReasonMock.mockImplementation((path: string) =>
            path === registeredWorkspacePath ? "路径位于敏感凭据目录" : null,
        );

        const result = await handlers.get("git:status")!({}, "C:/repo");

        expect(result).toMatchObject({ code: "ipcErrors.git.protectedPath" });
        expect(gitServiceMock.getGitStatus).not.toHaveBeenCalled();
    });

    // ── git:status ───────────────────────────────────────────────────────
    describe("git:status", () => {
        it("returns git status on success", async () => {
            const status = { branch: "main", modified: [], added: [], deleted: [], untracked: [], ahead: 0, behind: 0 };
            gitServiceMock.getGitStatus.mockResolvedValue(status);

            const handler = handlers.get("git:status")!;
            const result = await handler({}, "C:/repo");

            expect(result).toEqual(status);
            expect(gitServiceMock.getGitStatus).toHaveBeenCalledWith(registeredWorkspacePath);
        });

        it("returns ipcError when getGitStatus throws", async () => {
            gitServiceMock.getGitStatus.mockRejectedValue(new Error("git not found"));

            const handler = handlers.get("git:status")!;
            const result = await handler({}, "C:/repo");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.statusFailed");
            }
        });

        it("deduplicates identical in-flight status reads", async () => {
            let resolveStatus!: (value: unknown) => void;
            const pendingStatus = new Promise((resolve) => {
                resolveStatus = resolve;
            });
            gitServiceMock.getGitStatus.mockReturnValue(pendingStatus);

            const handler = handlers.get("git:status")!;
            const first = handler({}, "C:/repo");
            const second = handler({}, "C:/repo");

            await vi.waitFor(() => {
                expect(gitServiceMock.getGitStatus).toHaveBeenCalledTimes(1);
            });
            resolveStatus({ branch: "main" });
            await expect(first).resolves.toEqual({ branch: "main" });
            await expect(second).resolves.toEqual({ branch: "main" });
        });
    });

    // ── git:diff ─────────────────────────────────────────────────────────
    describe("git:diff", () => {
        it("returns diff output on success", async () => {
            gitServiceMock.gitDiff.mockResolvedValue("diff --git a/file b/file\n...");

            const handler = handlers.get("git:diff")!;
            const result = await handler({}, "C:/repo", "src/index.ts");

            expect(result).toBe("diff --git a/file b/file\n...");
            expect(gitServiceMock.gitDiff).toHaveBeenCalledWith(registeredWorkspacePath, "src/index.ts");
        });

        it("returns ipcError when gitDiff throws", async () => {
            gitServiceMock.gitDiff.mockRejectedValue(new Error("diff failed"));

            const handler = handlers.get("git:diff")!;
            const result = await handler({}, "C:/repo", "src/index.ts");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.diffFailed");
            }
        });

        it("returns ipcError for empty workspacePath (schema validation)", async () => {
            const handler = handlers.get("git:diff")!;
            const result = await handler({}, "", "src/index.ts");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });
    });

    // ── git:add ──────────────────────────────────────────────────────────
    describe("git:add", () => {
        it("stages files on success", async () => {
            gitServiceMock.gitAdd.mockResolvedValue(undefined);

            const handler = handlers.get("git:add")!;
            const result = await handler({}, "C:/repo", ["file1.ts", "file2.ts"]);

            expect(isIpcError(result)).toBe(false);
            expect(gitServiceMock.gitAdd).toHaveBeenCalledWith(registeredWorkspacePath, ["file1.ts", "file2.ts"]);
        });

        it("returns ipcError when gitAdd throws", async () => {
            gitServiceMock.gitAdd.mockRejectedValue(new Error("add failed"));

            const handler = handlers.get("git:add")!;
            const result = await handler({}, "C:/repo", ["file1.ts"]);

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.addFailed");
            }
        });

        it("returns ipcError for empty workspacePath", async () => {
            const handler = handlers.get("git:add")!;
            const result = await handler({}, "", ["file1.ts"]);

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });

        it("returns undefined (no-op) for empty files array", async () => {
            const handler = handlers.get("git:add")!;
            const result = await handler({}, "C:/repo", []);

            expect(result).toBeUndefined();
            expect(gitServiceMock.gitAdd).not.toHaveBeenCalled();
        });
    });

    // ── git:commit ───────────────────────────────────────────────────────
    describe("git:commit", () => {
        it("returns commit output on success", async () => {
            gitServiceMock.gitCommit.mockResolvedValue("[main abc123] fix: update file");

            const handler = handlers.get("git:commit")!;
            const result = await handler({}, "C:/repo", "fix: update file");

            expect(result).toBe("[main abc123] fix: update file");
            expect(gitServiceMock.gitCommit).toHaveBeenCalledWith(registeredWorkspacePath, "fix: update file");
        });

        it("returns ipcError when gitCommit throws", async () => {
            gitServiceMock.gitCommit.mockRejectedValue(new Error("commit failed"));

            const handler = handlers.get("git:commit")!;
            const result = await handler({}, "C:/repo", "msg");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.commitFailed");
            }
        });

        it("returns ipcError for empty workspacePath", async () => {
            const handler = handlers.get("git:commit")!;
            const result = await handler({}, "", "msg");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });

        it("returns ipcError for empty message", async () => {
            const handler = handlers.get("git:commit")!;
            const result = await handler({}, "C:/repo", "");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });
    });

    describe("git:push", () => {
        it("returns push output on success", async () => {
            gitServiceMock.gitPush.mockResolvedValue("Everything up-to-date");

            const handler = handlers.get("git:push")!;
            const result = await handler({}, "C:/repo");

            expect(result).toBe("Everything up-to-date");
            expect(gitServiceMock.gitPush).toHaveBeenCalledWith(registeredWorkspacePath);
        });

        it("returns ipcError when push fails", async () => {
            gitServiceMock.gitPush.mockRejectedValue(new Error("remote rejected"));

            const handler = handlers.get("git:push")!;
            const result = await handler({}, "C:/repo");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) expect(result.code).toBe("ipcErrors.git.pushFailed");
        });

        it("maps authentication failures to pushFailed with readable fallback (G-009)", async () => {
            gitServiceMock.gitPush.mockRejectedValue(
                new Error("Authentication failed for 'https://github.com/org/repo.git'"),
            );

            const handler = handlers.get("git:push")!;
            const result = await handler({}, "C:/repo");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.pushFailed");
                expect(result.fallback).toMatch(/Authentication failed|git push 失败/);
            }
        });

        it("rejects an empty workspace path", async () => {
            const handler = handlers.get("git:push")!;
            const result = await handler({}, "");

            expect(isIpcError(result)).toBe(true);
            expect(gitServiceMock.gitPush).not.toHaveBeenCalled();
        });
    });
    // ── git:checkout (protected path + schema) ──────────────────────────
    describe("git:checkout", () => {
        it("returns branch list on success", async () => {
            gitServiceMock.gitCheckout.mockResolvedValue(undefined);
            mockExecFileOutput("* main\n  develop\n  remotes/origin/main\n");

            const handler = handlers.get("git:checkout")!;
            const result = await handler({}, "C:/repo", "develop");

            expect(Array.isArray(result)).toBe(true);
            const branches = result as Array<{ name: string; isCurrent: boolean; isRemote: boolean }>;
            expect(branches).toHaveLength(3);
            expect(branches[0]).toMatchObject({ name: "main", isCurrent: true });
            expect(branches[1]).toMatchObject({ name: "develop", isCurrent: false });
            expect(branches[2]).toMatchObject({ name: "remotes/origin/main", isRemote: true });
        });

        it("returns ipcError for protected path", async () => {
            getProtectedPathReasonMock.mockReturnValue("路径不在当前工作区内");

            const handler = handlers.get("git:checkout")!;
            const result = await handler({}, "C:/secret", "main");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.protectedPath");
            }
            expect(gitServiceMock.gitCheckout).not.toHaveBeenCalled();
        });

        it("returns ipcError for empty workspacePath (schema)", async () => {
            const handler = handlers.get("git:checkout")!;
            const result = await handler({}, "", "main");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });

        it("returns ipcError when gitCheckout throws", async () => {
            gitServiceMock.gitCheckout.mockRejectedValue(new Error("checkout failed"));

            const handler = handlers.get("git:checkout")!;
            const result = await handler({}, "C:/repo", "develop");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.checkoutFailed");
            }
        });
    });

    // ── git:log (protected path + async execFile) ───────────────────────
    describe("git:log", () => {
        it("returns commit log entries on success", async () => {
            // NUL-separated: hash, author, date, message, then record separator
            mockExecFileOutput("abc123\x00Author\x002026-01-01\x00fix: bug\x00def456\x00Dev\x002026-01-02\x00feat: add\x00");

            const handler = handlers.get("git:log")!;
            const result = await handler({}, "C:/repo", 10);

            expect(Array.isArray(result)).toBe(true);
            const entries = result as Array<{ hash: string; author: string; date: string; message: string }>;
            expect(entries).toHaveLength(2);
            expect(entries[0]).toMatchObject({ hash: "abc123", author: "Author", message: "fix: bug" });
            expect(entries[1]).toMatchObject({ hash: "def456", author: "Dev", message: "feat: add" });
            expect(execFileSyncMock).not.toHaveBeenCalled();
        });

        it("returns ipcError for protected path", async () => {
            getProtectedPathReasonMock.mockReturnValue("路径不在当前工作区内");

            const handler = handlers.get("git:log")!;
            const result = await handler({}, "C:/secret");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.protectedPath");
            }
        });

        it("returns ipcError when execFile throws", async () => {
            mockExecFileError(new Error("git log failed"));

            const handler = handlers.get("git:log")!;
            const result = await handler({}, "C:/repo");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.logFailed");
            }
        });

        it.each([0, -1, 1.5, 1001])("rejects invalid count %s before running git", async (count) => {
            const result = await handlers.get("git:log")!({}, "C:/repo", count);

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
            expect(execFileMock).not.toHaveBeenCalled();
        });
    });

    // ── git:changed-files ────────────────────────────────────────────────
    describe("git:changed-files", () => {
        it("returns changed file list on success", async () => {
            const files = [{ path: "C:/repo/a.ts", status: "modified" as const }];
            gitServiceMock.gitChangedFiles.mockResolvedValue(files);

            const handler = handlers.get("git:changed-files")!;
            const result = await handler({}, "C:/repo");

            expect(result).toEqual(files);
            expect(gitServiceMock.gitChangedFiles).toHaveBeenCalledWith(registeredWorkspacePath);
        });

        it("returns ipcError for empty workspacePath (schema)", async () => {
            const handler = handlers.get("git:changed-files")!;
            const result = await handler({}, "");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });
    });

    // ── git:diff-staged ──────────────────────────────────────────────────
    describe("git:diff-staged", () => {
        it("returns staged diff on success", async () => {
            gitServiceMock.gitDiffStaged.mockResolvedValue("staged diff content");

            const handler = handlers.get("git:diff-staged")!;
            const result = await handler({}, "C:/repo");

            expect(result).toBe("staged diff content");
            expect(gitServiceMock.gitDiffStaged).toHaveBeenCalledWith(registeredWorkspacePath);
        });

        it("returns ipcError when gitDiffStaged throws", async () => {
            gitServiceMock.gitDiffStaged.mockRejectedValue(new Error("staged diff failed"));

            const handler = handlers.get("git:diff-staged")!;
            const result = await handler({}, "C:/repo");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.diffFailed");
            }
        });
    });

    // ── git:unstage ──────────────────────────────────────────────────────
    describe("git:unstage", () => {
        it("unstages files on success", async () => {
            gitServiceMock.gitUnstage.mockResolvedValue(undefined);

            const handler = handlers.get("git:unstage")!;
            const result = await handler({}, "C:/repo", ["file1.ts"]);

            expect(isIpcError(result)).toBe(false);
            expect(gitServiceMock.gitUnstage).toHaveBeenCalledWith(registeredWorkspacePath, ["file1.ts"]);
        });

        it("returns ipcError when gitUnstage throws", async () => {
            gitServiceMock.gitUnstage.mockRejectedValue(new Error("unstage failed"));

            const handler = handlers.get("git:unstage")!;
            const result = await handler({}, "C:/repo", ["file1.ts"]);

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.unstageFailed");
            }
        });
    });

    // ── git:original-content ─────────────────────────────────────────────
    describe("git:original-content", () => {
        it("returns HEAD content on success", async () => {
            gitServiceMock.gitOriginalContent.mockResolvedValue("original content");

            const handler = handlers.get("git:original-content")!;
            const result = await handler({}, "C:/repo", "src/file.ts");

            expect(result).toBe("original content");
            expect(gitServiceMock.gitOriginalContent).toHaveBeenCalledWith(registeredWorkspacePath, "src/file.ts");
        });

        it("returns ipcError for empty workspacePath (schema)", async () => {
            const handler = handlers.get("git:original-content")!;
            const result = await handler({}, "", "src/file.ts");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
        });
    });

    // ── git:create-branch (protected path + schema) ─────────────────────
    describe("git:create-branch", () => {
        it("returns branch list on success", async () => {
            gitServiceMock.gitCreateBranch.mockResolvedValue(undefined);
            mockExecFileOutput("* main\n  new-branch\n");

            const handler = handlers.get("git:create-branch")!;
            const result = await handler({}, "C:/repo", "new-branch");

            expect(Array.isArray(result)).toBe(true);
            const branches = result as Array<{ name: string }>;
            expect(branches).toHaveLength(2);
            expect(branches[1]).toMatchObject({ name: "new-branch" });
        });

        it("returns ipcError for protected path", async () => {
            getProtectedPathReasonMock.mockReturnValue("路径不在当前工作区内");

            const handler = handlers.get("git:create-branch")!;
            const result = await handler({}, "C:/secret", "new-branch");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.protectedPath");
            }
            expect(gitServiceMock.gitCreateBranch).not.toHaveBeenCalled();
        });

        it("returns ipcError when gitCreateBranch throws", async () => {
            gitServiceMock.gitCreateBranch.mockRejectedValue(new Error("create branch failed"));

            const handler = handlers.get("git:create-branch")!;
            const result = await handler({}, "C:/repo", "new-branch");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.createBranchFailed");
            }
        });
    });

    // ── git:branches (protected path + async execFile) ──────────────────
    describe("git:branches", () => {
        it("returns branch list on success", async () => {
            mockExecFileOutput("* main\n  develop\n");

            const handler = handlers.get("git:branches")!;
            const result = await handler({}, "C:/repo");

            expect(Array.isArray(result)).toBe(true);
            const branches = result as Array<{ name: string; isCurrent: boolean }>;
            expect(branches).toHaveLength(2);
            expect(branches[0]).toMatchObject({ name: "main", isCurrent: true });
            expect(execFileSyncMock).not.toHaveBeenCalled();
        });

        it("returns ipcError for protected path", async () => {
            getProtectedPathReasonMock.mockReturnValue("路径不在当前工作区内");

            const handler = handlers.get("git:branches")!;
            const result = await handler({}, "C:/secret");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.protectedPath");
            }
        });

        it("returns ipcError for an empty workspace path", async () => {
            const result = await handlers.get("git:branches")!({}, "");

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.git.invalidArgs");
            }
            expect(execFileMock).not.toHaveBeenCalled();
        });
    });
});
