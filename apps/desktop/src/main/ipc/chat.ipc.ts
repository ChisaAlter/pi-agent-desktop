// Chat IPC Handler
// AgentSession long-lived connection + ApprovalInterceptor + EventBridge
// Errors return IpcError (code/params/fallback), no thrown exceptions
// TODO(Phase 2 Task 19.1): split into chat-slash.ipc.ts / chat-plan.ipc.ts / chat-runtime.ipc.ts / chat-prompt.ipc.ts / chat-git.ipc.ts (deferred — high import-update risk)

import { clipboard, ipcMain, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { execFileSync } from "child_process";
import { rmSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import log from "electron-log/main";
import { ipcError, normalizeLongHorizonSettings } from "@shared";
import type { LongHorizonMemoryRecord } from "@shared";
import { WorkspaceRegistry } from "../services/pi-session/registry";
import type { IpcSender } from "../services/pi-session/event-bridge";
import { PendingEdits } from "../services/approval/pending-edits";
import { resolveApprovalRequest, setWorkspaceWindow } from "../services/approval/approval-bridge";
import { getWorkbenchContext } from "./workbench.ipc";
import {
    resolveExtensionUiRequest,
    setDesktopPermissionMode,
} from "../services/extensions/extension-ui-bridge";
import type {
    AppSettings,
    ExtensionUiResponse,
    AgentMode,
    PermissionDecision,
    PermissionMode,
    PiSlashCommand,
    RunBuiltinSlashCommandInput,
    SendPromptOptions,
    SlashCommandRunResult,
} from "@shared";
import type { AgentRuntimeRegistry } from "../services/agent-runtime/registry";
import type { GoalService } from "../services/long-horizon/goal-service";
import type { CheckpointService } from "../services/long-horizon/checkpoint-service";
import type { MemoryService } from "../services/long-horizon/memory-service";
import type { TaskService } from "../services/long-horizon/task-service";
import type { MarkdownMemoryService } from "../services/memory/markdown-memory-service";
import type { MemorySearchHit } from "../services/memory/markdown-index";
import { formatMemorySection } from "../services/subagent/tools/memory-tools";
import { getProtectedPathReason } from "../services/protected-paths";
import { gitUndoSchema, GoalEvaluateSchema } from "./schemas";
import { buildAgentModePrompt, goalSlashCommands, normalizeAgentMode } from "../services/agent-modes";
import { buildMiMoCodeRuntimePort } from "../services/mimocode-runtime-port";
import { resolveBundledDesktopExtensionPaths } from "../services/pi-session/factory";

interface WorkspaceLite {
    id: string;
    name: string;
    path: string;
}

interface ChatIpcDeps {
    registry: WorkspaceRegistry;
    /** 同步拿 workspace path 用 */
    getWorkspace: (id: string) => WorkspaceLite | undefined;
    /** 同步拿 default workspace 路径 (legacy callers only) */
    getDefaultWorkspace: () => WorkspaceLite | undefined;
    /** 持久化 PendingEdits 状态 (可选, 用于窗口重启时恢复) */
    pendingEdits: PendingEdits;
    /** 新工作台运行时；存在时 legacy pi:* 入口转发到 agent 语义 */
    agentRegistry?: AgentRuntimeRegistry;
    getSettings?: () => AppSettings;
    goalService?: GoalService;
    transcriptLookup?: (workspaceId: string, agentId?: string) => Promise<Array<{ role: string; content: string; id?: string }>>;
    memoryService?: MemoryService;
    /**
     * Markdown-primary memory service (Phase 5: chat-memory markdown bridge).
     * When provided, `pi:memory-search` consults this service instead of the
     * legacy SQLite-backed `memoryService`, and `pi:send` writes the
     * recent-user-intent entry directly to the project's MEMORY.md so the
     * renderer and subagents share the same on-disk data source.
     */
    markdownMemoryService?: MarkdownMemoryService;
    checkpointService?: CheckpointService;
    taskService?: TaskService;
    /**
     * 读取 workspace 级别 plan-mode 持久化状态 (CRIT-1)。
     * 返回 undefined 表示该 workspace 未设置 per-workspace override，调用方应回退到全局设置。
     */
    getWorkspacePlanMode?: (workspaceId: string) => boolean | undefined;
    /**
     * 持久化 workspace 级别 plan-mode 开关 (CRIT-1)。
     * 由 `plan:set-enabled` IPC handler 调用。
     */
    setWorkspacePlanMode?: (workspaceId: string, enabled: boolean) => Promise<void>;
}

type SlashSession = {
    extensionRunner?: {
        getRegisteredCommands?: () => unknown[];
        getCommand?: (name: string) => {
            handler?: (args: string, context: unknown) => void | Promise<void>;
        } | undefined;
        createCommandContext?: () => unknown;
    };
    promptTemplates?: Array<{
        name: string;
        description?: string;
    }>;
    resourceLoader?: {
        getSkills?: () => {
            skills?: Array<{
                name: string;
                description?: string;
            }>;
        };
    };
    compact?: (customInstructions?: string) => Promise<unknown>;
    reload?: () => Promise<void>;
    getLastAssistantText?: () => string | undefined;
    exportToHtml?: (outputPath?: string) => Promise<string>;
};

function sanitizePlanFilename(name: string): string {
    return name
        .replace(/\.md$/i, "")
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 80);
}

function escapeYamlDoubleQuoted(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type InlinePlanType = "feature" | "fix" | "refactor" | "chore";

function isInlinePlanType(value: string): value is InlinePlanType {
    return value === "feature" || value === "fix" || value === "refactor" || value === "chore";
}

function parseInlinePlanDocument(raw: string): {
    title?: string;
    type?: InlinePlanType;
    body: string;
} {
    let body = raw.trim();
    let title: string | undefined;
    let type: InlinePlanType | undefined;

    while (true) {
        const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        if (!match) break;
        for (const line of match[1].split(/\r?\n/)) {
            const kv = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
            if (!kv) continue;
            const key = kv[1];
            const value = kv[2].trim();
            if (!title && key === "title" && value) title = value;
            if (!type && key === "type" && isInlinePlanType(value)) type = value;
        }
        body = body.slice(match[0].length).trimStart();
    }

    return {
        title,
        type,
        body: body.trim(),
    };
}

function stripLeadingTitleHeading(body: string, title: string): string {
    const lines = body.split(/\r?\n/);
    const first = lines[0]?.trim() ?? "";
    if (/^#\s+/.test(first) && first.replace(/^#\s+/, "").trim() === title.trim()) {
        return lines.slice(1).join("\n").trim();
    }
    return body.trim();
}

function cleanInlinePlanText(text: string): string {
    return text
        .replace(/`/g, "")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function dedupePlanLines(lines: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const line of lines) {
        const normalized = cleanInlinePlanText(line);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function extractInlinePlanStepHeadings(lines: string[]): string[] {
    return dedupePlanLines(
        lines
            .map((line) => {
                const match = line.match(/^#{1,6}\s+(?:步骤|step)\s*\d+\s*[：:.-]?\s*(.+)$/i);
                return match?.[1] ?? "";
            })
            .filter(Boolean),
    );
}

function extractInlinePlanSteps(body: string): string[] {
    const tableSteps = dedupePlanLines(
        body
            .split(/\r?\n/)
            .map((line) => {
                const match = line.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/);
                return match?.[1] ?? "";
            }),
    );
    if (tableSteps.length > 0) return tableSteps;

    const lines = body.split(/\r?\n/);
    const stepHeadings = extractInlinePlanStepHeadings(lines);
    if (stepHeadings.length > 0) return stepHeadings;
    const scopedSteps: string[] = [];
    let inStepSection = false;
    for (const rawLine of lines) {
        const heading = rawLine.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
            inStepSection = /^(步骤|step|steps|plan|changes|implementation|approach)$/i.test(heading[1].trim());
            continue;
        }
        if (!inStepSection) continue;
        const numbered = rawLine.match(/^\s*\d+[.)]\s+(.+)$/);
        if (numbered) {
            scopedSteps.push(numbered[1]);
            continue;
        }
        const bullet = rawLine.match(/^\s*[-*]\s+(.+)$/);
        if (bullet) scopedSteps.push(bullet[1]);
    }
    const dedupedScoped = dedupePlanLines(scopedSteps);
    if (dedupedScoped.length > 0) return dedupedScoped;

    return dedupePlanLines(
        lines
            .map((line) => line.match(/^\s*\d+[.)]\s+(.+)$/)?.[1] ?? line.match(/^\s*[-*]\s+(.+)$/)?.[1] ?? ""),
    );
}

function extractInlinePlanValidation(body: string): string[] {
    const lines = body.split(/\r?\n/);
    const validation: string[] = [];
    let inValidationSection = false;
    for (const rawLine of lines) {
        const heading = rawLine.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
            inValidationSection = /^(验证|validation|check|checks)$/i.test(heading[1].trim());
            continue;
        }
        if (!inValidationSection) continue;
        const bullet = rawLine.match(/^\s*[-*]\s+(.+)$/);
        if (bullet) validation.push(bullet[1]);
    }
    return dedupePlanLines(validation);
}

function buildExecutableInlinePlan(body: string, title: string): {
    type: InlinePlanType;
    content: string;
} {
    const parsed = parseInlinePlanDocument(body);
    const resolvedTitle = parsed.title?.trim() || title.trim() || "plan";
    const cleanedBody = stripLeadingTitleHeading(parsed.body, resolvedTitle);
    const steps = extractInlinePlanSteps(cleanedBody);
    const validation = extractInlinePlanValidation(cleanedBody);
    const contentLines = [`# ${resolvedTitle}`, "", "Plan:"];
    if (steps.length > 0) {
        contentLines.push(...steps.map((step, index) => `${index + 1}. ${step}`));
    } else if (cleanedBody) {
        contentLines.push(`1. ${cleanInlinePlanText(cleanedBody.split(/\r?\n/).find((line) => line.trim()) ?? "执行计划")}`);
    } else {
        contentLines.push("1. 执行计划");
    }
    if (validation.length > 0) {
        contentLines.push("", "Validation:", ...validation.map((item) => `- ${item}`));
    }
    return {
        type: parsed.type ?? "feature",
        content: contentLines.join("\n").trim(),
    };
}

async function materializeInlinePlan(
    workspacePath: string,
    title: string,
    content: string,
    preferredFilename?: string,
): Promise<{ filename: string; path: string }> {
    const safeTitle = title.trim() || "plan";
    const plansDir = join(workspacePath, ".pi", "plans");
    await mkdir(plansDir, { recursive: true });
    const preferredBaseName = sanitizePlanFilename(preferredFilename ?? "");
    const baseName = preferredBaseName || sanitizePlanFilename(safeTitle) || "plan";
    const filename = preferredBaseName ? `${baseName}.md` : `${baseName}-${Date.now()}.md`;
    const planPath = join(plansDir, filename);
    const now = new Date().toISOString();
    const normalizedPlan = buildExecutableInlinePlan(content, safeTitle);
    const fileContent = [
        "---",
        `title: "${escapeYamlDoubleQuoted(safeTitle)}"`,
        "status: draft",
        `created: "${now}"`,
        `type: ${normalizedPlan.type}`,
        "---",
        "",
        normalizedPlan.content,
        "",
    ].join("\n");
    await writeFile(planPath, fileContent, "utf-8");
    return { filename, path: planPath };
}

const BUILTIN_SLASH_COMMANDS: ReadonlyArray<Pick<PiSlashCommand, "name" | "description">> = Object.freeze([
    { name: "settings", description: "Open settings menu" },
    { name: "model", description: "Select model" },
    { name: "scoped-models", description: "Enable/disable models for cycling" },
    { name: "export", description: "Export session" },
    { name: "import", description: "Import and resume a session" },
    { name: "share", description: "Share session as a secret GitHub gist" },
    { name: "copy", description: "Copy last agent message to clipboard" },
    { name: "name", description: "Set session display name" },
    { name: "session", description: "Show session info and stats" },
    { name: "changelog", description: "Show changelog entries" },
    { name: "hotkeys", description: "Show all keyboard shortcuts" },
    { name: "fork", description: "Create a new fork from a previous user message" },
    { name: "clone", description: "Duplicate the current session at the current position" },
    { name: "tree", description: "Navigate session tree" },
    { name: "login", description: "Configure provider authentication" },
    { name: "logout", description: "Remove provider authentication" },
    { name: "new", description: "Start a new session" },
    { name: "compact", description: "Manually compact the session context" },
    { name: "resume", description: "Resume a different session" },
    { name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
    { name: "quit", description: "Quit Pi Desktop" },
]);

const UNSUPPORTED_DESKTOP_COMMANDS = new Set([
    "tree",
    "fork",
    "clone",
    "share",
    "login",
    "logout",
    "changelog",
    "import",
    "name",
    "session",
]);

function isDesktopAdvertisedBuiltinSlashCommand(command: Pick<PiSlashCommand, "name">): boolean {
    return !UNSUPPORTED_DESKTOP_COMMANDS.has(command.name);
}

function builtinDesktopAction(command: string): PiSlashCommand["desktopAction"] {
    switch (command) {
        case "settings":
            return "open-settings";
        case "model":
        case "scoped-models":
            return "open-models";
        case "resume":
            return "open-sessions";
        case "new":
            return "new-session";
        case "hotkeys":
            return "open-hotkeys";
        case "compact":
            return "compact";
        case "reload":
            return "reload";
        case "export":
            return "export";
        case "copy":
            return "copy";
        case "quit":
            return "quit";
        default:
            return UNSUPPORTED_DESKTOP_COMMANDS.has(command) ? "unsupported" : undefined;
    }
}

function builtinSlashCommands(): PiSlashCommand[] {
    return BUILTIN_SLASH_COMMANDS
        .filter(isDesktopAdvertisedBuiltinSlashCommand)
        .map((command) => ({
            name: command.name,
            description: command.description,
            source: "builtin",
            desktopAction: builtinDesktopAction(command.name),
            requiresArgument: command.name === "compact" || command.name === "export" || command.name === "name",
        }));
}

function collectDynamicSlashCommands(session: SlashSession): PiSlashCommand[] {
    const commands: PiSlashCommand[] = [];
    const registered = session.extensionRunner?.getRegisteredCommands?.() ?? [];
    for (const item of registered) {
        if (!item || typeof item !== "object") continue;
        const command = item as { invocationName?: unknown; name?: unknown; description?: unknown };
        const name = typeof command.invocationName === "string"
            ? command.invocationName
            : typeof command.name === "string"
                ? command.name
                : "";
        if (!name) continue;
        commands.push({
            name,
            description: typeof command.description === "string" ? command.description : undefined,
            source: "extension",
        });
    }
    for (const template of session.promptTemplates ?? []) {
        commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
        });
    }
    for (const skill of session.resourceLoader?.getSkills?.()?.skills ?? []) {
        commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
        });
    }
    return commands;
}

function uniqueSlashCommands(commands: PiSlashCommand[]): PiSlashCommand[] {
    const seen = new Set<string>();
    const result: PiSlashCommand[] = [];
    for (const command of commands) {
        const key = `${command.source}:${command.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(command);
    }
    return result;
}

function slashResult(
    command: string,
    action: NonNullable<PiSlashCommand["desktopAction"]>,
    message: string,
    extra: Partial<SlashCommandRunResult> = {},
): SlashCommandRunResult {
    return {
        handled: true,
        command,
        action,
        message,
        tone: action === "unsupported" ? "error" : "success",
        ...extra,
    };
}

function slashInfo(command: string, message: string, extra: Partial<SlashCommandRunResult> = {}): SlashCommandRunResult {
    return {
        handled: true,
        command,
        message,
        tone: "success",
        ...extra,
    };
}

function longHorizonSettings(settings?: AppSettings): NonNullable<AppSettings["longHorizon"]> {
    return normalizeLongHorizonSettings(settings?.longHorizon);
}

function modeOptions(
    settings?: AppSettings,
    workspaceId?: string,
    getWorkspacePlanMode?: (workspaceId: string) => boolean | undefined,
): {
    longHorizonEnabled: boolean;
    planModeEnabled: boolean;
    composeModeEnabled: boolean;
    workflowEnabled: boolean;
    composeWorkflowEnabled: boolean;
} {
    const longHorizon = longHorizonSettings(settings);
    // CRIT-1: per-workspace planModeEnabled overrides the global toggle when set.
    // Falling back to the global value preserves legacy behavior for workspaces
    // that haven't opted into a per-workspace override.
    const workspacePlanMode =
        workspaceId && getWorkspacePlanMode ? getWorkspacePlanMode(workspaceId) : undefined;
    return {
        longHorizonEnabled: longHorizon.enabled,
        planModeEnabled:
            workspacePlanMode !== undefined ? workspacePlanMode : longHorizon.planMode.enabled,
        composeModeEnabled: longHorizon.composeMode.enabled,
        workflowEnabled: longHorizon.workflow.enabled,
        composeWorkflowEnabled: longHorizon.composeWorkflow.enabled,
    };
}

// Module-level memo: bundled extension paths don't change at runtime, so resolve once.
interface BundledExtensionFeatures {
    planModeSupported: boolean;
    composeModeSupported: boolean;
    workflowSupported: boolean;
}
let cachedExtensionFeatures: BundledExtensionFeatures | null = null;
function getBundledExtensionFeatures(): BundledExtensionFeatures {
    if (cachedExtensionFeatures) return cachedExtensionFeatures;
    cachedExtensionFeatures = {
        planModeSupported: resolveBundledDesktopExtensionPaths({ planModeEnabled: true }).length > 0,
        composeModeSupported: resolveBundledDesktopExtensionPaths({ composeModeEnabled: true }).length > 0,
        workflowSupported: resolveBundledDesktopExtensionPaths({
            workflowEnabled: true,
            composeWorkflowEnabled: true,
        }).length > 0,
    };
    return cachedExtensionFeatures;
}

/**
 * Convert a markdown-memory FTS5 hit into the legacy `LongHorizonMemoryRecord`
 * shape so the renderer-side `pi:memory-search` consumer doesn't need to know
 * which backend produced the result.
 *
 * The markdown file format stores the entry's `kind` in YAML frontmatter
 * (not in the FTS index schema), so the kind defaults to "note" — the
 * common case for project MEMORY.md entries (dream/distill/user-intent).
 * The snippet returned by FTS5 wraps matched tokens in `<<`/`>>` markers but
 * the original token remains a substring, so `text.includes(queryToken)` works.
 */
function markdownHitToRecord(
    hit: MemorySearchHit,
    workspaceId?: string,
): LongHorizonMemoryRecord & { score: number } {
    const scope: LongHorizonMemoryRecord["scope"] =
        hit.scope === "projects" ? "project" : hit.scope === "sessions" ? "session" : "global";
    const kind: LongHorizonMemoryRecord["kind"] = "note";
    const layer: LongHorizonMemoryRecord["layer"] =
        scope === "project"
            ? "project_memory"
            : scope === "session"
                ? "session_memory"
                : "global_memory";
    return {
        id: hit.path,
        scope,
        layer,
        kind,
        text: hit.snippet,
        workspaceId,
        tags: [],
        createdAt: Date.now(),
        score: hit.score,
    };
}

/**
 * Append a recent-user-intent section to the project's MEMORY.md so the
 * renderer-side `pi:memory-search` (and subagent `memory_search`) can recall
 * the user's latest intent. Mirrors the subagent `memory_write` write format
 * via `formatMemorySection` so the markdown layout stays consistent.
 */
async function appendRecentUserIntentToMarkdownMemory(
    service: MarkdownMemoryService,
    workspacePath: string,
    prompt: string,
): Promise<void> {
    const projectId = service.resolveProjectId(workspacePath);
    const targetPath = service.buildMemoryPath({
        scope: "projects",
        scopeId: projectId,
        type: "memory",
        filename: "MEMORY",
    });
    const section = formatMemorySection({
        scope: "project",
        scopeId: projectId,
        kind: "note",
        tags: ["recent-user-intent"],
        origin: "main",
        createdAt: new Date().toISOString(),
        text: prompt.slice(0, 2000),
    });
    await mkdir(dirname(targetPath), { recursive: true });
    // Append mode — multiple prompts accumulate as separate YAML-frontmatter
    // sections in the same MEMORY.md file.
    await writeFile(targetPath, section, { flag: "a" });
}

export function setupChatIpc(deps: ChatIpcDeps): void {
    const agentModeByWorkspace = new Map<string, AgentMode>();
    const send: IpcSender = (channel, _workspaceId, payload) => {
        const win: BrowserWindowType | null = BrowserWindow.getAllWindows()[0] ?? null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };
    const getSlashSession = async (ws: WorkspaceLite, agentId?: string): Promise<SlashSession> => {
        if (deps.agentRegistry) {
            let agent = agentId ? deps.agentRegistry.list().find((item) => item.id === agentId) : undefined;
            agent ??= deps.agentRegistry.findDefaultAgent(ws.id);
            if (!agent) {
                agent = await deps.agentRegistry.create({
                    workspaceId: ws.id,
                    title: `${ws.name} Agent`,
                });
            }
            return deps.agentRegistry.getWorkspaceSession(agent.id).session as unknown as SlashSession;
        }
        return (await deps.registry.get(
            ws.id,
            ws.path,
            deps.pendingEdits,
            send,
            undefined,
            deps.getSettings?.().generatedUiEnabled !== false,
        )).session as unknown as SlashSession;
    };

    // 监听 renderer 响应审批
    ipcMain.on("approval:respond", (_event, requestId: string, approved: boolean) => {
        resolveApprovalRequest(requestId, approved);
    });

    ipcMain.handle("permission:set-mode", async (_event, mode: PermissionMode) => {
        setDesktopPermissionMode(mode);
    });

    ipcMain.on(
        "permission:respond",
        (_event, requestId: string, response: ExtensionUiResponse | PermissionDecision | boolean | string) => {
            resolveExtensionUiRequest(requestId, response);
        },
    );

    ipcMain.handle("plan:set-enabled", async (_event, workspaceId: string, enabled: boolean) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        // CRIT-1: persist the per-workspace plan-mode toggle before refreshing the
        // runtime so the recreated session picks up the new value via getModeOptions.
        if (deps.setWorkspacePlanMode) {
            try {
                await deps.setWorkspacePlanMode(ws.id, enabled);
            } catch (err) {
                log.error("[chat.ipc] plan:set-enabled persist failed:", err);
                return ipcError(
                    "ipcErrors.chat.promptFailed",
                    `切换 Plan 模式失败: ${err instanceof Error ? err.message : String(err)}`,
                    { workspace: ws.name },
                );
            }
        }
        if (deps.agentRegistry && typeof deps.agentRegistry.refreshWorkspace === "function") {
            await deps.agentRegistry.refreshWorkspace(ws.id);
        } else if (typeof deps.registry.dispose === "function") {
            deps.registry.dispose(ws.id);
        }
        return undefined;
    });

    ipcMain.handle("plan:materialize-inline", async (_event, input: {
        workspaceId?: unknown;
        title?: unknown;
        content?: unknown;
        preferredFilename?: unknown;
    }) => {
        const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId : "";
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        const title = typeof input?.title === "string" ? input.title.trim() : "";
        const content = typeof input?.content === "string" ? input.content.trim() : "";
        const preferredFilename = typeof input?.preferredFilename === "string"
            ? input.preferredFilename.trim()
            : "";
        if (!content) {
            return ipcError(
                "ipcErrors.chat.promptFailed",
                "计划内容为空，无法生成计划文件。",
                { workspace: ws.name },
            );
        }
        try {
            return await materializeInlinePlan(ws.path, title, content, preferredFilename);
        } catch (err) {
            log.error("[chat.ipc] materialize inline plan failed:", err);
            return ipcError(
                "ipcErrors.chat.promptFailed",
                `生成计划文件失败: ${err instanceof Error ? err.message : String(err)}`,
                { workspace: ws.name },
            );
        }
    });

    ipcMain.handle("goal:set", async (_event, input: { workspaceId?: unknown; agentId?: unknown; condition?: unknown }) => {
        const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId : "";
        const condition = typeof input?.condition === "string" ? input.condition.trim() : "";
        const agentId = typeof input?.agentId === "string" ? input.agentId : undefined;
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!ws) {
            return ipcError("ipcErrors.chat.workspaceNotFound", `Workspace not found: ${workspaceId}`, { id: workspaceId });
        }
        if (!longHorizon.enabled || !longHorizon.goal.enabled || !deps.goalService) {
            return ipcError("ipcErrors.chat.goalDisabled", "长程 Goal 能力已关闭");
        }
        if (!condition) {
            return ipcError("ipcErrors.chat.goalInvalid", "任务目标不能为空");
        }
        return deps.goalService.set({ workspaceId: ws.id, agentId, condition });
    });

    ipcMain.handle("goal:clear", async (_event, workspaceId: string, agentId?: string) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError("ipcErrors.chat.workspaceNotFound", `Workspace not found: ${workspaceId}`, { id: workspaceId });
        }
        if (!deps.goalService) {
            return ipcError("ipcErrors.chat.goalDisabled", "长程 Goal 能力已关闭");
        }
        return deps.goalService.clear(ws.id, agentId);
    });

    ipcMain.handle("goal:get", async (_event, workspaceId: string, agentId?: string) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError("ipcErrors.chat.workspaceNotFound", `Workspace not found: ${workspaceId}`, { id: workspaceId });
        }
        return deps.goalService?.get(ws.id, agentId) ?? null;
    });

    // Phase C Task 4: goal:evaluate — manually trigger the judge LLM against
    // the active goal. Returns a GoalVerdict (or IpcError on misconfiguration).
    // Terminal verdicts are persisted via GoalService.applyVerdict; inconclusive
    // verdicts are returned without changing goal status so future turn_end
    // stop-gates can continue evaluating the running goal.
    ipcMain.handle("goal:evaluate", async (_event, raw: unknown) => {
        const parsed = GoalEvaluateSchema.safeParse(raw);
        if (!parsed.success) {
            return ipcError(
                "ipcErrors.goal.invalidInput",
                `goal:evaluate 入参无效: ${parsed.error.message}`,
            );
        }
        const { workspaceId, agentId } = parsed.data;
        const ws = deps.getWorkspace(workspaceId);
        if (!ws) {
            return ipcError(
                "ipcErrors.goal.notFound",
                `Workspace 未找到: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!longHorizon.enabled || !longHorizon.goal.enabled || !deps.goalService) {
            return ipcError(
                "ipcErrors.goal.disabled",
                "长程 Goal 能力已关闭",
            );
        }
        try {
            const goal = await deps.goalService.get(ws.id, agentId);
            if (!goal || goal.status === "cleared") {
                return ipcError(
                    "ipcErrors.goal.notFound",
                    "未找到活动的 goal",
                    { workspaceId: ws.id },
                );
            }
            if (goal.status !== "running") {
                return ipcError(
                    "ipcErrors.goal.notRunning",
                    "goal 当前不是运行状态，无法评估",
                    { workspaceId: ws.id, status: goal.status },
                );
            }
            const transcript = deps.transcriptLookup ? await deps.transcriptLookup(ws.id, agentId) : [];
            const verdict = await deps.goalService.evaluate({
                workspaceId: ws.id,
                agentId,
                condition: goal.condition,
                transcript,
            });
            if (verdict.verdict === "satisfied" || verdict.verdict === "failed") {
                await deps.goalService.applyVerdict(ws.id, verdict, agentId);
            }
            return verdict;
        } catch (err) {
            log.error("[chat.ipc] goal:evaluate failed:", err);
            return ipcError(
                "ipcErrors.goal.failed",
                `goal 评估失败: ${err instanceof Error ? err.message : String(err)}`,
                { workspace: ws.name },
            );
        }
    });

    ipcMain.handle("pi:runtime-feature-state", async () => {
        const extensionFeatures = getBundledExtensionFeatures();
        return buildMiMoCodeRuntimePort(longHorizonSettings(deps.getSettings?.()), {
            planModeSupported: extensionFeatures.planModeSupported,
            composeModeSupported: extensionFeatures.composeModeSupported,
            workflowSupported: extensionFeatures.workflowSupported,
        });
    });

    ipcMain.handle("pi:memory-search", async (_event, input: {
        workspaceId?: string;
        sessionId?: string;
        query?: string;
        limit?: number;
    }) => {
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!longHorizon.enabled || !longHorizon.memory.enabled) return [];
        const query = typeof input?.query === "string" ? input.query.trim() : "";
        if (!query) return [];

        // Phase 5: prefer markdown-primary search so the renderer shares the
        // same on-disk data source as the subagent `memory_write` tool. Falls
        // back to the legacy SQLite-backed `memoryService.search` when the
        // markdown service isn't injected (backward compat for users who
        // haven't enabled the new architecture).
        if (deps.markdownMemoryService) {
            const hits = await deps.markdownMemoryService.search(
                query,
                {}, // scope filter derived from session/project at spawn time, not user-controlled
                { limit: input?.limit },
            );
            return hits.map((hit) => markdownHitToRecord(hit, input?.workspaceId));
        }

        if (!deps.memoryService) return [];
        return deps.memoryService.search(query, {
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            limit: input.limit,
            includeHistoryFallback: longHorizon.history.enabled,
            searchScoreFloor: longHorizon.memory.searchScoreFloor,
        });
    });

    ipcMain.handle("pi:memory-list-recent", async (_event, input: {
        workspaceId?: string;
        sessionId?: string;
        limit?: number;
    }) => {
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!longHorizon.enabled || !longHorizon.memory.enabled || !deps.memoryService) return [];
        return deps.memoryService.listRecent({
            workspaceId: input?.workspaceId,
            sessionId: input?.sessionId,
            limit: input?.limit,
        });
    });

    ipcMain.handle("pi:task-list", async (_event, input: {
        workspaceId?: string;
        agentId?: string;
    }) => {
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!longHorizon.enabled || !longHorizon.task.enabled || !deps.taskService) return [];
        const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId : "";
        if (!workspaceId) return [];
        return deps.taskService.list({
            workspaceId,
            agentId: typeof input?.agentId === "string" ? input.agentId : undefined,
        });
    });

    ipcMain.handle("pi:task-get-active", async (_event, input: {
        workspaceId?: string;
        agentId?: string;
    }) => {
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!longHorizon.enabled || !longHorizon.task.enabled || !deps.taskService) return null;
        const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId : "";
        if (!workspaceId) return null;
        return deps.taskService.getActive({
            workspaceId,
            agentId: typeof input?.agentId === "string" ? input.agentId : undefined,
        });
    });

    ipcMain.on("plan:respond", (_event, requestId: string, decision: string, text?: string) => {
        resolveExtensionUiRequest(requestId, { requestId, value: decision === "execute" ? true : text ?? "" });
    });

    ipcMain.handle("pi:list-slash-commands", async (_event, workspaceId: string, agentId?: string, _rawMode?: AgentMode) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        try {
            const session = await getSlashSession(ws, agentId);
            const longHorizon = longHorizonSettings(deps.getSettings?.());
            const goalCommands = longHorizon.enabled && longHorizon.goal.enabled && deps.goalService
                ? goalSlashCommands()
                : [];
            return uniqueSlashCommands([...builtinSlashCommands(), ...goalCommands, ...collectDynamicSlashCommands(session)]);
        } catch (err) {
            log.error("[chat.ipc] list slash commands failed:", err);
            return ipcError(
                "ipcErrors.chat.slashCommandsFailed",
                `读取 Pi 命令失败: ${err instanceof Error ? err.message : String(err)}`,
                { workspace: ws.name },
            );
        }
    });

    ipcMain.handle("pi:run-builtin-slash-command", async (_event, input: RunBuiltinSlashCommandInput) => {
        const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId : "";
        const command = typeof input?.command === "string" ? input.command.trim().replace(/^\//, "") : "";
        const args = typeof input?.args === "string" ? input.args.trim() : "";
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (command === "goal" && longHorizon.enabled && longHorizon.goal.enabled && deps.goalService) {
            if (args.toLowerCase() === "clear") {
                await deps.goalService.clear(ws.id, input.agentId);
                return slashInfo(command, "已清除任务目标");
            }
            if (!args) {
                return slashInfo(command, "请提供任务目标，例如 /goal 完成测试并通过验证", {
                    tone: "error",
                    keepInput: true,
                });
            }
            await deps.goalService.set({ workspaceId: ws.id, agentId: input.agentId, condition: args });
            return slashInfo(command, `任务目标已设置：${args}`);
        }
        if (!BUILTIN_SLASH_COMMANDS.some((item) => item.name === command)) {
            try {
                const session = await getSlashSession(ws, input.agentId);
                const runner = session.extensionRunner;
                const extensionCommand = runner?.getCommand?.(command);
                if (extensionCommand?.handler && runner?.createCommandContext) {
                    await extensionCommand.handler(args, runner.createCommandContext());
                    return slashInfo(command, `/${command} 已执行`);
                }
            } catch (err) {
                log.error("[chat.ipc] run extension slash command failed:", err);
                return ipcError(
                    "ipcErrors.chat.slashCommandFailed",
                    `执行 /${command} 失败: ${err instanceof Error ? err.message : String(err)}`,
                    { workspace: ws.name },
                );
            }
            return {
                handled: false,
                command,
                forwardToAgent: true,
                content: `/${command}${args ? ` ${args}` : ""}`,
            } satisfies SlashCommandRunResult;
        }
        if (UNSUPPORTED_DESKTOP_COMMANDS.has(command)) {
            return slashResult(
                command,
                "unsupported",
                `/${command} 暂未接入 Pi Desktop，请在 Pi CLI 终端使用。`,
                { keepInput: true },
            );
        }

        try {
            switch (command) {
                case "settings":
                    return slashResult(command, "open-settings", "已打开设置");
                case "model":
                case "scoped-models":
                    return slashResult(command, "open-models", "已打开模型设置");
                case "resume":
                    return slashResult(command, "open-sessions", "已打开会话中心");
                case "new":
                    return slashResult(command, "new-session", "已准备新任务");
                case "hotkeys":
                    return slashResult(command, "open-hotkeys", "已打开快捷键速查");
                case "quit":
                    return slashResult(command, "quit", "正在关闭窗口");
                case "compact": {
                    const session = await getSlashSession(ws, input.agentId);
                    await session.compact?.(args || undefined);
                    return slashResult(command, "compact", "已触发上下文压缩");
                }
                case "reload": {
                    const session = await getSlashSession(ws, input.agentId);
                    await session.reload?.();
                    return slashResult(command, "reload", "已重新加载 Pi 资源");
                }
                case "copy": {
                    const session = await getSlashSession(ws, input.agentId);
                    const text = session.getLastAssistantText?.();
                    if (!text) {
                        return slashResult(command, "copy", "没有可复制的 assistant 消息", {
                            tone: "error",
                            keepInput: true,
                        });
                    }
                    clipboard.writeText(text);
                    return slashResult(command, "copy", "已复制最后一条 assistant 消息");
                }
                case "export": {
                    const session = await getSlashSession(ws, input.agentId);
                    const path = await session.exportToHtml?.(args || undefined);
                    return slashResult(command, "export", path ? `已导出到 ${path}` : "已导出会话");
                }
                default:
                    return slashResult(
                        command,
                        "unsupported",
                        `/${command} 暂未接入 Pi Desktop，请在 Pi CLI 终端使用。`,
                        { keepInput: true },
                    );
            }
        } catch (err) {
            log.error("[chat.ipc] run builtin slash command failed:", err);
            return ipcError(
                "ipcErrors.chat.slashCommandFailed",
                `执行 /${command} 失败: ${err instanceof Error ? err.message : String(err)}`,
                { workspace: ws.name },
            );
        }
    });

    // v1.1: renderer 同步 autoApprove 标志到主进程
    ipcMain.on("approval:set-auto-approve", (_event, value: boolean) => {
        deps.pendingEdits.autoApprove = value;
        log.info(`[chat.ipc] autoApprove set to: ${value}`);
    });

    ipcMain.handle("pi:send", async (event, workspaceId: string, text: string, options?: SendPromptOptions) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }

        // Register the BrowserWindow that owns this workspace so future
        // approval requests route to it (not BrowserWindow.getAllWindows()[0]).
        try {
            const ownerWin = BrowserWindow.fromWebContents(event.sender);
            if (ownerWin) setWorkspaceWindow(ws.id, ownerWin);
        } catch {
            // Ignore — best-effort wiring; falls back to getAllWindows().
        }

        // Prepend workbench context if user is viewing a file
        const contextFile = getWorkbenchContext(ws.id);
        const prompt = contextFile
            ? `[Currently viewing: ${contextFile}]\n\n${text}`
            : text;
        const settings = deps.getSettings?.();
        const longHorizon = longHorizonSettings(settings);
        const currentModeOptions = modeOptions(settings, ws.id, deps.getWorkspacePlanMode);
        const mode = normalizeAgentMode(options?.mode, currentModeOptions);
        // Set the workspace's active mode BEFORE any await so concurrent prompts / event-bridge
        // reads don't observe a stale value during the async window below.
        agentModeByWorkspace.set(ws.id, mode);
        const activeGoal = await deps.goalService?.get(ws.id);
        const contextBlock = longHorizon.enabled && longHorizon.checkpoint.enabled
            ? await deps.checkpointService?.rebuildContext({
                workspaceId: ws.id,
                goal: activeGoal?.condition,
                recentTail: [text.trim()].filter(Boolean),
                query: text,
            })
            : undefined;
        if (longHorizon.enabled && longHorizon.memory.enabled) {
            // Phase 5: prefer markdown-primary write so the renderer-side
            // `pi:memory-search` and subagent `memory_search` share the same
            // on-disk data source as the user-intent put block. Falls back to
            // the legacy SQLite-backed `memoryService.put` when the markdown
            // service isn't injected (e.g. user hasn't enabled the new arch).
            if (deps.markdownMemoryService) {
                try {
                    await appendRecentUserIntentToMarkdownMemory(
                        deps.markdownMemoryService,
                        ws.path,
                        prompt,
                    );
                } catch (err) {
                    log.error("[chat.ipc] markdown recent-user-intent write failed:", err);
                }
            } else {
                deps.memoryService?.put({
                    scope: "project",
                    workspaceId: ws.id,
                    kind: "note",
                    text: prompt.slice(0, 2000),
                    tags: ["recent-user-intent"],
                });
            }
        }
        const promptWithContext = contextBlock ? `${contextBlock}\n\n${prompt}` : prompt;
        const outbound = buildAgentModePrompt(mode, promptWithContext, currentModeOptions);

        try {
            if (deps.agentRegistry) {
                let agent = deps.agentRegistry.findDefaultAgent(ws.id);
                if (!agent) {
                    agent = await deps.agentRegistry.create({
                        workspaceId: ws.id,
                        title: `${ws.name} Agent`,
                    });
                }
                await deps.agentRegistry.prompt({ agentId: agent.id, message: promptWithContext, mode });
                return undefined;
            }
            // registry.get() 内部会 lazy-init: 第一次创建 session + bridge + interceptor
            // 并只订阅一次 Pi 事件 (修复之前的订阅泄漏 + 重复处理 bug)
            const wsSession = await deps.registry.get(
                ws.id,
                ws.path,
                deps.pendingEdits,
                send,
                () => agentModeByWorkspace.get(ws.id) ?? "build",
                settings?.generatedUiEnabled !== false,
            );
            await wsSession.session.prompt(outbound);
            return undefined; // 显式返 void 满足 TS 全部路径 return 一致
        } catch (err) {
            log.error("[chat.ipc] prompt failed:", err);
            return ipcError(
                "ipcErrors.chat.promptFailed",
                `Pi 消息发送失败: ${err instanceof Error ? err.message : String(err)}`,
                { workspace: ws.name },
            );
        }
    });

    ipcMain.handle("pi:stop", async (_event, workspaceId: string) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }
        if (deps.agentRegistry) {
            const agent = deps.agentRegistry.findDefaultAgent(ws.id);
            if (agent) await deps.agentRegistry.abort(agent.id);
            return undefined;
        }
        if (!deps.registry.has(ws.id)) return undefined;
        const wsSession = await deps.registry.get(ws.id, ws.path);
        wsSession.session.abort();
        return undefined;
    });

    // M1: Git undo (撤销 file_edit 类改动)
    // 用 execFileSync 参数化 (避免 shell 注入)
    ipcMain.handle("git:undo", async (_event, workspacePath: string, filePath: string) => {
        try {
            gitUndoSchema.parse([workspacePath, filePath]);
        } catch (err) {
            log.warn("[chat.ipc] git:undo invalid args:", err);
            return ipcError(
                "ipcErrors.chat.gitUndoInvalid",
                `撤销文件改动参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(filePath ?? "") },
            );
        }

        const workspaceRoot = resolve(workspacePath);
        const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath);
        const reason = getProtectedPathReason(targetPath, workspaceRoot);
        if (reason) {
            return ipcError("ipcErrors.files.protectedPath", reason, { path: targetPath });
        }
        const gitPath = relative(workspaceRoot, targetPath).replace(/\\/g, "/");

        // Defense-in-depth: reject any relative path that escapes the workspace.
        if (gitPath.startsWith("../") || gitPath === ".." || isAbsolute(gitPath)) {
            return ipcError("ipcErrors.chat.gitUndoInvalid", "目标路径超出工作区");
        }
        const resolved = resolve(workspaceRoot, gitPath);
        if (!resolved.startsWith(workspaceRoot + sep) && resolved !== workspaceRoot) {
            return ipcError("ipcErrors.chat.gitUndoInvalid", "目标路径超出工作区");
        }

        try {
            // 先试 git checkout (tracked file)
            execFileSync("git", ["checkout", "--", gitPath], { cwd: workspaceRoot, stdio: "ignore" });
        } catch {
            // fallback: remove an untracked new file using Node APIs under the same workspace guard.
            try {
                const status = execFileSync("git", ["status", "--porcelain", "--", gitPath], { cwd: workspaceRoot, encoding: "utf-8" }).trim();
                if (!status.startsWith("?? ")) {
                    log.warn(`git:undo refused to delete tracked/modified file: ${gitPath} (status=${status})`);
                    return ipcError("ipcErrors.chat.gitUndoNotUntracked", "目标文件不是 untracked,已拒绝删除");
                }
                rmSync(join(workspaceRoot, gitPath), { force: true });
            } catch (err) {
                log.error("[chat.ipc] git:undo failed:", err);
                return ipcError(
                    "ipcErrors.chat.gitUndoFailed",
                    `撤销文件改动失败: ${err instanceof Error ? err.message : String(err)}`,
                    { path: gitPath },
                );
            }
        }
        return undefined; // 显式 void 让 TS happy (handler 必须 return 一致)
    });
}
