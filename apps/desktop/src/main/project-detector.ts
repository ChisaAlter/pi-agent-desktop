// Project detection (M6-1 STUB)
// 完整实现推迟到 v1.1+ (从 OpenClaw 项目结构感知借用)
//
// v1.0: 返回 "unknown" 项目类型, 不阻塞上层.

export interface ProjectInfo {
    type: "node" | "python" | "rust" | "go" | "java" | "unknown";
    name: string;
    version?: string;
    rootPath: string;
    configFiles: string[];
    packageManager?: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "cargo" | "go";
    hasGit: boolean;
    scripts?: Record<string, string>;
}

export function detectProject(workspacePath: string): ProjectInfo {
    return {
        type: "unknown",
        name: workspacePath.split(/[\\/]/).pop() ?? "unknown",
        rootPath: workspacePath,
        configFiles: [],
        hasGit: false,
    };
}
