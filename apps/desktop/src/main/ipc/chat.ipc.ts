// Chat IPC Handler
// AgentSession long-lived connection + ApprovalInterceptor + EventBridge
// Errors return IpcError (code/params/fallback), no thrown exceptions

import { clipboard, ipcMain, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import { execFileSync } from "child_process";
import { rmSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import log from "electron-log/main";
import { DEFAULT_LONG_HORIZON_SETTINGS, ipcError } from "@shared";
import { WorkspaceRegistry } from "../services/pi-session/registry";
import type { IpcSender } from "../services/pi-session/event-bridge";
import { PendingEdits } from "../services/approval/pending-edits";
import { resolveApprovalRequest } from "../services/approval/approval-bridge";
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
import { getProtectedPathReason } from "../services/protected-paths";
import { gitUndoSchema } from "./schemas";
import { buildAgentModePrompt, composeSlashCommands, goalSlashCommands, normalizeAgentMode } from "../services/agent-modes";
import { buildMiMoCodeRuntimePort } from "../services/mimocode-runtime-port";

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
    memoryService?: MemoryService;
    checkpointService?: CheckpointService;
}

type SlashSession = {
    extensionRunner?: {
        getRegisteredCommands?: () => unknown[];
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
    return BUILTIN_SLASH_COMMANDS.map((command) => ({
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
    const current = settings?.longHorizon;
    const workflow = current?.workflow ?? current?.composeWorkflow;
    return {
        ...DEFAULT_LONG_HORIZON_SETTINGS,
        ...current,
        planMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.planMode, ...current?.planMode },
        composeMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.composeMode, ...current?.composeMode },
        maxMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.maxMode, ...current?.maxMode },
        memory: { ...DEFAULT_LONG_HORIZON_SETTINGS.memory, ...current?.memory },
        history: { ...DEFAULT_LONG_HORIZON_SETTINGS.history, ...current?.history },
        checkpoint: { ...DEFAULT_LONG_HORIZON_SETTINGS.checkpoint, ...current?.checkpoint },
        goal: { ...DEFAULT_LONG_HORIZON_SETTINGS.goal, ...current?.goal },
        subagents: { ...DEFAULT_LONG_HORIZON_SETTINGS.subagents, ...current?.subagents },
        task: { ...DEFAULT_LONG_HORIZON_SETTINGS.task, ...current?.task },
        actor: { ...DEFAULT_LONG_HORIZON_SETTINGS.actor, ...current?.actor },
        workflow: { ...DEFAULT_LONG_HORIZON_SETTINGS.workflow, ...workflow },
        dream: { ...DEFAULT_LONG_HORIZON_SETTINGS.dream, ...current?.dream },
        distill: { ...DEFAULT_LONG_HORIZON_SETTINGS.distill, ...current?.distill },
        composeWorkflow: { ...DEFAULT_LONG_HORIZON_SETTINGS.composeWorkflow, ...current?.composeWorkflow },
    };
}

function modeOptions(settings?: AppSettings): {
    longHorizonEnabled: boolean;
    planModeEnabled: boolean;
    composeModeEnabled: boolean;
    maxModeEnabled: boolean;
} {
    const longHorizon = longHorizonSettings(settings);
    return {
        longHorizonEnabled: longHorizon.enabled,
        planModeEnabled: longHorizon.planMode.enabled,
        composeModeEnabled: longHorizon.composeMode.enabled,
        maxModeEnabled: longHorizon.maxMode.enabled,
    };
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
        return (await deps.registry.get(ws.id, ws.path, deps.pendingEdits, send)).session as unknown as SlashSession;
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
        void enabled;
        return undefined;
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

    ipcMain.handle("pi:runtime-feature-state", async () => (
        buildMiMoCodeRuntimePort(longHorizonSettings(deps.getSettings?.()))
    ));

    ipcMain.handle("pi:memory-search", async (_event, input: {
        workspaceId?: string;
        sessionId?: string;
        query?: string;
        limit?: number;
    }) => {
        const longHorizon = longHorizonSettings(deps.getSettings?.());
        if (!longHorizon.enabled || !longHorizon.memory.enabled || !deps.memoryService) return [];
        const query = typeof input?.query === "string" ? input.query.trim() : "";
        if (!query) return [];
        return deps.memoryService.search(query, {
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            limit: input.limit,
            includeHistoryFallback: longHorizon.history.enabled,
            searchScoreFloor: longHorizon.memory.searchScoreFloor,
        });
    });

    ipcMain.on("plan:respond", (_event, requestId: string, decision: string, text?: string) => {
        resolveExtensionUiRequest(requestId, { requestId, value: decision === "execute" ? true : text ?? "" });
    });

    ipcMain.handle("pi:list-slash-commands", async (_event, workspaceId: string, agentId?: string, rawMode?: AgentMode) => {
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
            const mode = normalizeAgentMode(rawMode, modeOptions(deps.getSettings?.()));
            const modeCommands = longHorizon.enabled && longHorizon.composeWorkflow.enabled && mode === "compose"
                ? composeSlashCommands()
                : [];
            const goalCommands = longHorizon.enabled && longHorizon.goal.enabled && deps.goalService
                ? goalSlashCommands()
                : [];
            return uniqueSlashCommands([...builtinSlashCommands(), ...goalCommands, ...collectDynamicSlashCommands(session), ...modeCommands]);
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
                deps.goalService.clear(ws.id, input.agentId);
                return slashInfo(command, "已清除任务目标");
            }
            if (!args) {
                return slashInfo(command, "请提供任务目标，例如 /goal 完成测试并通过验证", {
                    tone: "error",
                    keepInput: true,
                });
            }
            deps.goalService.set({ workspaceId: ws.id, agentId: input.agentId, condition: args });
            return slashInfo(command, `任务目标已设置：${args}`);
        }
        if (!BUILTIN_SLASH_COMMANDS.some((item) => item.name === command)) {
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

    ipcMain.handle("pi:send", async (_event, workspaceId: string, text: string, options?: SendPromptOptions) => {
        const ws = workspaceId ? deps.getWorkspace(workspaceId) : undefined;
        if (!ws) {
            return ipcError(
                "ipcErrors.chat.workspaceNotFound",
                `Workspace not found: ${workspaceId}`,
                { id: workspaceId },
            );
        }

        // Prepend workbench context if user is viewing a file
        const contextFile = getWorkbenchContext(ws.id);
        const prompt = contextFile
            ? `[Currently viewing: ${contextFile}]\n\n${text}`
            : text;
        const settings = deps.getSettings?.();
        const longHorizon = longHorizonSettings(settings);
        const currentModeOptions = modeOptions(settings);
        const mode = normalizeAgentMode(options?.mode, currentModeOptions);
        const activeGoal = deps.goalService?.get(ws.id);
        const contextBlock = longHorizon.enabled && longHorizon.checkpoint.enabled
            ? deps.checkpointService?.rebuildContext({
                workspaceId: ws.id,
                goal: activeGoal?.condition,
                recentTail: [text.trim()].filter(Boolean),
                query: text,
            })
            : undefined;
        if (longHorizon.enabled && longHorizon.memory.enabled) {
            deps.memoryService?.put({
                scope: "project",
                workspaceId: ws.id,
                kind: "note",
                text: prompt.slice(0, 2000),
                tags: ["recent-user-intent"],
            });
        }
        const promptWithContext = contextBlock ? `${contextBlock}\n\n${prompt}` : prompt;
        const outbound = buildAgentModePrompt(mode, promptWithContext, currentModeOptions);
        agentModeByWorkspace.set(ws.id, mode);

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

        try {
            // 先试 git checkout (tracked file)
            execFileSync("git", ["checkout", "--", gitPath], { cwd: workspaceRoot, stdio: "ignore" });
        } catch {
            // fallback: remove an untracked new file using Node APIs under the same workspace guard.
            try {
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
