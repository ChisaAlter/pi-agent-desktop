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
const sendPrompt = vi.fn<(_workspaceId: string, _message: string, _options?: unknown) => Promise<unknown>>(async () => undefined);
const stopPrompt = vi.fn<(_workspaceId: string) => Promise<unknown>>(async () => undefined);
const agentsPrompt = vi.fn(async () => undefined);
const agentsAbort = vi.fn(async () => undefined);
const agentsRuntimeState = vi.fn(async (agentId: string) => ({ agentId, status: "idle", isStreaming: false }));
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
            <button type="button" onClick={() => void state.startStreaming("ws1", "/execute_plan plan-probe.md", { visibleContent: "执行计划：plan-probe.md" })}>
                send-agent-execute-plan
            </button>
            <button type="button" onClick={() => void state.startStreaming("ws1", "你好?")}>
                send-agent-plan-greeting
            </button>
            <button
                type="button"
                onClick={() => void state.startStreaming("ws1", "请直接执行下面这份计划，不要重新生成计划。", {
                    visibleContent: "执行计划：plan-probe.md",
                    waitForAgentIdle: true,
                })}
            >
                send-agent-plan-execution-prompt
            </button>
            <button type="button" onClick={() => state.stopStreaming("ws1")}>
                stop-agent
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
    agentsAbort.mockReset();
    agentsAbort.mockResolvedValue(undefined);
    agentsRuntimeState.mockReset();
    agentsRuntimeState.mockResolvedValue({ agentId: "agent_1", status: "idle", isStreaming: false });
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
            agentsAbort,
            agentsRuntimeState,
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

    it("describes disabled permissions as host runtime enforcement rather than prompt enforcement", async () => {
        useSessionStore.setState((state) => ({
            sessions: state.sessions.map((session) => ({
                ...session,
                toolPermissions: {
                    fileRead: true,
                    fileWrite: false,
                    shell: false,
                    git: false,
                    network: false,
                    extensions: false,
                },
            })),
        }));

        await act(async () => { render(<HookStateHost />); });
        await act(async () => { screen.getByText("send-follow-up").click(); });

        const outbound = sendPrompt.mock.calls[0]?.[1] ?? "";
        expect(outbound).toContain("host runtime enforces");
        expect(outbound).toContain("This note only explains the enforced policy");
        expect(outbound).not.toContain("Do not use disabled capabilities");
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

    it("normalizes legacy id/name assistant toolcall payloads into canonical session tool calls", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_start",
                    id: "tc_legacy",
                    name: "read",
                    input: { path: "README.md" },
                },
            } as unknown as PiEvent);
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_end",
                    id: "tc_legacy",
                    output: "ok",
                },
            } as unknown as PiEvent);
        });

        const toolCalls = useSessionStore.getState().sessions[0].messages[0].toolCalls ?? [];
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]).toMatchObject({
            id: "tc_legacy",
            name: "read",
            input: { path: "README.md" },
            output: "ok",
            status: "completed",
        });
    });

    it("reads canonical SDK tool calls without logging the full partial event", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            await act(async () => {
                render(<HookHost />);
            });

            await act(async () => {
                emitPiEvent?.({ type: "agent_start" });
                emitPiEvent?.({
                    type: "message_update",
                    assistantMessageEvent: {
                        type: "toolcall_start",
                        contentIndex: 1,
                        partial: {
                            content: [
                                { type: "text", text: "准备读取" },
                                {
                                    type: "toolCall",
                                    id: "tc_sdk",
                                    name: "read",
                                    arguments: { path: "README.md" },
                                },
                            ],
                        },
                    },
                } as unknown as PiEvent);
                emitPiEvent?.({
                    type: "message_update",
                    assistantMessageEvent: {
                        type: "toolcall_end",
                        contentIndex: 1,
                        toolCall: {
                            type: "toolCall",
                            id: "tc_sdk",
                            name: "read",
                            arguments: { path: "README.md" },
                        },
                    },
                } as unknown as PiEvent);
            });

            const toolCalls = useSessionStore.getState().sessions[0].messages[0].toolCalls ?? [];
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0]).toMatchObject({
                id: "tc_sdk",
                name: "read",
                input: { path: "README.md" },
                status: "completed",
            });
            expect(warn.mock.calls.some(([message]) => String(message).includes("without canonical"))).toBe(false);
        } finally {
            warn.mockRestore();
        }
    });

    it("logs only compact metadata for a genuinely malformed tool event", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            await act(async () => {
                render(<HookHost />);
            });

            await act(async () => {
                emitPiEvent?.({ type: "agent_start" });
                emitPiEvent?.({
                    type: "message_update",
                    assistantMessageEvent: {
                        type: "toolcall_start",
                        contentIndex: 0,
                        partial: {
                            content: [{
                                type: "toolCall",
                                name: "read",
                                arguments: { payload: "x".repeat(10_000) },
                            }],
                        },
                    },
                } as unknown as PiEvent);
            });

            const call = warn.mock.calls.find(([message]) => String(message).includes("without canonical"));
            expect(call).toBeTruthy();
            expect(call?.[1]).not.toHaveProperty("partial");
            expect(JSON.stringify(call?.[1]).length).toBeLessThan(300);
        } finally {
            warn.mockRestore();
        }
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

    it("falls back to workspace stop when agentsAbort rejects", async () => {
        agentsAbort.mockRejectedValueOnce(new Error("agent missing"));
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            screen.getByText("stop-agent").click();
        });

        expect(agentsAbort).toHaveBeenCalledWith("agent_1");
        expect(stopPrompt).toHaveBeenCalledWith("ws1");
        expect(screen.getByTestId("agent-stream-error").textContent).toBe("");
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

    it("waits for the runtime to go idle before queueing execute-plan with follow-up behavior", async () => {
        agentsRuntimeState
            .mockResolvedValueOnce({ agentId: "agent_1", status: "running", isStreaming: true })
            .mockResolvedValueOnce({ agentId: "agent_1", status: "idle", isStreaming: false });

        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
        });

        await act(async () => {
            screen.getByText("send-agent-execute-plan").click();
        });

        for (let attempt = 0; attempt < 5 && agentsPrompt.mock.calls.length === 0; attempt += 1) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
        }

        expect(agentsRuntimeState).toHaveBeenCalledWith("agent_1");
        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: "/execute_plan plan-probe.md",
            mode: "build",
            streamingBehavior: "followUp",
        });
    });

    it("still waits for runtime idle when plan decision UI has already paused visible streaming", async () => {
        agentsRuntimeState
            .mockResolvedValueOnce({ agentId: "agent_1", status: "running", isStreaming: true })
            .mockResolvedValueOnce({ agentId: "agent_1", status: "idle", isStreaming: false });

        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
        });

        await act(async () => {
            usePlanStore.setState({
                activeCard: {
                    id: "plan_1",
                    title: "创建并验证 plan_probe.txt",
                    content: "1. 创建文件\n2. 验证存在",
                    filename: "plan-probe.md",
                    createdAt: Date.now(),
                },
            });
        });

        await act(async () => {
            screen.getByText("send-agent-execute-plan").click();
        });

        for (let attempt = 0; attempt < 5 && agentsPrompt.mock.calls.length === 0; attempt += 1) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
        }

        expect(agentsRuntimeState).toHaveBeenCalledWith("agent_1");
        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: "/execute_plan plan-probe.md",
            mode: "build",
            streamingBehavior: "followUp",
        });
    });

    it("waits for runtime idle before queueing a plan execution prompt triggered from chat UI", async () => {
        agentsRuntimeState
            .mockResolvedValueOnce({ agentId: "agent_1", status: "running", isStreaming: true })
            .mockResolvedValueOnce({ agentId: "agent_1", status: "idle", isStreaming: false });

        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            screen.getByText("send-agent-plan-execution-prompt").click();
        });

        for (let attempt = 0; attempt < 5 && agentsPrompt.mock.calls.length === 0; attempt += 1) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
        }

        expect(agentsRuntimeState).toHaveBeenCalledWith("agent_1");
        expect(agentsPrompt).toHaveBeenCalledWith({
            agentId: "agent_1",
            message: "请直接执行下面这份计划，不要重新生成计划。",
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

    it("mirrors session-bound agent assistant output into the linked chat session", async () => {
        useAgentStore.setState({
            agents: [
                {
                    id: "agent_1",
                    workspaceId: "ws1",
                    title: "Session Agent",
                    status: "idle",
                    sessionId: "s1",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            currentAgentId: "agent_1",
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: true,
        });

        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    content: [{ type: "text", text: "linked answer" }],
                },
            } as unknown as PiEvent);
        });

        const session = useSessionStore.getState().sessions[0];
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0]).toMatchObject({
            role: "assistant",
            content: "linked answer",
        });
    });

    it("writes usage updates into the linked chat session for session-bound agents", async () => {
        useAgentStore.setState({
            agents: [
                {
                    id: "agent_1",
                    workspaceId: "ws1",
                    title: "Session Agent",
                    status: "idle",
                    sessionId: "s1",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            currentAgentId: "agent_1",
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: true,
        });

        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "usage_update",
                usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            } as PiEvent);
        });

        expect(useSessionStore.getState().sessions[0]?.usage).toMatchObject({
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
        });
    });

    it("keeps writing usage updates to the active session turn even if the agent list briefly loses its session binding", async () => {
        useAgentStore.setState({
            agents: [
                {
                    id: "agent_1",
                    workspaceId: "ws1",
                    title: "Session Agent",
                    status: "idle",
                    sessionId: "s1",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            currentAgentId: "agent_1",
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: true,
        });

        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "linked answer",
                },
            } as PiEvent);
        });

        useAgentStore.setState({
            agents: [
                {
                    id: "agent_1",
                    workspaceId: "ws1",
                    title: "Session Agent",
                    status: "idle",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        });

        await act(async () => {
            emitPiEvent?.({
                type: "usage_update",
                usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            } as PiEvent);
        });

        expect(useSessionStore.getState().sessions[0]?.messages[0]).toMatchObject({
            role: "assistant",
            content: "linked answer",
        });
        expect(useSessionStore.getState().sessions[0]?.usage).toMatchObject({
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
        });
    });

    it("keeps agent-scoped custom messages out of the chat session but still syncs usage", async () => {
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
        expect(session.usage).toMatchObject({
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            compactionStatus: "completed",
        });
    });

    it("syncs agent usage from assistant message payloads when providers do not emit usage_update events", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    provider: "longcat",
                    model: "LongCat-2.0-Preview",
                    usage: {
                        input: 205,
                        output: 18,
                        totalTokens: 14559,
                    },
                },
            } as PiEvent);
        });

        expect(useSessionStore.getState().sessions[0]?.usage).toMatchObject({
            provider: "longcat",
            model: "LongCat-2.0-Preview",
            inputTokens: 205,
            outputTokens: 18,
            totalTokens: 14559,
        });
    });

    it("normalizes legacy custom_message cards into generated ui payloads", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "custom_message",
                card: {
                    id: "legacy-card",
                    kind: "file-actions",
                    title: "交付结果",
                    content: "已生成以下文件",
                    items: [{ id: "file-1", label: "report.md", path: "docs/report.md", status: "completed" }],
                    actions: [{ id: "copy", label: "复制", kind: "copy-text", value: "done" }],
                },
            } as PiEvent);
        });

        expect(useSessionStore.getState().sessions[0]?.messages[0]).toMatchObject({
            role: "assistant",
            generatedUi: expect.objectContaining({
                version: "v1",
                id: "legacy-card",
                title: "交付结果",
            }),
        });
        expect(useSessionStore.getState().sessions[0]?.messages[0]?.generatedUi?.sections).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "markdown" }),
                expect.objectContaining({ kind: "file_list" }),
                expect.objectContaining({ kind: "action_bar" }),
            ]),
        );
    });

    it("sanitizes explicit generated ui payloads from custom_message events", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "custom_message",
                ui: {
                    version: "v1",
                    id: "ui-explicit",
                    title: "运行状态",
                    sections: [
                        { id: "summary", kind: "summary", content: "已完成" },
                        { id: "ignored", kind: "panel", content: "should be dropped" },
                        {
                            id: "actions",
                            kind: "action_bar",
                            actions: [
                                { id: "copy", label: "复制", kind: "copy-text", value: "done" },
                                { id: "unsafe", label: "执行脚本", kind: "eval", value: "alert(1)" },
                            ],
                        },
                    ],
                },
            } as PiEvent);
        });

        const generatedUi = useSessionStore.getState().sessions[0]?.messages[0]?.generatedUi;
        expect(generatedUi).toMatchObject({
            version: "v1",
            id: "ui-explicit",
            title: "运行状态",
        });
        expect(generatedUi?.sections).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "summary" }),
                expect.objectContaining({
                    kind: "action_bar",
                    actions: [expect.objectContaining({ id: "copy", kind: "copy-text" })],
                }),
            ]),
        );
        expect(generatedUi?.sections).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: "panel" })]),
        );
        const actionSection = generatedUi?.sections.find((section) => section.kind === "action_bar");
        expect(actionSection && "actions" in actionSection ? actionSection.actions : []).toHaveLength(1);
    });

    it("does not let later zero-valued usage events wipe an already observed session usage snapshot", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    provider: "longcat",
                    model: "LongCat-2.0-Preview",
                    usage: {
                        input: 205,
                        output: 18,
                        totalTokens: 14559,
                    },
                },
            } as PiEvent);
            emitPiEvent?.({
                type: "usage_update",
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
            } as PiEvent);
        });

        expect(useSessionStore.getState().sessions[0]?.usage).toMatchObject({
            provider: "longcat",
            model: "LongCat-2.0-Preview",
            inputTokens: 205,
            outputTokens: 18,
            totalTokens: 14559,
        });
    });

    it("keeps the highest observed token totals when later agent events report a smaller snapshot", async () => {
        await act(async () => {
            render(<AgentHookStateHost />);
        });

        await act(async () => {
            emitPiEvent?.({
                type: "usage_update",
                usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
            } as PiEvent);
            emitPiEvent?.({
                type: "context_update",
                usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
            } as PiEvent);
        });

        expect(useSessionStore.getState().sessions[0]?.usage).toMatchObject({
            inputTokens: 500,
            outputTokens: 100,
            totalTokens: 600,
        });
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

    it("does not auto-complete a plan merely because agent_end arrived", async () => {
        usePlanStore.setState({
            activeExecution: {
                activePlanId: "plan_1",
                title: "执行计划",
                phase: "executing",
            },
            steps: [
                { id: "s1", text: "写入文件", status: "pending" },
            ],
            status: "executing",
        });

        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_end", messages: [] } as PiEvent);
        });

        expect(usePlanStore.getState().activeExecution?.phase).toBe("executing");
    });

    it("completes an executing plan only after the assistant emits the explicit completion sentinel", async () => {
        usePlanStore.setState({
            activeExecution: {
                activePlanId: "plan_2",
                title: "执行计划",
                phase: "executing",
            },
            steps: [
                { id: "s1", text: "创建文件", status: "pending" },
                { id: "s2", text: "验证结果", status: "pending" },
            ],
            status: "executing",
        });

        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_start" });
            emitPiEvent?.({
                type: "message_end",
                message: {
                    role: "assistant",
                    content: [{ type: "text", text: "[PLAN_DONE]\n\n全部完成。"}],
                },
            } as PiEvent);
        });

        expect(usePlanStore.getState().activeExecution?.phase).toBe("completed");
        expect(usePlanStore.getState().status).toBe("completed");
        expect(usePlanStore.getState().steps).toEqual([
            { id: "s1", text: "创建文件", status: "completed" },
            { id: "s2", text: "验证结果", status: "completed" },
        ]);
    });
});
