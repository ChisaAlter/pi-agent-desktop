import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitBranchInfo } from "../../shared/types";

const execFileAsync = promisify(execFile);

export class GitService {
	async getBranches(cwd: string): Promise<GitBranchInfo> {
		try {
			// 获取当前分支和所有本地分支
			const [{ stdout: currentRaw }, { stdout: localRaw }] = await Promise.all([
				execFileAsync("git", ["branch", "--show-current"], { cwd }),
				execFileAsync("git", ["branch", "--format=%(refname:short)"], { cwd }),
			]);

			const current = currentRaw.trim() || null;
			const localBranches = localRaw
				.split(/\r?\n/)
				.map((b) => b.trim())
				.filter(Boolean);

			// 获取远程分支（排除 HEAD 引用和纯远程名）
			let remoteBranches: string[] = [];
			try {
				const { stdout: remoteRaw } = await execFileAsync(
					"git",
					["branch", "-r", "--format=%(refname:short)"],
					{ cwd },
				);
				remoteBranches = remoteRaw
					.split(/\r?\n/)
					.map((b) => b.trim())
					.filter((b) => b && b.includes("/") && !b.endsWith("/HEAD"));
			} catch {
				// 远程分支获取失败时忽略，不影响本地分支展示
			}

			// 合并本地和远程分支，去重，当前分支排在最前
			const allBranches = [...new Set([...localBranches, ...remoteBranches])];
			const sorted = current
				? [current, ...allBranches.filter((b) => b !== current)]
				: allBranches;

			return { current, branches: sorted };
		} catch {
			// 非 Git 目录或未安装 git 时只返回空信息，UI 可以降级展示为 no git。
			return { current: null, branches: [] };
		}
	}

	async checkout(cwd: string, branch: string): Promise<GitBranchInfo> {
		// 分支切换会改变工作区状态，先只支持切换已有本地分支，避免隐式创建或修改远端跟踪关系。
		await execFileAsync("git", ["checkout", branch], { cwd });
		return this.getBranches(cwd);
	}
}
