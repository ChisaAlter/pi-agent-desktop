import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LONG_HORIZON_SETTINGS } from "@shared";
import { AgentRuntimeRegistry } from "../registry";
import { PendingEdits } from "../../approval/pending-edits";
import { createExtensionUiBridge } from "../../extensions/extension-ui-bridge";
import { createApprovalInterceptor } from "../../approval/interceptor";
import { createWorkspaceSession } from "../../pi-session/factory";
import { PLAN_DIRECTIVE } from "../../agent-modes/plan-prompt";

const sessions: Array<{
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    subscribers: Array<(event: unknown) => void | Promise<void>>;
}> = [];
const { interceptorHandleMock } = vi.hoisted(() => ({
    interceptorHandleMock: vi.fn(async () => undefined),
}));

vi.mock("../../pi-session/factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: { workspaceId: string }) => {
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
        };
        sessions.push(session);
        return {
            workspaceId: opts.workspaceId,
            session,
            dispose: session.dispose,
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
        vi.mocked(createWorkspaceSession).mockClear();
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
