// 风险分类器 (M1 Task 3)
// 决定工具调用属于高危 (HIGH_RISK) / 文件编辑 (FILE_EDIT) / 只读 (READ_ONLY) 哪一档
// 决定审批如何处理: high → 弹模态预拦截, edit → 事后 diff + undo, read → 直接放行

import type { RiskLevel } from "@shared/approval";

export type { RiskLevel };

export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

export interface Classification {
    risk: RiskLevel;
    preview: string;
}

// 高危 bash 子命令模式
const HIGH_RISK_BASH_PATTERNS: RegExp[] = [
    /\brm\s+-rf?\s+(\/|~|\$HOME)(\s|$)/,
    /\bsudo\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /\bchmod\s+777\s+\//,
    /curl\s+.*\|\s*sh\b/,
    /\bgit\s+push\s+.*--force\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bnpm\s+uninstall\s+-g\b/,
    /\breg\s+delete\b/i,
];

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

        for (const pat of HIGH_RISK_BASH_PATTERNS) {
            if (pat.test(cmd)) return { risk: "high", preview: cmd };
        }
        for (const pat of EDIT_BASH_PATTERNS) {
            if (pat.test(cmd)) return { risk: "edit", preview: cmd };
        }
        // 第一个 token 是不是读类命令
        const firstToken = cmd.split(/\s+/)[0];
        if (READ_BASH_COMMANDS.has(firstToken)) return { risk: "read", preview: cmd };
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
