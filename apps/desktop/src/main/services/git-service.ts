import { execFile } from "child_process";
import { isAbsolute, join, relative, resolve } from "path";
import { ipcError, type GitStatus, type GitChangedFile, type IpcError } from "@shared";
import { getProtectedPathReason } from "./protected-paths";

export function protectedGitPathError(path: string, reason: string): IpcError {
    return ipcError("ipcErrors.git.protectedPath", reason, { path });
}

function assertWorkspaceAllowed(workspacePath: string): IpcError | null {
    const reason = getProtectedPathReason(workspacePath);
    return reason ? protectedGitPathError(workspacePath, reason) : null;
}

function toGitPath(workspacePath: string, filePath: string): string | IpcError {
    const workspaceRoot = resolve(workspacePath);
    const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath);
    const reason = getProtectedPathReason(targetPath, workspaceRoot);
    if (reason) return protectedGitPathError(targetPath, reason);
    return relative(workspaceRoot, targetPath).replace(/\\/g, "/");
}

function normalizeGitPaths(workspacePath: string, files: string[]): string[] | IpcError {
    const normalized: string[] = [];
    for (const file of files) {
        const next = toGitPath(workspacePath, file);
        if (typeof next !== "string") return next;
        normalized.push(next);
    }
    return normalized;
}

// Async wrapper around `git` invocation. Replaces blocking execFileSync calls so
// the Electron main thread is no longer held while git runs. Defaults match the
// previous call sites (utf-8, 10s timeout, 10MB buffer); callers that need a
// larger buffer (e.g. gitOriginalContent) can pass an explicit maxBuffer.
function execGit(args: string[], cwd: string, timeout = 10000, maxBuffer = 10 * 1024 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            args,
            { cwd, encoding: "utf-8", timeout, maxBuffer },
            (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout);
            },
        );
    });
}

async function findGitRoot(workspacePath: string): Promise<string | null> {
    try {
        return (await execGit(["rev-parse", "--show-toplevel"], workspacePath)).trim();
    } catch {
        return null;
    }
}

export async function getGitStatus(workspacePath: string): Promise<GitStatus | null | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;

    const gitRoot = await findGitRoot(workspacePath);
    if (!gitRoot) return null;

    let branch = "main";
    try {
        branch = (await execGit(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot)).trim();
    } catch {
        // Detached head or unusual repository state; keep the UI usable.
    }

    const statusOutput = await execGit(["status", "--porcelain"], gitRoot);
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];

    for (const line of statusOutput.split("\n").filter((item) => item.trim())) {
        const status = line.substring(0, 2);
        // Porcelain renames: "R  old -> new" — keep the destination path for UI lists.
        const rawPath = line.substring(3).trim();
        const file = rawPath.includes(" -> ") ? (rawPath.split(" -> ").at(-1) ?? rawPath).trim() : rawPath;
        if (status === "??") {
            untracked.push(file);
            continue;
        }
        // Worktree (unstaged) column only — staged-only rows stay out of these buckets
        // so the rail "变更" list matches `git status` unstaged work.
        const worktreeStatus = status[1];
        if (worktreeStatus === "M") modified.push(file);
        if (worktreeStatus === "A") added.push(file);
        if (worktreeStatus === "D") deleted.push(file);
    }

    let ahead = 0;
    let behind = 0;
    try {
        const upstream = (await execGit(["rev-parse", "--abbrev-ref", "@{u}"], gitRoot)).trim();
        const countOutput = (
            await execGit(["rev-list", "--left-right", "--count", `HEAD...${upstream}`], gitRoot)
        ).trim();
        const parts = countOutput.split("\t");
        if (parts.length === 2) {
            ahead = parseInt(parts[0], 10) || 0;
            behind = parseInt(parts[1], 10) || 0;
        }
    } catch {
        // No upstream configured.
    }

    return { branch, modified, added, deleted, untracked, ahead, behind };
}

export async function gitDiff(workspacePath: string, filePath?: string): Promise<string | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (!filePath) {
        return execGit(["diff"], workspacePath);
    }
    const gitPath = toGitPath(workspacePath, filePath);
    if (typeof gitPath !== "string") return gitPath;
    return execGit(["diff", "--", gitPath], workspacePath);
}

export async function gitDiffStaged(workspacePath: string): Promise<string | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    return execGit(["diff", "--staged"], workspacePath);
}

export async function gitAdd(workspacePath: string, files: string[]): Promise<void | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (files.length === 0) return undefined;
    const gitPaths = normalizeGitPaths(workspacePath, files);
    if (!Array.isArray(gitPaths)) return gitPaths;
    await execGit(["add", "--", ...gitPaths], workspacePath);
    return undefined;
}

export async function gitUnstage(workspacePath: string, files: string[]): Promise<void | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (files.length === 0) return undefined;
    const gitPaths = normalizeGitPaths(workspacePath, files);
    if (!Array.isArray(gitPaths)) return gitPaths;
    await execGit(["restore", "--staged", "--", ...gitPaths], workspacePath);
    return undefined;
}

export async function gitCommit(workspacePath: string, message: string): Promise<string | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    return execGit(["commit", "-m", message], workspacePath);
}
export async function gitPush(workspacePath: string): Promise<string | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    return execGit(["push"], workspacePath, 60_000);
}

export async function gitCheckout(workspacePath: string, branch: string): Promise<void | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    try {
        await execGit(["check-ref-format", "--branch", branch], workspacePath);
        await execGit(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], workspacePath);
    } catch {
        return ipcError("ipcErrors.git.invalidArgs", `分支不存在: ${branch}`, { branch });
    }
    await execGit(["checkout", branch], workspacePath);
}

export async function gitCreateBranch(workspacePath: string, branchName: string): Promise<void | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (!/^[a-zA-Z0-9._\-/]+$/.test(branchName)) {
        return ipcError("ipcErrors.git.invalidArgs", `分支名包含非法字符: ${branchName}`);
    }
    await execGit(["checkout", "-b", branchName], workspacePath);
    return undefined;
}

export async function gitOriginalContent(
    workspacePath: string,
    filePath: string,
): Promise<string | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    const gitRoot = await findGitRoot(workspacePath);
    if (!gitRoot) return "";
    const gitPath = toGitPath(workspacePath, filePath);
    if (typeof gitPath !== "string") return gitPath;
    // `git show HEAD:<path>` 的路径永远相对 repo 根 (`-C` 只改 cwd, 不影响
    // tree 内路径语义)。当 workspace 是 repo 的子目录 (嵌套仓库) 时, 必须把
    // workspace 相对 repo 根的目录前缀拼到前面, 否则原内容解析必然失败,
    // 撤销/对比功能在嵌套仓库工作区恒为空且无提示。
    let treePrefix = "";
    try {
        const prefix = (await execGit(["rev-parse", "--show-prefix"], workspacePath)).trim();
        if (prefix) treePrefix = prefix;
    } catch {
        // 前缀解析失败时保持旧行为 (空前缀), 不阻断主流程。
    }
    try {
        return await execGit(
            ["-C", gitRoot, "show", `HEAD:${treePrefix}${gitPath}`],
            gitRoot,
            10000,
            32 * 1024 * 1024,
        );
    } catch {
        return "";
    }
}

export async function gitChangedFiles(workspacePath: string): Promise<GitChangedFile[] | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    const gitRoot = await findGitRoot(workspacePath);
    if (!gitRoot) return [];

    // Use `git status -z --porcelain` so filenames containing spaces or special
    // characters are NUL-separated instead of whitespace-separated. With -z,
    // each entry is "XY path\0"; renames/copies emit "XY dest\0src\0" — the
    // destination lives in the entry itself and the SECOND token holds the
    // ORIGINAL (source) path, which must be skipped, not reported.
    const output = await execGit(["status", "-z", "--porcelain"], gitRoot);
    const tokens = output.split("\0");
    // Trailing NUL produces a final empty token — drop it.
    if (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();

    const files: GitChangedFile[] = [];
    const seen = new Set<string>();
    const addFile = (relPath: string, status: GitChangedFile["status"]): void => {
        if (!relPath || seen.has(relPath)) return;
        seen.add(relPath);
        files.push({ path: join(gitRoot, relPath).replace(/\\/g, "/"), status });
    };

    const mapStatus = (ch: string): GitChangedFile["status"] =>
        ch === "A" ? "added" : ch === "D" ? "deleted" : ch === "R" ? "renamed" : "modified";

    for (let i = 0; i < tokens.length; ) {
        const entry = tokens[i];
        if (!entry) {
            i++;
            continue;
        }
        const xy = entry.substring(0, 2);
        const x = xy[0];
        const y = xy[1];
        // The destination path is embedded in the entry itself ("XY dest").
        // Renames/copies append a second NUL-separated token holding the
        // ORIGINAL path — skip it (i += 2) but never report it.
        const path = entry.substring(3);
        if ((x === "R" || x === "C" || y === "R" || y === "C") && i + 1 < tokens.length) {
            i += 2;
        } else {
            i += 1;
        }

        // Map the XY porcelain status to the GitChangedFile status union.
        // Staged (X) takes priority; fall back to unstaged (Y); untracked ("?")
        // is reported as "added" to match the previous ls-files behavior.
        let ch: string;
        if (x === "?") ch = "A";
        else if (x !== " ") ch = x;
        else ch = y;
        addFile(path, mapStatus(ch));
    }
    return files;
}
