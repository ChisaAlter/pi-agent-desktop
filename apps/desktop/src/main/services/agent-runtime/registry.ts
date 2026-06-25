import { randomUUID } from "crypto";
import {
    normalizeLongHorizonSettings,
    type AgentMessage,
    type AgentRuntimeState,
    type AgentTab,
    type AppSettings,
    type CreateAgentInput,
    type PiSlashCommand,
    type SendAgentPromptInput,
    type Workspace,
    type AgentMode,
} from "@shared";
import type { PiEvent } from "@shared/events";
import {
    createWorkspaceSession,
    resolveBundledDesktopExtensionPaths,
    type WorkspaceSession,
} from "../pi-session/factory";
import { createApprovalInterceptor } from "../approval/interceptor";
import { createExtensionUiBridge } from "../extensions/extension-ui-bridge";
import { buildAgentModePrompt, normalizeAgentMode } from "../agent-modes";
import type { TaskService } from "../long-horizon/task-service";
import type { MemoryService } from "../long-horizon/memory-service";
import type { PendingEdits } from "../approval/pending-edits";
import type { PiAgentConfig } from "../../types";
import log from "electron-log/main";

type Send = (channel: string, payload: unknown) => void;

interface AgentRuntimeRegistryDeps {
    getWorkspace: (workspaceId: string) => Workspace | undefined;
    pendingEdits: PendingEdits;
    send: Send;
    agentDir?: string;
    getSettings?: () => AppSettings;
    getPiAgentConfig?: () => PiAgentConfig | null;
    getModeOptions?: () => {
        longHorizonEnabled: boolean;
        planModeEnabled?: boolean;
        composeModeEnabled?: boolean;
    };
    getTaskService?: () => Pick<TaskService, "setSourceTasks"> | null | undefined;
    getMemoryService?: () => Pick<MemoryService, "put"> | null | undefined;
}

interface AgentRuntime {
    tab: AgentTab;
    workspace: Workspace;
    session: WorkspaceSession;
    messages: AgentMessage[];
    isStreaming: boolean;
    mode: AgentMode;
    sessionMode: AgentMode;
    thinkingLevel?: "none" | "low" | "medium" | "high";
    /** 卡死看门狗: running 期间计时, 超时未结束则合成 extension_error 翻转状态 */
    watchdog?: NodeJS.Timeout;
}

const AGENT_WATCHDOG_MS = 5 * 60 * 1000;

export class AgentRuntimeRegistry {
    private readonly runtimes = new Map<string, AgentRuntime>();
    private suppressEventForwarding = false;

    constructor(private readonly deps: AgentRuntimeRegistryDeps) {}

    list(): AgentTab[] {
        return [...this.runtimes.values()].map((runtime) => ({ ...runtime.tab }));
    }

    async create(input: CreateAgentInput): Promise<AgentTab> {
        const workspace = this.deps.getWorkspace(input.workspaceId);
        if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);

        const id = randomUUID();
        const now = Date.now();
        const tab: AgentTab = {
            id,
            workspaceId: workspace.id,
            title: input.title || `${workspace.name} Agent`,
            status: "starting",
            sessionId: input.sessionId,
            sessionPath: input.sessionPath,
            createdAt: now,
            updatedAt: now,
        };

        const session = await this.createPrimarySession(workspace, id, input.sessionPath);

        const runtime: AgentRuntime = {
            tab,
            workspace,
            session,
            messages: [],
            isStreaming: false,
            mode: "build",
            sessionMode: "build",
        };
        this.runtimes.set(id, runtime);
        this.subscribe(runtime);
        runtime.tab.status = "idle";
        runtime.tab.updatedAt = Date.now();
        this.emitState();
        return { ...runtime.tab };
    }

    async prompt(input: SendAgentPromptInput): Promise<void> {
        const runtime = this.requireRuntime(input.agentId);
        const text = input.message.trim();
        if (!text) return;
        const modeOptions = this.deps.getModeOptions?.();
        const mode = normalizeAgentMode(input.mode, modeOptions);
        await this.syncRuntimeMode(runtime, mode);
        runtime.mode = mode;
        const visibleContent = visibleUserPromptContent(text);
        this.addMessage(runtime, "user", visibleContent, { mode });
        this.rememberRecentUserIntent(runtime, visibleContent, mode);
        const outbound = buildAgentModePrompt(mode, text, modeOptions);
        await this.promptRuntime(runtime, outbound, input.streamingBehavior);
    }

    async promptInternal(agentId: string, message: string): Promise<void> {
        const runtime = this.requireRuntime(agentId);
        const text = message.trim();
        if (!text) return;
        this.suppressEventForwarding = true;
        try {
            await this.promptRuntime(runtime, text);
        } finally {
            this.suppressEventForwarding = false;
        }
    }

    private async promptRuntime(
        runtime: AgentRuntime,
        text: string,
        streamingBehavior?: SendAgentPromptInput["streamingBehavior"],
    ): Promise<void> {
        runtime.tab.status = "running";
        runtime.tab.updatedAt = Date.now();
        runtime.isStreaming = true;
        this.emitState();
        try {
            await runtime.session.session.prompt(
                text,
                streamingBehavior ? { streamingBehavior } : undefined,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtime.tab.status = "error";
            runtime.tab.updatedAt = Date.now();
            runtime.isStreaming = false;
            this.disarmWatchdog(runtime);
            this.addMessage(runtime, "error", `Agent prompt failed: ${message}`);
            this.emitState();
            throw error;
        }
    }

    async abort(agentId: string): Promise<void> {
        const runtime = this.requireRuntime(agentId);
        runtime.session.session.abort();
        runtime.isStreaming = false;
        runtime.tab.status = "idle";
        runtime.tab.updatedAt = Date.now();
        this.disarmWatchdog(runtime);
        this.addMessage(runtime, "system", "已请求停止当前响应");
        this.emitState();
    }

    stop(agentId: string): void {
        const runtime = this.runtimes.get(agentId);
        if (!runtime) return;
        this.disarmWatchdog(runtime);
        runtime.session.dispose();
        this.runtimes.delete(agentId);
        this.emitState();
    }

    async restart(agentId: string): Promise<AgentTab> {
        const runtime = this.requireRuntime(agentId);
        const input: CreateAgentInput = {
            workspaceId: runtime.workspace.id,
            title: runtime.tab.title,
            sessionId: runtime.tab.sessionId,
            sessionPath: runtime.tab.sessionPath,
        };
        this.stop(agentId);
        return this.create(input);
    }

    async refreshWorkspace(workspaceId: string): Promise<void> {
        const targets = [...this.runtimes.values()].filter((runtime) => runtime.workspace.id === workspaceId);
        await Promise.all(targets.map((runtime) => this.refreshRuntimeSession(runtime)));
        this.emitState();
    }

    getMessages(agentId: string): AgentMessage[] {
        return [...this.requireRuntime(agentId).messages];
    }

    getRuntimeState(agentId: string): AgentRuntimeState {
        const runtime = this.requireRuntime(agentId);
        return {
            agentId,
            status: runtime.tab.status,
            isStreaming: runtime.isStreaming,
            sessionPath: runtime.tab.sessionPath,
            thinkingLevel: runtime.thinkingLevel,
        };
    }

    setThinking(agentId: string, level: "none" | "low" | "medium" | "high"): void {
        const runtime = this.requireRuntime(agentId);
        runtime.thinkingLevel = level;
    }

    getWorkspaceSession(agentId: string): WorkspaceSession {
        return this.requireRuntime(agentId).session;
    }

    listSlashCommands(agentId: string): PiSlashCommand[] {
        return collectDynamicSlashCommands(this.requireRuntime(agentId).session.session);
    }

    findDefaultAgent(workspaceId: string): AgentTab | undefined {
        return this.list().find((agent) => agent.workspaceId === workspaceId);
    }

    /** 停止并释放某 workspace 下所有 agent (用于 workspace:delete) */
    disposeWorkspace(workspaceId: string): void {
        for (const agentId of [...this.runtimes.keys()]) {
            const runtime = this.runtimes.get(agentId);
            if (runtime?.workspace.id === workspaceId) {
                this.stop(agentId);
            }
        }
    }

    disposeAll(): void {
        for (const agentId of [...this.runtimes.keys()]) {
            this.stop(agentId);
        }
    }

    private subscribe(runtime: AgentRuntime): void {
        const interceptor = createApprovalInterceptor(runtime.workspace.id, {
            abort: () => runtime.session.session.abort(),
            pendingEdits: this.deps.pendingEdits,
            send: (channel, workspaceId, payload) => this.sendInterceptorPayload(runtime, channel, workspaceId, payload),
            workspacePath: runtime.workspace.path,
            getMode: () => runtime.mode,
        });

        runtime.session.session.subscribe(async (rawEvent: unknown) => {
            const event = rawEvent as PiEvent;
            try {
                await interceptor.handleEvent(event);
            } catch (error) {
                log.error("[agent-runtime] interceptor error:", error);
            }
            try {
                this.handleEvent(runtime, event);
            } catch (error) {
                log.error("[agent-runtime] event handling error:", error);
            }
        });
    }

    private handleEvent(runtime: AgentRuntime, event: PiEvent): void {
        runtime.tab.updatedAt = Date.now();
        if (event.type === "agent_start") {
            runtime.tab.status = "running";
            runtime.isStreaming = true;
            this.armWatchdog(runtime);
        }
        if (event.type === "extension_error") {
            runtime.tab.status = "error";
            runtime.isStreaming = false;
            this.disarmWatchdog(runtime);
        }
        if (event.type === "agent_end" || event.type === "turn_end") {
            runtime.tab.status = "idle";
            runtime.isStreaming = false;
            this.disarmWatchdog(runtime);
        }
        if (!this.suppressEventForwarding) {
            this.deps.send("agents:event", {
                agentId: runtime.tab.id,
                workspaceId: runtime.workspace.id,
                event,
            });
        }
        this.emitState();
    }

    private armWatchdog(runtime: AgentRuntime): void {
        if (runtime.watchdog) return;
        runtime.watchdog = setTimeout(() => {
            runtime.watchdog = undefined;
            log.error("[agent-runtime] watchdog fired (stuck running):", runtime.tab.id);
            runtime.tab.status = "error";
            runtime.isStreaming = false;
            runtime.tab.updatedAt = Date.now();
            this.addMessage(
                runtime,
                "error",
                "会话运行超时未结束，可能已崩溃。请重新发起对话。",
            );
            if (!this.suppressEventForwarding) {
                this.deps.send("agents:event", {
                    agentId: runtime.tab.id,
                    workspaceId: runtime.workspace.id,
                    event: {
                        type: "extension_error",
                        message: "会话运行超时未结束，可能已崩溃。",
                        workspaceId: runtime.workspace.id,
                    },
                });
            }
            this.emitState();
        }, AGENT_WATCHDOG_MS);
    }

    private disarmWatchdog(runtime: AgentRuntime): void {
        if (runtime.watchdog) {
            clearTimeout(runtime.watchdog);
            runtime.watchdog = undefined;
        }
    }

    private sendInterceptorPayload(
        runtime: AgentRuntime,
        channel: string,
        workspaceId: string,
        payload: unknown,
    ): void {
        if (channel === "pi:event") {
            this.deps.send("agents:event", {
                agentId: runtime.tab.id,
                workspaceId,
                event: payload,
            });
            return;
        }
        this.deps.send(channel, payload);
    }

    private addMessage(
        runtime: AgentRuntime,
        role: AgentMessage["role"],
        content: string,
        meta?: Record<string, unknown>,
    ): void {
        runtime.messages.push({
            id: randomUUID(),
            agentId: runtime.tab.id,
            role,
            content,
            createdAt: Date.now(),
            meta,
        });
        this.deps.send("agents:message", {
            agentId: runtime.tab.id,
            messages: this.getMessages(runtime.tab.id),
        });
    }

    private emitState(): void {
        this.deps.send("agents:state", this.list());
    }

    private currentModelSelection(): {
        agentDir?: string;
        provider?: string;
        modelId?: string;
        piAgentConfig?: PiAgentConfig | null;
    } {
        const settings = this.deps.getSettings?.();
        const config = this.deps.getPiAgentConfig?.() ?? null;
        return {
            agentDir: this.deps.agentDir,
            provider: settings?.provider || config?.defaultProvider || undefined,
            modelId: settings?.model || config?.defaultModel || undefined,
            piAgentConfig: config,
        };
    }

    private buildDesktopExtensions(): string[] {
        const options = this.deps.getModeOptions?.();
        if (!options?.longHorizonEnabled) return [];
        return resolveBundledDesktopExtensionPaths({
            planModeEnabled: options.planModeEnabled,
            composeModeEnabled: options.composeModeEnabled,
        });
    }

    private async createPrimarySession(
        workspace: Workspace,
        agentId: string,
        sessionPath?: string,
    ): Promise<WorkspaceSession> {
        return createWorkspaceSession({
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            ...this.currentModelSelection(),
            sessionPath,
            desktopExtensions: this.buildDesktopExtensions(),
            uiContext: createExtensionUiBridge(
                workspace.id,
                { agentId },
                {
                    onPlanProgress: ({ workspaceId, agentId, items }) => {
                        this.deps.getTaskService?.()?.setSourceTasks(workspaceId, agentId, "plan", items);
                    },
                },
            ),
        });
    }

    private async refreshRuntimeSession(runtime: AgentRuntime): Promise<void> {
        const previous = runtime.session;
        runtime.session = await this.createPrimarySession(
            runtime.workspace,
            runtime.tab.id,
            runtime.tab.sessionPath,
        );
        this.subscribe(runtime);
        runtime.tab.updatedAt = Date.now();
        try {
            previous.dispose();
        } catch (error) {
            log.warn("[agent-runtime] refresh dispose error:", error);
        }
    }

    private async syncRuntimeMode(runtime: AgentRuntime, targetMode: AgentMode): Promise<void> {
        const nextMode = targetMode;
        if (runtime.sessionMode === nextMode) return;

        this.suppressEventForwarding = true;
        try {
            if (runtime.sessionMode === "plan") {
                await runtime.session.session.prompt("/plan");
            }
            if (runtime.sessionMode === "compose") {
                await runtime.session.session.prompt("/compose off");
            }
            if (nextMode === "plan") {
                await runtime.session.session.prompt("/plan");
            }
            if (nextMode === "compose") {
                await runtime.session.session.prompt("/compose on");
            }
            runtime.sessionMode = nextMode;
        } finally {
            this.suppressEventForwarding = false;
        }
    }

    private requireRuntime(agentId: string): AgentRuntime {
        const runtime = this.runtimes.get(agentId);
        if (!runtime) throw new Error(`Agent not found: ${agentId}`);
        return runtime;
    }

    private rememberRecentUserIntent(runtime: AgentRuntime, content: string, mode: AgentMode): void {
        const memoryService = this.deps.getMemoryService?.();
        if (!memoryService || !content.trim()) return;
        const longHorizon = normalizeLongHorizonSettings(this.deps.getSettings?.().longHorizon);
        if (!longHorizon.enabled || !longHorizon.memory.enabled) return;
        memoryService.put({
            scope: runtime.tab.sessionId ? "session" : "project",
            workspaceId: runtime.workspace.id,
            sessionId: runtime.tab.sessionId,
            kind: "note",
            text: content.slice(0, 2000),
            tags: ["recent-user-intent", `mode:${mode}`],
        });
    }
}

function collectDynamicSlashCommands(session: WorkspaceSession["session"]): PiSlashCommand[] {
    const commands: PiSlashCommand[] = [];
    const extensionCommands = session.extensionRunner?.getRegisteredCommands?.() ?? [];
    for (const command of extensionCommands as Array<{ invocationName?: unknown; name?: unknown; description?: unknown }>) {
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
    for (const skill of session.resourceLoader.getSkills().skills) {
        commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
        });
    }
    return commands;
}

function visibleUserPromptContent(content: string): string {
    const text = content.trim();
    if (!text.startsWith("/plan")) return content;
    const supplement = extractPlanSection(text, "补充目标");
    if (supplement) return supplement;
    const request = extractPlanSection(text, "用户请求");
    if (request) return request;
    const original = extractPlanSection(text, "原始请求");
    return original || text.replace(/^\/plan(?:\r?\n|\s+)?/i, "").trim() || content;
}

function extractPlanSection(text: string, label: "用户请求" | "原始请求" | "补充目标"): string {
    const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\n\\s*(?:用户请求|要求|原始请求|补充目标):|$)`);
    return pattern.exec(text)?.[1]?.trim() ?? "";
}
