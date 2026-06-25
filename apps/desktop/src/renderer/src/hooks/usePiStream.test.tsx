// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";
import { usePiStream } from "./usePiStream";
import { useSessionStore } from "../stores/session-store";
import { usePlanStore } from "../stores/plan-store";
import { useAgentStore } from "../stores/agent-store";
import { useAgentModeStore } from "../stores/agent-mode-store";

let emitPiEvent: ((event: PiEvent) => void) | null = null;
const sendPrompt = vi.fn(async () => undefined);
const stopPrompt = vi.fn<(_workspaceId: string) => Promise<unknown>>(async () => undefined);
const agentsPrompt = vi.fn(async () => undefined);
const planSetEnabled = vi.fn(async () => undefined);

function HookHost(): null {
    usePiStream();
    return null;
}

function HookStateHost() {
    const state = usePiStream();
    return (
        <div>
            <div data-testid="stream-error">{state.error ?? ""}</div>
            <button type="button" onClick={() => void state.startStreaming("ws1", "follow up")}>
                send-follow-up
            </button>
            <button type="button" onClick={() => state.stopStreaming("ws1")}>
                stop
            </button>
        </div>
    );
}

function AgentHookStateHost() {
    const state = usePiStream("agent_1");
    return (
        <div>
            <div data-testid="agent-stream-error">{state.error ?? ""}</div>
            <button type="button" onClick={() => void state.startStreaming("ws1", "agent follow up")}>
                send-agent-follow-up
            </button>
            <button type="button" onClick={() => void state.startStreaming("ws1", "你好?")}>
                send-agent-plan-greeting
            </button>
        </div>
    );
}

function PlanHookStateHost() {
    const state = usePiStream();
    return (
        <div>
            <div data-testid="streaming">{String(state.isStreaming)}</div>
            <div data-testid="stream-error">{state.error ?? ""}</div>
            <button type="button" onClick={() => void state.startStreaming("ws1", "你好")}>
                send-plan-greeting
            </button>
            <button type="button" onClick={() => void state.startStreaming("ws1", "附加文件:\n@C:\\repo\\package.json\n\n用户消息:\n你好?")}>
                send-plan-greeting-with-attachment
            </button>
            <button type="button" onClick={() => void state.startStreaming("ws1", "为聊天输入框制定改版计划")}>
                send-plan-task
            </button>
            <button type="button" onClick={() => void state.startStreaming("ws1", "了解一下这个项目")}>
                send-short-plan-task
            </button>
            <button type="button" onClick={() => void state.startStreaming("ws1", [
                "/plan",
                "",
                "用户请求:",
                "了解一下这个项目",
                "",
                "要求:",
                "- 先只读探索当前项目的真实文件、入口、配置和测试结构。",
            ].join("\n"))}>
                send-prewrapped-plan-task
            </button>
        </div>
    );
}

beforeEach(() => {
    emitPiEvent = null;
    sendPrompt.mockClear();
    agentsPrompt.mockReset();
    agentsPrompt.mockResolvedValue(undefined);
    planSetEnabled.mockClear();
    stopPrompt.mockReset();
    stopPrompt.mockResolvedValue(undefined);
    (globalThis as { window: unknown }).window = {
        dispatchEvent: vi.fn(),
        // 2026-06-06 hotfix (T6): usePiStream 用 setTimeout/setInterval 防 debounce 卡住,
        // 测试 mock window 历来不包含定时器,补上
        setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
        clearTimeout: (id: number) => clearTimeout(id),
        setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
        clearInterval: (id: number) => clearInterval(id),
        piAPI: {
            getStatus: vi.fn(async () => ({
                installed: true,
                localVersion: "0.0.0",
                latestVersion: "0.0.0",
                updateAvailable: false,
                executablePath: "pi",
                installMethod: "test",
                configExists: true,
                defaultProvider: "test",
                defaultModel: "test",
            })),
            onEvent: vi.fn((cb: (event: PiEvent) => void) => {
                emitPiEvent = cb;
                return vi.fn();
            }),
            onAgentEvent: vi.fn((cb: (payload: { agentId: string; event: PiEvent }) => void) => {
                emitPiEvent = (event) => cb({ agentId: "agent_1", event });
                return vi.fn();
            }),
            sendPrompt,
            agentsPrompt,
            planSetEnabled,
            stop: stopPrompt,
            renameSession: vi.fn(async () => undefined),
        },
    };
    useSessionStore.setState({
        currentSessionId: "s1",
        sessions: [
            {
                id: "s1",
                title: "Session",
                workspaceId: "ws1",
                createdAt: new Date(0),
                updatedAt: new Date(0),
                messages: [],
            },
        ],
    });
    usePlanStore.setState({
        enabled: false,
        activeCard: null,
        decisionRequest: null,
        pendingPlanClarification: null,
        steps: [],
        status: "idle",
    });
    useAgentStore.setState({
        agents: [],
        currentAgentId: null,
        messagesByAgent: {},
        runtimeByAgent: {},
        initialized: false,
    });
    useAgentModeStore.setState({
        byWorkspace: {},
    });
});

describe("usePiStream", () => {
    it("passes the selected workspace agent mode to pi:send", async () => {
        useAgentModeStore.getState().setMode("ws1", "compose");

        await act(async () => {
            render(<HookStateHost />);
        });
        await act(async () => {
            screen.getByText("send-follow-up").click();
        });

        expect(sendPrompt).toHaveBeenCalledWith(
            "ws1",
            expect.stringContaining("follow up"),
            { mode: "compose" },
        );
    });

    it("passes the selected workspace agent mode to agent prompts", async () => {
        useAgentModeStore.getState().setMode("ws1", "compose");

        await act(async () => {
            render(<AgentHookStateHost />);
        });
        await act(async () => {
            screen.getByText("send-agent-follow-up").click();
        });

        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: expect.stringContaining("agent follow up"),
            mode: "compose",
        });
    });

    it("forwards selected Plan agent mode without local clarification", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");

        await act(async () => {
            render(<PlanHookStateHost />);
        });
        await act(async () => {
            screen.getByText("send-plan-greeting").click();
        });

        expect(sendPrompt).toHaveBeenCalledWith("ws1", "你好", { mode: "plan" });
        expect(usePlanStore.getState().pendingPlanClarification).toBeNull();
    });

    it("handles SDK message_update events emitted immediately after subscription", async () => {
        await act(async () => {
            render(<HookHost />);
        });
        expect(emitPiEvent).toBeTruthy();

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({ type: "message_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "你好",
                },
            });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0]).toMatchObject({
            role: "assistant",
            content: "你好",
        });
    });

    it("still handles legacy flattened message_update events", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({ type: "message_start" });
            emitPiEvent?.({
                type: "message_update",
                subtype: "text_delta",
                delta: "legacy",
            });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages[0]).toMatchObject({
            role: "assistant",
            content: "legacy",
        });
    });

    it("renders assistant text from SDK message_end content when no text_delta is emitted", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    content: [{ type: "text", text: "final answer" }],
                },
            } as unknown as PiEvent);
        });

        const messages = useAgentStore.getState().messagesByAgent.agent_1;
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            role: "assistant",
            content: "final answer",
        });
    });

    it("shows provider errors from SDK message_end instead of replacing them with a generic empty response", async () => {
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    provider: "longcat",
                    model: "LongCat-2.0-Preview",
                    content: [],
                    errorMessage: '403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
                },
            } as unknown as PiEvent);
            emitPiEvent?.({ type: "agent_end" });
        });

        expect(screen.getByTestId("stream-error").textContent).toContain("longcat / LongCat-2.0-Preview");
        expect(screen.getByTestId("stream-error").textContent).toContain("403");
        expect(screen.getByTestId("stream-error").textContent).not.toContain("Pi 本轮没有返回内容");
    });

    it("syncs SDK tool calls into the assistant message without a second assistant row", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_start",
                    toolCallId: "tc_1",
                    toolName: "read",
                    args: { path: "README.md" },
                },
            });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "读完了",
                },
            });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_end",
                    toolCallId: "tc_1",
                    result: "ok",
                },
            });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0]).toMatchObject({
            role: "assistant",
            content: "读完了",
        });
        expect(session.messages[0].toolCalls).toHaveLength(1);
        expect(session.messages[0].toolCalls?.[0]).toMatchObject({
            id: "tc_1",
            name: "read",
            input: { path: "README.md" },
            output: "ok",
            status: "completed",
        });
    });

    it("syncs execution-only tool events into the assistant message", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "tool_execution_start",
                toolCallId: "tc_exec",
                toolName: "bash",
                args: { command: "pwd" },
            });
            emitPiEvent?.({
                type: "tool_execution_end",
                toolCallId: "tc_exec",
                toolName: "bash",
                isError: false,
            });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0].toolCalls).toHaveLength(1);
        expect(session.messages[0].toolCalls?.[0]).toMatchObject({
            id: "tc_exec",
            name: "bash",
            input: { command: "pwd" },
            status: "completed",
        });
    });

    it("surfaces empty Pi turns as a visible error", async () => {
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({ type: "agent_end" });
        });

        expect(screen.getByTestId("stream-error").textContent).toContain("Pi 本轮没有返回内容");
    });

    it("surfaces extension errors with details and ends streaming", async () => {
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({ type: "extension_error", message: "扩展无法读取 package.json" } as PiEvent);
        });

        expect(screen.getByTestId("stream-error").textContent).toContain("扩展无法读取 package.json");
        expect((window.dispatchEvent as ReturnType<typeof vi.fn>).mock.calls.some((call) => {
            const event = call[0] as Event;
            return event.type === "pi:stream-end";
        })).toBe(true);
    });

    it("keeps a specific extension error when a later SDK abort message arrives", async () => {
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({ type: "extension_error", message: "Plan 模式禁止执行 write" } as PiEvent);
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    provider: "mimo",
                    model: "mimo-v2.5-pro",
                    errorMessage: "Request was aborted.",
                },
            } as PiEvent);
        });

        expect(screen.getByTestId("stream-error").textContent).toContain("Plan 模式禁止执行 write");
        expect(screen.getByTestId("stream-error").textContent).not.toContain("Request was aborted");
    });

    it("keeps a specific agent extension error when agentsPrompt rejects with abort", async () => {
        agentsPrompt.mockImplementationOnce(async () => {
            emitPiEvent?.({ type: "extension_error", message: "Plan 模式禁止执行 bash" } as PiEvent);
            throw new Error("Request was aborted.");
        });
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-agent-follow-up").click();
        });

        expect(screen.getByTestId("agent-stream-error").textContent).toContain("Plan 模式禁止执行 bash");
        expect(screen.getByTestId("agent-stream-error").textContent).not.toContain("Request was aborted");
    });

    it("shows stop IPC fallback instead of silently swallowing it", async () => {
        stopPrompt.mockResolvedValueOnce({
            __error: true,
            code: "PI_STOP_FAILED",
            fallback: "停止失败: agent is not running",
        });
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            screen.getByText("stop").click();
        });

        expect(stopPrompt).toHaveBeenCalledWith("ws1");
        expect(screen.getByTestId("stream-error").textContent).toContain("停止失败: agent is not running");
    });

    it("shows rejected stop errors instead of silently swallowing them", async () => {
        stopPrompt.mockRejectedValueOnce(new Error("transport closed"));
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            screen.getByText("stop").click();
        });

        expect(screen.getByTestId("stream-error").textContent).toContain("停止失败: transport closed");
    });

    it("sends follow-up while streaming without resetting the active assistant message", async () => {
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "partial",
                },
            });
        });

        await act(async () => {
            screen.getByText("send-follow-up").click();
        });

        await act(async () => {
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: " answer",
                },
            });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(sendPrompt).toHaveBeenCalledWith("ws1", "follow up", { mode: "build" });
        expect(session.messages).toHaveLength(2);
        expect(session.messages[0]).toMatchObject({ role: "assistant", content: "partial answer" });
        expect(session.messages[1]).toMatchObject({ role: "user", content: "follow up" });
        expect((window.dispatchEvent as ReturnType<typeof vi.fn>).mock.calls.filter((call) => {
            const event = call[0] as Event;
            return event.type === "pi:stream-start";
        })).toHaveLength(0);
    });

    it("queues agent follow-ups with explicit streaming behavior while streaming", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
        });

        await act(async () => {
            screen.getByText("send-agent-follow-up").click();
        });

        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: "agent follow up",
            mode: "build",
            streamingBehavior: "followUp",
        });
    });

    it("adds an optimistic agent user message before the main-process echo arrives", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-agent-follow-up").click();
        });

        expect(useAgentStore.getState().messagesByAgent.agent_1).toMatchObject([
            {
                agentId: "agent_1",
                role: "user",
                content: "agent follow up",
                meta: { optimistic: true },
            },
        ]);
        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: "agent follow up",
            mode: "build",
        });
    });

    it("does not persist agent-scoped custom messages or usage into the current chat session", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "usage_update",
                usage: { inputTokens: 10, outputTokens: 2 },
            } as PiEvent);
            emitPiEvent?.({
                type: "custom_message",
                card: {
                    id: "agent_card",
                    kind: "result-summary",
                    title: "Agent card",
                },
            } as PiEvent);
            emitPiEvent?.({ type: "compaction_start" } as PiEvent);
            emitPiEvent?.({ type: "compaction_end" } as PiEvent);
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages).toEqual([]);
        expect(session.usage).toBeUndefined();
    });

    it("forwards agent plan-mode input without local clarification", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-agent-plan-greeting").click();
        });

        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: "你好?",
            mode: "plan",
        });
        expect(usePlanStore.getState().pendingPlanClarification).toBeNull();
    });

    it("forwards plan-mode tasks verbatim instead of wrapping them into /plan prompts", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-task").click();
        });

        expect(sendPrompt).toHaveBeenCalledWith("ws1", "为聊天输入框制定改版计划", { mode: "plan" });
        expect(usePlanStore.getState().pendingPlanClarification).toBeNull();
    });

    it("does not swallow normal follow-ups while plan mode is enabled", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<HookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
        });

        await act(async () => {
            screen.getByText("send-follow-up").click();
        });

        expect(sendPrompt).toHaveBeenCalledWith("ws1", "follow up", { mode: "build" });
    });

    it("stops showing the current turn as thinking once a structured plan card arrives", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-task").click();
        });
        expect(screen.getByTestId("streaming").textContent).toBe("true");

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "thinking_delta",
                    delta: "正在制定计划",
                },
            });
            usePlanStore.getState().setCard({
                id: "plan_tool_1",
                title: "测试计划",
                content: "- 检查\n- 修改",
                createdAt: Date.now(),
            });
        });

        expect(usePlanStore.getState().activeCard?.title).toBe("测试计划");
        expect(screen.getByTestId("streaming").textContent).toBe("false");
    });

    it("does not synthesize fallback plan cards from assistant text on turn_end", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-task").click();
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: [
                        "实施计划：",
                        "1. 修改输入框",
                        "2. 跑测试",
                        "[DONE:1]",
                    ].join("\n"),
                },
            });
            emitPiEvent?.({ type: "turn_end" });
        });

        expect(usePlanStore.getState().activeCard).toBeNull();
        expect(usePlanStore.getState().decisionRequest).toBeNull();
    });

    it("forwards plan-mode greetings directly", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-greeting").click();
        });

        expect(sendPrompt).toHaveBeenCalledWith("ws1", "你好", { mode: "plan" });
        expect(usePlanStore.getState().pendingPlanClarification).toBeNull();
    });

    it("forwards plan-mode greetings with attachments without stripping the outbound prompt", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-greeting-with-attachment").click();
        });

        expect(sendPrompt).toHaveBeenCalledTimes(1);
        const [, outbound] = sendPrompt.mock.calls[0] as unknown as [string, string];
        expect(outbound).toContain("附加文件:");
        expect(outbound).toContain("用户消息:");
        expect(outbound).toContain("你好?");
    });

    it("forwards short project exploration requests verbatim in plan mode", async () => {
        useAgentModeStore.getState().setMode("ws1", "plan");
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-short-plan-task").click();
        });

        expect(sendPrompt).toHaveBeenCalledWith("ws1", "了解一下这个项目", { mode: "plan" });
        expect(usePlanStore.getState().pendingPlanClarification).toBeNull();
    });

    it("preserves text when duplicate agent_start arrives within the same turn", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "第一段",
                },
            });
            // Duplicate agent_start within same turn (isTurnActiveRef still true)
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "第二段",
                },
            });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0].content).toBe("第一段第二段");
    });

    it("correctly resets state when agent_start arrives after turn_end (new turn)", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "第一轮",
                },
            });
            emitPiEvent?.({ type: "turn_end" });
        });

        // After turn_end, isTurnActiveRef is false, so next agent_start should do full reset
        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "第二轮",
                },
            });
            emitPiEvent?.({ type: "agent_end" });
        });

        const session = useSessionStore.getState().sessions[0];
        // First turn's message should exist, and second turn should create a new message
        // because turn_end cleared messageIdRef (non-agent mode)
        expect(session.messages.length).toBeGreaterThanOrEqual(1);
        const lastMsg = session.messages[session.messages.length - 1];
        expect(lastMsg.content).toBe("第二轮");
    });

    it("supplements tool name when tool_execution_start arrives before toolcall_start", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            // tool_execution_start arrives first — creates minimal entry
            emitPiEvent?.({
                type: "tool_execution_start",
                toolCallId: "tc_race",
                toolName: "bash",
                args: { command: "ls" },
            });
            // toolcall_start arrives second — supplements the name
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_start",
                    toolCallId: "tc_race",
                    toolName: "bash",
                    args: { command: "ls" },
                },
            });
            emitPiEvent?.({
                type: "tool_execution_end",
                toolCallId: "tc_race",
                toolName: "bash",
                isError: false,
            });
            emitPiEvent?.({ type: "agent_end" });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages[0].toolCalls).toHaveLength(1);
        expect(session.messages[0].toolCalls?.[0]).toMatchObject({
            id: "tc_race",
            name: "bash",
            input: { command: "ls" },
            status: "completed",
        });
    });

    it("updates execution status when toolcall_start arrives before tool_execution_start", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            // toolcall_start arrives first — creates entry with name
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_start",
                    toolCallId: "tc_race2",
                    toolName: "read",
                    args: { path: "README.md" },
                },
            });
            // tool_execution_start arrives second — updates execution status
            emitPiEvent?.({
                type: "tool_execution_start",
                toolCallId: "tc_race2",
                toolName: "read",
                args: { path: "README.md" },
            });
            emitPiEvent?.({
                type: "tool_execution_end",
                toolCallId: "tc_race2",
                toolName: "read",
                isError: false,
            });
            emitPiEvent?.({ type: "agent_end" });
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages[0].toolCalls).toHaveLength(1);
        expect(session.messages[0].toolCalls?.[0]).toMatchObject({
            id: "tc_race2",
            name: "read",
            input: { path: "README.md" },
            status: "completed",
        });
    });
});
