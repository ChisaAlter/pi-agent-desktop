// @vitest-environment jsdom
//
// 2026-06-06 hotfix (T6): usePiStream debounce + flush
//   - text_delta 高频不写盘
//   - 500ms debounce 合并
//   - turn_end 强制 flush
//   - flush 调用一次 piAPI.updateMessage,带累积 content/thinking/toolCalls

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";
import { usePiStream } from "./usePiStream";
import { useSessionStore } from "../stores/session-store";

let emitPiEvent: ((event: PiEvent) => void) | null = null;
let animationFrameCallbacks: FrameRequestCallback[] = [];
const appendMessageMock = vi.fn(async (..._args: unknown[]) => undefined);
const updateMessageMock = vi.fn(async (..._args: unknown[]) => undefined);
const updateToolCallMock = vi.fn(async (..._args: unknown[]) => undefined);

function HookHost(): React.JSX.Element {
    const stream = usePiStream();
    return <div data-testid="current-text">{stream.currentText}</div>;
}

beforeEach(() => {
    vi.useFakeTimers();
    emitPiEvent = null;
    animationFrameCallbacks = [];
    appendMessageMock.mockClear();
    updateMessageMock.mockClear();
    updateToolCallMock.mockClear();
    (globalThis as { window: unknown }).window = {
        dispatchEvent: vi.fn(),
        // 2026-06-06 hotfix (T6): usePiStream 用 setTimeout/setInterval 防 debounce 卡住,
        // 测试 mock window 历来不包含定时器,补上
        setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
        clearTimeout: (id: number) => clearTimeout(id),
        setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
        clearInterval: (id: number) => clearInterval(id),
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
            animationFrameCallbacks.push(callback);
            return animationFrameCallbacks.length;
        }),
        cancelAnimationFrame: vi.fn(),
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
            appendMessage: appendMessageMock,
            updateMessage: updateMessageMock,
            updateToolCall: updateToolCallMock,
        },
    };
    useSessionStore.setState({
        sessions: [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "test",
                createdAt: new Date(),
                updatedAt: new Date(),
                messages: [],
            },
        ],
        currentSessionId: "s1",
        persistErrorCount: 0,
        lastPersistError: null,
    });
});

afterEach(() => {
    vi.useRealTimers();
});

// 构造一个 fake PiEvent 对象的 helper(用类型断言,避免到处写 as any)
function fakeEvent<T extends PiEvent>(evt: T): PiEvent {
    return evt;
}

describe("usePiStream (T6) — debounce + flush", () => {
    it("同一动画帧内的多个 delta 只产生一次可见更新", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            for (const delta of ["a", "b", "c"]) {
                emitPiEvent?.(fakeEvent({
                    type: "message_update",
                    assistantMessageEvent: { type: "text_delta", delta },
                }));
            }
        });

        expect(screen.getByTestId("current-text").textContent).toBe("");
        expect(useSessionStore.getState().sessions[0]?.messages.at(-1)?.content).toBe("");
        expect(animationFrameCallbacks).toHaveLength(1);

        await act(async () => {
            animationFrameCallbacks.shift()?.(16);
        });

        expect(screen.getByTestId("current-text").textContent).toBe("abc");
        expect(useSessionStore.getState().sessions[0]?.messages.at(-1)?.content).toBe("abc");
    });

    it("100 个 text_delta 在 500ms 内只触发 1 次 updateMessage IPC", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        // 触发流: agent_start → 第一个 text_delta 触发 ensureAssistantMessage
        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            for (let i = 0; i < 100; i++) {
                emitPiEvent?.(fakeEvent({
                    type: "message_update",
                    assistantMessageEvent: { type: "text_delta", delta: "a" },
                }));
            }
        });

        // 立刻: updateMessage 还没调(debounce 还没到)
        expect(updateMessageMock).not.toHaveBeenCalled();

        // 500ms 后: debounce flush
        await act(async () => {
            vi.advanceTimersByTime(500);
        });

        // 整个流应该只 1 次 IPC updateMessage
        expect(updateMessageMock).toHaveBeenCalledTimes(1);
        // 内容应该是累积的 100 个 'a'
        const arg = updateMessageMock.mock.calls[0]?.[2] as { content: string };
        expect(arg.content.length).toBe(100);
    });

    it("text_delta + thinking_delta 合并到 1 次 updateMessage(带 content + thinking)", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "thinking_delta", delta: "think1" },
            }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "hi" },
            }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: " world" },
            }));
        });

        await act(async () => {
            vi.advanceTimersByTime(500);
        });

        expect(updateMessageMock).toHaveBeenCalledTimes(1);
        const arg = updateMessageMock.mock.calls[0]?.[2] as { content: string; thinking: string };
        expect(arg.content).toBe("hi world");
        expect(arg.thinking).toBe("think1");
    });

    it("turn_end 强制 flush(不等 debounce)", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "early" },
            }));
        });

        // 还没到 500ms,但 turn_end 触发
        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "turn_end" }));
        });

        expect(screen.getByTestId("current-text").textContent).toBe("early");
        expect(useSessionStore.getState().sessions[0]?.messages.at(-1)?.content).toBe("early");
        expect(updateMessageMock).toHaveBeenCalledTimes(1);
        const arg = updateMessageMock.mock.calls[0]?.[2] as { content: string };
        expect(arg.content).toBe("early");
    });

    it("agent_end 兜底 flush(防止 turn_end 漏触发)", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "x" },
            }));
        });

        await act(async () => {
            // 跳过 turn_end,直接 agent_end
            emitPiEvent?.(fakeEvent({ type: "agent_end" }));
        });

        expect(updateMessageMock).toHaveBeenCalledTimes(1);
    });

    it("agent_end 直接 flush 时带上最新 toolCalls 快照", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "tool_execution_start",
                toolCallId: "tc_agent_end",
                toolName: "bash",
                args: { command: "pwd" },
            }));
            emitPiEvent?.(fakeEvent({
                type: "tool_execution_end",
                toolCallId: "tc_agent_end",
                toolName: "bash",
                isError: false,
            }));
            emitPiEvent?.(fakeEvent({ type: "agent_end" }));
        });

        expect(updateMessageMock).toHaveBeenCalledTimes(1);
        const arg = updateMessageMock.mock.calls[0]?.[2] as { toolCalls?: Array<{ id: string; status: string }> };
        expect(arg.toolCalls).toHaveLength(1);
        expect(arg.toolCalls?.[0]).toMatchObject({ id: "tc_agent_end", status: "completed" });
    });

    it("flush 前会净化 store 中的 legacy toolCalls，并丢弃不完整项", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "sanitize" },
            }));
        });

        useSessionStore.setState((state) => ({
            sessions: state.sessions.map((session) => (
                session.id === "s1"
                    ? {
                        ...session,
                        messages: session.messages.map((message) => (
                            message.role === "assistant"
                                ? {
                                    ...message,
                                    toolCalls: [
                                        {
                                            toolCallId: "tc_legacy",
                                            toolName: "bash",
                                            args: { command: "pwd" },
                                            status: "completed",
                                        },
                                        {
                                            toolName: "missing-id",
                                            status: "running",
                                        },
                                    ] as unknown as typeof message.toolCalls,
                                }
                                : message
                        )),
                    }
                    : session
            )),
        }));

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "turn_end" }));
        });

        const payload = updateMessageMock.mock.calls[0]?.[2] as {
            toolCalls?: Array<{ id: string; name: string; input?: unknown; status: string }>;
        };
        expect(payload.toolCalls).toEqual([
            {
                id: "tc_legacy",
                name: "bash",
                input: { command: "pwd" },
                status: "completed",
            },
        ]);
    });

    it("flush 失败 → 累加 persistErrorCount(不抛)", async () => {
        updateMessageMock.mockRejectedValueOnce(new Error("disk full"));

        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "x" },
            }));
            emitPiEvent?.(fakeEvent({ type: "turn_end" }));
        });

        // 让 promise 链 resolve
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toContain("disk full");
    });

    it("5s hard timeout: 长时间没新事件但还有 pending,也强制 flush", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "orphan" },
            }));
        });

        // 不到 500ms,先确认没调
        await act(async () => {
            vi.advanceTimersByTime(400);
        });
        expect(updateMessageMock).not.toHaveBeenCalled();

        // 推到 5s 边界 — 触发 hard timeout (内部 setInterval 每秒检查)
        // interval 设的是 1000ms, 触发条件: now - lastEventAt >= 5000ms
        await act(async () => {
            vi.advanceTimersByTime(6000);
        });

        expect(updateMessageMock).toHaveBeenCalledTimes(1);
    });

    it("连续多 turn,turn 1 flush 后 turn 2 不污染 turn 1 的内容", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        // Turn 1
        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            emitPiEvent?.(fakeEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "T1" },
            }));
            emitPiEvent?.(fakeEvent({ type: "turn_end" }));
        });
        // turn 1 flush
        expect(updateMessageMock).toHaveBeenCalledTimes(1);

        // Turn 2
        await act(async () => {
            emitPiEvent?.(fakeEvent({ type: "agent_start" }));
            // 注意: 没有 text_delta, 直接 turn_end
            // 这次不应该有新的 updateMessage 调用,因为没有累积内容
            emitPiEvent?.(fakeEvent({ type: "turn_end" }));
        });

        // turn 2 没累积 → 不应该调 updateMessage
        expect(updateMessageMock).toHaveBeenCalledTimes(1);
    });
});
