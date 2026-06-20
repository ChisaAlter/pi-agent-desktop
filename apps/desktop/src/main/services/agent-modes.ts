import { isAbsolute, relative, resolve } from "path";
import type { AgentMode, PiSlashCommand } from "@shared";

interface ComposeSkill {
    name: string;
    description: string;
}

const COMPOSE_SKILLS: ComposeSkill[] = [
    { name: "compose:brainstorm", description: "澄清目标、约束和成功标准，形成可执行设计。" },
    { name: "compose:plan", description: "把设计拆成可验证的实施计划，先计划再动手。" },
    { name: "compose:execute", description: "按计划分步实现，并在关键步骤后验证。" },
    { name: "compose:review", description: "审查代码改动，优先找 bug、风险和测试缺口。" },
    { name: "compose:verify", description: "运行类型检查、lint、测试和必要的端到端验证。" },
    { name: "compose:report", description: "汇总完成内容、验证证据、残留风险和后续动作。" },
    { name: "compose:ask", description: "需要用户决策时提出短问题；可推断时继续执行。" },
    { name: "compose:tdd", description: "先写失败测试，再实现最小代码，再重构。" },
    { name: "compose:debug", description: "系统化排查：复现、假设、证据、修复、回归测试。" },
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

export function normalizeAgentMode(value: unknown): AgentMode {
    return value === "plan" || value === "compose" ? value : "build";
}

export function composeSlashCommands(): PiSlashCommand[] {
    return COMPOSE_SKILLS.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: "skill",
        requiresArgument: true,
    }));
}

export function buildAgentModePrompt(mode: AgentMode, text: string): string {
    const content = text.trim();
    if (mode === "build") return content;
    if (mode === "plan") {
        return [
            "<system-reminder>",
            "Plan mode is active. The user indicated that they do not want implementation yet.",
            "You MUST NOT make edits outside `.pi/plans/*.md`, run non-readonly commands, change configuration, commit, or otherwise modify the system before the user explicitly approves the plan.",
            "",
            "Allowed write target: `.pi/plans/*.md` only.",
            "",
            "Workflow:",
            "1. Explore the repository with read-only actions.",
            "2. Ask concise clarification questions only when they materially change the plan.",
            "3. Write or update a concise implementation plan under `.pi/plans/`.",
            "4. End by asking the user whether to switch to Build mode and execute the plan, continue refining, or cancel.",
            "</system-reminder>",
            "",
            content,
        ].join("\n");
    }
    return [
        "<system-reminder>",
        "Compose mode is active. Act as a workflow orchestrator inspired by MiMo-Code compose mode.",
        "Use the local compose skills listed below as real process instructions. Do not claim a native `skill` tool exists; if a skill is relevant, follow its described workflow directly with the tools Pi Desktop actually exposes.",
        "Route work through the smallest useful loop: understand, plan, execute, verify, report. Ask only when a decision materially changes the outcome.",
        "</system-reminder>",
        "",
        composeSkillsBlock(),
        "",
        content,
    ].join("\n");
}

export function composeSkillsBlock(): string {
    return [
        "<compose_skills>",
        ...COMPOSE_SKILLS.map((skill) => `- ${skill.name}: ${skill.description}`),
        "</compose_skills>",
    ].join("\n");
}

export function isPlanModeToolAllowed(input: {
    toolName: string;
    args?: Record<string, unknown>;
    workspacePath: string;
}): boolean {
    const toolName = input.toolName.toLowerCase();
    if (READ_ONLY_TOOLS.has(toolName)) return true;
    if (WRITE_TOOLS.has(toolName)) return isPlanFilePath(getToolPath(input.args), input.workspacePath);
    if (MUTATING_OR_HIGH_RISK_TOOLS.has(toolName)) return false;
    return false;
}

function getToolPath(args: Record<string, unknown> | undefined): string {
    if (!args) return "";
    const raw = args.file_path ?? args.path ?? args.filePath ?? args.relative_path ?? args.relativePath;
    return typeof raw === "string" ? raw : "";
}

function isPlanFilePath(path: string, workspacePath: string): boolean {
    if (!path) return false;
    const absolute = isAbsolute(path) ? resolve(path) : resolve(workspacePath, path);
    const rel = relative(resolve(workspacePath), absolute).replace(/\\/g, "/");
    return !rel.startsWith("../") && rel !== ".." && /^\.pi\/plans\/[^/].*\.md$/i.test(rel);
}
