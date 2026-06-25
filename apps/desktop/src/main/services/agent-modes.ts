import { isAbsolute, relative, resolve } from "path";
import type { AgentMode, PiSlashCommand } from "@shared";

export interface AgentModeRuntimeOptions {
    longHorizonEnabled?: boolean;
    planModeEnabled?: boolean;
    composeModeEnabled?: boolean;
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

export function buildAgentModePrompt(mode: AgentMode, text: string, options: AgentModeRuntimeOptions = {}): string {
    const content = text.trim();
    if (options.longHorizonEnabled === false) return content;
    if (mode === "build") return content;
    if (mode === "plan") return content;
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
        return READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
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
