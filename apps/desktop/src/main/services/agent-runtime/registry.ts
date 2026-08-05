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
    type AgentPermissionSyncResult,
    type ToolPermissions,
    type PiThinkingLevel,
} from "@shared";
import type { PiEvent } from "@shared/events";
import {
    createWorkspaceSession,
    resolveBundledDesktopExtensionPaths,
    type WorkspaceSession,
} from "../pi-session/factory";
import { normalizeCustomMessageEvent } from "../pi-session/event-bridge";
import { createApprovalInterceptor } from "../approval/interceptor";
import { createExtensionUiBridge } from "../extensions/extension-ui-bridge";
import { buildAgentModePrompt, normalizeAgentMode } from "../agent-modes";
import type { TaskService } from "../long-horizon/task-service";
import type { MemoryService } from "../long-horizon/memory-service";
import type { PendingEdits } from "../approval/pending-edits";
import type { PiAgentConfig } from "../../types";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SubagentManager } from "../subagent/manager";
import { createActorTool } from "../subagent/actor-tool";
import { createRuntimePolicyController, type RuntimePolicyController } from "../permission/guarded-tools";
import { filterActiveTools, resolveRuntimePolicy, resolveStoredToolPermissions } from "../permission/runtime-policy";
import log from "electron-log/main";

type Send = (channel: string, payload: unknown, workspaceId?: string) => void;

interface AgentRuntimeRegistryDeps {
    getWorkspace: (workspaceId: string) => Workspace | undefined;
    pendingEdits: PendingEdits;
    send: Send;
    agentDir?: string;
    getSettings?: () => AppSettings;
    getPiAgentConfig?: () => PiAgentConfig | null;
    getEffectiveToolPermissions?: (workspaceId: string, sessionId?: string) => ToolPermissions;
    resolveNativeSessionPath?: (sessionId: string) => string;
    /**
     * Returns mode options for the given workspace (CRIT-1).
     * Implementations should override `planModeEnabled` with the workspace's
     * persisted `planModeEnabled` field when set, so per-workspace toggles
     * flow through to `buildAgentModePrompt` via `options.planModeEnabled`.
     * Passing `undefined` returns the global defaults (legacy behavior).
     */
    getModeOptions?: (workspaceId?: string) => {
        longHorizonEnabled: boolean;
        generatedUiEnabled?: boolean;
        planModeEnabled?: boolean;
        composeModeEnabled?: boolean;
        workflowEnabled?: boolean;
        composeWorkflowEnabled?: boolean;
    };
    /** @deprecated setSourceTasks is the legacy per-source snapshot API; migrate callers to TaskService.createTask in a future spec. */
    getTaskService?: () => Pick<TaskService, "setSourceTasks"> | null | undefined;
    getMemoryService?: () => Pick<MemoryService, "put"> | null | undefined;
    /**
     * Returns the process-wide SubagentManager, or null when subagents are
     * disabled. When set, the registry injects the `actor` tool into each
     * primary agent's `customTools` and cascades `stop` / `disposeAll` into
     * `disposeAgent` / `disposeAll` so subagent sessions don't outlive their
     * primary agent.
     */
    getSubagentManager?: () => SubagentManager | null;
    onTurnEnd?: (workspaceId: string, agentId: string) => void | Promise<void>;
}

interface AgentRuntime {
    tab: AgentTab;
    workspace: Workspace;
    session: WorkspaceSession;
    messages: AgentMessage[];
    isStreaming: boolean;
    mode: AgentMode;
    sessionMode: AgentMode;
    policyController: RuntimePolicyController;
    operationTail: Promise<void>;
    /** Workspace lifecycle generation captured when this runtime was created. */
    workspaceGeneration: number;
    /**
     * 中止纪元: abort()/stop() 递增。排队中的操作在启动前比对 epoch,
     * 不一致则跳过执行 (用户停止后排队 prompt 不再运行)。
     */
    abortEpoch: number;
    /** 卡死看门狗: running 期间计时, 超时未结束则合成 extension_error 翻转状态 */
    watchdog?: NodeJS.Timeout;
}

const AGENT_WATCHDOG_MS = 5 * 60 * 1000;

export function formatPromptFailureMessage(error: unknown): string {
    const raw = promptFailureDetails(error);
    const category = /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid api key|authentication failed)/i.test(raw)
        ? "模型认证失败，请检查 API Key 或登录状态。"
        : /(?:\b429\b|too many requests|rate[ -]?limit)/i.test(raw)
            ? "模型服务请求过于频繁，请稍后重试。"
            : /(?:timed?\s*out|timeout|ETIMEDOUT)/i.test(raw)
                ? "模型请求超时，请稍后重试或检查网络。"
                : /(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network(?: error| down)?)/i.test(raw)
                    ? "无法连接模型服务，请检查网络和服务地址。"
                    : "模型请求失败。";
    return raw ? `${category} ${raw}` : category;
}

function promptFailureDetails(error: unknown): string {
    if (error instanceof Error) {
        const cause = Reflect.get(error, "cause");
        const causeDetails = cause && cause !== error ? promptFailureDetails(cause) : "";
        return [error.message.trim(), causeDetails].filter(Boolean).join(": ");
    }
    return String(error ?? "").trim();
}export class AgentRuntimeRegistry {
    private readonly runtimes = new Map<string, AgentRuntime>();
    private suppressedAgentIds = new Set<string>();
    /** in-flight 创建 promise: 仅对明确 session 身份的创建请求去重 */
    private readonly creating = new Map<string, Promise<AgentTab>>();
    private readonly workspaceGenerations = new Map<string, number>();
    private readonly invalidatedWorkspaces = new Set<string>();

    constructor(private readonly deps: AgentRuntimeRegistryDeps) {}

    list(): AgentTab[] {
        return [...this.runtimes.values()].map((runtime) => ({ ...runtime.tab }));
    }

    /** Return all live runtimes owned by a workspace. */
    listByWorkspace(workspaceId: string): AgentTab[] {
        return this.list().filter((agent) => agent.workspaceId === workspaceId);
    }

    /** Find the first live runtime bound to a persisted desktop session. */
    findBySessionId(sessionId: string): AgentTab | undefined {
        return this.list().find((agent) => agent.sessionId === sessionId);
    }

    /** Find the runtime for one workspace/session pair. */
    findByWorkspaceAndSession(workspaceId: string, sessionId: string): AgentTab | undefined {
        return this.list().find((agent) => agent.workspaceId === workspaceId && agent.sessionId === sessionId);
    }

    /**
     * Resolve the runtime used by a workspace surface.
     *
     * Selection is deliberately deterministic: an explicit agent id wins,
     * then an exact persisted session match, then the workspace's sessionless
     * default agent. An agent from another workspace is never returned.
     */
    resolveActiveAgent(
        workspaceId: string,
        selection: { agentId?: string; sessionId?: string } | string = {},
    ): AgentTab | undefined {
        const input = typeof selection === "string" ? { sessionId: selection } : selection;
        if (input.agentId) {
            const selected = this.list().find((agent) =>
                agent.id === input.agentId && agent.workspaceId === workspaceId,
            );
            if (selected) return selected;
        }
        if (input.sessionId) {
            const sessionAgent = this.findByWorkspaceAndSession(workspaceId, input.sessionId);
            if (sessionAgent) return sessionAgent;
        }
        return this.listByWorkspace(workspaceId).find((agent) => !agent.sessionId);
    }

    async create(input: CreateAgentInput): Promise<AgentTab> {
        // 无 sessionId 的显式 create 允许同 workspace 创建多个独立 agent。
        // 只有具有明确 session 身份的请求才需要 in-flight 去重。
        const dedupKey = input.sessionId
            ? `${input.workspaceId}\u0000${input.sessionId}`
            : null;
        const inFlight = dedupKey ? this.creating.get(dedupKey) : undefined;
        if (inFlight) return inFlight;
        const created = this.doCreate(input);
        if (!dedupKey) return created;
        this.creating.set(dedupKey, created);
        void created.then(
            () => {
                if (this.creating.get(dedupKey) === created) this.creating.delete(dedupKey);
            },
            () => {
                if (this.creating.get(dedupKey) === created) this.creating.delete(dedupKey);
            },
        );
        return created;
    }

    private currentWorkspaceGeneration(workspaceId: string): number {
        return this.workspaceGenerations.get(workspaceId) ?? 0;
    }

    private invalidateWorkspace(workspaceId: string): void {
        this.workspaceGenerations.set(workspaceId, this.currentWorkspaceGeneration(workspaceId) + 1);
        this.invalidatedWorkspaces.add(workspaceId);
    }

    private beginWorkspaceCreate(workspaceId: string): number {
        const generation = this.currentWorkspaceGeneration(workspaceId);
        this.invalidatedWorkspaces.delete(workspaceId);
        return generation;
    }

    private isWorkspaceCreateValid(workspaceId: string, generation: number): boolean {
        return !this.invalidatedWorkspaces.has(workspaceId)
            && this.currentWorkspaceGeneration(workspaceId) === generation;
    }

    private async doCreate(input: CreateAgentInput): Promise<AgentTab> {
        const workspace = this.deps.getWorkspace(input.workspaceId);
        if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
        const workspaceGeneration = this.beginWorkspaceCreate(workspace.id);

        const id = randomUUID();
        const now = Date.now();
        // 安全审查 C3: sessionPath 已从 IPC 契约移除 — 原生 JSONL 路径只能由
        // sessionId 经 resolveNativeSessionPath 推导, 渲染层无法指定任意文件路径.
        const sessionPath = input.sessionId ? this.deps.resolveNativeSessionPath?.(input.sessionId) : undefined;
        const tab: AgentTab = {
            id,
            workspaceId: workspace.id,
            title: input.title || `${workspace.name} Agent`,
            status: "starting",
            sessionId: input.sessionId,
            sessionPath,
            createdAt: now,
            updatedAt: now,
        };

        const policyController = createRuntimePolicyController(resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: this.getEffectiveToolPermissions(workspace.id, input.sessionId),
        }));
        const session = await this.createPrimarySession(workspace, id, policyController, sessionPath);
        if (!this.isWorkspaceCreateValid(workspace.id, workspaceGeneration)) {
            try {
                session.dispose();
            } catch (error) {
                log.warn("[agent-runtime] stale session dispose after workspace invalidation failed:", workspace.id, error);
            }
            throw new Error(`Workspace agent creation invalidated: ${workspace.id}`);
        }

        const runtime: AgentRuntime = {
            tab,
            workspace,
            session,
            messages: [],
            isStreaming: false,
            mode: "build",
            sessionMode: "build",
            policyController,
            operationTail: Promise.resolve(),
            workspaceGeneration,
            abortEpoch: 0,
        };
        this.runtimes.set(id, runtime);
        this.subscribe(runtime);
        if (session.modelFallbackMessage) {
            this.addMessage(runtime, "system", session.modelFallbackMessage, { warning: true, source: "pi-model-fallback" });
        }
        runtime.tab.status = "idle";
        runtime.tab.updatedAt = Date.now();
        this.emitState();
        return { ...runtime.tab };
    }

    async prompt(input: SendAgentPromptInput): Promise<void> {
        const runtime = this.requireRuntime(input.agentId);
        const text = input.message.trim();
        if (!text) return;
        return new Promise<void>((resolveAccepted, rejectAccepted) => {
            const operation = this.enqueueRuntimeOperation(runtime, async () => {
                const modeOptions = this.deps.getModeOptions?.(runtime.workspace.id);
                const mode = normalizeAgentMode(input.mode, modeOptions);
                // Capture Pi session mode before /plan toggle so plan→build can inject BUILD_SWITCH.
                const previousSessionMode = runtime.sessionMode;
                await this.syncRuntimeMode(runtime, mode, input.streamingBehavior);
                runtime.mode = mode;
                await this.configureSessionPermissions(runtime, runtime.session, mode);
                const visibleContent = visibleUserPromptContent(text);
                this.addMessage(runtime, "user", visibleContent, { mode });
                this.rememberRecentUserIntent(runtime, visibleContent, mode);
                const outbound = buildAgentModePrompt(mode, text, {
                    ...modeOptions,
                    previousMode: previousSessionMode,
                });
                await this.promptRuntime(runtime, outbound, input.streamingBehavior, {
                    returnEarly: true,
                    onAccepted: resolveAccepted,
                });
            });
            // onAccepted 已 resolve 后 operation 仍可能 reject (重复调用无副作用);
            // 被 abort 跳过 (未执行) 时 operation 正常 resolve — 这里兜底结算外层 promise,
            // 避免 pi:send 因排队 prompt 被跳过而永远挂起。
            void operation.then(resolveAccepted, rejectAccepted);
        });
    }

    async promptInternal(agentId: string, message: string): Promise<void> {
        const runtime = this.requireRuntime(agentId);
        const text = message.trim();
        if (!text) return;
        await this.enqueueRuntimeOperation(runtime, async () => {
            this.suppressedAgentIds.add(agentId);
            try {
                await this.configureSessionPermissions(runtime, runtime.session, runtime.mode);
                await this.promptRuntime(runtime, text);
            } finally {
                this.suppressedAgentIds.delete(agentId);
            }
        });
    }

    private async promptRuntime(
        runtime: AgentRuntime,
        text: string,
        streamingBehavior?: SendAgentPromptInput["streamingBehavior"],
        options?: { returnEarly?: boolean; onAccepted?: () => void },
    ): Promise<void> {
        runtime.tab.status = "running";
        runtime.tab.updatedAt = Date.now();
        runtime.isStreaming = true;
        this.armWatchdog(runtime);
        this.emitState();
        let failureHandled = false;
        // 捕获启动时的纪元: 运行期间用户 abort/stop 会递增, 此时 SDK prompt
        // 的拒绝是"用户停止"而非失败 — 不翻转 error 状态、不追加错误消息。
        const epochAtStart = runtime.abortEpoch;
        const handleFailureOnce = (error: unknown): void => {
            if (failureHandled) return;
            if (runtime.abortEpoch !== epochAtStart) return;
            failureHandled = true;
            this.handlePromptFailure(runtime, error);
        };
        try {
            const promptPromise = Promise.resolve(runtime.session.session.prompt(
                text,
                streamingBehavior ? { streamingBehavior } : undefined,
            ));
            if (!options?.returnEarly) {
                await promptPromise;
                return;
            }
            let returnedEarly = false;
            const trackedPrompt = promptPromise.catch((error) => {
                if (returnedEarly) {
                    handleFailureOnce(error);
                }
                throw error;
            });
            await Promise.race([
                trackedPrompt,
                new Promise<void>((resolve) => {
                    queueMicrotask(resolve);
                }),
            ]);
            returnedEarly = true;
            options.onAccepted?.();
            await trackedPrompt;
        } catch (error) {
            handleFailureOnce(error);
            throw error;
        }
    }

    async abort(agentId: string): Promise<void> {
        const runtime = this.requireRuntime(agentId);
        // 用户停止: 递增纪元使排队中的 prompt 不再执行; 并等待 SDK abort
        // (内部 waitForIdle) 完成后再翻转状态, 避免运行中的 promptRuntime
        // 在状态已置 idle 后继续覆盖/追加消息。
        runtime.abortEpoch += 1;
        try {
            await runtime.session.session.abort();
        } catch (error) {
            log.warn("[agent-runtime] abort error:", error);
        }
        runtime.isStreaming = false;
        runtime.tab.status = "idle";
        runtime.tab.updatedAt = Date.now();
        this.disarmWatchdog(runtime);
        this.addMessage(runtime, "system", "已请求停止当前响应");
        this.emitState();
    }

    /** Abort all live runtimes bound to a persisted session, retaining them. */
    async abortBySession(sessionId: string): Promise<void> {
        await Promise.all(this.list().filter((agent) => agent.sessionId === sessionId).map((agent) => this.abort(agent.id)));
    }

    /** Abort all live runtimes in a workspace, retaining their runtime records. */
    async abortWorkspace(workspaceId: string): Promise<void> {
        await Promise.all(this.listByWorkspace(workspaceId).map((agent) => this.abort(agent.id)));
    }

    stop(agentId: string): void {
        const runtime = this.runtimes.get(agentId);
        if (!runtime) return;
        // 递增纪元: 排队中的操作不再对已 dispose 的 session 执行。
        runtime.abortEpoch += 1;
        this.disarmWatchdog(runtime);
        runtime.session.dispose();
        this.runtimes.delete(agentId);
        this.emitState();
        this.disposeSubagentForAgent(agentId);
    }

    /** Dispose all live runtimes bound to a persisted session. */
    stopBySession(sessionId: string): void {
        for (const agent of this.list()) {
            if (agent.sessionId === sessionId) this.stop(agent.id);
        }
    }

    /** Dispose all live runtimes in a workspace. */
    stopWorkspace(workspaceId: string): void {
        this.invalidateWorkspace(workspaceId);
        for (const agent of this.listByWorkspace(workspaceId)) {
            this.stop(agent.id);
        }
    }

    async restart(agentId: string): Promise<AgentTab> {
        const runtime = this.requireRuntime(agentId);
        // 安全审查 C3: 不再回传 sessionPath — create 由 sessionId 推导原生路径,
        // restart 保留 sessionId 即可续接同一原生会话文件.
        const input: CreateAgentInput = {
            workspaceId: runtime.workspace.id,
            title: runtime.tab.title,
            sessionId: runtime.tab.sessionId,
        };
        this.stop(agentId);
        return this.create(input);
    }

    async refreshWorkspace(workspaceId: string): Promise<void> {
        const targets = [...this.runtimes.values()].filter((runtime) => runtime.workspace.id === workspaceId);
        await Promise.all(targets.map((runtime) =>
            this.enqueueRuntimeOperation(runtime, () => this.refreshRuntimeSession(runtime))));
        this.emitState();
    }

    async setModelForAll(provider: string, modelId: string): Promise<void> {
        const targets = [...this.runtimes.values()];
        await Promise.all(targets.map((runtime) =>
            this.enqueueRuntimeOperation(runtime, async () => {
                const switched = await runtime.session.setModel(provider, modelId);
                if (!switched) {
                    throw new Error(`实时会话找不到模型 ${provider} / ${modelId}`);
                }
                runtime.tab.updatedAt = Date.now();
            })));
        this.emitState();
    }

    getMessages(agentId: string): AgentMessage[] {
        return [...this.requireRuntime(agentId).messages];
    }

    getRuntimeState(agentId: string): AgentRuntimeState {
        const runtime = this.requireRuntime(agentId);
        const session = runtime.session.session;
        const model = session.model;
        const stats = session.getSessionStats();
        return {
            agentId,
            status: runtime.tab.status,
            isStreaming: runtime.isStreaming,
            sessionPath: runtime.tab.sessionPath,
            modelProvider: model?.provider,
            modelId: model?.id,
            modelName: model?.name,
            sessionName: session.sessionName,
            thinkingLevel: session.thinkingLevel,
            availableThinkingLevels: session.getAvailableThinkingLevels(),
            supportsThinking: session.supportsThinking(),
            tokenUsage: {
                input: stats.tokens.input,
                output: stats.tokens.output,
                total: stats.tokens.total,
            },
        };
    }

    setThinking(agentId: string, level: PiThinkingLevel): AgentRuntimeState {
        const runtime = this.requireRuntime(agentId);
        runtime.session.session.setThinkingLevel(level);
        runtime.tab.updatedAt = Date.now();
        const state = this.getRuntimeState(agentId);
        this.emitRuntimeStates();
        return state;
    }

    /**
     * 立即把 UI 选择的 Agent 模式同步到 live Pi session。
     * 生产要求：不能只写 localStorage，必须在下一条消息前就完成 /plan|/compose 切换与工具权限裁剪。
     */
    async setMode(agentId: string, mode: AgentMode): Promise<AgentRuntimeState> {
        const runtime = this.requireRuntime(agentId);
        const modeOptions = this.deps.getModeOptions?.(runtime.workspace.id);
        const nextMode = normalizeAgentMode(mode, modeOptions);
        return this.enqueueRuntimeOperation(runtime, async () => {
            await this.syncRuntimeMode(runtime, nextMode);
            runtime.mode = nextMode;
            await this.configureSessionPermissions(runtime, runtime.session, nextMode);
            runtime.tab.updatedAt = Date.now();
            const state = this.getRuntimeState(agentId);
            this.emitRuntimeStates();
            return state;
        });
    }

    getWorkspaceSession(agentId: string): WorkspaceSession {
        return this.requireRuntime(agentId).session;
    }

    listSlashCommands(agentId: string): PiSlashCommand[] {
        return collectDynamicSlashCommands(this.requireRuntime(agentId).session.session);
    }

    findDefaultAgent(workspaceId: string): AgentTab | undefined {
        return this.resolveActiveAgent(workspaceId);
    }

    /** 停止并释放某 workspace 下所有 agent (用于 workspace:delete). */
    disposeWorkspace(workspaceId: string): void {
        this.stopWorkspace(workspaceId);
    }

    disposeAll(): void {
        for (const workspaceId of new Set([
            ...Array.from(this.runtimes.values(), (runtime) => runtime.workspace.id),
            ...this.creating.keys(),
        ])) {
            this.invalidateWorkspace(workspaceId);
        }
        for (const agentId of [...this.runtimes.keys()]) {
            this.stop(agentId);
        }
        // Defensive sweep — `stop` already cascaded per-agent `disposeAgent`,
        // but call `disposeAll` so the manager can release any stragglers
        // (e.g., actors whose primary agent was never registered here).
        const manager = this.deps.getSubagentManager?.();
        if (manager) {
            try {
                manager.disposeAll();
            } catch (error) {
                log.error("[agent-runtime] subagent disposeAll error:", error);
            }
        }
    }

    private isRuntimeValid(runtime: AgentRuntime): boolean {
        return this.runtimes.get(runtime.tab.id) === runtime
            && this.isWorkspaceCreateValid(runtime.workspace.id, runtime.workspaceGeneration);
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
            if (!this.isRuntimeValid(runtime)) return;
            const event = normalizeCustomMessageEvent(rawEvent as PiEvent);
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
        if (!this.isRuntimeValid(runtime)) return;
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
        if (
            runtime.isStreaming
            && event.type !== "agent_start"
            && event.type !== "agent_end"
            && event.type !== "turn_end"
            && event.type !== "extension_error"
            && event.type !== "auto_retry_start"
            && event.type !== "auto_retry_end"
        ) {
            this.armWatchdog(runtime);
        }
        if (event.type === "turn_end") {
            this.notifyTurnEnd(runtime);
        }
        if (event.type === "thinking_level_changed" || event.type === "session_info_changed") {
            this.emitRuntimeStates();
        }
        if (!this.suppressedAgentIds.has(runtime.tab.id)) {
            this.deps.send("agents:event", {
                agentId: runtime.tab.id,
                workspaceId: runtime.workspace.id,
                event,
            });
        }
        this.emitState();
    }

    async syncPermissions(agentId: string, modeOverride?: AgentMode): Promise<AgentPermissionSyncResult> {
        const runtime = this.requireRuntime(agentId);
        return this.enqueueRuntimeOperation(runtime, async () => {
            const mode = modeOverride ?? runtime.mode;
            return this.configureSessionPermissions(runtime, runtime.session, mode);
        });
    }

    private configureSessionPermissions(
        runtime: AgentRuntime,
        targetSession: WorkspaceSession,
        mode: AgentMode,
    ): AgentPermissionSyncResult {
        const policy = resolveRuntimePolicy({
            mode,
            workspacePermissions: this.getEffectiveToolPermissions(runtime.workspace.id, runtime.tab.sessionId),
        });
        const allTools = [...new Set(targetSession.session.getAllTools().map((tool) => tool.name))];
        const activeTools = filterActiveTools(allTools, policy);
        const activeSet = new Set(activeTools);
        const deniedTools = allTools.filter((toolName) => !activeSet.has(toolName));
        targetSession.session.setActiveToolsByName(activeTools);
        runtime.policyController.setPolicy(policy);
        return { activeTools, deniedTools };
    }

    private armWatchdog(runtime: AgentRuntime): void {
        if (runtime.watchdog) {
            clearTimeout(runtime.watchdog);
        }
        runtime.watchdog = setTimeout(() => {
            runtime.watchdog = undefined;
            log.error("[agent-runtime] watchdog fired (stuck running):", runtime.tab.id);
            try {
                runtime.session.session.abort();
            } catch (error) {
                log.warn("[agent-runtime] watchdog abort failed:", error);
            }
            runtime.tab.status = "error";
            runtime.isStreaming = false;
            runtime.tab.updatedAt = Date.now();
            this.addMessage(
                runtime,
                "error",
                "会话运行超时未结束，可能已崩溃。请重新发起对话。",
            );
            if (!this.suppressedAgentIds.has(runtime.tab.id)) {
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

    private handlePromptFailure(runtime: AgentRuntime, error: unknown): void {
        const message = formatPromptFailureMessage(error);
        runtime.tab.status = "error";
        runtime.tab.updatedAt = Date.now();
        runtime.isStreaming = false;
        this.disarmWatchdog(runtime);
        this.addMessage(runtime, "error", `Agent prompt failed: ${message}`);
        this.emitState();
    }

    private notifyTurnEnd(runtime: AgentRuntime): void {
        try {
            void Promise.resolve(this.deps.onTurnEnd?.(runtime.workspace.id, runtime.tab.id)).catch((error) => {
                log.error("[agent-runtime] onTurnEnd error:", error);
            });
        } catch (error) {
            log.error("[agent-runtime] onTurnEnd error:", error);
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
        this.deps.send(channel, payload, workspaceId);
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
        this.emitRuntimeStates();
    }

    private emitRuntimeStates(): void {
        this.deps.send(
            "agents:runtime-state-changed",
            [...this.runtimes.keys()].map((agentId) => this.getRuntimeState(agentId)),
        );
    }

    private currentModelSelection(): {
        agentDir?: string;
        provider?: string;
        modelId?: string;
        piAgentConfig?: PiAgentConfig | null;
        thinkingLevel?: PiThinkingLevel;
        autoCompactionEnabled?: boolean;
    } {
        const settings = this.deps.getSettings?.();
        const config = this.deps.getPiAgentConfig?.() ?? null;
        const configuredThinking = settings?.thinkingLevel === "none" ? "off" : settings?.thinkingLevel;
        return {
            agentDir: this.deps.agentDir,
            provider: settings?.provider || config?.defaultProvider || undefined,
            modelId: settings?.model || config?.defaultModel || undefined,
            piAgentConfig: config,
            thinkingLevel: configuredThinking,
            autoCompactionEnabled: settings?.autoCompactionEnabled,
        };
    }

    private buildDesktopExtensions(workspaceId: string): string[] {
        const options = this.deps.getModeOptions?.(workspaceId);
        return resolveBundledDesktopExtensionPaths({
            generatedUiEnabled: options?.generatedUiEnabled !== false,
            planModeEnabled: options?.longHorizonEnabled ? options.planModeEnabled : false,
            composeModeEnabled: options?.longHorizonEnabled ? options.composeModeEnabled : false,
            workflowEnabled: options?.longHorizonEnabled ? options.workflowEnabled : false,
            composeWorkflowEnabled: options?.longHorizonEnabled ? options.composeWorkflowEnabled : false,
        });
    }

    private async createPrimarySession(
        workspace: Workspace,
        agentId: string,
        policyController: RuntimePolicyController,
        sessionPath?: string,
    ): Promise<WorkspaceSession> {
        return createWorkspaceSession({
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            ...this.currentModelSelection(),
            sessionPath,
            desktopExtensions: this.buildDesktopExtensions(workspace.id),
            customTools: this.buildPrimaryCustomTools(workspace, agentId),
            getRuntimePolicy: policyController.getPolicy,
            uiContext: createExtensionUiBridge(
                workspace.id,
                { agentId },
                {
                    onPlanProgress: ({ workspaceId, agentId, items }) => {
                        // TODO: migrate to TaskService.createTask in future spec
                        void this.deps.getTaskService?.()?.setSourceTasks(workspaceId, agentId, "plan", items).catch((error) => {
                            log.error("[AgentRuntimeRegistry] failed to persist plan progress:", error);
                        });
                    },
                },
            ),
        });
    }

    /**
     * Build the `customTools` array for a primary agent session. When a
     * SubagentManager is available, injects the `actor` tool so the LLM can
     * delegate to subagents. Errors from `createActorTool` (e.g., empty
     * subagent registry at construction time) are caught and logged — the
     * session is still created, just without the actor tool.
     */
    private buildPrimaryCustomTools(
        workspace: Workspace,
        agentId: string,
    ): ToolDefinition[] {
        const manager = this.deps.getSubagentManager?.();
        if (!manager) return [];
        try {
            const actorTool = createActorTool(manager, agentId, {
                workspaceId: workspace.id,
                workspacePath: workspace.path,
            });
            return [actorTool];
        } catch (error) {
            log.error("[agent-runtime] createActorTool failed:", error);
            return [];
        }
    }

    /**
     * Cascade `stop` into the SubagentManager so subagent sessions are torn
     * down with their primary agent. Errors are swallowed — a failing
     * subagent dispose must not prevent the primary runtime from stopping.
     */
    private disposeSubagentForAgent(agentId: string): void {
        const manager = this.deps.getSubagentManager?.();
        if (!manager) return;
        try {
            manager.disposeAgent(agentId);
        } catch (error) {
            log.error("[agent-runtime] subagent disposeAgent error:", error);
        }
    }

    private async refreshRuntimeSession(runtime: AgentRuntime): Promise<void> {
        const previous = runtime.session;
        const candidate = await this.createPrimarySession(
            runtime.workspace,
            runtime.tab.id,
            runtime.policyController,
            runtime.tab.sessionPath,
        );
        try {
            this.configureSessionPermissions(runtime, candidate, runtime.mode);
        } catch (error) {
            candidate.dispose();
            throw error;
        }
        runtime.session = candidate;
        this.subscribe(runtime);
        runtime.tab.updatedAt = Date.now();
        // 新 session 从默认 build 模式启动: 重置 sessionMode, 否则残留的
        // "plan" 会让下次 build prompt 错误地发送 /plan (或反向跳过 /plan)。
        runtime.sessionMode = "build";
        try {
            previous.dispose();
        } catch (error) {
            log.warn("[agent-runtime] refresh dispose error:", error);
        }
    }

    private async syncRuntimeMode(
        runtime: AgentRuntime,
        targetMode: AgentMode,
        streamingBehavior?: SendAgentPromptInput["streamingBehavior"],
    ): Promise<void> {
        const nextMode = targetMode;
        if (runtime.sessionMode === nextMode) return;
        const sendModePrompt = async (command: string): Promise<void> => {
            if (streamingBehavior) {
                await runtime.session.session.prompt(command, { streamingBehavior });
                return;
            }
            await runtime.session.session.prompt(command);
        };

        this.suppressedAgentIds.add(runtime.tab.id);
        try {
            if (runtime.sessionMode === "plan") {
                await sendModePrompt("/plan");
            }
            if (runtime.sessionMode === "compose") {
                await sendModePrompt("/compose off");
            }
            if (nextMode === "plan") {
                await sendModePrompt("/plan");
            }
            if (nextMode === "compose") {
                await sendModePrompt("/compose on");
            }
            runtime.sessionMode = nextMode;
        } finally {
            this.suppressedAgentIds.delete(runtime.tab.id);
        }
    }

    private requireRuntime(agentId: string): AgentRuntime {
        const runtime = this.runtimes.get(agentId);
        if (!runtime) throw new Error(`Agent not found: ${agentId}`);
        return runtime;
    }

    private enqueueRuntimeOperation<T>(runtime: AgentRuntime, operation: () => Promise<T>): Promise<T> {
        const epoch = runtime.abortEpoch;
        const result = runtime.operationTail.then(() => {
            // 入队后发生 abort()/stop() (纪元递增) → 跳过执行并立即完成,
            // 否则排队中的 prompt 会在用户停止后继续运行 (或打到已 dispose 的 session)。
            if (epoch !== runtime.abortEpoch) {
                return undefined as T;
            }
            return operation();
        });
        runtime.operationTail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private getEffectiveToolPermissions(workspaceId: string, sessionId?: string): ToolPermissions {
        return this.deps.getEffectiveToolPermissions?.(workspaceId, sessionId) ?? resolveStoredToolPermissions({});
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
