import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LONG_HORIZON_SETTINGS, type ToolPermissions } from "@shared";
import { AgentRuntimeRegistry, formatPromptFailureMessage } from "../registry";
import { PendingEdits } from "../../approval/pending-edits";
import { createExtensionUiBridge } from "../../extensions/extension-ui-bridge";
import { createApprovalInterceptor } from "../../approval/interceptor";
import { createWorkspaceSession, resolveBundledDesktopExtensionPaths } from "../../pi-session/factory";
import { PLAN_DIRECTIVE } from "../../agent-modes/plan-prompt";

const sessions: Array<{
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    subscribers: Array<(event: unknown) => void | Promise<void>>;
    getAllTools: ReturnType<typeof vi.fn>;
    getActiveToolNames: ReturnType<typeof vi.fn>;
    setActiveToolsByName: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
}> = [];
const { interceptorHandleMock, sessionCreationState } = vi.hoisted(() => ({
    interceptorHandleMock: vi.fn(async () => undefined),
    sessionCreationState: { nextActiveToolsError: undefined as Error | undefined },
}));

vi.mock("../../pi-session/factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: { workspaceId: string; sessionPath?: string; getRuntimePolicy?: () => unknown }) => {
        const index = sessions.length + 1;
        const subscribers: Array<(event: unknown) => void | Promise<void>> = [];
        const session = {
            prompt: vi.fn(async () => {
                const delta = index === 2 ? "short" : index === 3 ? "longer candidate answer" : "";
                if (delta) {
                    await Promise.all(subscribers.map((subscriber) => subscriber({ type: "text_delta", delta })));
                }
            }),
            abort: vi.fn(),
            dispose: vi.fn(),
            subscribe: vi.fn((subscriber: (event: unknown) => void | Promise<void>) => {
                subscribers.push(subscriber);
            }),
            subscribers,
            getAllTools: vi.fn(() => [
                { name: "read" },
                { name: "write" },
                { name: "bash" },
                { name: "git_status" },
                { name: "fetch" },
                { name: "actor" },
            ]),
            getActiveToolNames: vi.fn(() => ["read", "write", "bash", "git_status", "fetch", "actor"]),
            setActiveToolsByName: vi.fn(),
            setModel: vi.fn(async () => true),
        };
        if (sessionCreationState.nextActiveToolsError) {
            const error = sessionCreationState.nextActiveToolsError;
            sessionCreationState.nextActiveToolsError = undefined;
            session.setActiveToolsByName.mockImplementationOnce(() => {
                throw error;
            });
        }
        sessions.push(session);
        return {
            workspaceId: opts.workspaceId,
            session,
            dispose: session.dispose,
            setModel: session.setModel,
        };
    }),
    resolveBundledDesktopExtensionPaths: vi.fn(() => []),
}));

vi.mock("../../approval/interceptor", () => ({
    createApprovalInterceptor: vi.fn(() => ({
        handleEvent: interceptorHandleMock,
    })),
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
    },
}));

vi.mock("../../extensions/extension-ui-bridge", () => ({
    createExtensionUiBridge: vi.fn(() => ({})),
}));

describe("AgentRuntimeRegistry", () => {
    let emitted: Array<{ channel: string; payload: unknown }>;
    let registry: AgentRuntimeRegistry;

    beforeEach(() => {
        sessions.length = 0;
        interceptorHandleMock.mockReset();
        interceptorHandleMock.mockResolvedValue(undefined);
        sessionCreationState.nextActiveToolsError = undefined;
        vi.mocked(createWorkspaceSession).mockClear();
        vi.mocked(resolveBundledDesktopExtensionPaths).mockClear();
        emitted = [];
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
        });
    });

    it("creates independent agents for the same workspace", async () => {
        const first = await registry.create({ workspaceId: "ws_1", title: "A" });
        const second = await registry.create({ workspaceId: "ws_1", title: "B" });

        expect(first.id).not.toBe(second.id);
        expect(first.workspaceId).toBe("ws_1");
        expect(second.workspaceId).toBe("ws_1");
        expect(sessions).toHaveLength(2);
        expect(registry.list().map((agent) => agent.title)).toEqual(["A", "B"]);
    });

    it("honors the generated UI setting when loading desktop extensions", async () => {
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) => workspaceId === "ws_1"
                ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getModeOptions: () => ({ longHorizonEnabled: true, generatedUiEnabled: false }),
        });

        await registry.create({ workspaceId: "ws_1" });

        expect(resolveBundledDesktopExtensionPaths).toHaveBeenLastCalledWith(expect.objectContaining({ generatedUiEnabled: false }));
    });

    it("switches live agent sessions in place without recreating them", async () => {
        await registry.create({ workspaceId: "ws_1", title: "A" });
        await registry.create({ workspaceId: "ws_1", title: "B" });

        await registry.setModelForAll("mimo", "mimo-v2.5");

        expect(sessions).toHaveLength(2);
        expect(sessions[0].setModel).toHaveBeenCalledWith("mimo", "mimo-v2.5");
        expect(sessions[1].setModel).toHaveBeenCalledWith("mimo", "mimo-v2.5");
    });

    it("scopes extension UI permission requests to the created agent", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(createExtensionUiBridge).toHaveBeenCalledWith(
            "ws_1",
            { agentId: agent.id },
            expect.objectContaining({ onPlanProgress: expect.any(Function) }),
        );
    });

    it("creates agent sessions with the selected desktop provider and model", async () => {
        const { createWorkspaceSession } = await import("../../pi-session/factory");
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            agentDir: "C:/Users/test/.pi/agent",
            getSettings: () => ({
                theme: "light",
                fontSize: 14,
                model: "LongCat-2.0-Preview",
                provider: "longcat",
                apiKey: "",
                temperature: 0.7,
                maxTokens: 4096,
                autoSave: true,
                showLineNumbers: true,
                wordWrap: true,
                permissionLevel: "smart",
            }),
            getPiAgentConfig: () => ({
                defaultProvider: "longcat",
                defaultModel: "LongCat-2.0-Preview",
                providers: [
                    {
                        id: "longcat",
                        name: "LongCat",
                        baseUrl: "https://api.longcat.chat/openai",
                        api: "openai-completions",
                        models: [
                            {
                                id: "LongCat-2.0-Preview",
                                name: "LongCat 2.0 Preview",
                                provider: "longcat",
                                providerName: "LongCat",
                            },
                        ],
                    },
                ],
            }),
        });

        await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(createWorkspaceSession).toHaveBeenCalledWith(
            expect.objectContaining({
                agentDir: "C:/Users/test/.pi/agent",
                provider: "longcat",
                modelId: "LongCat-2.0-Preview",
                piAgentConfig: expect.objectContaining({
                    defaultProvider: "longcat",
                    defaultModel: "LongCat-2.0-Preview",
                }),
            }),
        );
    });

    it("routes prompt, messages, and state by agent id", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "hello" });

        expect(sessions[0].prompt).toHaveBeenCalledWith("hello", undefined);
        expect(registry.getMessages(agent.id)[0]).toMatchObject({
            agentId: agent.id,
            role: "user",
            content: "hello",
        });
        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "running",
            isStreaming: true,
        });
    });

    it("records recent user intent into long-horizon memory for agent prompts", async () => {
        const memoryPut = vi.fn();
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getSettings: () => ({
                theme: "light",
                fontSize: 14,
                model: "LongCat-2.0-Preview",
                provider: "longcat",
                apiKey: "",
                temperature: 0.7,
                maxTokens: 4096,
                autoSave: true,
                showLineNumbers: true,
                wordWrap: true,
                permissionLevel: "smart",
                longHorizon: {
                    ...DEFAULT_LONG_HORIZON_SETTINGS,
                    enabled: true,
                    memory: {
                        ...DEFAULT_LONG_HORIZON_SETTINGS.memory,
                        enabled: true,
                    },
                },
            }),
            getMemoryService: () => ({ put: memoryPut }) as never,
        });
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "remember this" });

        expect(memoryPut).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: "ws_1",
            kind: "note",
            text: "remember this",
            tags: expect.arrayContaining(["recent-user-intent"]),
        }));
    });

    it("keeps internal plan wrapper text out of visible agent user messages", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const wrapped = [
            "/plan",
            "",
            "用户请求:",
            "制定计划，了解一下这个项目",
            "",
            "要求:",
            "- 先只读探索当前项目的真实文件、入口、配置和测试结构。",
            "- 基于探索结果再提出计划，不要在缺少证据时直接泛泛提问。",
        ].join("\n");

        await registry.prompt({ agentId: agent.id, message: wrapped, mode: "plan" });

        expect(sessions[0].prompt).toHaveBeenNthCalledWith(1, "/plan");
        expect(sessions[0].prompt).toHaveBeenNthCalledWith(2, expect.stringContaining("用户请求:"), undefined);
        expect(registry.getMessages(agent.id)[0]).toMatchObject({
            role: "user",
            content: "制定计划，了解一下这个项目",
        });
        expect(registry.getMessages(agent.id)[0]?.content).not.toContain("要求:");
        expect(registry.getMessages(agent.id)[0]?.content).not.toContain("先只读探索");
    });

    it("enters real plan mode before sending the raw user request", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "改输入区", mode: "plan" });

        expect(sessions[0].prompt).toHaveBeenNthCalledWith(1, "/plan");
        // Task 2 (CRIT-2): plan mode + enabled prepends PLAN_DIRECTIVE to user content.
        // The runtime constructs `${PLAN_DIRECTIVE}\n\n<user text>` via buildAgentModePrompt.
        expect(sessions[0].prompt).toHaveBeenNthCalledWith(2, `${PLAN_DIRECTIVE}\n\n改输入区`, undefined);
        const outbound = sessions[0].prompt.mock.calls[1][0] as string;
        expect(outbound).toContain(PLAN_DIRECTIVE);
        expect(outbound.endsWith("改输入区")).toBe(true);
    });

    it("enters real compose mode before sending the raw user request", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "全面审查代码", mode: "compose" });

        expect(sessions[0].prompt).toHaveBeenNthCalledWith(1, "/compose on");
        expect(sessions[0].prompt).toHaveBeenNthCalledWith(2, "全面审查代码", undefined);
    });

    it("forwards streaming behavior for queued prompts", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "follow later", streamingBehavior: "followUp" });

        expect(sessions[0].prompt).toHaveBeenCalledWith("follow later", { streamingBehavior: "followUp" });
    });

    it("returns from prompt submission before the full agent turn has finished", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        let resolvePrompt: (() => void) | undefined;
        sessions[0].prompt.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve;
        }));

        let settled = "pending";
        void registry.prompt({ agentId: agent.id, message: "submit and continue" }).then(() => {
            settled = "resolved";
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(settled).toBe("resolved");
        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "running",
            isStreaming: true,
        });

        resolvePrompt?.();
    });

    it("keeps the operation tail until an accepted Plan turn settles", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        const planTurn = deferred();
        sessions[0].prompt.mockImplementation(async (message: string) => {
            if (message === `${PLAN_DIRECTIVE}\n\ninspect`) {
                await planTurn.promise;
            }
        });

        let planAccepted = false;
        await registry.prompt({ agentId: agent.id, message: "inspect", mode: "plan" }).then(() => {
            planAccepted = true;
        });

        expect(planAccepted).toBe(true);
        expect(sessions[0].prompt.mock.calls.map(([message]) => message)).toEqual([
            "/plan",
            `${PLAN_DIRECTIVE}\n\ninspect`,
        ]);
        expect(sessions[0].setActiveToolsByName).toHaveBeenCalledTimes(1);
        expect(sessions[0].setActiveToolsByName).toHaveBeenLastCalledWith(["read", "git_status", "actor"]);

        let buildAccepted = false;
        const buildPrompt = registry.prompt({ agentId: agent.id, message: "implement", mode: "build" }).then(() => {
            buildAccepted = true;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(buildAccepted).toBe(false);
        expect(sessions[0].setActiveToolsByName).toHaveBeenCalledTimes(1);
        expect(sessions[0].prompt.mock.calls.map(([message]) => message)).toEqual([
            "/plan",
            `${PLAN_DIRECTIVE}\n\ninspect`,
        ]);
        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({ mode: "plan" });

        planTurn.resolve();
        await buildPrompt;

        expect(buildAccepted).toBe(true);
        expect(sessions[0].prompt.mock.calls.map(([message]) => message)).toEqual([
            "/plan",
            `${PLAN_DIRECTIVE}\n\ninspect`,
            "/plan",
            "implement",
        ]);
        expect(sessions[0].setActiveToolsByName).toHaveBeenLastCalledWith([
            "read", "write", "bash", "git_status", "actor",
        ]);
        expect(getRuntimePolicy?.()).toMatchObject({ mode: "build" });
    });

    it("queues mode-exit commands with the same follow-up behavior before executing a queued prompt", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "先生成计划", mode: "plan" });
        await registry.prompt({
            agentId: agent.id,
            message: "现在执行计划",
            mode: "build",
            streamingBehavior: "followUp",
        });

        expect(sessions[0].prompt).toHaveBeenNthCalledWith(1, "/plan");
        // Task 2 (CRIT-2): first prompt is in plan mode → directive prepended.
        expect(sessions[0].prompt).toHaveBeenNthCalledWith(2, `${PLAN_DIRECTIVE}\n\n先生成计划`, undefined);
        const planOutbound = sessions[0].prompt.mock.calls[1][0] as string;
        expect(planOutbound).toContain(PLAN_DIRECTIVE);
        expect(planOutbound.endsWith("先生成计划")).toBe(true);
        expect(sessions[0].prompt).toHaveBeenNthCalledWith(3, "/plan", { streamingBehavior: "followUp" });
        // Second prompt is in build mode → passes through unchanged.
        expect(sessions[0].prompt).toHaveBeenNthCalledWith(4, "现在执行计划", { streamingBehavior: "followUp" });
    });

    it("restarts with the same session path and replaces runtime", async () => {
        const agent = await registry.create({
            workspaceId: "ws_1",
            title: "Imported",
            sessionPath: "C:/pi/session.jsonl",
        });

        const restarted = await registry.restart(agent.id);

        expect(restarted.id).not.toBe(agent.id);
        expect(restarted.title).toBe("Imported");
        expect(restarted.sessionPath).toBe("C:/pi/session.jsonl");
        expect(sessions[0].dispose).toHaveBeenCalled();
        expect(sessions).toHaveLength(2);
    });

    it("derives a native Pi session path from the desktop session id", async () => {
        const resolveNativeSessionPath = vi.fn(() => "C:/user-data/pi-sessions/session-123-b9c84322f82434cb.jsonl");
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) => workspaceId === "ws_1"
                ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            resolveNativeSessionPath,
        });

        const agent = await registry.create({ workspaceId: "ws_1", sessionId: "session-123" });

        expect(resolveNativeSessionPath).toHaveBeenCalledWith("session-123");
        expect(createWorkspaceSession).toHaveBeenCalledWith(expect.objectContaining({
            sessionPath: "C:/user-data/pi-sessions/session-123-b9c84322f82434cb.jsonl",
        }));
        expect(agent.sessionPath).toBe("C:/user-data/pi-sessions/session-123-b9c84322f82434cb.jsonl");
    });

    it("preserves an explicit imported native session path", async () => {
        const resolveNativeSessionPath = vi.fn();
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) => workspaceId === "ws_1"
                ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            resolveNativeSessionPath,
        });

        await registry.create({
            workspaceId: "ws_1",
            sessionId: "session-123",
            sessionPath: "D:/imports/native.jsonl",
        });

        expect(resolveNativeSessionPath).not.toHaveBeenCalled();
        expect(createWorkspaceSession).toHaveBeenCalledWith(expect.objectContaining({
            sessionPath: "D:/imports/native.jsonl",
        }));
    });

    it("refreshes workspace runtimes in place without changing agent ids", async () => {
        const first = await registry.create({ workspaceId: "ws_1", title: "A" });
        const second = await registry.create({ workspaceId: "ws_1", title: "B" });

        await registry.refreshWorkspace("ws_1");

        expect(sessions[0].dispose).toHaveBeenCalled();
        expect(sessions[1].dispose).toHaveBeenCalled();
        expect(registry.list().map((agent) => agent.id)).toEqual([first.id, second.id]);
        expect(registry.list().map((agent) => agent.title)).toEqual(["A", "B"]);
        expect(sessions).toHaveLength(4);
    });

    it("stops one agent without touching another", async () => {
        const first = await registry.create({ workspaceId: "ws_1", title: "A" });
        const second = await registry.create({ workspaceId: "ws_1", title: "B" });

        registry.stop(first.id);

        expect(sessions[0].dispose).toHaveBeenCalled();
        expect(sessions[1].dispose).not.toHaveBeenCalled();
        expect(registry.list().map((agent) => agent.id)).toEqual([second.id]);
    });

    it("emits agent-scoped pi events", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const subscribed = sessions[0].subscribe.mock.calls[0][0];

        await subscribed({ type: "agent_start" });

        expect(emitted).toContainEqual({
            channel: "agents:event",
            payload: { agentId: agent.id, workspaceId: "ws_1", event: { type: "agent_start" } },
        });
        expect(emitted.find((item) => item.channel === "pi:event")).toBeUndefined();
    });

    it("routes interceptor pi events through the agent-scoped event channel", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const send = vi.mocked(createApprovalInterceptor).mock.calls.at(-1)?.[1].send;

        expect(send).toBeDefined();
        send("pi:event", "ws_1", {
            type: "extension_error",
            message: "Plan 模式禁止执行 bash。",
        });

        expect(emitted).toContainEqual({
            channel: "agents:event",
            payload: {
                agentId: agent.id,
                workspaceId: "ws_1",
                event: {
                    type: "extension_error",
                    message: "Plan 模式禁止执行 bash。",
                },
            },
        });
        expect(emitted.find((item) => item.channel === "pi:event")).toBeUndefined();
    });

    it("still emits agent events when the approval interceptor fails", async () => {
        interceptorHandleMock.mockRejectedValueOnce(new Error("interceptor failed"));
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const subscribed = sessions[0].subscribe.mock.calls[0][0];

        await subscribed({ type: "agent_start" });

        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "running",
            isStreaming: true,
        });
        expect(emitted).toContainEqual({
            channel: "agents:event",
            payload: { agentId: agent.id, workspaceId: "ws_1", event: { type: "agent_start" } },
        });
    });

    const developmentPermissions: ToolPermissions = {
        fileRead: true,
        fileWrite: true,
        shell: true,
        git: true,
        network: false,
        extensions: true,
    };

    function deferred(): { promise: Promise<void>; resolve: () => void } {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
            resolve = done;
        });
        return { promise, resolve };
    }

    it("serializes concurrent Plan and Build prompts for the same agent", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        const planTransition = deferred();
        sessions[0].prompt.mockImplementationOnce(() => planTransition.promise);

        const planPrompt = registry.prompt({ agentId: agent.id, message: "inspect", mode: "plan" });
        await Promise.resolve();
        const buildPrompt = registry.prompt({ agentId: agent.id, message: "implement", mode: "build" });
        await Promise.resolve();

        expect(sessions[0].prompt).toHaveBeenCalledTimes(1);
        expect(sessions[0].prompt).toHaveBeenCalledWith("/plan");
        expect(sessions[0].setActiveToolsByName).not.toHaveBeenCalled();

        planTransition.resolve();
        await Promise.all([planPrompt, buildPrompt]);

        expect(sessions[0].prompt.mock.calls.map(([message]) => message)).toEqual([
            "/plan",
            `${PLAN_DIRECTIVE}\n\ninspect`,
            "/plan",
            "implement",
        ]);
        expect(sessions[0].setActiveToolsByName.mock.calls.map(([tools]) => tools)).toEqual([
            ["read", "git_status", "actor"],
            ["read", "write", "bash", "git_status", "actor"],
        ]);
        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({ mode: "build" });
    });

    it("keeps prompt serialization independent across agents", async () => {
        const first = await registry.create({ workspaceId: "ws_1", title: "A" });
        const second = await registry.create({ workspaceId: "ws_1", title: "B" });
        const firstTransition = deferred();
        sessions[0].prompt.mockImplementationOnce(() => firstTransition.promise);

        const blocked = registry.prompt({ agentId: first.id, message: "inspect", mode: "plan" });
        await Promise.resolve();
        await registry.prompt({ agentId: second.id, message: "independent", mode: "build" });

        expect(sessions[1].setActiveToolsByName).toHaveBeenCalled();
        expect(sessions[1].prompt).toHaveBeenCalledWith("independent", undefined);
        expect(sessions[0].prompt).toHaveBeenCalledTimes(1);

        firstTransition.resolve();
        await blocked;
    });

    it("queues public permission sync behind an in-flight mode transition", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        const planTransition = deferred();
        sessions[0].prompt.mockImplementationOnce(() => planTransition.promise);

        const planPrompt = registry.prompt({ agentId: agent.id, message: "inspect", mode: "plan" });
        await Promise.resolve();
        const permissionSync = registry.syncPermissions(agent.id);
        await Promise.resolve();

        expect(sessions[0].prompt).toHaveBeenCalledTimes(1);
        expect(sessions[0].prompt).toHaveBeenCalledWith("/plan");
        expect(sessions[0].setActiveToolsByName).not.toHaveBeenCalled();

        planTransition.resolve();
        const [, syncResult] = await Promise.all([planPrompt, permissionSync]);

        expect(syncResult).toEqual({
            activeTools: ["read", "git_status", "actor"],
            deniedTools: ["write", "bash", "fetch"],
        });
        expect(sessions[0].setActiveToolsByName.mock.calls.map(([tools]) => tools)).toEqual([
            ["read", "git_status", "actor"],
            ["read", "git_status", "actor"],
        ]);
        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({ mode: "plan" });
    });

    it("creates the runtime policy from the session permission override", async () => {
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) => workspaceId === "ws_1"
                ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getEffectiveToolPermissions: (_workspaceId, sessionId) => sessionId === "session_1"
                ? { ...developmentPermissions, fileWrite: false }
                : developmentPermissions,
        });

        await registry.create({ workspaceId: "ws_1", sessionId: "session_1" });

        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({
            mode: "build",
            permissions: { ...developmentPermissions, fileWrite: false },
        });
    });

    it("uses workspace permissions when the session has no override", async () => {
        const getEffectiveToolPermissions = vi.fn(() => ({ ...developmentPermissions, network: true }));
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) => workspaceId === "ws_1"
                ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getEffectiveToolPermissions,
        });

        await registry.create({ workspaceId: "ws_1" });

        expect(getEffectiveToolPermissions).toHaveBeenCalledWith("ws_1", undefined);
        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({ permissions: { ...developmentPermissions, network: true } });
    });

    it("defaults to the development permission preset", async () => {
        await registry.create({ workspaceId: "ws_1" });

        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({ permissions: developmentPermissions });
    });

    it("applies the latest active tools before each user prompt", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });

        await registry.prompt({ agentId: agent.id, message: "hello" });

        expect(sessions[0].setActiveToolsByName).toHaveBeenCalledWith([
            "read", "write", "bash", "git_status", "actor",
        ]);
        expect(sessions[0].setActiveToolsByName.mock.invocationCallOrder[0]).toBeLessThan(
            sessions[0].prompt.mock.invocationCallOrder[0],
        );
    });

    it("removes mutation and shell tools before a Plan prompt", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });

        await registry.prompt({ agentId: agent.id, message: "inspect", mode: "plan" });

        expect(sessions[0].setActiveToolsByName).toHaveBeenLastCalledWith(["read", "git_status", "actor"]);
        expect(sessions[0].setActiveToolsByName.mock.invocationCallOrder[0]).toBeLessThan(
            sessions[0].prompt.mock.invocationCallOrder[1],
        );
    });

    it("applies the current runtime policy after refreshing a session", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        await registry.prompt({ agentId: agent.id, message: "plan", mode: "plan" });

        await registry.refreshWorkspace("ws_1");

        expect(sessions[1].setActiveToolsByName).toHaveBeenCalledWith(["read", "git_status", "actor"]);
    });

    it("returns active and denied tools in registered order when permissions sync", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });

        const result = await registry.syncPermissions(agent.id, "plan");

        expect(result).toEqual({
            activeTools: ["read", "git_status", "actor"],
            deniedTools: ["write", "bash", "fetch"],
        });
    });

    it("keeps the previous controller policy when active tool configuration fails", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        sessions[0].setActiveToolsByName.mockImplementationOnce(() => {
            throw new Error("activation failed");
        });

        await expect(registry.syncPermissions(agent.id, "plan")).rejects.toThrow("activation failed");

        expect(getRuntimePolicy?.()).toMatchObject({ mode: "build" });
    });

    it("deduplicates registered tool names by first occurrence", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        sessions[0].getAllTools.mockReturnValue([
            { name: "read" },
            { name: "write" },
            { name: "read" },
            { name: "bash" },
            { name: "write" },
        ]);

        const result = await registry.syncPermissions(agent.id, "plan");

        expect(result).toEqual({
            activeTools: ["read"],
            deniedTools: ["write", "bash"],
        });
        expect(sessions[0].setActiveToolsByName).toHaveBeenCalledWith(["read"]);
    });

    it("keeps the previous session active when refresh configuration fails", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        const previous = registry.getWorkspaceSession(agent.id);
        sessionCreationState.nextActiveToolsError = new Error("candidate activation failed");

        await expect(registry.refreshWorkspace("ws_1")).rejects.toThrow("candidate activation failed");

        expect(registry.getWorkspaceSession(agent.id)).toBe(previous);
        expect(sessions[0].dispose).not.toHaveBeenCalled();
        expect(sessions[1].dispose).toHaveBeenCalledOnce();
        expect(sessions[1].subscribe).not.toHaveBeenCalled();
    });

    it("configures a refreshed session before subscribing and disposing the previous session", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });

        await registry.refreshWorkspace("ws_1");

        expect(sessions[1].setActiveToolsByName.mock.invocationCallOrder[0]).toBeLessThan(
            sessions[1].subscribe.mock.invocationCallOrder[0],
        );
        expect(sessions[1].subscribe.mock.invocationCallOrder[0]).toBeLessThan(
            sessions[0].dispose.mock.invocationCallOrder[0],
        );
        expect(registry.getWorkspaceSession(agent.id).session).toBe(sessions[1]);
    });

    it("syncs Plan tools before an internal prompt without changing the current mode", async () => {
        const agent = await registry.create({ workspaceId: "ws_1" });
        await registry.prompt({ agentId: agent.id, message: "plan first", mode: "plan" });
        sessions[0].getAllTools.mockReturnValue([
            { name: "read" },
            { name: "write" },
            { name: "edit" },
            { name: "bash" },
            { name: "plan_write" },
        ]);
        sessions[0].setActiveToolsByName.mockClear();
        sessions[0].prompt.mockClear();

        await registry.promptInternal(agent.id, "internal follow-up");

        expect(sessions[0].setActiveToolsByName).toHaveBeenCalledWith(["read", "plan_write"]);
        expect(sessions[0].setActiveToolsByName.mock.invocationCallOrder[0]).toBeLessThan(
            sessions[0].prompt.mock.invocationCallOrder[0],
        );
        expect(sessions[0].prompt).toHaveBeenCalledOnce();
        expect(sessions[0].prompt).toHaveBeenCalledWith("internal follow-up", undefined);
        const getRuntimePolicy = vi.mocked(createWorkspaceSession).mock.calls[0]?.[0].getRuntimePolicy;
        expect(getRuntimePolicy?.()).toMatchObject({ mode: "plan" });
    });

    it("keeps long-running workflow turns alive when progress events continue before the watchdog deadline", async () => {
        vi.useFakeTimers();
        try {
            const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
            const subscribed = sessions[0].subscribe.mock.calls[0][0];

            await subscribed({ type: "agent_start" });
            await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
            await subscribed({ type: "tool_update", toolCallId: "workflow-1", status: "running" });
            await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

            expect(registry.getRuntimeState(agent.id)).toMatchObject({
                status: "running",
                isStreaming: true,
            });
            expect(registry.getMessages(agent.id)).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        role: "error",
                        content: expect.stringContaining("会话运行超时"),
                    }),
                ]),
            );

            await vi.advanceTimersByTimeAsync((3 * 60 * 1000) + 1);

            expect(registry.getRuntimeState(agent.id)).toMatchObject({
                status: "error",
                isStreaming: false,
            });
            expect(sessions[0].abort).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it("calls onTurnEnd with workspace and agent ids when a default runtime emits turn_end", async () => {
        const onTurnEnd = vi.fn();
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            onTurnEnd,
        });
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const subscribed = sessions[0].subscribe.mock.calls[0][0];

        await subscribed({ type: "turn_end" });

        expect(onTurnEnd).toHaveBeenCalledWith("ws_1", agent.id);
        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "idle",
            isStreaming: false,
        });
        expect(emitted).toContainEqual({
            channel: "agents:event",
            payload: { agentId: agent.id, workspaceId: "ws_1", event: { type: "turn_end" } },
        });
    });

    it("keeps event handling alive when onTurnEnd rejects", async () => {
        const onTurnEnd = vi.fn().mockRejectedValue(new Error("judge unavailable"));
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            onTurnEnd,
        });
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const subscribed = sessions[0].subscribe.mock.calls[0][0];

        await subscribed({ type: "turn_end" });
        await Promise.resolve();

        expect(onTurnEnd).toHaveBeenCalledWith("ws_1", agent.id);
        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "idle",
            isStreaming: false,
        });
        expect(emitted).toContainEqual({
            channel: "agents:event",
            payload: { agentId: agent.id, workspaceId: "ws_1", event: { type: "turn_end" } },
        });
    });

    it.each([
        ["401 Unauthorized", "模型认证失败，请检查 API Key 或登录状态。"],
        ["429 Too Many Requests", "模型服务请求过于频繁，请稍后重试。"],
        ["fetch failed: ECONNREFUSED", "无法连接模型服务，请检查网络和服务地址。"],
        ["request timed out after 30000ms", "模型请求超时，请稍后重试或检查网络。"],
    ])("classifies prompt failure %j for a user-actionable message", (raw, expected) => {
        const message = formatPromptFailureMessage(new Error(raw));

        expect(message).toContain(expected);
        expect(message).toContain(raw);
    });
    it("marks the agent as error when prompt fails", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        sessions[0].prompt.mockRejectedValueOnce(new Error("network down"));

        await expect(registry.prompt({ agentId: agent.id, message: "hello" })).rejects.toThrow("network down");

        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "error",
            isStreaming: false,
        });
        expect(registry.getMessages(agent.id)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    agentId: agent.id,
                    role: "error",
                    content: expect.stringContaining("network down"),
                }),
            ]),
        );
    });
});
