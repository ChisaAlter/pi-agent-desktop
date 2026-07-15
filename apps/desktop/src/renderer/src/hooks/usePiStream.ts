// usePiStream Hook (M7-2 重写)
// 管理 Pi 流式状态 — 监听 @shared/events 的新事件类型
//
// 责任:
// 1. 订阅 window.piAPI.onEvent 拿 PiEvent
// 2. 把 PiEvent 流式累积成本地状态 (currentText, currentThinking, toolCalls)
// 3. turn_end / agent_end 时把累积内容写到 session-store 的最后一条 assistant 消息
// 4. tool_execution_start 转发给 approval-store (M1 高危拦截)
// 5. 暴露 startStreaming / stopStreaming 给 UI
//
// Persistence: debounce + flush
//  - text_delta / thinking_delta / toolcall_* 事件不再每次都 fire-and-forget IPC
//  - 累积到一个 ref, 500ms debounce, 调 window.piAPI.updateMessage 一次
//  - turn_end / agent_end 强制 flush
//  - store action 调用传 { persist: false } 跳过 fire-and-forget

import { useCallback, useEffect, useRef, useState } from "react";
import type { PiEvent } from "@shared/events";
import {
    isIpcError,
    type SessionUsageSnapshot,
    type ToolCall,
} from "@shared";
import { useSessionStore } from "../stores/session-store";
import { usePlanStore } from "../stores/plan-store";
import { useSettingsStore } from "../stores/settings-store";
import { useAgentModeStore } from "../stores/agent-mode-store";
import { logger } from "../utils/logger";
import { useAgentStore } from "../stores/agent-store";
import { addToast } from "../stores/toast-store";
import { i18n } from "../i18n";
import { playCompleteSound } from "../utils/sounds";
import { notifyTaskComplete, canNotify } from "../utils/notifications";
import { normalizeGeneratedUi } from "../utils/generated-ui";
import { requestRunControlStop } from "../utils/run-control";
import {
    normalizeToolCallsForPersistence,
    readToolCallId,
    readToolCallInput,
    readToolCallIsError,
    readToolCallName,
    readToolCallOutput,
} from "../utils/tool-call";

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
    startStreaming: (workspaceId: string, content: string, options?: StartStreamingOptions) => Promise<void>;
    stopStreaming: (workspaceId: string) => void;
    clearError: () => void;
}

export interface StartStreamingOptions {
    visibleContent?: string;
    agentId?: string;
    waitForAgentIdle?: boolean;
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

function summarizeToolCallEvent(event: AssistantMessageEvent): Record<string, unknown> {
    const record = event as Record<string, unknown>;
    const summary: Record<string, unknown> = { type: event.type };
    if (typeof record.contentIndex === "number") {
        summary.contentIndex = record.contentIndex;
    }
    summary.hasToolCall = Boolean(record.toolCall);
    const partial = record.partial;
    if (partial && typeof partial === "object" && !Array.isArray(partial)) {
        const content = (partial as Record<string, unknown>).content;
        if (Array.isArray(content)) summary.partialContentCount = content.length;
    }
    return summary;
}


function readToolExecutionProgress(event: PiEvent): unknown {
    const partialResult = (event as { partialResult?: unknown }).partialResult;
    if (!partialResult || typeof partialResult !== "object" || Array.isArray(partialResult)) {
        return partialResult;
    }
    const content = (partialResult as { content?: unknown }).content;
    if (!Array.isArray(content)) return partialResult;
    const text = content
        .flatMap((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
            ? [(item as { text: string }).text]
            : [])
        .join("\n")
        .trim();
    return text || partialResult;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function maxDefined(current?: number, next?: number): number | undefined {
    if (next === undefined) return current;
    if (current === undefined) return next;
    return Math.max(current, next);
}

function mergeUsageSnapshot(
    current: SessionUsageSnapshot | undefined,
    incoming: Partial<SessionUsageSnapshot>,
): SessionUsageSnapshot {
    const inputTokens = maxDefined(current?.inputTokens, incoming.inputTokens);
    const outputTokens = maxDefined(current?.outputTokens, incoming.outputTokens);
    const derivedTotalTokens = inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined;
    const totalTokens = maxDefined(maxDefined(current?.totalTokens, incoming.totalTokens), derivedTotalTokens);

    return {
        ...current,
        provider: incoming.provider ?? current?.provider,
        model: incoming.model ?? current?.model,
        contextWindow: incoming.contextWindow ?? current?.contextWindow,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: maxDefined(current?.estimatedCostUsd, incoming.estimatedCostUsd),
        compactionStatus: incoming.compactionStatus ?? current?.compactionStatus ?? "idle",
        updatedAt: Date.now(),
    };
}

function usageSnapshotFromRecord(
    usage: Record<string, unknown>,
    current?: SessionUsageSnapshot,
    extra?: { provider?: string; model?: string; contextWindow?: number },
): SessionUsageSnapshot {
    const nestedCost = usage.cost && typeof usage.cost === "object" ? usage.cost as Record<string, unknown> : undefined;
    const inputTokens = asNumber(usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.input);
    const outputTokens = asNumber(usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.output);
    const totalTokens = asNumber(usage.totalTokens ?? usage.total_tokens) ?? (
        inputTokens !== undefined || outputTokens !== undefined
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined
    );
    return mergeUsageSnapshot(current, {
        provider: typeof usage.provider === "string"
            ? usage.provider
            : extra?.provider,
        model: typeof usage.model === "string"
            ? usage.model
            : extra?.model,
        contextWindow: asNumber(usage.contextWindow ?? usage.context_window)
            ?? extra?.contextWindow,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: asNumber(usage.estimatedCostUsd ?? usage.costUsd ?? usage.cost_usd ?? nestedCost?.total),
    });
}

function usageFromEvent(event: PiEvent, current?: SessionUsageSnapshot): SessionUsageSnapshot {
    const data = event as unknown as Record<string, unknown>;
    const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : data;
    return usageSnapshotFromRecord(usage, current);
}

function usageFromAssistantMessage(message: unknown, current?: SessionUsageSnapshot): SessionUsageSnapshot | null {
    if (!message || typeof message !== "object") return null;
    const data = message as Record<string, unknown>;
    if (data.role !== "assistant") return null;
    const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : undefined;
    if (!usage) return null;
    return usageSnapshotFromRecord(usage, current, {
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
        contextWindow: asNumber(data.contextWindow ?? data.context_window),
    });
}

function eventMessage(event: unknown, fallback: string): string {
    if (isIpcError(event)) return event.fallback;
    if (event instanceof Error && event.message.trim()) return event.message;
    if (typeof event === "string" && event.trim()) return event;
    const data = event && typeof event === "object" ? event as Record<string, unknown> : {};
    const value = data.message ?? data.error ?? data.reason;
    if (value instanceof Error && value.message.trim()) return value.message;
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
}

function textFromMessageContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .map((part) => {
            if (typeof part === "string") return part;
            if (!part || typeof part !== "object") return "";
            const data = part as Record<string, unknown>;
            return typeof data.text === "string" ? data.text : "";
        })
        .join("");
}

function assistantTextFromMessageEnd(event: PiEvent): string {
    const message = (event as unknown as { message?: unknown }).message;
    if (!message || typeof message !== "object") return "";
    const data = message as Record<string, unknown>;
    if (data.role !== "assistant") return "";
    return textFromMessageContent(data.content);
}

const PLAN_COMPLETION_SENTINEL = "[PLAN_DONE]";

function hasPlanCompletionSentinel(content: string): boolean {
    return content.includes(PLAN_COMPLETION_SENTINEL);
}

function stripPlanCompletionSentinel(content: string): string {
    return content
        .replace(/\[PLAN_DONE\]\s*/g, "")
        .trim();
}

function assistantErrorFromMessageEnd(event: PiEvent): string {
    const message = (event as unknown as { message?: unknown }).message;
    if (!message || typeof message !== "object") return "";
    const data = message as Record<string, unknown>;
    if (data.role !== "assistant") return "";
    const errorMessage = typeof data.errorMessage === "string" ? data.errorMessage.trim() : "";
    if (!errorMessage) return "";
    const provider = typeof data.provider === "string" && data.provider.trim() ? data.provider.trim() : "";
    const model = typeof data.model === "string" && data.model.trim() ? data.model.trim() : "";
    const scope = [provider, model].filter(Boolean).join(" / ");
    return scope ? `${scope}: ${errorMessage}` : errorMessage;
}

function isSdkAbortMessage(message: string): boolean {
    return /\bRequest was aborted\.?\b/i.test(message) || /\baborted\b/i.test(message);
}

function describePermissionsForPrompt(sessionId: string | null, workspaceId: string): string {
    const session = sessionId
        ? useSessionStore.getState().sessions.find((item) => item.id === sessionId)
        : null;
    const permissions = session?.toolPermissions ?? useSettingsStore.getState().getWorkspaceToolDefaults(workspaceId);
    const disabled: string[] = [];
    if (!permissions.fileRead) disabled.push("file reads");
    if (!permissions.fileWrite) disabled.push("file writes or edits");
    if (!permissions.shell) disabled.push("bash, PowerShell, and shell commands");
    if (!permissions.git) disabled.push("git commands");
    if (!permissions.network) disabled.push("network access");
    if (!permissions.extensions) disabled.push("extension tools");
    if (disabled.length === 0) return "";
    return [
        "<tool-permissions>",
        `The host runtime enforces these disabled capabilities: ${disabled.join(", ")}.`,
        "This note only explains the enforced policy; it does not perform enforcement itself. Ask the user to enable a capability if the task requires it.",
        "</tool-permissions>",
        "",
    ].join("\n");
}

function isExecutePlanCommand(content: string): boolean {
    return /^\/execute_plan(?:\s|$)/i.test(content.trimStart());
}

const EXECUTE_PLAN_IDLE_POLL_MS = 100;
const EXECUTE_PLAN_IDLE_TIMEOUT_MS = 10_000;

async function waitForAgentRuntimeIdle(agentId: string, timeoutMs = EXECUTE_PLAN_IDLE_TIMEOUT_MS): Promise<void> {
    if (!window.piAPI?.agentsRuntimeState) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const runtime = await window.piAPI.agentsRuntimeState(agentId);
        if (isIpcError(runtime)) return;
        if (!runtime.isStreaming && runtime.status !== "running" && runtime.status !== "starting") {
            return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, EXECUTE_PLAN_IDLE_POLL_MS));
    }
    throw new Error("上一轮仍未完成，暂时无法执行计划。");
}

export function usePiStream(agentId?: string | null): UsePiStreamReturn {
    const [isStreaming, setIsStreaming] = useState(false);
    const [currentThinking, setCurrentThinking] = useState("");
    const [currentText, setCurrentText] = useState("");
    const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

    // Refs 避免 stale closure
    const isStreamingRef = useRef(false);
    const promptInFlightRef = useRef(false);
    const textRef = useRef("");
    const thinkingRef = useRef("");
    const toolCallsRef = useRef(new Map<string, ToolCallState>());
    const messageIdRef = useRef<string | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const agentIdRef = useRef<string | null>(null);
    const streamRenderFrameRef = useRef<number | null>(null);
    const pendingStreamRenderRef = useRef({ content: false, thinking: false });
    const isTurnActiveRef = useRef(false);
    const lastProviderErrorRef = useRef<string | null>(null);
    const hasCompletionSignalRef = useRef(false);

    // Debounce + flush mechanism
    //   - streamPersistRef 累积待 flush 的内容
    //   - flushTimerRef 持有 setTimeout id
    //   - 任何流式事件(text_delta/thinking_delta/toolcall_*)更新 ref + 重置 timer
    //   - timer 到点 / turn_end / agent_end 触发 flushStreamPersist,直接调 piAPI.updateMessage 一次
    type StreamPersistAccum = {
        sessionId: string;
        messageId: string;
        content?: string;
        thinking?: string;
        toolCalls?: ToolCall[];
    };
    const streamPersistRef = useRef<StreamPersistAccum | null>(null);
    const flushTimerRef = useRef<number | null>(null);
    // 5s hard timeout safety net for debounce
    const STREAM_FLUSH_DEBOUNCE_MS = 500;
    const STREAM_FLUSH_HARD_TIMEOUT_MS = 5000;
    const lastStreamEventAtRef = useRef<number | null>(null);

    const flushStreamPersist = useCallback(() => {
        if (flushTimerRef.current !== null) {
            window.clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        const p = streamPersistRef.current;
        if (!p) return;
        streamPersistRef.current = null;
        lastStreamEventAtRef.current = null;
        if (!window.piAPI?.updateMessage) return;
        const session = useSessionStore.getState().sessions.find((s) => s.id === p.sessionId);
        const message = session?.messages.find((m) => m.id === p.messageId);
        const sourceToolCalls = message?.toolCalls ?? p.toolCalls;
        if (Array.isArray(sourceToolCalls)) {
            const normalizedToolCalls = normalizeToolCallsForPersistence(sourceToolCalls);
            if (normalizedToolCalls.length !== sourceToolCalls.length) {
                logger.warn("[usePiStream] dropped malformed toolCalls before session:update-message", {
                    sessionId: p.sessionId,
                    messageId: p.messageId,
                    before: sourceToolCalls.length,
                    after: normalizedToolCalls.length,
                });
            }
            p.toolCalls = normalizedToolCalls;
        }

        const updates: { content?: string; thinking?: string; toolCalls?: ToolCall[] } = {};
        if (p.content !== undefined) updates.content = p.content;
        if (p.thinking !== undefined) updates.thinking = p.thinking;
        if (p.toolCalls !== undefined) updates.toolCalls = p.toolCalls;

        if (Object.keys(updates).length === 0) return;

        window.piAPI.updateMessage(p.sessionId, p.messageId, updates)
            .then((r) => {
                if (r && isIpcError(r)) {
                    const s = useSessionStore.getState();
                    useSessionStore.setState({
                        persistErrorCount: s.persistErrorCount + 1,
                        lastPersistError: r.fallback,
                    });
                }
            })
            .catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                const s = useSessionStore.getState();
                useSessionStore.setState({
                    persistErrorCount: s.persistErrorCount + 1,
                    lastPersistError: msg,
                });
                logger.error("[usePiStream] flush persist failed:", msg);
                addToast(i18n.t("errors.messageSaveFailed"), "warning");
            });
    }, []);

    const scheduleStreamPersist = useCallback(() => {
        lastStreamEventAtRef.current = Date.now();
        if (flushTimerRef.current !== null) {
            window.clearTimeout(flushTimerRef.current);
        }
        flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushStreamPersist();
        }, STREAM_FLUSH_DEBOUNCE_MS);
    }, [flushStreamPersist]);

    // Force flush if no event for 5s (prevents debounce stall)
    // Only runs while actively streaming — keeps the timer idle when the agent
    // is not producing content, avoiding pointless 1s wakeups.
    useEffect(() => {
        if (!isStreaming) return;
        const id = window.setInterval(() => {
            const last = lastStreamEventAtRef.current;
            if (last !== null && Date.now() - last >= STREAM_FLUSH_HARD_TIMEOUT_MS) {
                flushStreamPersist();
            }
        }, 1000);
        // unmount 时 flush 残留增量并清掉待触发防抖定时器, 防止数据丢失 + setState-after-unmount
        return () => {
            window.clearInterval(id);
            flushStreamPersist();
            if (flushTimerRef.current !== null) {
                window.clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
        };
    }, [flushStreamPersist, isStreaming]);

    useEffect(() => { agentIdRef.current = agentId ?? null; }, [agentId]);
    useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

    const cancelStreamRenderFrame = useCallback(() => {
        if (streamRenderFrameRef.current === null) return;
        if (typeof window.cancelAnimationFrame === "function") {
            window.cancelAnimationFrame(streamRenderFrameRef.current);
        }
        streamRenderFrameRef.current = null;
    }, []);

    const discardPendingStreamRender = useCallback(() => {
        cancelStreamRenderFrame();
        pendingStreamRenderRef.current = { content: false, thinking: false };
    }, [cancelStreamRenderFrame]);

    const flushStreamRender = useCallback(() => {
        cancelStreamRenderFrame();
        const pending = pendingStreamRenderRef.current;
        if (!pending.content && !pending.thinking) return;
        pendingStreamRenderRef.current = { content: false, thinking: false };

        const updates: { content?: string; thinking?: string } = {};
        if (pending.content) {
            updates.content = textRef.current;
            setCurrentText(textRef.current);
        }
        if (pending.thinking) {
            updates.thinking = thinkingRef.current;
            setCurrentThinking(thinkingRef.current);
        }

        const messageId = messageIdRef.current;
        if (!messageId) return;
        const aid = agentIdRef.current;
        if (aid) {
            useAgentStore.getState().updateStreamMessage(aid, messageId, updates);
        }
        const sessionId = sessionIdRef.current;
        if (sessionId) {
            useSessionStore.getState().updateMessage(sessionId, messageId, updates, { persist: false });
        }
    }, [cancelStreamRenderFrame]);

    const scheduleStreamRender = useCallback(() => {
        if (streamRenderFrameRef.current !== null) return;
        if (typeof window.requestAnimationFrame !== "function") {
            flushStreamRender();
            return;
        }
        streamRenderFrameRef.current = window.requestAnimationFrame(() => {
            streamRenderFrameRef.current = null;
            flushStreamRender();
        });
    }, [flushStreamRender]);

    useEffect(() => discardPendingStreamRender, [discardPendingStreamRender]);

    const getPinnedSession = useCallback(() => {
        const pinnedSessionId = sessionIdRef.current;
        if (!pinnedSessionId) return null;
        return useSessionStore.getState().sessions.find((session) => session.id === pinnedSessionId) ?? null;
    }, []);

    const getTargetSession = useCallback((targetAgentId?: string | null) => {
        const pinnedSession = getPinnedSession();
        if (pinnedSession) return pinnedSession;
        const effectiveAgentId = targetAgentId ?? agentIdRef.current;
        if (effectiveAgentId) {
            const linkedSessionId = useAgentStore.getState().agents.find((agent) => agent.id === effectiveAgentId)?.sessionId;
            if (!linkedSessionId) return null;
            return useSessionStore.getState().sessions.find((session) => session.id === linkedSessionId) ?? null;
        }
        return useSessionStore.getState().getCurrentSession();
    }, [getPinnedSession]);

    const updateCurrentUsage = useCallback((updates: Partial<SessionUsageSnapshot>) => {
        const session = getTargetSession() ?? useSessionStore.getState().getCurrentSession();
        if (!session) return;
        useSessionStore.getState().updateSessionUsage(session.id, {
            ...(session.usage ?? { updatedAt: Date.now() }),
            ...updates,
            updatedAt: Date.now(),
        });
    }, [getTargetSession]);
    const syncUsageFromAssistantMessage = useCallback((message: unknown) => {
        const session = getTargetSession() ?? useSessionStore.getState().getCurrentSession();
        if (!session) return;
        const nextUsage = usageFromAssistantMessage(message, session.usage);
        if (!nextUsage) return;
        useSessionStore.getState().updateSessionUsage(session.id, nextUsage);
    }, [getTargetSession]);
    const ensureAssistantMessage = useCallback(() => {
        const linkedSession = getTargetSession();
        if (linkedSession && !sessionIdRef.current) {
            sessionIdRef.current = linkedSession.id;
        }
        if (messageIdRef.current) return;
        const aid = agentIdRef.current;
        if (!aid && !linkedSession) return;
        const newId = `${aid ? "am" : "m"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        messageIdRef.current = newId;
        setStreamingMessageId(newId);
        if (aid) {
            useAgentStore.getState().appendStreamMessage(aid, {
                id: newId,
                agentId: aid,
                role: "assistant",
                content: "",
                createdAt: Date.now(),
            });
        }
        if (linkedSession) {
            sessionIdRef.current = linkedSession.id;
            // Persist empty assistant message (once on creation, low frequency)
            useSessionStore.getState().addMessage(linkedSession.id, {
                id: newId,
                role: "assistant",
                content: "",
                timestamp: new Date(),
            }, { persist: true });
        }
    }, [getTargetSession]);

    const appendAgentMessage = useCallback((agentId: string, role: "user" | "assistant", content: string) => {
        useAgentStore.getState().appendStreamMessage(agentId, {
            id: `${role === "user" ? "um" : "am"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            agentId,
            role,
            content,
            createdAt: Date.now(),
            ...(role === "user" ? { meta: { optimistic: true } } : {}),
        });
    }, []);

    const pauseVisibleStreamingForPlanDecision = useCallback(() => {
        flushStreamRender();
        setIsStreaming(false);
        isStreamingRef.current = false;
        promptInFlightRef.current = false;
        setStreamingMessageId(null);
        messageIdRef.current = null;
        sessionIdRef.current = null;
        window.dispatchEvent(new CustomEvent("pi:stream-end"));
    }, [flushStreamRender]);

    // ── 连接状态 ────────────────────────────────────────────────────────────
    // Track when window.piAPI becomes available — preload injects it after the
    // renderer's first paint, so a mount-only effect that returns early on
    // undefined would never re-run and the heartbeat would stay silent.
    const [piApiReady, setPiApiReady] = useState<boolean>(
        typeof window !== "undefined" && Boolean(window.piAPI),
    );
    useEffect(() => {
        if (piApiReady) return;
        if (typeof window !== "undefined" && window.piAPI) {
            setPiApiReady(true);
            return;
        }
        const id = window.setInterval(() => {
            if (typeof window !== "undefined" && window.piAPI) {
                setPiApiReady(true);
            }
        }, 500);
        return () => window.clearInterval(id);
    }, [piApiReady]);

    // Connection status: initial check + 30s heartbeat, auto-disconnect on error
    useEffect(() => {
        if (!piApiReady || !window.piAPI) return;

        const check = (): void => {
            void window.piAPI.getStatus()
                .then((s) => {
                    // getStatus may return IpcError when Pi is not ready
                    if (isIpcError(s)) setIsConnected(false);
                    else setIsConnected(s.installed);
                })
                .catch(() => setIsConnected(false));
        };

        check();
        const id = setInterval(check, 30000);
        return () => clearInterval(id);
    }, [piApiReady]);

    // ── 事件订阅 ────────────────────────────────────────────────────────────
    // mount-only: handleEvent 在后面定义, 用 ref 在 useEffect 前 hold 引用.
    // ref 类型是 ((event: PiEvent) => void) | null, 每次 render 同步到 current.
    const handleEventRef = useRef<((event: PiEvent) => void) | null>(null);
    useEffect(() => {
        const unsubs: Array<() => void> = [];
        if (window.piAPI?.onAgentEvent) {
            const unsub = window.piAPI.onAgentEvent((payload) => {
                const activeAgentId = agentIdRef.current;
                if (!activeAgentId || payload.agentId !== activeAgentId) return;
                handleEventRef.current?.(payload.event);
            });
            if (typeof unsub === "function") unsubs.push(unsub);
        }

        if (!agentId && window.piAPI?.onEvent) {
            const unsub = window.piAPI.onEvent((event: PiEvent) => {
                if (agentIdRef.current) return;
                handleEventRef.current?.(event);
            });
            if (typeof unsub === "function") unsubs.push(unsub);
        }

        return () => {
            unsubs.forEach((unsub) => unsub());
        };
    }, [agentId]);

    // ── 事件处理 ────────────────────────────────────────────────────────────
    const handleEvent = useCallback((event: PiEvent) => {
        switch (event.type) {
            case "agent_start":
                // 防御重复 agent_start: 如果同一 turn 内已有内容,保留状态避免覆盖
                if (isTurnActiveRef.current && (textRef.current || thinkingRef.current)) {
                    // 同一 turn 内重复 agent_start — 重置工具调用但保留文本内容
                    toolCallsRef.current = new Map();
                    setToolCalls(new Map());
                    break;
                }
                // 新 turn 或首次 agent_start — 完整重置
                discardPendingStreamRender();
                setIsStreaming(true);
                isStreamingRef.current = true;
                isTurnActiveRef.current = true;
                setError(null);
                setCurrentText("");
                setCurrentThinking("");
                textRef.current = "";
                thinkingRef.current = "";
                hasCompletionSignalRef.current = false;
                lastProviderErrorRef.current = null;
                toolCallsRef.current = new Map();
                setToolCalls(new Map());
                break;

            case "message_start":
                // Pi can emit repeated/empty message_start events. Create the assistant row lazily on first content.
                break;

            case "message_update": {
                const assistantEvent = getAssistantMessageEvent(event);
                syncUsageFromAssistantMessage((event as { message?: unknown }).message);
                if (!assistantEvent) break;

                if (assistantEvent.type === "text_delta") {
                    const delta = assistantEvent.delta;
                    if (!delta) break;
                    ensureAssistantMessage();
                    hasCompletionSignalRef.current = true;
                    textRef.current += delta;
                    pendingStreamRenderRef.current.content = true;
                    scheduleStreamRender();
                    if (sessionIdRef.current && messageIdRef.current) {
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                ...streamPersistRef.current,
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        streamPersistRef.current.content = textRef.current;
                        scheduleStreamPersist();
                    }
                } else if (assistantEvent.type === "thinking_delta") {
                    const delta = assistantEvent.delta;
                    if (!delta) break;
                    ensureAssistantMessage();
                    thinkingRef.current += delta;
                    pendingStreamRenderRef.current.thinking = true;
                    scheduleStreamRender();
                    if (sessionIdRef.current && messageIdRef.current) {
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                ...streamPersistRef.current,
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        streamPersistRef.current.thinking = thinkingRef.current;
                        scheduleStreamPersist();
                    }
                } else if (assistantEvent.type === "toolcall_start") {
                    const toolCallId = readToolCallId(assistantEvent);
                    const toolName = readToolCallName(assistantEvent);
                    if (!toolCallId || !toolName) {
                        logger.warn("[usePiStream] skip toolcall_start without canonical id/name", summarizeToolCallEvent(assistantEvent));
                        break;
                    }
                    const input = readToolCallInput(assistantEvent);
                    const existingTc = toolCallsRef.current.get(toolCallId);
                    if (existingTc) {
                        // tool_execution_start 先到达已创建条目 — 补充 tool name
                        existingTc.name = toolName;
                        existingTc.args = input;
                        toolCallsRef.current.set(toolCallId, existingTc);
                        setToolCalls(new Map(toolCallsRef.current));
                        if (sessionIdRef.current && messageIdRef.current) {
                            useSessionStore.getState().updateToolCall(sessionIdRef.current, messageIdRef.current, toolCallId, {
                                name: toolName,
                                input,
                            }, { persist: false });
                            scheduleStreamPersist();
                        }
                        break;
                    }
                    ensureAssistantMessage();
                    const tc: ToolCallState = {
                        id: toolCallId,
                        name: toolName,
                        args: input,
                        status: "running",
                        startTime: Date.now(),
                    };
                    toolCallsRef.current.set(toolCallId, tc);
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        useSessionStore.getState().addToolCall(sessionIdRef.current, messageIdRef.current, {
                            id: toolCallId,
                            name: toolName,
                            input,
                            status: "running",
                            startTime: new Date(tc.startTime),
                        }, { persist: false });
                        // 累积 toolCalls 快照,turn_end 时一并 flush
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                ...streamPersistRef.current,
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        // 注意:turn_end flush 时直接从 store 取最新 toolCalls
                        scheduleStreamPersist();
                    }
                } else if (assistantEvent.type === "toolcall_end") {
                    const toolCallId = readToolCallId(assistantEvent);
                    if (!toolCallId) {
                        logger.warn("[usePiStream] skip toolcall_end without canonical id", summarizeToolCallEvent(assistantEvent));
                        break;
                    }
                    const output = readToolCallOutput(assistantEvent);
                    const tc = toolCallsRef.current.get(toolCallId);
                    if (tc) {
                        tc.status = "completed";
                        tc.result = output;
                        tc.endTime = Date.now();
                        toolCallsRef.current.set(toolCallId, tc);
                        setToolCalls(new Map(toolCallsRef.current));
                        if (sessionIdRef.current && messageIdRef.current) {
                            useSessionStore.getState().updateToolCall(sessionIdRef.current, messageIdRef.current, toolCallId, {
                                status: "completed",
                                output,
                                endTime: new Date(tc.endTime),
                            }, { persist: false });
                            scheduleStreamPersist();
                        }
                    }
                }
                break;
            }

            case "message_end": {
                syncUsageFromAssistantMessage((event as { message?: unknown }).message);
                const providerError = assistantErrorFromMessageEnd(event);
                if (providerError) {
                    if (lastProviderErrorRef.current && isSdkAbortMessage(providerError)) {
                        break;
                    }
                    lastProviderErrorRef.current = providerError;
                    flushStreamRender();
                    setError(providerError);
                    break;
                }

                const finalText = assistantTextFromMessageEnd(event);
                const planCompleted =
                    usePlanStore.getState().activeExecution?.phase === "executing"
                    && hasPlanCompletionSentinel(finalText);
                const cleanedFinalText = stripPlanCompletionSentinel(finalText);
                if (planCompleted) {
                    usePlanStore.getState().markCompleted();
                }
                if (!cleanedFinalText || cleanedFinalText === textRef.current) break;
                ensureAssistantMessage();
                hasCompletionSignalRef.current = true;
                textRef.current = cleanedFinalText;
                pendingStreamRenderRef.current.content = true;
                if (sessionIdRef.current && messageIdRef.current) {
                    streamPersistRef.current = {
                        ...streamPersistRef.current,
                        sessionId: sessionIdRef.current,
                        messageId: messageIdRef.current,
                        content: cleanedFinalText,
                    };
                    scheduleStreamPersist();
                }
                flushStreamRender();
                break;
            }

            case "tool_execution_start": {
                const toolCallId = readToolCallId(event);
                const toolName = readToolCallName(event);
                if (!toolCallId || !toolName) {
                    logger.warn("[usePiStream] skip tool_execution_start without canonical id/name", event);
                    break;
                }
                const input = readToolCallInput(event);
                const existingTc = toolCallsRef.current.get(toolCallId);
                if (existingTc) {
                    // toolcall_start 先到达已创建条目 — 更新执行状态
                    existingTc.name = toolName;
                    existingTc.args = input;
                    existingTc.status = "running";
                    existingTc.startTime = Date.now();
                    toolCallsRef.current.set(toolCallId, existingTc);
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        useSessionStore.getState().updateToolCall(sessionIdRef.current, messageIdRef.current, toolCallId, {
                            name: toolName,
                            input,
                            status: "running",
                            startTime: new Date(existingTc.startTime),
                        }, { persist: false });
                        scheduleStreamPersist();
                    }
                    break;
                }
                ensureAssistantMessage();
                // toolcall_start 未先到达 — 创建最小条目(tool name 可能稍后由 toolcall_start 补充)
                const tc: ToolCallState = {
                    id: toolCallId,
                    name: toolName,
                    args: input,
                    status: "running",
                    startTime: Date.now(),
                };
                toolCallsRef.current.set(toolCallId, tc);
                setToolCalls(new Map(toolCallsRef.current));
                if (sessionIdRef.current && messageIdRef.current) {
                    useSessionStore.getState().addToolCall(sessionIdRef.current, messageIdRef.current, {
                        id: toolCallId,
                        name: toolName,
                        input,
                        status: "running",
                        startTime: new Date(tc.startTime),
                    }, { persist: false });
                    if (!streamPersistRef.current ||
                        streamPersistRef.current.sessionId !== sessionIdRef.current ||
                        streamPersistRef.current.messageId !== messageIdRef.current) {
                        streamPersistRef.current = {
                            ...streamPersistRef.current,
                            sessionId: sessionIdRef.current,
                            messageId: messageIdRef.current,
                        };
                    }
                    scheduleStreamPersist();
                }
                break;
            }


            case "tool_execution_update": {
                const toolCallId = readToolCallId(event);
                if (!toolCallId) {
                    logger.warn("[usePiStream] skip tool_execution_update without canonical id", event);
                    break;
                }
                const output = readToolExecutionProgress(event);
                const tc = toolCallsRef.current.get(toolCallId);
                if (tc && output !== undefined) {
                    tc.result = output;
                    toolCallsRef.current.set(toolCallId, tc);
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        useSessionStore.getState().updateToolCall(
                            sessionIdRef.current,
                            messageIdRef.current,
                            toolCallId,
                            { output },
                            { persist: false },
                        );
                        scheduleStreamPersist();
                    }
                }
                break;
            }
            case "tool_execution_end": {
                const toolCallId = readToolCallId(event);
                if (!toolCallId) {
                    logger.warn("[usePiStream] skip tool_execution_end without canonical id", event);
                    break;
                }
                const isError = readToolCallIsError(event);
                const tc = toolCallsRef.current.get(toolCallId);
                if (tc) {
                    tc.status = isError ? "error" : "completed";
                    tc.endTime = Date.now();
                    setToolCalls(new Map(toolCallsRef.current));
                    if (sessionIdRef.current && messageIdRef.current) {
                        useSessionStore.getState().updateToolCall(sessionIdRef.current, messageIdRef.current, toolCallId, {
                            status: isError ? "error" : "completed",
                            endTime: new Date(tc.endTime),
                        }, { persist: false });
                        scheduleStreamPersist();
                    }
                }
                break;
            }

            case "turn_end":
                syncUsageFromAssistantMessage((event as { message?: unknown }).message);
                flushStreamRender();
                // Force flush accumulated content/thinking/toolCalls
                // 在 turn_end 这一刻把整个 assistant message 落盘一次
                flushStreamPersist();
                isTurnActiveRef.current = false;
                // 非 agent 模式下清除 message/session 引用; agent 模式跨 turn 保持
                if (!agentIdRef.current) {
                    setStreamingMessageId(null);
                    messageIdRef.current = null;
                    sessionIdRef.current = null;
                }
                break;

            case "usage_update":
            case "context_update": {
                const session = getTargetSession() ?? useSessionStore.getState().getCurrentSession();
                if (session) {
                    useSessionStore.getState().updateSessionUsage(session.id, usageFromEvent(event, session.usage));
                }
                break;
            }

            case "compaction_start":
                updateCurrentUsage({ compactionStatus: "running" });
                break;

            case "compaction_end":
                updateCurrentUsage({ compactionStatus: "completed" });
                break;

            case "custom_message": {
                const session = getTargetSession();
                if (!session) break;
                const customType = typeof (event as unknown as { customType?: unknown }).customType === "string"
                    ? (event as unknown as { customType: string }).customType
                    : "";
                if (customType === "plan-complete" && usePlanStore.getState().activeExecution?.phase === "executing") {
                    usePlanStore.getState().markCompleted();
                }
                if (customType === "plan-pause" && usePlanStore.getState().activeExecution?.phase === "executing") {
                    usePlanStore.getState().markPaused();
                }
                const generatedUi = normalizeGeneratedUi(
                    (event as unknown as { ui?: unknown; card?: unknown; details?: unknown }).ui
                    ?? (event as unknown as { card?: unknown; details?: unknown }).card
                    ?? (event as unknown as { details?: unknown }).details
                    ?? event,
                );
                if (!generatedUi) {
                    if (customType === "plan-complete" || customType === "plan-pause") {
                        hasCompletionSignalRef.current = true;
                    }
                    break;
                }
                hasCompletionSignalRef.current = true;
                useSessionStore.getState().addMessage(session.id, {
                    id: `cm_${generatedUi.id}`,
                    role: "assistant",
                    content: "",
                    timestamp: new Date(),
                    generatedUi,
                }, { persist: true });
                break;
            }

            case "agent_end":
                {
                    const messages = (event as { messages?: unknown }).messages;
                    const lastAssistantMessage = Array.isArray(messages)
                        ? [...messages].reverse().find((message) => message && typeof message === "object" && (message as Record<string, unknown>).role === "assistant")
                        : null;
                    if (lastAssistantMessage) {
                        syncUsageFromAssistantMessage(lastAssistantMessage);
                    }
                }
                if (
                    !textRef.current &&
                    !thinkingRef.current &&
                    toolCallsRef.current.size === 0 &&
                    !usePlanStore.getState().activeCard &&
                    !lastProviderErrorRef.current
                ) {
                    setError("Pi 本轮没有返回内容，请检查模型/API Key 配置后重试。");
                }
                // Safety flush (in case turn_end doesn't fire)
                flushStreamRender();
                flushStreamPersist();
                setIsStreaming(false);
                isStreamingRef.current = false;
                isTurnActiveRef.current = false;
                setStreamingMessageId(null);
                messageIdRef.current = null;
                sessionIdRef.current = null;
                // Notify useTaskProgress: agent ended
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
                // 只在本轮产生了用户可见结果时提示，避免纯工具阶段反复响铃
                if (hasCompletionSignalRef.current && !lastProviderErrorRef.current) {
                    playCompleteSound();
                }
                if (hasCompletionSignalRef.current && !lastProviderErrorRef.current && canNotify()) {
                    const currentSession = useSessionStore.getState().getCurrentSession();
                    notifyTaskComplete(currentSession?.title ?? "对话");
                }
                hasCompletionSignalRef.current = false;
                break;

            case "extension_error":
                lastProviderErrorRef.current = eventMessage(event, "Pi 扩展错误");
                setError(lastProviderErrorRef.current);
                flushStreamRender();
                flushStreamPersist();
                setIsStreaming(false);
                isStreamingRef.current = false;
                setStreamingMessageId(null);
                messageIdRef.current = null;
                if (usePlanStore.getState().activeExecution?.phase === "executing") {
                    usePlanStore.getState().markFailed();
                }
                hasCompletionSignalRef.current = false;
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
                break;
        }
    }, [discardPendingStreamRender, ensureAssistantMessage, flushStreamPersist, flushStreamRender, scheduleStreamPersist, scheduleStreamRender, syncUsageFromAssistantMessage, updateCurrentUsage, getTargetSession]);

    useEffect(() => {
        handleEventRef.current = handleEvent;
    }, [handleEvent]);

    useEffect(() => {
        const unsubscribe = usePlanStore.subscribe((state, previousState) => {
            if (state.activeCard && state.activeCard.id !== previousState.activeCard?.id) {
                pauseVisibleStreamingForPlanDecision();
            }
        });
        return unsubscribe;
    }, [pauseVisibleStreamingForPlanDecision]);

    // ── 动作 ────────────────────────────────────────────────────────────────
    const startStreaming = useCallback(async (workspaceId: string, content: string, options: StartStreamingOptions = {}) => {
        if (!window.piAPI) {
            setError("piAPI 不可用");
            return;
        }
        if (!content.trim()) return;
        const aid = options.agentId ?? agentIdRef.current;
        if (options.agentId) {
            agentIdRef.current = options.agentId;
        }
        const session = aid ? getTargetSession(aid) : useSessionStore.getState().getCurrentSession();
        const selectedMode = useAgentModeStore.getState().getMode(workspaceId);
        const isFollowUpWhileStreaming = isStreamingRef.current || promptInFlightRef.current;
        const isSlashCommand = content.trimStart().startsWith("/");
        const visibleContent = options.visibleContent ?? content;
        const shouldQueueAfterIdle = options.waitForAgentIdle || isExecutePlanCommand(content);
        if (isFollowUpWhileStreaming) {
            if (aid) {
                appendAgentMessage(aid, "user", visibleContent);
            }
            if (session) {
                useSessionStore.getState().addMessage(session.id, {
                    id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    role: "user",
                    content: visibleContent,
                    timestamp: new Date(),
                });
            }
            try {
                if (aid) {
                    if (shouldQueueAfterIdle) {
                        await waitForAgentRuntimeIdle(aid);
                    }
                    await window.piAPI.agentsPrompt({
                        agentId: aid,
                        message: content,
                        streamingBehavior: "followUp",
                        mode: selectedMode,
                    });
                } else {
                    const result = await window.piAPI.sendPrompt(workspaceId, content, { mode: selectedMode });
                    if (isIpcError(result)) {
                        setError(result.fallback);
                    }
                }
            } catch (err) {
                setError(String(err));
            }
            promptInFlightRef.current = false;
            return;
        }
        promptInFlightRef.current = true;
        setIsStreaming(true);
        isStreamingRef.current = true;
        isTurnActiveRef.current = true;
        setError(null);
        discardPendingStreamRender();
        textRef.current = "";
        thinkingRef.current = "";
        hasCompletionSignalRef.current = false;
        lastProviderErrorRef.current = null;
        messageIdRef.current = null;
        sessionIdRef.current = session?.id ?? null;
        streamPersistRef.current = null;
        toolCallsRef.current = new Map();
        setCurrentText("");
        setCurrentThinking("");
        setToolCalls(new Map());

        // Notify useTaskProgress / progress reminder lanes.
        window.dispatchEvent(new CustomEvent("pi:stream-start", {
            detail: {
                runContext: isExecutePlanCommand(content) ? "plan_execution" : "task",
            },
        }));

        // Agent runtime will later echo the canonical message list. Add an
        // optimistic row now so permission prompts cannot leave the chat empty.
        if (aid) {
            appendAgentMessage(aid, "user", visibleContent);
        } else if (!aid && session) {
            sessionIdRef.current = session.id;
            useSessionStore.getState().addMessage(session.id, {
                id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: "user",
                content: visibleContent,
                timestamp: new Date(),
            });
        }

        try {
            if (selectedMode === "plan") {
                usePlanStore.getState().startPlanning();
            }
            const permissionPrefix = aid || isSlashCommand || selectedMode === "plan"
                ? ""
                : describePermissionsForPrompt(sessionIdRef.current, workspaceId);
            const outbound = `${permissionPrefix}${content}`;
            if (aid) {
                if (shouldQueueAfterIdle) {
                    await waitForAgentRuntimeIdle(aid);
                }
                await window.piAPI.agentsPrompt({
                    agentId: aid,
                    message: outbound,
                    mode: selectedMode,
                    ...(shouldQueueAfterIdle ? { streamingBehavior: "followUp" as const } : {}),
                });
            } else {
                try {
                    const result = await window.piAPI.sendPrompt(workspaceId, outbound, { mode: selectedMode });
                    if (isIpcError(result)) {
                        setError(result.fallback);
                        // Add visible error message in chat
                        const errSession = useSessionStore.getState().getCurrentSession();
                        if (errSession) {
                            useSessionStore.getState().addMessage(errSession.id, {
                                id: `err_${Date.now()}`,
                                role: "assistant",
                                content: `⚠️ 发送失败: ${result.fallback}`,
                                timestamp: new Date(),
                            });
                        }
                        setIsStreaming(false);
                        isStreamingRef.current = false;
                        setStreamingMessageId(null);
                        window.dispatchEvent(new CustomEvent("pi:stream-end"));
                    }
                } catch (err) {
                    setError(String(err));
                    setIsStreaming(false);
                    isStreamingRef.current = false;
                    promptInFlightRef.current = false;
                    window.dispatchEvent(new CustomEvent("pi:stream-end"));
                }
            }
            if (isExecutePlanCommand(content)) {
                usePlanStore.getState().startExecution({
                    activePlanId: usePlanStore.getState().activeExecution?.activePlanId ?? `execute_${Date.now()}`,
                    title: visibleContent.replace(/^执行计划[：:]\s*/, "").trim() || content.replace(/^\/execute_plan\s*/i, "").trim() || "计划",
                    filename: usePlanStore.getState().activeExecution?.filename,
                    sourceMessageId: usePlanStore.getState().activeExecution?.sourceMessageId,
                });
            }
            promptInFlightRef.current = false;
        } catch (err) {
            const message = String(err);
            const displayMessage = /Request was aborted/i.test(message) && lastProviderErrorRef.current
                ? lastProviderErrorRef.current
                : message;
            setError(displayMessage);
            addToast(displayMessage, "error");
            setIsStreaming(false);
            isStreamingRef.current = false;
            promptInFlightRef.current = false;
            if (isExecutePlanCommand(content)) {
                usePlanStore.getState().markFailed();
            }
            // Notify useTaskProgress: streaming error
            window.dispatchEvent(new CustomEvent("pi:stream-end"));
        }
    }, [appendAgentMessage, discardPendingStreamRender, getTargetSession]);

    const stopStreaming = useCallback((workspaceId: string) => {
        void (async () => {
            const stopped = await requestRunControlStop({
                workspaceId,
                agentId: agentIdRef.current,
                runContext: usePlanStore.getState().activeExecution?.phase === "executing"
                    || usePlanStore.getState().activeExecution?.phase === "pausing"
                    ? "plan_execution"
                    : "task",
                onError: (message) => {
                    setError(message);
                },
            });
            if (!stopped) return;
            flushStreamRender();
            setIsStreaming(false);
            isStreamingRef.current = false;
            promptInFlightRef.current = false;
            hasCompletionSignalRef.current = false;
            setStreamingMessageId(null);
        })();
    }, [flushStreamRender]);

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
