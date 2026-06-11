import { randomUUID } from "crypto";
import type {
    AgentMessage,
    AgentRuntimeState,
    AgentTab,
    CreateAgentInput,
    SendAgentPromptInput,
    Workspace,
} from "@shared";
import type { PiEvent } from "@shared/events";
import { createWorkspaceSession, type WorkspaceSession } from "../pi-session/factory";
import { createApprovalInterceptor } from "../approval/interceptor";
import { createExtensionUiBridge } from "../extensions/extension-ui-bridge";
import type { PendingEdits } from "../approval/pending-edits";

type Send = (channel: string, payload: unknown) => void;

interface AgentRuntimeRegistryDeps {
    getWorkspace: (workspaceId: string) => Workspace | undefined;
    pendingEdits: PendingEdits;
    send: Send;
}

interface AgentRuntime {
    tab: AgentTab;
    workspace: Workspace;
    session: WorkspaceSession;
    messages: AgentMessage[];
    isStreaming: boolean;
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
            uiContext: createExtensionUiBridge(workspace.id),
        });

        const runtime: AgentRuntime = {
            tab,
            workspace,
            session,
            messages: [],
            isStreaming: false,
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
        this.addMessage(runtime, "user", text);
        await this.promptRuntime(runtime, text, input.streamingBehavior);
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
        };
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
        });

        runtime.session.session.subscribe(async (rawEvent: unknown) => {
            const event = rawEvent as PiEvent;
            await interceptor.handleEvent(event);
            this.handleEvent(runtime, event);
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
