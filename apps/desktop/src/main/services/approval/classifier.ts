// 风险分类器 (M1 Task 3)
// 决定工具调用属于高危 (HIGH_RISK) / 文件编辑 (FILE_EDIT) / 只读 (READ_ONLY) 哪一档
// 决定审批如何处理: high → 弹模态预拦截, edit → 事后 diff + undo, read → 直接放行

import type { RiskLevel } from "@shared/approval";
import { isHighRiskCommand } from "@shared/command-risk";

export type { RiskLevel };

export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

export interface Classification {
    risk: RiskLevel;
    preview: string;
}

// 高危 shell 命令追加 pattern (补充 @shared/command-risk 中未覆盖的)
const EXTRA_HIGH_RISK_PATTERNS: RegExp[] = [
    /\bsc\s+delete\b/i,
    /\bbcdedit\b/i,
    /\bnet\s+user\b/i,
    /\bInvoke-Expression\b/i,
    /\bStop-Process\s+.*-Force\b/i,
];

function isExtraHighRiskCommand(cmd: string): boolean {
    return EXTRA_HIGH_RISK_PATTERNS.some((p) => p.test(cmd));
}

// 高危写路径 (支持 Unix / Windows / ~ 前缀)
const HIGH_RISK_PATH_PATTERNS: RegExp[] = [
    /^~?\/?\.ssh\//,
    /^~?\/?\.aws\//,
    /^~?\/?\.config\//,
    /^~?\/?\.bashrc$/,
    /^~?\/?\.zshrc$/,
    /^~?\/?\.profile$/,
    /^\/etc\//i,
    /^C:\\Windows\\System32/i,
    /\.git[\\/]hooks/,
    /\.git[\\/]config$/,
    /\.pi[\\/]agent[\\/]settings\.json$/,
];

// 文件编辑类 bash
const EDIT_BASH_PATTERNS: RegExp[] = [
    /^>\s*\S/, // > file 重定向
    /\bsed\s+-i\b/,
    /\bawk\s+.*\s+>\s+/,
];

// 含写语义的 shell 结构 — 即便首 token 是"读类"命令, 出现这些结构也不再视为只读:
//   - 管道到可变命令 (xargs/tee/sh/sudo/...)
//   - find 的 -delete/-exec 写 flag
//   - awk 的 system()/getline/print> 重定向 (EDIT_BASH_PATTERNS 覆盖不到的 awk 写形态)
// 这些命中 → 降级为 edit (高危 rm 等已由前面的 high-risk 检查先行拦截)
const MUTATION_SYNTAX_PATTERNS: RegExp[] = [
    /\|\s*(?:xargs|tee|sh|bash|sudo|rm|mv|cp|chmod|chown|dd)\b/i,
    /\bfind\b.*\s-(?:delete|exec|execdir)\b/i,
    /\bawk\b.*\b(?:system|getline|print\s*>)/i,
];

function hasMutationSyntax(cmd: string): boolean {
    return MUTATION_SYNTAX_PATTERNS.some((p) => p.test(cmd));
}

// 读类 bash 命令 (这些通常只查询, 不修改)
const READ_BASH_COMMANDS = new Set([
    "ls", "cat", "head", "tail", "echo", "pwd", "whoami", "date",
    "git", "npm", "pnpm", "yarn", "node", "which", "where", "type",
    "env", "printenv", "file", "stat", "wc", "diff", "grep",
    "find", "rg", "awk", "cut", "sort", "uniq", "tr",
    "test", "true", "false",
]);

// 对 git/npm/node 等多用途工具, 只读白名单子命令; 其余视为可变 (edit) 以防
// `git push`(非 force)、`npm publish/install`、`node -e "..."` 等被误判为只读而绕过追踪.
const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
    git: new Set([
        "status", "log", "diff", "show", "branch", "remote", "config",
        "ls-files", "ls-remote", "blame", "describe", "rev-parse",
        "fetch", "pull", "stash", "tag", "shortlog", "name-rev",
    ]),
    npm: new Set([
        "view", "show", "list", "ls", "outdated", "info", "search",
        "ping", "config", "help", "version", "prefix", "root",
    ]),
    pnpm: new Set([
        "list", "ls", "outdated", "info", "why", "config", "help",
        "version", "root", "fetch",
    ]),
    yarn: new Set(["info", "list", "outdated", "config", "version", "why"]),
    node: new Set(["--version", "-v", "--help", "-h", "version"]),
};

/** 对 READ_BASH_COMMANDS 中的多用途工具, 检查子命令是否在只读白名单内. */
function isReadOnlyMultiTool(firstToken: string, cmd: string): boolean {
    const allowed = READ_ONLY_SUBCOMMANDS[firstToken];
    if (!allowed) return true; // 无白名单的工具保持原 read 行为
    const tokens = cmd.split(/\s+/);
    // 取第一个非 flag token 作为子命令 (跳过 --global 等开关)
    const sub = tokens.find((t, i) => i > 0 && !t.startsWith("-"));
    if (!sub) return false; // 有工具名但无明确只读子命令 → 视为可变
    return allowed.has(sub.toLowerCase());
}

function isHighRiskPath(p: string): boolean {
    for (const pat of HIGH_RISK_PATH_PATTERNS) {
        if (pat.test(p)) return true;
    }
    return false;
}

export function classifyToolCall(call: ToolCall): Classification {
    const name = (call.name ?? "").toLowerCase();
    const args = call.args ?? {};

    // 1. 显式 read 类工具直接放行
    if (name === "read" || name === "grep" || name === "glob" || name === "find" || name === "ls") {
        return { risk: "read", preview: `${name} ${JSON.stringify(args)}` };
    }

    // 2. bash 工具按子命令分类
    if (name === "bash" || name === "shell") {
        const cmd = String(args.command ?? args.cmd ?? "").trim();
        if (!cmd) return { risk: "read", preview: "(empty)" };

        if (isHighRiskCommand(cmd) || isExtraHighRiskCommand(cmd)) return { risk: "high", preview: cmd };
        for (const pat of EDIT_BASH_PATTERNS) {
            if (pat.test(cmd)) return { risk: "edit", preview: cmd };
        }
        // 含写语义的 shell 结构 (管道到 xargs/tee、find -delete、awk system(...))
        // 即便首 token 在 READ_BASH_COMMANDS 里, 也不再放行为只读.
        if (hasMutationSyntax(cmd)) return { risk: "edit", preview: cmd };
        // 第一个 token 是不是读类命令
        const firstToken = cmd.split(/\s+/)[0];
        if (READ_BASH_COMMANDS.has(firstToken)) {
            // git/npm/node 等多用途工具: 仅当子命令在只读白名单内才放行,
            // 否则降级为 edit, 避免可变子命令被误判只读而绕过编辑追踪.
            if (isReadOnlyMultiTool(firstToken, cmd)) return { risk: "read", preview: cmd };
            return { risk: "edit", preview: cmd };
        }
        // 未知 bash, 默认 edit (保守)
        return { risk: "edit", preview: cmd };
    }

    // 3. write/edit 工具按路径分类
    if (name === "write" || name === "edit" || name === "create" || name === "patch") {
        const rawPath = String(args.file_path ?? args.path ?? args.filePath ?? "");
        if (isHighRiskPath(rawPath)) {
            return { risk: "high", preview: `${name} ${rawPath}` };
        }
        return { risk: "edit", preview: `${name} ${rawPath}` };
    }

    // 4. 未知工具, 默认 edit (保守)
    return { risk: "edit", preview: `${name} ${JSON.stringify(args)}` };
}
