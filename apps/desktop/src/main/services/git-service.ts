import { execFile, execFileSync } from "child_process";
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

function execGitAsync(args: string[], cwd: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        execFile("git", args, { cwd, encoding: "utf-8" }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolvePromise(stdout);
        });
    });
}

function findGitRoot(workspacePath: string): string | null {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: workspacePath,
            encoding: "utf-8",
        }).trim();
    } catch {
        return null;
    }
}

async function findGitRootAsync(workspacePath: string): Promise<string | null> {
    try {
        return (await execGitAsync(["rev-parse", "--show-toplevel"], workspacePath)).trim();
    } catch {
        return null;
    }
}

export async function getGitStatus(workspacePath: string): Promise<GitStatus | null | IpcError> {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;

    const gitRoot = await findGitRootAsync(workspacePath);
    if (!gitRoot) return null;

    let branch = "main";
    try {
        branch = (await execGitAsync(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot)).trim();
    } catch {
        // Detached head or unusual repository state; keep the UI usable.
    }

    const statusOutput = await execGitAsync(["status", "--porcelain"], gitRoot);
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];

    for (const line of statusOutput.split("\n").filter((item) => item.trim())) {
        const status = line.substring(0, 2);
        const file = line.substring(3).trim();
        if (status === "??") {
            untracked.push(file);
            continue;
        }
        const worktreeStatus = status[1];
        if (worktreeStatus === "M") modified.push(file);
        if (worktreeStatus === "A") added.push(file);
        if (worktreeStatus === "D") deleted.push(file);
    }

    let ahead = 0;
    let behind = 0;
    try {
        const upstream = (await execGitAsync(["rev-parse", "--abbrev-ref", "@{u}"], gitRoot)).trim();
        const countOutput = (await execGitAsync(["rev-list", "--left-right", "--count", `HEAD...${upstream}`], gitRoot)).trim();
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

export function gitDiff(workspacePath: string, filePath?: string): string | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (!filePath) {
        return execFileSync("git", ["diff"], {
            cwd: workspacePath,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
        });
    }
    const gitPath = toGitPath(workspacePath, filePath);
    if (typeof gitPath !== "string") return gitPath;
    return execFileSync("git", ["diff", "--", gitPath], {
        cwd: workspacePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
    });
}

export function gitDiffStaged(workspacePath: string): string | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    return execFileSync("git", ["diff", "--staged"], {
        cwd: workspacePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
    });
}

export function gitAdd(workspacePath: string, files: string[]): void | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (files.length === 0) return undefined;
    const gitPaths = normalizeGitPaths(workspacePath, files);
    if (!Array.isArray(gitPaths)) return gitPaths;
    execFileSync("git", ["add", "--", ...gitPaths], { cwd: workspacePath });
    return undefined;
}

export function gitUnstage(workspacePath: string, files: string[]): void | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (files.length === 0) return undefined;
    const gitPaths = normalizeGitPaths(workspacePath, files);
    if (!Array.isArray(gitPaths)) return gitPaths;
    execFileSync("git", ["restore", "--staged", "--", ...gitPaths], { cwd: workspacePath });
    return undefined;
}

export function gitCommit(workspacePath: string, message: string): string | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    return execFileSync("git", ["commit", "-m", message], {
        cwd: workspacePath,
        encoding: "utf-8",
    });
}

export function gitCheckout(workspacePath: string, branch: string): void | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (!/^[a-zA-Z0-9._\-/]+$/.test(branch)) {
        return ipcError("ipcErrors.git.invalidArgs", `分支名包含非法字符: ${branch}`);
    }
    execFileSync("git", ["checkout", branch], { cwd: workspacePath, encoding: "utf-8" });
    return undefined;
}

export function gitCreateBranch(workspacePath: string, branchName: string): void | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    if (!/^[a-zA-Z0-9._\-/]+$/.test(branchName)) {
        return ipcError("ipcErrors.git.invalidArgs", `分支名包含非法字符: ${branchName}`);
    }
    execFileSync("git", ["checkout", "-b", branchName], { cwd: workspacePath, encoding: "utf-8" });
    return undefined;
}

export function gitOriginalContent(workspacePath: string, filePath: string): string | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    const gitRoot = findGitRoot(workspacePath);
    if (!gitRoot) return "";
    const gitPath = toGitPath(workspacePath, filePath);
    if (typeof gitPath !== "string") return gitPath;
    try {
        return execFileSync("git", ["-C", gitRoot, "show", `HEAD:${gitPath}`], {
            encoding: "utf-8",
            maxBuffer: 32 * 1024 * 1024,
        });
    } catch {
        return "";
    }
}

export function gitChangedFiles(workspacePath: string): GitChangedFile[] | IpcError {
    const workspaceError = assertWorkspaceAllowed(workspacePath);
    if (workspaceError) return workspaceError;
    const gitRoot = findGitRoot(workspacePath);
    if (!gitRoot) return [];

    const run = (args: string[]): string => {
        try {
            return execFileSync("git", args, { cwd: gitRoot, encoding: "utf-8" });
        } catch {
            return "";
        }
    };

    const staged = run(["diff", "--cached", "--name-status", "--diff-filter=ACDMR"]);
    const unstaged = run(["diff", "--name-status", "--diff-filter=ACDMR"]);
    const untracked = run(["ls-files", "--others", "--exclude-standard"]);

    const files: GitChangedFile[] = [];
    const seen = new Set<string>();
    const addFile = (relPath: string, status: GitChangedFile["status"]): void => {
        if (!relPath || seen.has(relPath)) return;
        seen.add(relPath);
        files.push({ path: join(gitRoot, relPath).replace(/\\/g, "/"), status });
    };

    const mapStatus = (ch: string): GitChangedFile["status"] =>
        ch === "A" ? "added" : ch === "D" ? "deleted" : ch === "R" ? "renamed" : "modified";

    for (const line of staged.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [statusChar, ...pathParts] = trimmed.split(/\s+/);
        addFile(pathParts.join(" "), mapStatus(statusChar ?? "M"));
    }
    for (const line of unstaged.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [statusChar, ...pathParts] = trimmed.split(/\s+/);
        addFile(pathParts.join(" "), mapStatus(statusChar ?? "M"));
    }
    for (const line of untracked.split(/\r?\n/)) {
        addFile(line.trim(), "added");
    }
    return files;
}
