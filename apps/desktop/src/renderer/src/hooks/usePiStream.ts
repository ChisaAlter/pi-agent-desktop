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
import { isIpcError } from "@shared";
import { useSessionStore } from "../stores/session-store";
import { useApprovalStore } from "../stores/approval-store";

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

const HIGH_RISK_TOOLS = new Set(["bash", "write", "edit", "delete"]);

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

    const { getCurrentSession, addMessage, updateMessage } = useSessionStore();
    const approvalStore = useApprovalStore();

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
                // 新消息开始, 创建一个空 assistant 消息
                {
                    const session = useSessionStore.getState().getCurrentSession();
                    if (session) {
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
                    }
                }
                break;

            case "message_update": {
                const subtype = event.subtype;
                if (subtype === "text_delta") {
                    const delta = (event as { delta: string }).delta;
                    textRef.current += delta;
                    setCurrentText(textRef.current);
                    // 实时更新 session 里的最后一条消息
                    if (sessionIdRef.current && messageIdRef.current) {
                        updateMessage(sessionIdRef.current, messageIdRef.current, { content: textRef.current });
                    }
                } else if (subtype === "thinking_delta") {
                    const delta = (event as { delta: string }).delta;
                    thinkingRef.current += delta;
                    setCurrentThinking(thinkingRef.current);
                } else if (subtype === "toolcall_start") {
                    const e = event as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                    const tc: ToolCallState = {
                        id: e.toolCallId,
                        name: e.toolName,
                        args: e.args,
                        status: "running",
                        startTime: Date.now(),
                    };
                    toolCallsRef.current.set(e.toolCallId, tc);
                    setToolCalls(new Map(toolCallsRef.current));
                } else if (subtype === "toolcall_end") {
                    const e = event as { toolCallId: string; result?: unknown };
                    const tc = toolCallsRef.current.get(e.toolCallId);
                    if (tc) {
                        tc.status = "completed";
                        tc.result = e.result;
                        tc.endTime = Date.now();
                        toolCallsRef.current.set(e.toolCallId, tc);
                        setToolCalls(new Map(toolCallsRef.current));
                    }
                }
                break;
            }

            case "message_end":
                // 一条消息完成 — 已经在 text_delta 实时更新过了
                break;

            case "tool_execution_start": {
                const e = event as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                // 高危工具: 记录到审批 store
                if (HIGH_RISK_TOOLS.has(e.toolName)) {
                    const changeId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    approvalStore.addChange({
                        toolCallId: e.toolCallId,
                        toolName: e.toolName === "write" || e.toolName === "edit" ? e.toolName : "write",
                        filePath: (e.args?.path as string) ?? (e.args?.file_path as string) ?? "",
                    });
                    const tc = toolCallsRef.current.get(e.toolCallId);
                    if (tc) tc.approvalChangeId = changeId;
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
                }
                break;
            }

            case "turn_end":
                setIsStreaming(false);
                setStreamingMessageId(null);
                messageIdRef.current = null;
                break;

            case "agent_end":
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
    }, [addMessage, updateMessage, approvalStore]);

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
            await window.piAPI.sendPrompt(workspaceId, content);
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
