import { isAbsolute, relative, resolve } from "path";
import type { AgentMode, PiSlashCommand } from "@shared";
import { PLAN_DIRECTIVE } from "./agent-modes/plan-prompt";
import { BUILD_SWITCH } from "./agent-modes/directives";

export interface AgentModeRuntimeOptions {
    longHorizonEnabled?: boolean;
    planModeEnabled?: boolean;
    composeModeEnabled?: boolean;
    workflowEnabled?: boolean;
    composeWorkflowEnabled?: boolean;
    /**
     * Mode of the previous prompt in this agent/workspace session.
     * Used for plan→build transition reminder (BUILD_SWITCH).
     */
    previousMode?: AgentMode;
}

export interface AgentRegistryEntry {
    id: string;
    mode: AgentMode;
    role: "primary" | "subagent";
    experimental?: boolean;
    description: string;
}

export const SYSTEM_SUBAGENTS: AgentRegistryEntry[] = [
    {
        id: "checkpoint-writer",
        mode: "build",
        role: "subagent",
        description: "Writes structured checkpoints for context recovery.",
    },
    {
        id: "dream",
        mode: "build",
        role: "subagent",
        description: "Explores alternate approaches before execution.",
    },
    {
        id: "distill",
        mode: "build",
        role: "subagent",
        description: "Distills long conversations into durable memory notes.",
    },
];

const PRIMARY_AGENTS: AgentRegistryEntry[] = [
    { id: "build", mode: "build", role: "primary", description: "Default implementation mode." },
    { id: "plan", mode: "plan", role: "primary", description: "Read-only planning mode with .pi/plans/*.md as the only write target." },
    { id: "compose", mode: "compose", role: "primary", description: "Workflow/task orchestrator mode." },
];

const GOAL_COMMANDS: PiSlashCommand[] = [
    {
        name: "goal",
        description: "Set or clear a long-horizon stop condition. Usage: /goal <condition> or /goal clear",
        source: "builtin",
        requiresArgument: true,
    },
];

const READ_ONLY_TOOLS = new Set([
    "read",
    "view",
    "grep",
    "glob",
    "ls",
    "list",
    "search",
    "find",
]);

const WRITE_TOOLS = new Set([
    "write",
    "edit",
    "file_write",
    "file_edit",
    "apply_patch",
]);

const MUTATING_OR_HIGH_RISK_TOOLS = new Set([
    "bash",
    "shell",
    "powershell",
    "terminal",
    "git",
    "network",
    "fetch",
    "web",
]);

const READ_ONLY_SHELL_COMMANDS = new Set([
    "cat",
    "dir",
    "find",
    "findstr",
    "get-childitem",
    "get-command",
    "get-content",
    "get-location",
    "get-process",
    "grep",
    "head",
    "ls",
    "pwd",
    "resolve-path",
    "rg",
    "select-object",
    "select-string",
    "sort",
    "tail",
    "test-path",
    "type",
    "wc",
    "where",
    "where.exe",
    "whoami",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
    "branch",
    "diff",
    "log",
    "rev-list",
    "rev-parse",
    "show",
    "status",
    "worktree",
]);

export function agentRegistry(options: AgentModeRuntimeOptions = {}): AgentRegistryEntry[] {
    const longHorizonEnabled = options.longHorizonEnabled ?? true;
    const planModeEnabled = options.planModeEnabled ?? true;
    const composeModeEnabled = options.composeModeEnabled ?? true;
    if (!longHorizonEnabled) return [PRIMARY_AGENTS[0]];
    return [
        PRIMARY_AGENTS[0],
        ...(planModeEnabled ? [PRIMARY_AGENTS[1]] : []),
        ...(composeModeEnabled ? [PRIMARY_AGENTS[2]] : []),
        ...SYSTEM_SUBAGENTS,
    ];
}

export function normalizeAgentMode(value: unknown, options: AgentModeRuntimeOptions = {}): AgentMode {
    const longHorizonEnabled = options.longHorizonEnabled ?? true;
    const planModeEnabled = options.planModeEnabled ?? true;
    const composeModeEnabled = options.composeModeEnabled ?? true;
    if (!longHorizonEnabled) return "build";
    if (value === "plan" && planModeEnabled) return value;
    if (value === "compose" && composeModeEnabled) return value;
    return "build";
}

export function goalSlashCommands(): PiSlashCommand[] {
    return GOAL_COMMANDS.map((command) => ({ ...command }));
}

/**
 * Build the outbound user prompt for a mode, including long-horizon directives.
 *
 * Plan→build transition injects BUILD_SWITCH so the model drops plan read-only
 * discipline and may write workspace files. Pass `options.previousMode` from
 * the agent/workspace session mode before the current toggle.
 */
export function buildAgentModePrompt(mode: AgentMode, text: string, options: AgentModeRuntimeOptions = {}): string {
    const content = text.trim();
    if (options.longHorizonEnabled === false) return content;

    // Plan→build transition wins over plain build (no plan directive).
    if (mode === "build" && options.previousMode === "plan") {
        return [
            BUILD_SWITCH,
            "",
            "Plan mode constraints are lifted. You may write workspace files, run shell commands, and execute the plan steps now.",
            "Do not call plan_write for execution. Implement the plan directly.",
            "",
            content,
        ].join("\n");
    }

    if (mode === "build") return content;
    if (mode === "plan") {
        // `longHorizonEnabled === false` already returned above, so only
        // `planModeEnabled` can still disable the directive here. Using
        // `!== false` (not `=== true`) preserves the default-enabled
        // behavior set by `normalizeAgentMode` (which defaults `undefined`
        // to `true`).
        if (options.planModeEnabled !== false) {
            return [PLAN_DIRECTIVE, "", content].join("\n");
        }
        return content;
    }
    if (options.workflowEnabled && options.composeWorkflowEnabled) {
        return [
            "Compose workflow runtime is enabled.",
            "Compose mode alone is not a reason to start a workflow.",
            "Do not start a workflow for simple questions, explanations, web research, or read-only exploration.",
            "Do not start a workflow for a single small edit that can be implemented and verified directly.",
            "Use the workflow only when the request genuinely requires multiple dependent implementation steps, coordinated parallel tasks, or long-horizon execution.",
            "When that threshold is met, call the `workflow` tool with `operation=\"run\"`, `name=\"compose\"`, and `args.task` set to the user request.",
            "Use the workflow result instead of improvising a prompt-only compose flow.",
            "",
            content,
        ].join("\n");
    }
    return content;
}

export function isPlanModeToolAllowed(input: {
    toolName: string;
    args?: Record<string, unknown>;
    workspacePath: string;
}): boolean {
    const toolName = input.toolName.toLowerCase();
    if (READ_ONLY_TOOLS.has(toolName)) return true;
    if (toolName === "bash" || toolName === "shell" || toolName === "powershell") {
        return isReadOnlyShellCommand(getToolCommand(input.args));
    }
    if (toolName === "plan_write") {
        return isPlanFilePath(resolvePlanWritePath(input.args), input.workspacePath);
    }
    if (WRITE_TOOLS.has(toolName)) return isPlanFilePath(getToolPath(input.args), input.workspacePath);
    if (MUTATING_OR_HIGH_RISK_TOOLS.has(toolName)) return false;
    return false;
}

function getToolPath(args: Record<string, unknown> | undefined): string {
    if (!args) return "";
    const raw = args.file_path ?? args.path ?? args.filePath ?? args.relative_path ?? args.relativePath;
    return typeof raw === "string" ? raw : "";
}

function getToolCommand(args: Record<string, unknown> | undefined): string {
    if (!args) return "";
    const raw = args.command ?? args.cmd ?? args.script;
    return typeof raw === "string" ? raw.trim() : "";
}

function resolvePlanWritePath(args: Record<string, unknown> | undefined): string {
    if (!args) return "";
    const raw = typeof args.filename === "string" ? args.filename.trim() : "";
    if (!raw) return "";
    const normalized = raw.replace(/\\/g, "/").replace(/\/+$/g, "");
    if (normalized.startsWith(".pi/plans/") || normalized.startsWith("./.pi/plans/")) {
        return normalized;
    }
    return `.pi/plans/${normalized.endsWith(".md") ? normalized : `${normalized}.md`}`;
}

function isReadOnlyShellCommand(command: string): boolean {
    if (!command) return false;
    const sanitized = command.replace(/\s*(?:[12])?>\s*(?:\/dev\/null|nul|\$null)\b/gi, "").trim();
    if (/[<>`]|&&|\|\||;|\$\(/.test(sanitized)) return false;
    const pipeline = sanitized
        .split("|")
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (pipeline.length === 0) return true;
    return pipeline.every(isReadOnlyShellSegment);
}

function isReadOnlyShellSegment(segment: string): boolean {
    const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const command = tokens[0]?.replace(/^['"]|['"]$/g, "").toLowerCase();
    if (!command) return true;
    if (command === "git") {
        const subcommand = tokens[1]?.replace(/^['"]|['"]$/g, "").toLowerCase();
        if (!subcommand) return false;
        if (subcommand === "worktree") {
            return (tokens[2]?.replace(/^['"]|['"]$/g, "").toLowerCase() ?? "") === "list";
        }
        if (subcommand === "branch") {
            // git branch 裸命令 = 列分支 (只读); 但任何非旗标参数都是分支名,
            // 而 git branch <name> 会创建分支, -d/-D/-m/-M/-f 等会删除/重命名/
            // 强制更新。只读旗标 (--list/--contains 等) 允许带 pattern/commit
            // 参数, 其余组合一律拒绝 (fail-closed)。
            const args = tokens.slice(2).map((t) => t.replace(/^['"]|['"]$/g, ""));
            if (args.length === 0) return true;
            const readonlyFlags = new Set(["-a", "-r", "-v", "-vv", "--list", "--no-color", "--contains", "--merged", "--no-merged"]);
            if (!readonlyFlags.has(args[0])) return false;
            return args.every((t) => !t.startsWith("-") || readonlyFlags.has(t));
        }
        return READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
    }
    if (command === "find") {
        // find 的动作旗标会修改文件系统: -delete 删除, -exec/-execdir/-ok 执行
        // 任意命令, -fprint/-fprintf/-fprint0/-fls 写文件。其余 (name/type/
        // mtime/print 等) 是纯查询, 放行。
        const args = tokens.slice(1).map((t) => t.replace(/^['"]|['"]$/g, ""));
        if (args.some((t) =>
            t === "-delete" || t === "-exec" || t === "-execdir" || t === "-ok" || t === "-okdir"
            || t.startsWith("-fprint") || t === "-fls")) return false;
        return true;
    }
    if (command === "sort") {
        // sort -o/--output 会把排序结果写回文件; sort 其余旗标均只读。
        const args = tokens.slice(1).map((t) => t.replace(/^['"]|['"]$/g, ""));
        return args.every((t) =>
            !(t.startsWith("--output")) &&
            !(t.startsWith("-") && !t.startsWith("--") && t.includes("o")));
    }
    if (command === "mkdir") return isPlanDirectoryMkdir(tokens.slice(1));
    return READ_ONLY_SHELL_COMMANDS.has(command);
}

function isPlanDirectoryMkdir(args: string[]): boolean {
    const targets: string[] = [];
    for (const token of args) {
        const normalized = token.replace(/^['"]|['"]$/g, "").trim();
        if (!normalized) continue;
        if (normalized === "-p" || normalized === "--parents") continue;
        if (normalized.startsWith("-")) return false;
        targets.push(normalized.replace(/\\/g, "/").replace(/\/+$/g, ""));
    }
    return targets.length > 0 && targets.every((target) => target === ".pi/plans" || target === "./.pi/plans");
}

function isPlanFilePath(path: string, workspacePath: string): boolean {
    if (!path) return false;
    const absolute = isAbsolute(path) ? resolve(path) : resolve(workspacePath, path);
    const rel = relative(resolve(workspacePath), absolute).replace(/\\/g, "/");
    return !rel.startsWith("../") && rel !== ".." && /^\.pi\/plans\/[^/].*\.md$/i.test(rel);
}
