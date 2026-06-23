import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeRegistry } from "../registry";
import { PendingEdits } from "../../approval/pending-edits";
import { createExtensionUiBridge } from "../../extensions/extension-ui-bridge";
import { createApprovalInterceptor } from "../../approval/interceptor";

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

        expect(createExtensionUiBridge).toHaveBeenCalledWith("ws_1", { agentId: agent.id });
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

        expect(sessions[0].prompt).toHaveBeenCalledWith(expect.stringContaining("Plan mode is active"), undefined);
        expect(sessions[0].prompt).toHaveBeenCalledWith(expect.stringContaining("用户请求:"), undefined);
        expect(registry.getMessages(agent.id)[0]).toMatchObject({
            role: "user",
            content: "制定计划，了解一下这个项目",
        });
        expect(registry.getMessages(agent.id)[0]?.content).not.toContain("要求:");
        expect(registry.getMessages(agent.id)[0]?.content).not.toContain("先只读探索");
    });

    it("forwards streaming behavior for queued prompts", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "follow later", streamingBehavior: "followUp" });

        expect(sessions[0].prompt).toHaveBeenCalledWith("follow later", { streamingBehavior: "followUp" });
    });

    it("routes max mode through the max runner and replays the winner into the primary session", async () => {
        const maxRun = vi.fn(async (input: { prompt: string; replayWinner: (content: string) => Promise<void> }) => {
            expect(input.prompt).toContain("Max mode is active");
            expect(input.prompt).toContain("solve hard task");
            await input.replayWinner("winner plan");
            return {
                winnerId: "candidate-2",
                reason: "best",
                overhead: { candidates: 5, promptChars: 10, resultChars: 20 },
            };
        });
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getModeOptions: () => ({ longHorizonEnabled: true, maxModeEnabled: true }),
            maxModeService: { run: maxRun } as never,
        });
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "solve hard task", mode: "max" });

        expect(maxRun).toHaveBeenCalledTimes(1);
        expect(sessions[0].prompt).toHaveBeenCalledWith("winner plan", undefined);
        expect(sessions[0].prompt).not.toHaveBeenCalledWith(expect.stringContaining("solve hard task"), undefined);
    });

    it("uses real temporary candidate and judge sessions for max mode when no runner is injected", async () => {
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getModeOptions: () => ({ longHorizonEnabled: true, maxModeEnabled: true, maxCandidates: 2 }),
        });
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "solve hard task", mode: "max" });

        expect(sessions).toHaveLength(4);
        expect(sessions[1].prompt).toHaveBeenCalledWith(expect.stringContaining("solve hard task"));
        expect(sessions[2].prompt).toHaveBeenCalledWith(expect.stringContaining("solve hard task"));
        expect(sessions[3].prompt).toHaveBeenCalledWith(expect.stringContaining("candidate-1"));
        expect(sessions[3].prompt).toHaveBeenCalledWith(expect.stringContaining("candidate-2"));
        expect(sessions[0].prompt).toHaveBeenCalledWith("longer candidate answer", undefined);
        expect(sessions[1].dispose).toHaveBeenCalled();
        expect(sessions[2].dispose).toHaveBeenCalled();
        expect(sessions[3].dispose).toHaveBeenCalled();
    });

    it("routes max candidate tool events through the approval interceptor in plan mode", async () => {
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getModeOptions: () => ({ longHorizonEnabled: true, maxModeEnabled: true, maxCandidates: 1 }),
        });
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        await registry.prompt({ agentId: agent.id, message: "solve hard task", mode: "max" });
        interceptorHandleMock.mockClear();

        await sessions[1].subscribers[0]?.({
            type: "tool_execution_start",
            toolName: "write",
            args: { path: "src/a.ts" },
            toolCallId: "tc1",
        });

        expect(interceptorHandleMock).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_execution_start" }));
        const candidateInterceptorDeps = vi.mocked(createApprovalInterceptor).mock.calls.find((call) =>
            String((call[1] as { getMode?: () => string }).getMode?.()) === "plan"
        );
        expect(candidateInterceptorDeps).toBeTruthy();
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
