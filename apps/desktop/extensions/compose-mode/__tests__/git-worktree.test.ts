import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
    applyComposeWorktreePatch,
    commitComposeWorkspace,
    createComposeWorktree,
    detectGitWorktreeSupport,
    captureComposeWorktreePatch,
    removeComposeWorktree,
    workspaceHasGitChanges,
} from "../git-worktree";

const SLOW_GIT_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000;

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function createRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), "compose-worktree-"));
    return initRepo(repo);
}

function initRepo(repo: string): string {
    git(["init"], repo);
    git(["config", "user.name", "Pi Desktop Tests"], repo);
    git(["config", "user.email", "pi-desktop-tests@example.com"], repo);
    writeFileSync(join(repo, "README.md"), "# repo\n", "utf8");
    git(["add", "README.md"], repo);
    git(["commit", "-m", "chore: init"], repo);
    return repo;
}

function createDeepRepo(): { repo: string; root: string } {
    const root = mkdtempSync(join(tmpdir(), "compose-worktree-deep-"));
    const repo = join(root, "nested-path-segment-aaaaaaaaaaaaaaaa", "nested-path-segment-bbbbbbbbbbbbbbbb", "workspace-root-cccccccccccccccc");
    mkdirSync(repo, { recursive: true });
    initRepo(repo);
    return { repo, root };
}

describe("compose git worktree helpers", () => {
    it("returns an honest unsupported result for a non-git folder", () => {
        const result = detectGitWorktreeSupport("C:/");

        expect(result.supported).toBe(false);
        expect(result.reason).toEqual(expect.any(String));
    }, SLOW_GIT_TEST_TIMEOUT_MS);

    it("creates an isolated worktree, applies its patch back to the root workspace, commits, and cleans up", () => {
        const repo = createRepo();
        try {
            const support = detectGitWorktreeSupport(repo);
            expect(support).toMatchObject({
                supported: true,
                clean: true,
            });

            const worktree = createComposeWorktree(repo, "run-1234", "Implement full Compose runtime");
            writeFileSync(join(worktree.worktreePath, "README.md"), "# repo\n\npatched\n", "utf8");
            writeFileSync(join(worktree.worktreePath, "workflow.txt"), "WORKFLOW_OK\n", "utf8");

            const patch = captureComposeWorktreePatch(worktree.worktreePath);
            expect(patch.changed).toBe(true);
            expect(patch.changedFiles).toEqual(expect.arrayContaining(["README.md", "workflow.txt"]));

            const applied = applyComposeWorktreePatch(worktree.gitRoot, patch.patch ?? "", worktree.branchName);
            expect(applied.applied).toBe(true);
            expect(readFileSync(join(repo, "README.md"), "utf8")).toContain("patched");
            expect(readFileSync(join(repo, "workflow.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("WORKFLOW_OK\n");
            expect(workspaceHasGitChanges(repo)).toBe(true);

            removeComposeWorktree(worktree);
            expect(existsSync(worktree.worktreePath)).toBe(false);
            expect(() => git(["rev-parse", "--verify", worktree.branchName], repo)).toThrow();

            const committed = commitComposeWorkspace(repo, "feat(compose): integrate isolated worktree patch");
            expect(committed).toMatchObject({
                committed: true,
                sha: expect.any(String),
            });
            expect(workspaceHasGitChanges(repo)).toBe(false);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    }, SLOW_GIT_TEST_TIMEOUT_MS);

    it("reports dirty repositories as unsupported for worktree isolation", () => {
        const repo = createRepo();
        try {
            writeFileSync(join(repo, "README.md"), "# repo\n\ndirty\n", "utf8");
            const result = detectGitWorktreeSupport(repo);

            expect(result.supported).toBe(false);
            expect(result.clean).toBe(false);
            expect(result.reason).toContain("uncommitted changes");
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    }, SLOW_GIT_TEST_TIMEOUT_MS);

    it("can create a worktree from an earlier clean git base even after compose artifacts dirty the root workspace", () => {
        const repo = createRepo();
        try {
            const support = detectGitWorktreeSupport(repo);
            expect(support).toMatchObject({
                supported: true,
                gitRoot: expect.any(String),
                headSha: expect.any(String),
            });

            writeFileSync(join(repo, "docs-compose-plan.md"), "compose plan\n", "utf8");
            expect(detectGitWorktreeSupport(repo).supported).toBe(false);

            const worktree = createComposeWorktree(repo, "run-keep-clean-base", "task-with-dirty-root", support);
            expect(existsSync(worktree.worktreePath)).toBe(true);
            removeComposeWorktree(worktree);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    }, SLOW_GIT_TEST_TIMEOUT_MS);

    it("keeps Windows worktree paths short enough for deep repositories", () => {
        if (process.platform !== "win32") {
            expect(true).toBe(true);
            return;
        }

        const { repo, root } = createDeepRepo();
        try {
            const worktree = createComposeWorktree(
                repo,
                "e2055ae8-da20-4c3d-9f8f-975691e89afd",
                "Implement compose runtime task 1 with isolated worktree",
            );

            expect(existsSync(worktree.worktreePath)).toBe(true);
            removeComposeWorktree(worktree);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, SLOW_GIT_TEST_TIMEOUT_MS);
});
