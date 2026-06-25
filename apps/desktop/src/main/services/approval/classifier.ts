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

// 读类 bash 命令 (这些通常只查询, 不修改)
const READ_BASH_COMMANDS = new Set([
    "ls", "cat", "head", "tail", "echo", "pwd", "whoami", "date",
    "git", "npm", "pnpm", "yarn", "node", "which", "where", "type",
    "env", "printenv", "file", "stat", "wc", "diff", "grep",
    "find", "rg", "awk", "cut", "sort", "uniq", "tr",
    "test", "true", "false",
]);

// 对 git/npm/node 等多用途工具, 只能放过显式的只读命令形态; 其余一律降级为 edit.
// 这样像 `git pull` / `git branch -D` / `git config user.name x` / `npm config set`
// 这类会修改工作树或用户环境的命令不会被误判成只读.
const READ_ONLY_COMMAND_PATTERNS: Record<string, RegExp[]> = {
    git: [
        /^git\s+status(?:\s|$)/i,
        /^git\s+log(?:\s|$)/i,
        /^git\s+diff(?:\s|$)/i,
        /^git\s+show(?:\s|$)/i,
        /^git\s+ls-files(?:\s|$)/i,
        /^git\s+ls-remote(?:\s|$)/i,
        /^git\s+blame(?:\s|$)/i,
        /^git\s+describe(?:\s|$)/i,
        /^git\s+rev-parse(?:\s|$)/i,
        /^git\s+shortlog(?:\s|$)/i,
        /^git\s+name-rev(?:\s|$)/i,
        /^git\s+branch(?:\s+(?:--all|--list|--show-current|-a|-r)\b.*)?\s*$/i,
        /^git\s+remote(?:\s+-v)?\s*$/i,
        /^git\s+config\s+(?:--get(?:-all)?|--list)\b.*$/i,
        /^git\s+tag(?:\s+(?:--list|-l)\b.*)?\s*$/i,
        /^git\s+stash\s+list(?:\s|$)/i,
    ],
    npm: [
        /^npm\s+(?:view|show|list|ls|outdated|info|search|ping|help|version|prefix|root)(?:\s|$)/i,
        /^npm\s+config\s+(?:get|list)\b.*$/i,
    ],
    pnpm: [
        /^pnpm\s+(?:list|ls|outdated|info|why|help|version|root)(?:\s|$)/i,
        /^pnpm\s+config\s+(?:get|list)\b.*$/i,
    ],
    yarn: [
        /^yarn\s+(?:info|list|outdated|why|version)(?:\s|$)/i,
        /^yarn\s+config\s+(?:get|list)\b.*$/i,
    ],
    node: [
        /^node\s+(?:--version|-v|--help|-h)\s*$/i,
    ],
};

/** 对 READ_BASH_COMMANDS 中的多用途工具, 检查子命令是否在只读白名单内. */
function isReadOnlyMultiTool(firstToken: string, cmd: string): boolean {
    const patterns = READ_ONLY_COMMAND_PATTERNS[firstToken];
    if (!patterns) return true; // 无细分规则的工具保持原 read 行为
    return patterns.some((pattern) => pattern.test(cmd));
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
