// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";
import { usePiStream } from "./usePiStream";
import { useSessionStore } from "../stores/session-store";
import { usePlanStore } from "../stores/plan-store";
import { useAgentStore } from "../stores/agent-store";

let emitPiEvent: ((event: PiEvent) => void) | null = null;
const sendPrompt = vi.fn(async () => undefined);
const stopPrompt = vi.fn<(_workspaceId: string) => Promise<unknown>>(async () => undefined);
const agentsPrompt = vi.fn(async () => undefined);

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
        </div>
    );
}

beforeEach(() => {
    emitPiEvent = null;
    sendPrompt.mockClear();
    agentsPrompt.mockClear();
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
});

describe("usePiStream", () => {
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
        expect(sendPrompt).toHaveBeenCalledWith("ws1", "follow up");
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
            streamingBehavior: "followUp",
        });
    });

    it("shows vague agent plan-mode input locally when asking for a plan goal", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-agent-plan-greeting").click();
        });

        expect(agentsPrompt).not.toHaveBeenCalled();
        expect(usePlanStore.getState().pendingPlanClarification).toMatchObject({
            workspaceId: "ws1",
            originalContent: "你好?",
        });
        expect(useAgentStore.getState().messagesByAgent.agent_1?.at(0)).toMatchObject({
            role: "user",
            content: "你好?",
        });
        expect(useAgentStore.getState().messagesByAgent.agent_1?.at(1)).toMatchObject({
            role: "assistant",
            content: expect.stringContaining("计划模式需要目标"),
        });
    });

    it("sends a plan-mode prompt once with exactly one /plan prefix", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-task").click();
            screen.getByText("send-plan-task").click();
        });

        expect(sendPrompt).toHaveBeenCalledTimes(1);
        const [, outbound] = sendPrompt.mock.calls[0] as unknown as [string, string];
        expect(outbound).toMatch(/^\/plan\n/);
        expect((outbound.match(/^\/plan/gm) ?? [])).toHaveLength(1);
    });

    it("stops showing the current turn as thinking once a plan card is waiting for a decision", async () => {
        usePlanStore.setState({ enabled: true });
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
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_start",
                    toolCallId: "plan_tool_1",
                    toolName: "plan_write",
                    args: { title: "测试计划", content: "- 检查\n- 修改" },
                },
            });
        });

        expect(usePlanStore.getState().activeCard?.title).toBe("测试计划");
        expect(screen.getByTestId("streaming").textContent).toBe("false");
    });

    it("does not create an executable fallback plan card for a generic plan-mode greeting response", async () => {
        usePlanStore.setState({ enabled: true });
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
                        "<think>用户只是问候，不应创建计划卡</think>",
                        "你好。关于 /plan，它通常用于规划任务。",
                        "新功能设计 -> 拆解任务、识别依赖、制定里程碑。",
                        "请告诉我你的目标。",
                    ].join("\n"),
                },
            });
            emitPiEvent?.({ type: "turn_end" });
        });

        expect(usePlanStore.getState().activeCard).toBeNull();
        expect(usePlanStore.getState().decisionRequest).toBeNull();
    });

    it("asks for a plan goal instead of sending vague plan-mode greetings to Pi", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-greeting").click();
        });

        expect(sendPrompt).not.toHaveBeenCalled();
        expect(usePlanStore.getState().pendingPlanClarification).toMatchObject({
            workspaceId: "ws1",
            originalContent: "你好",
        });
        expect(useSessionStore.getState().sessions[0].messages.at(-1)).toMatchObject({
            role: "assistant",
            content: expect.stringContaining("计划模式需要目标"),
        });
        expect(screen.getByTestId("streaming").textContent).toBe("false");
    });

    it("asks for a plan goal for vague plan-mode greetings even when attachments add a prefix", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-plan-greeting-with-attachment").click();
        });

        expect(sendPrompt).not.toHaveBeenCalled();
        expect(usePlanStore.getState().pendingPlanClarification).toMatchObject({
            workspaceId: "ws1",
            originalContent: expect.stringContaining("用户消息:"),
        });
        expect(screen.getByTestId("streaming").textContent).toBe("false");
    });

    it("asks for a plan goal for short project exploration requests", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-short-plan-task").click();
        });

        expect(usePlanStore.getState().decisionRequest).toBeNull();
        expect(usePlanStore.getState().pendingPlanClarification).toMatchObject({
            originalContent: "了解一下这个项目",
        });
        expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("sends the next plan-mode message as clarification without asking again", async () => {
        usePlanStore.setState({ enabled: true });
        await act(async () => {
            render(<PlanHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-short-plan-task").click();
        });
        sendPrompt.mockClear();

        await act(async () => {
            screen.getByText("send-plan-task").click();
        });

        expect(usePlanStore.getState().pendingPlanClarification).toBeNull();
        expect(sendPrompt).toHaveBeenCalledTimes(1);
        const [, outbound] = sendPrompt.mock.calls[0] as unknown as [string, string];
        expect(outbound).toMatch(/^\/plan\n/);
        expect(outbound).toContain("原始请求:");
        expect(outbound).toContain("了解一下这个项目");
        expect(outbound).toContain("补充目标:");
        expect(outbound).toContain("为聊天输入框制定改版计划");
    });
});
