// usePiStream Hook (M7-2 重写)
// 管理 Pi 流式状态 — 监听 @shared/events 的新事件类型
//
// 责任:
// 1. 订阅 window.piAPI.onEvent 拿 PiEvent
// 2. 把 PiEvent 流式累积成本地状态 (currentText, currentThinking, toolCalls)
// 3. turn_end / agent_end 时把累积内容写到 session-store 的最后一条 assistant 消息
// 4. tool_execution_start 转发给 approval-store (M1 高危拦截)
// 5. 暴露 startStreaming / stopStreaming 给 UI

import { useCallback, useEffect, useRef, useState } from "react";
import type { PiEvent } from "@shared/events";
import { isIpcError, type PlanCard } from "@shared";
import { useSessionStore } from "../stores/session-store";
import { usePlanStore } from "../stores/plan-store";

export interface ToolCallState {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: "pending" | "running" | "completed" | "error";
    result?: unknown;
    startTime: number;
    endTime?: number;
    approvalChangeId?: string;
}

export interface PiStreamState {
    isStreaming: boolean;
    currentThinking: string;
    currentText: string;
    toolCalls: Map<string, ToolCallState>;
    error: string | null;
    isConnected: boolean;
    streamingMessageId: string | null;
}

export interface UsePiStreamReturn extends PiStreamState {
    startStreaming: (workspaceId: string, content: string) => Promise<void>;
    stopStreaming: () => void;
    clearError: () => void;
}

type AssistantMessageEvent =
    | { type: "text_delta"; delta: string }
    | { type: "thinking_delta"; delta: string }
    | { type: "toolcall_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
    | { type: "toolcall_end"; toolCallId: string; result?: unknown }
    | { type: string; [key: string]: unknown };

function getAssistantMessageEvent(event: PiEvent): AssistantMessageEvent | null {
    if (event.type !== "message_update") return null;

    const nested = (event as { assistantMessageEvent?: unknown }).assistantMessageEvent;
    if (nested && typeof nested === "object" && typeof (nested as { type?: unknown }).type === "string") {
        return nested as AssistantMessageEvent;
    }

    const subtype = (event as { subtype?: unknown }).subtype;
    if (typeof subtype === "string") {
        return { ...(event as unknown as Record<string, unknown>), type: subtype } as AssistantMessageEvent;
    }

    return null;
}

function createFallbackPlanCard(content: string): PlanCard | null {
    const text = content.trim();
    if (!text) return null;

    const hasPlanShape = /(^|\n)\s*(?:#+\s*)?计划[：:\s]/.test(text) ||
        /(^|\n)\s*(?:步骤|Step)\s*\d+\s*[：:.]/i.test(text) ||
        /(^|\n)\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?(?:.+)/.test(text);
    const hasExecutionIntent = /执行计划|execute_plan|implementation plan|test plan|方案|步骤/i.test(text);
    if (!hasPlanShape || !hasExecutionIntent) return null;

    const titleLine = text
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^#+\s*/, ""))
        .find((line) => line.length > 0 && /计划|plan/i.test(line));
    const title = titleLine?.replace(/^计划[：:\s]*/, "").trim() || "计划";

    return {
        id: `fallback_plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        content: text,
        createdAt: Date.now(),
    };
}

export function usePiStream(): UsePiStreamReturn {
    const [isStreaming, setIsStreaming] = useState(false);
    const [currentThinking, setCurrentThinking] = useState("");
    const [currentText, setCurrentText] = useState("");
    const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

    // Refs 避免 stale closure
    const textRef = useRef("");
    const thinkingRef = useRef("");
    const toolCallsRef = useRef(new Map<string, ToolCallState>());
    const messageIdRef = useRef<string | null>(null);
    const sessionIdRef = useRef<string | null>(null);

    const { getCurrentSession, addMessage, updateMessage, addToolCall, updateToolCall } = useSessionStore();
    const ensureAssistantMessage = useCallback(() => {
        if (sessionIdRef.current && messageIdRef.current) return;
        const session = useSessionStore.getState().getCurrentSession();
        if (!session) return;
        sessionIdRef.current = session.id;
        const newId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        messageIdRef.current = newId;
        setStreamingMessageId(newId);
        addMessage(session.id, {
            id: newId,
            role: "assistant",
            content: "",
            timestamp: new Date(),
        });
    }, [addMessage]);

    // ── 连接状态 ────────────────────────────────────────────────────────────
    // v1.0.17: 初次检测 + 每 30 秒心跳重检，断了自动设为 false
    useEffect(() => {
        if (!window.piAPI) return;

        const check = (): void => {
            void window.piAPI.getStatus()
                .then((s) => {
                    // v1.0.8: getStatus 可能返 IpcError, 此时 Pi 未就绪 → not connected
                    if (isIpcError(s)) setIsConnected(false);
                    else setIsConnected(s.installed);
                })
                .catch(() => setIsConnected(false));
        };

        check();
        const id = setInterval(check, 30000);
        return () => clearInterval(id);
    }, []);

    // ── 事件订阅 ────────────────────────────────────────────────────────────
    // mount-only: handleEvent 在后面定义, 用 ref 在 useEffect 前 hold 引用.
    // ref 类型是 ((event: PiEvent) => void) | null, 每次 render 同步到 current.
    const handleEventRef = useRef<((event: PiEvent) => void) | null>(null);
    useEffect(() => {
        if (!window.piAPI?.onEvent) return;
        const unsub = window.piAPI.onEvent((event: PiEvent) => {
            handleEventRef.current?.(event);
        });
        return () => {
            if (typeof unsub === "function") unsub();
        };
    }, []);

    // ── 事件处理 ────────────────────────────────────────────────────────────
    const handleEvent = useCallback((event: PiEvent) => {
        switch (event.type) {
            case "agent_start":
                setIsStreaming(true);
                setError(null);
                setCurrentText("");
                setCurrentThinking("");
                textRef.current = "";
                thinkingRef.current = "";
                toolCallsRef.current = new Map();
                setToolCalls(new Map());
                break;

            case "message_start":
                // Pi can emit repeated/empty message_start events. Create the assistant row lazily on first content.
                break;

            case "message_update": {
                const assistantEvent = getAssistantMessageEvent(event);
                if (!assistantEvent) break;

                if (assistantEvent.type === "text_delta") {
                    const delta = assistantEvent.delta;
                    ensureAssistantMessage();
                    textRef.current += delta;
                    setCurrentText(textRef.current);
                    // 实时更新 session 里的最后一条消息
                    if (sessionIdRef.current && messageIdRef.current) {
                        updateMessage(sessionIdRef.current, messageIdRef.current, { content: textRef.current });
                    }
                } else if (assistantEvent.type === "thinking_delta") {
                    const delta = assistantEvent.delta;
                    ensureAssistantMessage();
                    thinkingRef.current += delta;
                    setCurrentThinking(thinkingRef.current);
                    if (sessionIdRef.current && messageIdRef.current) {
                        updateMessage(sessionIdRef.current, messageIdRef.current, { thinking: thinkingRef.current });
                    }
                } else if (assistantEvent.type === "toolcall_start") {
                    const e = assistantEvent as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                    ensureAssistantMessage();
                    if (e.toolName === "plan_write") {
                        const title = typeof e.args.title === "string" ? e.args.title : "计划";
                        const content = typeof e.args.content === "string" ? e.args.content : "";
                        usePlanStore.getState().setCard({
                            id: e.toolCallId,
                            title,
                            content,
                            filename: typeof e.args.filename === "string" ? e.args.filename : undefined,
                            createdAt: Date.now(),
                        });
                    }
                    const tc: ToolCallState = {
                        id: e.toolCallId,
                        name: e.toolName,
                        args: e.args,
                        status: "running",
                        startTime: Date.now(),
                    };
                    toolCallsRef.current.set(e.toolCallId, tc);
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        addToolCall(sessionIdRef.current, messageIdRef.current, {
                            id: e.toolCallId,
                            name: e.toolName,
                            input: e.args,
                            status: "running",
                            startTime: new Date(tc.startTime),
                        });
                    }
                } else if (assistantEvent.type === "toolcall_end") {
                    const e = assistantEvent as { toolCallId: string; result?: unknown };
                    const tc = toolCallsRef.current.get(e.toolCallId);
                    if (tc) {
                        tc.status = "completed";
                        tc.result = e.result;
                        tc.endTime = Date.now();
                        toolCallsRef.current.set(e.toolCallId, tc);
                        setToolCalls(new Map(toolCallsRef.current));
                        if (sessionIdRef.current && messageIdRef.current) {
                            updateToolCall(sessionIdRef.current, messageIdRef.current, e.toolCallId, {
                                status: "completed",
                                output: e.result,
                                endTime: new Date(tc.endTime),
                            });
                        }
                    }
                }
                break;
            }

            case "message_end":
                // 一条消息完成 — 已经在 text_delta 实时更新过了
                break;

            case "tool_execution_start": {
                const e = event as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                ensureAssistantMessage();
                if (e.toolName === "plan_write") {
                    const title = typeof e.args?.title === "string" ? e.args.title : "计划";
                    const content = typeof e.args?.content === "string" ? e.args.content : "";
                    usePlanStore.getState().setCard({
                        id: e.toolCallId,
                        title,
                        content,
                        filename: typeof e.args?.filename === "string" ? e.args.filename : undefined,
                        createdAt: Date.now(),
                    });
                }
                if (!toolCallsRef.current.has(e.toolCallId)) {
                    const tc: ToolCallState = {
                        id: e.toolCallId,
                        name: e.toolName,
                        args: e.args,
                        status: "running",
                        startTime: Date.now(),
                    };
                    toolCallsRef.current.set(e.toolCallId, tc);
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        addToolCall(sessionIdRef.current, messageIdRef.current, {
                            id: e.toolCallId,
                            name: e.toolName,
                            input: e.args,
                            status: "running",
                            startTime: new Date(tc.startTime),
                        });
                    }
                }
                break;
            }

            case "tool_execution_end": {
                const e = event as { toolCallId: string; isError: boolean };
                const tc = toolCallsRef.current.get(e.toolCallId);
                if (tc) {
                    tc.status = e.isError ? "error" : "completed";
                    tc.endTime = Date.now();
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        updateToolCall(sessionIdRef.current, messageIdRef.current, e.toolCallId, {
                            status: e.isError ? "error" : "completed",
                            endTime: new Date(tc.endTime),
                        });
                    }
                }
                break;
            }

            case "turn_end":
                if (textRef.current) {
                    const planStore = usePlanStore.getState();
                    if (planStore.enabled && !planStore.activeCard) {
                        const fallbackCard = createFallbackPlanCard(textRef.current);
                        if (fallbackCard) {
                            planStore.setCard(fallbackCard);
                        }
                    }
                    usePlanStore.getState().applyDoneMarkers(textRef.current);
                }
                setIsStreaming(false);
                setStreamingMessageId(null);
                messageIdRef.current = null;
                break;

            case "agent_end":
                if (
                    !textRef.current &&
                    !thinkingRef.current &&
                    toolCallsRef.current.size === 0 &&
                    !usePlanStore.getState().activeCard
                ) {
                    setError("Pi 本轮没有返回内容，请检查模型/API Key 配置后重试。");
                }
                setIsStreaming(false);
                setStreamingMessageId(null);
                messageIdRef.current = null;
                // v1.0.17: 通知 useTaskProgress agent 结束
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
                break;

            case "extension_error":
                setError("Pi 扩展错误");
                break;
        }
    }, [updateMessage, addToolCall, updateToolCall, ensureAssistantMessage]);

    useEffect(() => {
        handleEventRef.current = handleEvent;
    }, [handleEvent]);

    // ── 动作 ────────────────────────────────────────────────────────────────
    const startStreaming = useCallback(async (workspaceId: string, content: string) => {
        if (!window.piAPI) {
            setError("piAPI 不可用");
            return;
        }
        if (!content.trim()) return;
        setIsStreaming(true);
        setError(null);
        textRef.current = "";
        thinkingRef.current = "";
        toolCallsRef.current = new Map();
        setCurrentText("");
        setCurrentThinking("");
        setToolCalls(new Map());

        // v1.0.17: 通知 useTaskProgress 流式开始
        window.dispatchEvent(new CustomEvent("pi:stream-start"));

        // 用户消息
        const session = getCurrentSession();
        if (session) {
            sessionIdRef.current = session.id;
            addMessage(session.id, {
                id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: "user",
                content,
                timestamp: new Date(),
            });
        }

        try {
            const outbound = usePlanStore.getState().enabled && !content.trimStart().startsWith("/")
                ? `/plan\n${content}`
                : content;
            const result = await window.piAPI.sendPrompt(workspaceId, outbound);
            if (isIpcError(result)) {
                setError(result.fallback);
                setIsStreaming(false);
                setStreamingMessageId(null);
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
            }
        } catch (err) {
            setError(String(err));
            setIsStreaming(false);
            // v1.0.17: 通知 useTaskProgress 流式异常结束
            window.dispatchEvent(new CustomEvent("pi:stream-end"));
        }
    }, [getCurrentSession, addMessage]);

    const stopStreaming = useCallback(() => {
        if (!window.piAPI) return;
        try {
            void window.piAPI.stop();
        } catch {
            // ignore
        }
        setIsStreaming(false);
        // v1.0.17: 通知 useTaskProgress 流式结束
        window.dispatchEvent(new CustomEvent("pi:stream-end"));
    }, []);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        isStreaming,
        currentThinking,
        currentText,
        toolCalls,
        error,
        isConnected,
        streamingMessageId,
        startStreaming,
        stopStreaming,
        clearError,
    };
}
