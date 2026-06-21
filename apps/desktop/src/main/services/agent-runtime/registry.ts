import { randomUUID } from "crypto";
import type {
    AgentMessage,
    AgentRuntimeState,
    AgentTab,
    CreateAgentInput,
    PiSlashCommand,
    SendAgentPromptInput,
    Workspace,
    AgentMode,
} from "@shared";
import type { PiEvent } from "@shared/events";
import { createWorkspaceSession, type WorkspaceSession } from "../pi-session/factory";
import { createApprovalInterceptor } from "../approval/interceptor";
import { createExtensionUiBridge } from "../extensions/extension-ui-bridge";
import { buildAgentModePrompt, normalizeAgentMode } from "../agent-modes";
import { MaxModeService } from "../long-horizon/max-mode-service";
import type { PendingEdits } from "../approval/pending-edits";
import log from "electron-log/main";

type Send = (channel: string, payload: unknown) => void;

interface AgentRuntimeRegistryDeps {
    getWorkspace: (workspaceId: string) => Workspace | undefined;
    pendingEdits: PendingEdits;
    send: Send;
    getModeOptions?: () => { longHorizonEnabled: boolean; maxModeEnabled: boolean; maxCandidates?: number };
    maxModeService?: Pick<MaxModeService, "run">;
}

interface AgentRuntime {
    tab: AgentTab;
    workspace: Workspace;
    session: WorkspaceSession;
    messages: AgentMessage[];
    isStreaming: boolean;
    mode: AgentMode;
    thinkingLevel?: "none" | "low" | "medium" | "high";
}

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
            sessionPath: input.sessionPath,
            createdAt: now,
            updatedAt: now,
        };

        const session = await createWorkspaceSession({
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            sessionPath: input.sessionPath,
            uiContext: createExtensionUiBridge(workspace.id, { agentId: id }),
        });

        const runtime: AgentRuntime = {
            tab,
            workspace,
            session,
            messages: [],
            isStreaming: false,
            mode: "build",
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
        runtime.mode = mode;
        this.addMessage(runtime, "user", text, { mode });
        const outbound = buildAgentModePrompt(mode, text, modeOptions);
        if (mode === "max") {
            const maxModeService = this.deps.maxModeService ?? this.createDefaultMaxModeService(runtime, modeOptions?.maxCandidates);
            await maxModeService.run({
                prompt: outbound,
                replayWinner: (content) => this.promptRuntime(runtime, content, input.streamingBehavior),
            });
            return;
        }
        await this.promptRuntime(runtime, outbound, input.streamingBehavior);
    }

    private createDefaultMaxModeService(runtime: AgentRuntime, candidates?: number): MaxModeService {
        return new MaxModeService({
            candidates: candidates ?? 5,
            createCandidate: async (index) => {
                const candidate = await createWorkspaceSession({
                    workspaceId: runtime.workspace.id,
                    workspacePath: runtime.workspace.path,
                    uiContext: createExtensionUiBridge(runtime.workspace.id, { agentId: `${runtime.tab.id}:max:${index}` }),
                });
                const interceptor = createApprovalInterceptor(runtime.workspace.id, {
                    abort: () => candidate.session.abort(),
                    pendingEdits: this.deps.pendingEdits,
                    send: (channel, _workspaceId, payload) => this.deps.send(channel, payload),
                    workspacePath: runtime.workspace.path,
                    getMode: () => "plan",
                });
                let content = "";
                candidate.session.subscribe(async (rawEvent: unknown) => {
                    await interceptor.handleEvent(rawEvent as PiEvent);
                    const delta = textDeltaFromEvent(rawEvent);
                    if (delta) content += delta;
                });
                return {
                    id: `candidate-${index}`,
                    prompt: (prompt) => candidate.session.prompt(buildMaxCandidatePrompt(prompt, index)),
                    readResult: () => content.trim(),
                    dispose: candidate.dispose,
                };
            },
            judge: async (results) => {
                const fallback = pickLongestCandidate(results);
                if (!fallback) throw new Error("Max mode produced no candidates");
                const judge = await createWorkspaceSession({
                    workspaceId: runtime.workspace.id,
                    workspacePath: runtime.workspace.path,
                    uiContext: createExtensionUiBridge(runtime.workspace.id, { agentId: `${runtime.tab.id}:max:judge` }),
                });
                const judgeInterceptor = createApprovalInterceptor(runtime.workspace.id, {
                    abort: () => judge.session.abort(),
                    pendingEdits: this.deps.pendingEdits,
                    send: (channel, _workspaceId, payload) => this.deps.send(channel, payload),
                    workspacePath: runtime.workspace.path,
                    getMode: () => "plan",
                });
                let judgeOutput = "";
                try {
                    judge.session.subscribe(async (rawEvent: unknown) => {
                        await judgeInterceptor.handleEvent(rawEvent as PiEvent);
                        const delta = textDeltaFromEvent(rawEvent);
                        if (delta) judgeOutput += delta;
                    });
                    await judge.session.prompt(buildMaxJudgePrompt(results));
                    return parseMaxJudgeOutput(judgeOutput, results) ?? {
                        winnerId: fallback.id,
                        reason: "Judge output was not parseable; selected the richest generated result.",
                    };
                } finally {
                    judge.dispose();
                }
            },
        });
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
        this.addMessage(runtime, "system", "已请求停止当前响应");
        this.emitState();
    }

    stop(agentId: string): void {
        const runtime = this.runtimes.get(agentId);
        if (!runtime) return;
        runtime.session.dispose();
        this.runtimes.delete(agentId);
        this.emitState();
    }

    async restart(agentId: string): Promise<AgentTab> {
        const runtime = this.requireRuntime(agentId);
        const input: CreateAgentInput = {
            workspaceId: runtime.workspace.id,
            title: runtime.tab.title,
            sessionPath: runtime.tab.sessionPath,
        };
        this.stop(agentId);
        return this.create(input);
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

    disposeAll(): void {
        for (const agentId of [...this.runtimes.keys()]) {
            this.stop(agentId);
        }
    }

    private subscribe(runtime: AgentRuntime): void {
        const interceptor = createApprovalInterceptor(runtime.workspace.id, {
            abort: () => runtime.session.session.abort(),
            pendingEdits: this.deps.pendingEdits,
            send: (channel, _workspaceId, payload) => this.deps.send(channel, payload),
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
        }
        if (event.type === "agent_end" || event.type === "turn_end") {
            runtime.tab.status = "idle";
            runtime.isStreaming = false;
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

    private requireRuntime(agentId: string): AgentRuntime {
        const runtime = this.runtimes.get(agentId);
        if (!runtime) throw new Error(`Agent not found: ${agentId}`);
        return runtime;
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

function textDeltaFromEvent(rawEvent: unknown): string {
    if (!rawEvent || typeof rawEvent !== "object") return "";
    const event = rawEvent as Record<string, unknown>;
    if (event.type === "text_delta" && typeof event.delta === "string") return event.delta;
    if (event.type === "message_update") {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent && typeof assistantEvent === "object") {
            const nested = assistantEvent as Record<string, unknown>;
            if ((nested.type === "text_delta" || nested.subtype === "text_delta") && typeof nested.delta === "string") {
                return nested.delta;
            }
        }
        if (event.subtype === "text_delta" && typeof event.delta === "string") return event.delta;
    }
    return "";
}

function pickLongestCandidate<T extends { content: string }>(results: T[]): T | undefined {
    return [...results].sort((a, b) => b.content.length - a.content.length)[0] ?? results[0];
}

function buildMaxCandidatePrompt(prompt: string, index: number): string {
    return [
        "<system-reminder>",
        `Max candidate ${index} is a temporary planning session.`,
        "Do not edit files, run mutating commands, commit, install packages, or change system state.",
        "Use read-only exploration only when necessary, then produce the best implementation plan or answer candidate.",
        "</system-reminder>",
        "",
        prompt,
    ].join("\n");
}

function buildMaxJudgePrompt(results: Array<{ id: string; content: string }>): string {
    return [
        "You are the Max Mode judge. Choose the candidate that best satisfies the user request.",
        'Return only compact JSON in this shape: {"winnerId":"candidate-1","reason":"..."}',
        "",
        ...results.map((candidate) => [
            `Candidate ${candidate.id}:`,
            candidate.content || "(empty)",
        ].join("\n")),
    ].join("\n\n");
}

function parseMaxJudgeOutput(
    output: string,
    results: Array<{ id: string; content: string }>,
): { winnerId: string; reason: string } | null {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]) as { winnerId?: unknown; reason?: unknown };
        if (typeof parsed.winnerId !== "string") return null;
        if (!results.some((candidate) => candidate.id === parsed.winnerId)) return null;
        return {
            winnerId: parsed.winnerId,
            reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason : "Selected by Max Mode judge.",
        };
    } catch {
        return null;
    }
}
