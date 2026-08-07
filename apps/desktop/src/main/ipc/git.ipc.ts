import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import log from 'electron-log/main';
import { ipcError, isIpcError } from '@shared';
import { gitAdd, gitCommit, gitPush, gitDiff, gitDiffStaged, getGitStatus, gitUnstage, gitCheckout, gitCreateBranch, gitOriginalContent, gitChangedFiles } from '../services/git-service';
import { getProtectedPathReason } from '../services/protected-paths';
import { gitAddSchema, gitCommitSchema, gitPushSchema, gitDiffSchema, gitDiffStagedSchema, gitCheckoutSchema, gitCreateBranchSchema, gitOriginalContentSchema, gitChangedFilesSchema, gitStatusSchema, gitLogSchema, gitBranchesSchema } from './schemas';
import { createRegisteredWorkspaceResolver, type RegisteredWorkspacePath } from './workspace-authorization';


interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

const inFlightGitReads = new Map<string, Promise<unknown>>();

function deduplicateGitRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = inFlightGitReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = read();
  inFlightGitReads.set(key, pending);
  const clear = (): void => {
    if (inFlightGitReads.get(key) === pending) inFlightGitReads.delete(key);
  };
  void pending.then(clear, clear);
  return pending;
}

function gitReadKey(channel: string, ...args: unknown[]): string {
  return JSON.stringify([channel, ...args]);
}

function runGit(workspacePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 10_000,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function parseBranches(output: string): GitBranchEntry[] {
  return output.split('\n').filter(line => line.trim()).map(line => ({
    name: line.replace(/^\*?\s+/, '').trim(),
    isCurrent: line.startsWith('*'),
    isRemote: line.includes('remotes/'),
  }));
}

async function listBranches(workspacePath: string): Promise<GitBranchEntry[]> {
  return parseBranches(await runGit(workspacePath, ['branch', '-a']));
}
export function setupGitIpc(opts: {
  getRegisteredWorkspaces: () => readonly RegisteredWorkspacePath[];
}): void {
  const resolveRegisteredWorkspace = createRegisteredWorkspaceResolver(opts.getRegisteredWorkspaces);
  const authorizeWorkspace = async (workspacePath: string) => {
    const authorizedWorkspacePath = await resolveRegisteredWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    const protectedReason = getProtectedPathReason(authorizedWorkspacePath);
    if (protectedReason) {
      return ipcError("ipcErrors.git.protectedPath", protectedReason, { path: workspacePath });
    }
    return authorizedWorkspacePath;
  };

  ipcMain.handle('git:status', async (_, workspacePath: string) => {
    try {
      gitStatusSchema.parse([workspacePath]);
    } catch (err) {
      log.warn("[git.ipc] git:status invalid args:", err);
      return ipcError(
        "ipcErrors.git.invalidArgs",
        `git status 参数无效: ${err instanceof Error ? err.message : String(err)}`,
        { path: String(workspacePath ?? "") },
      );
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await deduplicateGitRead(gitReadKey('git:status', authorizedWorkspacePath), () => getGitStatus(authorizedWorkspacePath));
    } catch (err) {
      log.error("[git.ipc] git:status failed:", err);
      return ipcError(
        "ipcErrors.git.statusFailed",
        `读取 git 状态失败: ${err instanceof Error ? err.message : String(err)}`,
        { path: workspacePath },
      );
    }
  });

  ipcMain.handle('git:diff', async (_, workspacePath: string, filePath?: string) => {
    try {
      gitDiffSchema.parse(filePath === undefined ? [workspacePath] : [workspacePath, filePath]);
    } catch (err) {
      log.warn("[git.ipc] git:diff invalid args:", err);
      return ipcError(
        "ipcErrors.git.invalidArgs",
        `git diff 参数无效: ${err instanceof Error ? err.message : String(err)}`,
        { path: String(filePath ?? "") },
      );
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await deduplicateGitRead(gitReadKey('git:diff', authorizedWorkspacePath, filePath), () => gitDiff(authorizedWorkspacePath, filePath));
    } catch (err) {
      log.error("[git.ipc] git:diff failed:", err);
      return ipcError(
        "ipcErrors.git.diffFailed",
        `读取 git diff 失败: ${err instanceof Error ? err.message : String(err)}`,
        { path: filePath ?? "all" },
      );
    }
  });

  ipcMain.handle('git:diff-staged', async (_, workspacePath: string) => {
    try {
      gitDiffStagedSchema.parse([workspacePath]);
    } catch (err) {
      log.warn("[git.ipc] git:diff-staged invalid args:", err);
      return ipcError(
        "ipcErrors.git.invalidArgs",
        `git staged diff 参数无效: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      // gitDiffStaged delegates to git with the standard ['diff', '--staged'] argv.
      return await deduplicateGitRead(gitReadKey('git:diff-staged', authorizedWorkspacePath), () => gitDiffStaged(authorizedWorkspacePath));
    } catch (err) {
      log.error("[git.ipc] git:diff-staged failed:", err);
      return ipcError(
        "ipcErrors.git.diffFailed",
        `读取 staged diff 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('git:add', async (_, workspacePath: string, files: string[]) => {
    try {
      gitAddSchema.parse([workspacePath, files]);
    } catch (err) {
      log.warn("[git.ipc] git:add invalid args:", err);
      return ipcError(
        "ipcErrors.git.invalidArgs",
        `git add 参数无效: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    if (files.length === 0) return;
    try {
      return await gitAdd(authorizedWorkspacePath, files);
    } catch (err) {
      log.error("[git.ipc] git:add exec failed:", err);
      return ipcError(
        "ipcErrors.git.addFailed",
        `git add 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('git:unstage', async (_, workspacePath: string, files: string[]) => {
    try {
      gitAddSchema.parse([workspacePath, files]);
    } catch (err) {
      log.warn("[git.ipc] git:unstage invalid args:", err);
      return ipcError(
        "ipcErrors.git.invalidArgs",
        `git unstage 参数无效: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    if (files.length === 0) return undefined;
    try {
      return await gitUnstage(authorizedWorkspacePath, files);
    } catch (err) {
      log.error("[git.ipc] git:unstage exec failed:", err);
      return ipcError(
        "ipcErrors.git.unstageFailed",
        `git unstage 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('git:commit', async (_, workspacePath: string, message: string) => {
    try {
      gitCommitSchema.parse([workspacePath, message]);
    } catch (err) {
      log.warn("[git.ipc] git:commit invalid args:", err);
      return ipcError(
        "ipcErrors.git.invalidArgs",
        `git commit 参数无效: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await gitCommit(authorizedWorkspacePath, message);
    } catch (err) {
      log.error("[git.ipc] git:commit exec failed:", err);
      return ipcError(
        "ipcErrors.git.commitFailed",
        `git commit 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('git:push', async (_, workspacePath: string) => {
    try {
      gitPushSchema.parse([workspacePath]);
    } catch (err) {
      return ipcError("ipcErrors.git.invalidArgs", `git push 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await gitPush(authorizedWorkspacePath);
    } catch (err) {
      log.error("[git.ipc] git:push exec failed:", err);
      return ipcError("ipcErrors.git.pushFailed", `git push 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ipcMain.handle('git:log', async (_, workspacePath: string, count: number = 20) => {
    try {
      gitLogSchema.parse([workspacePath, count]);
    } catch (err) {
      log.warn("[git.ipc] git:log invalid args:", err);
      return ipcError("ipcErrors.git.invalidArgs", `git log 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const logPathReason = getProtectedPathReason(workspacePath);
    if (logPathReason) {
      return ipcError("ipcErrors.git.protectedPath", logPathReason, { path: workspacePath });
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      // 用 NUL 分隔字段 + 行, 避免 %s commit message 含 " 或换行导致 JSON.parse 失败.
      // %x00 = NUL. 每条提交按 hash/author/date/message 顺序输出, NUL 分隔字段与记录.
      const format = '--pretty=format:%H%x00%an%x00%ai%x00%s%x00';
      const output = await deduplicateGitRead(gitReadKey('git:log', authorizedWorkspacePath, count), () => runGit(authorizedWorkspacePath, ['log', format, '-n', String(count), '-z']));
      // -z 用 NUL 分隔记录, format 内也用 NUL 分隔字段; 拆分后每 4 个一段为一条提交.
      const tokens = output.split('\x00');
      const entries: { hash: string; author: string; date: string; message: string }[] = [];
      for (let i = 0; i + 3 < tokens.length; i += 4) {
        const hash = tokens[i].trim();
        if (!hash) continue;
        entries.push({
          hash,
          author: tokens[i + 1],
          date: tokens[i + 2],
          message: tokens[i + 3],
        });
      }
      return entries;
    } catch (err) {
      log.error("[git.ipc] git:log failed:", err);
      return ipcError(
        "ipcErrors.git.logFailed",
        `读取 git log 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('git:branches', async (_, workspacePath: string) => {
    try {
      gitBranchesSchema.parse([workspacePath]);
    } catch (err) {
      log.warn("[git.ipc] git:branches invalid args:", err);
      return ipcError("ipcErrors.git.invalidArgs", `git branches 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const branchPathReason = getProtectedPathReason(workspacePath);
    if (branchPathReason) {
      return ipcError("ipcErrors.git.protectedPath", branchPathReason, { path: workspacePath });
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await deduplicateGitRead(gitReadKey('git:branches', authorizedWorkspacePath), () => listBranches(authorizedWorkspacePath));
    } catch (err) {
      log.error("[git.ipc] git:branches failed:", err);
      return ipcError(
        "ipcErrors.git.branchesFailed",
        `读取 git branches 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ipcMain.handle('git:checkout', async (_, workspacePath: string, branch: string) => {
    const checkoutPathReason = getProtectedPathReason(workspacePath);
    if (checkoutPathReason) {
      return ipcError("ipcErrors.git.protectedPath", checkoutPathReason, { path: workspacePath });
    }
    try {
      gitCheckoutSchema.parse([workspacePath, branch]);
    } catch (err) {
      return ipcError("ipcErrors.git.invalidArgs", `git checkout 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      const result = await gitCheckout(authorizedWorkspacePath, branch);
      if (result && typeof result === 'object' && 'code' in result) return result;
      // 重新获取分支列表
      return await listBranches(authorizedWorkspacePath);
    } catch (err) {
      log.error("[git.ipc] git:checkout failed:", err);
      return ipcError("ipcErrors.git.checkoutFailed", `切换分支失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ipcMain.handle('git:create-branch', async (_, workspacePath: string, branchName: string) => {
    const createBranchPathReason = getProtectedPathReason(workspacePath);
    if (createBranchPathReason) {
      return ipcError("ipcErrors.git.protectedPath", createBranchPathReason, { path: workspacePath });
    }
    try {
      gitCreateBranchSchema.parse([workspacePath, branchName]);
    } catch (err) {
      return ipcError("ipcErrors.git.invalidArgs", `git create-branch 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      const result = await gitCreateBranch(authorizedWorkspacePath, branchName);
      if (result && typeof result === 'object' && 'code' in result) return result;
      return await listBranches(authorizedWorkspacePath);
    } catch (err) {
      log.error("[git.ipc] git:create-branch failed:", err);
      return ipcError("ipcErrors.git.createBranchFailed", `创建分支失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ipcMain.handle('git:original-content', async (_, workspacePath: string, filePath: string) => {
    try {
      gitOriginalContentSchema.parse([workspacePath, filePath]);
    } catch (err) {
      return ipcError("ipcErrors.git.invalidArgs", `git original-content 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await deduplicateGitRead(gitReadKey('git:original-content', authorizedWorkspacePath, filePath), () => gitOriginalContent(authorizedWorkspacePath, filePath));
    } catch (err) {
      log.error("[git.ipc] git:original-content failed:", err);
      return ipcError("ipcErrors.git.originalContentFailed", `读取 HEAD 原始内容失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ipcMain.handle('git:changed-files', async (_, workspacePath: string) => {
    try {
      gitChangedFilesSchema.parse([workspacePath]);
    } catch (err) {
      return ipcError("ipcErrors.git.invalidArgs", `git changed-files 参数无效: ${err instanceof Error ? err.message : String(err)}`);
    }
    const authorizedWorkspacePath = await authorizeWorkspace(workspacePath);
    if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
    try {
      return await deduplicateGitRead(gitReadKey('git:changed-files', authorizedWorkspacePath), () => gitChangedFiles(authorizedWorkspacePath));
    } catch (err) {
      log.error("[git.ipc] git:changed-files failed:", err);
      return ipcError("ipcErrors.git.changedFilesFailed", `读取改动文件列表失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
