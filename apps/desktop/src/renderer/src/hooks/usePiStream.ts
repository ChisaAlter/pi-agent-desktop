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
// 2026-06-06 hotfix (T6): 流式消息持久化走 debounce + flush
//  - text_delta / thinking_delta / toolcall_* 事件不再每次都 fire-and-forget IPC
//  - 累积到一个 ref, 500ms debounce, 调 window.piAPI.updateMessage 一次
//  - turn_end / agent_end 强制 flush
//  - store action 调用传 { persist: false } 跳过 fire-and-forget

import { useCallback, useEffect, useRef, useState } from "react";
import type { PiEvent } from "@shared/events";
import {
    isIpcError,
    type CustomMessageCard,
    type CustomMessageCardAction,
    type CustomMessageCardKind,
    type PlanCard,
    type PlanMessageAction,
    type SessionUsageSnapshot,
    type ToolCall,
} from "@shared";
import { useSessionStore } from "../stores/session-store";
import { usePlanStore } from "../stores/plan-store";
import { useSettingsStore } from "../stores/settings-store";
import { logger } from "../utils/logger";
import { useAgentStore } from "../stores/agent-store";

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
    const text = content
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*$/gi, "")
        .trim();
    if (!text) return null;
    if (/关于\s*\/?plan|请告诉我你的目标|为了给出有价值的规划|常见用法包括/i.test(text)) return null;

    const hasPlanShape = /(^|\n)\s*(?:#+\s*)?计划[：:\s]/.test(text) ||
        /(^|\n)\s*(?:步骤|Step)\s*\d+\s*[：:.]/i.test(text) ||
        /(^|\n)\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?(?:.+)/.test(text);
    const hasExecutionIntent = /执行计划|execute_plan|implementation plan|test plan|方案|步骤/i.test(text);
    if (!hasPlanShape || !hasExecutionIntent) return null;

    const titleLine = text
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^#+\s*/, ""))
        .find((line) => line.length > 0 && /计划|plan/i.test(line));
    if (!titleLine || /关于\s*\/?plan/i.test(titleLine)) return null;
    const title = titleLine?.replace(/^计划[：:\s]*/, "").trim() || "计划";

    return {
        id: `fallback_plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        content: text,
        createdAt: Date.now(),
    };
}

const CUSTOM_CARD_KINDS = new Set<CustomMessageCardKind>([
    "status-list",
    "approval-actions",
    "task-progress",
    "result-summary",
    "file-actions",
]);

const CUSTOM_CARD_ACTIONS = new Set<CustomMessageCardAction["kind"]>([
    "slash-command",
    "open-file",
    "copy-text",
    "switch-view",
    "refresh",
]);

function asNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeCustomCard(raw: unknown): CustomMessageCard {
    const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const requestedKind = typeof data.kind === "string" ? data.kind : typeof data.customType === "string" ? data.customType : "";
    const kind: CustomMessageCard["kind"] = CUSTOM_CARD_KINDS.has(requestedKind as CustomMessageCardKind)
        ? requestedKind as CustomMessageCardKind
        : "markdown-fallback";
    const actions = Array.isArray(data.actions)
        ? data.actions.flatMap((action, index): CustomMessageCardAction[] => {
            if (!action || typeof action !== "object") return [];
            const a = action as Record<string, unknown>;
            const actionKind = typeof a.kind === "string" ? a.kind : "";
            if (!CUSTOM_CARD_ACTIONS.has(actionKind as CustomMessageCardAction["kind"])) return [];
            const value = typeof a.value === "string" ? a.value : "";
            if (!value) return [];
            return [{
                id: typeof a.id === "string" ? a.id : `action_${index}`,
                label: typeof a.label === "string" ? a.label : actionKind,
                kind: actionKind as CustomMessageCardAction["kind"],
                value,
            }];
        })
        : undefined;
    const items = Array.isArray(data.items)
        ? data.items.flatMap((item, index) => {
            if (!item || typeof item !== "object") return [];
            const i = item as Record<string, unknown>;
            return [{
                id: typeof i.id === "string" ? i.id : `item_${index}`,
                label: typeof i.label === "string" ? i.label : String(i.name ?? `Item ${index + 1}`),
                status: typeof i.status === "string" ? i.status : undefined,
                description: typeof i.description === "string" ? i.description : undefined,
                path: typeof i.path === "string" ? i.path : undefined,
            }];
        })
        : undefined;
    return {
        id: typeof data.id === "string" ? data.id : `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        title: typeof data.title === "string" ? data.title : undefined,
        content: typeof data.content === "string" ? data.content : undefined,
        items,
        actions,
    };
}

function usageFromEvent(event: PiEvent, current?: SessionUsageSnapshot): SessionUsageSnapshot {
    const data = event as unknown as Record<string, unknown>;
    const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : data;
    const inputTokens = asNumber(usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens);
    const outputTokens = asNumber(usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens);
    const totalTokens = asNumber(usage.totalTokens ?? usage.total_tokens) ?? (
        inputTokens !== undefined || outputTokens !== undefined
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined
    );
    return {
        ...current,
        provider: typeof usage.provider === "string" ? usage.provider : current?.provider,
        model: typeof usage.model === "string" ? usage.model : current?.model,
        contextWindow: asNumber(usage.contextWindow ?? usage.context_window) ?? current?.contextWindow,
        inputTokens: inputTokens ?? current?.inputTokens,
        outputTokens: outputTokens ?? current?.outputTokens,
        totalTokens: totalTokens ?? current?.totalTokens,
        estimatedCostUsd: asNumber(usage.estimatedCostUsd ?? usage.costUsd ?? usage.cost_usd) ?? current?.estimatedCostUsd,
        compactionStatus: current?.compactionStatus ?? "idle",
        updatedAt: Date.now(),
    };
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
        `The user disabled: ${disabled.join(", ")}.`,
        "Do not use disabled capabilities in this turn. Ask the user to enable them if the task requires them.",
        "</tool-permissions>",
        "",
    ].join("\n");
}

function shouldAskForPlanGoal(content: string): boolean {
    let text = content
        .replace(/^\/plan(?:\s+|\r?\n)?/i, "")
        .trim();
    const userMessageMatch = text.match(/(?:^|\r?\n)用户消息:\s*([\s\S]*)$/);
    if (userMessageMatch) {
        text = userMessageMatch[1].trim();
    }
    if (!text) return true;
    if (/^(你好|您好|hello|hi|hey|在吗|可以吗|能用吗|测试|test)[？?！!。.]*$/i.test(text)) return true;
    return /^(了解|看一下|熟悉|读一下|研究一下|分析一下)\s*(一下)?\s*(这个|当前)?\s*(项目|仓库|代码库|代码)?[？?！!。.]*$/i.test(text);
}

function createPlanClarificationContent(content: string): string {
    const text = content.trim() || "这个任务";
    return [
        "计划模式需要目标",
        "",
        `你想让我为「${text}」制定哪方面的计划？`,
        "可以直接补充目标、范围、约束或验收标准，我会基于补充内容生成可执行计划。",
    ].join("\n");
}

function createPlanAction(card: PlanCard): PlanMessageAction {
    return {
        id: `plan_action_${card.id}`,
        title: card.title,
        filename: card.filename,
        status: "pending",
    };
}

function isExecutePlanCommand(content: string): boolean {
    return /^\/execute_plan(?:\s|$)/i.test(content.trimStart());
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

    // 2026-06-06 hotfix (T6): debounce + flush 机制
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
    // 2026-06-06 hotfix (T6): 5s hard timeout 防 debounce 卡住
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
        if (message?.toolCalls) {
            p.toolCalls = message.toolCalls;
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

    // 2026-06-06 hotfix (T6): hard timeout — 5s 内没新事件就强制 flush,防止 debounce 卡住
    useEffect(() => {
        const id = window.setInterval(() => {
            const last = lastStreamEventAtRef.current;
            if (last !== null && Date.now() - last >= STREAM_FLUSH_HARD_TIMEOUT_MS) {
                flushStreamPersist();
            }
        }, 1000);
        return () => window.clearInterval(id);
    }, [flushStreamPersist]);

    const { getCurrentSession, addMessage, updateMessage, addToolCall, updateToolCall } = useSessionStore();

    useEffect(() => { agentIdRef.current = agentId ?? null; }, [agentId]);
    useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

    const updateCurrentUsage = useCallback((updates: Partial<SessionUsageSnapshot>) => {
        const session = useSessionStore.getState().getCurrentSession();
        if (!session) return;
        useSessionStore.getState().updateSessionUsage(session.id, {
            ...(session.usage ?? { updatedAt: Date.now() }),
            ...updates,
            updatedAt: Date.now(),
        });
    }, []);
    const ensureAssistantMessage = useCallback(() => {
        if (messageIdRef.current) return;
        const aid = agentIdRef.current;
        if (aid) {
            const newId = `am_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            messageIdRef.current = newId;
            setStreamingMessageId(newId);
            useAgentStore.getState().appendStreamMessage(aid, {
                id: newId,
                agentId: aid,
                role: "assistant",
                content: "",
                createdAt: Date.now(),
            });
            return;
        }
        const session = useSessionStore.getState().getCurrentSession();
        if (!session) return;
        sessionIdRef.current = session.id;
        const newId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        messageIdRef.current = newId;
        setStreamingMessageId(newId);
        // 2026-06-06 hotfix (T6): 持久化空 assistant message(只在创建时一次,低频)
        addMessage(session.id, {
            id: newId,
            role: "assistant",
            content: "",
            timestamp: new Date(),
        }, { persist: true });
    }, [addMessage]);

    const appendAgentMessage = useCallback((agentId: string, role: "user" | "assistant", content: string, planAction?: PlanMessageAction) => {
        useAgentStore.getState().appendStreamMessage(agentId, {
            id: `${role === "user" ? "um" : "am"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            agentId,
            role,
            content,
            createdAt: Date.now(),
            ...(planAction ? { planAction } : {}),
        });
    }, []);

    const appendInlinePlanClarification = useCallback((workspaceId: string, content: string) => {
        const aid = agentIdRef.current;
        if (aid) {
            appendAgentMessage(aid, "user", content);
            appendAgentMessage(aid, "assistant", createPlanClarificationContent(content));
        } else if (sessionIdRef.current) {
            addMessage(sessionIdRef.current, {
                id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                role: "assistant",
                content: createPlanClarificationContent(content),
                timestamp: new Date(),
            });
        }
        usePlanStore.getState().setPendingPlanClarification({ workspaceId, originalContent: content });
    }, [addMessage, appendAgentMessage]);

    const publishInlinePlanCard = useCallback((card: PlanCard) => {
        const cleanContent = card.content
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/<think>[\s\S]*$/gi, "")
            .trim();
        const planAction = createPlanAction(card);
        usePlanStore.getState().markPlanCardRendered(card.id);
        const aid = agentIdRef.current;
        if (aid) {
            if (messageIdRef.current) {
                useAgentStore.getState().updateStreamMessage(aid, messageIdRef.current, {
                    content: cleanContent,
                    planAction,
                });
            } else {
                appendAgentMessage(aid, "assistant", cleanContent, planAction);
            }
            return;
        }
        const session = sessionIdRef.current
            ? useSessionStore.getState().sessions.find((item) => item.id === sessionIdRef.current)
            : useSessionStore.getState().getCurrentSession();
        if (!session) return;
        if (messageIdRef.current) {
            updateMessage(session.id, messageIdRef.current, {
                content: cleanContent,
                planAction,
            });
            return;
        }
        addMessage(session.id, {
            id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content: cleanContent,
            timestamp: new Date(),
            planAction,
        });
    }, [addMessage, appendAgentMessage, updateMessage]);

    const pauseVisibleStreamingForPlanDecision = useCallback(() => {
        setIsStreaming(false);
        isStreamingRef.current = false;
        promptInFlightRef.current = false;
        setStreamingMessageId(null);
        messageIdRef.current = null;
        sessionIdRef.current = null;
        window.dispatchEvent(new CustomEvent("pi:stream-end"));
    }, []);

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
        if (agentId && window.piAPI?.onAgentEvent) {
            const unsub = window.piAPI.onAgentEvent((payload) => {
                if (payload.agentId !== agentId) return;
                handleEventRef.current?.(payload.event);
            });
            return () => {
                if (typeof unsub === "function") unsub();
            };
        }

        if (!window.piAPI?.onEvent) return;
        const unsub = window.piAPI.onEvent((event: PiEvent) => {
            handleEventRef.current?.(event);
        });
        return () => {
            if (typeof unsub === "function") unsub();
        };
    }, [agentId]);

    // ── 事件处理 ────────────────────────────────────────────────────────────
    const handleEvent = useCallback((event: PiEvent) => {
        switch (event.type) {
            case "agent_start":
                setIsStreaming(true);
                isStreamingRef.current = true;
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
                    if (agentIdRef.current && messageIdRef.current) {
                        useAgentStore.getState().updateStreamMessage(agentIdRef.current, messageIdRef.current, {
                            content: textRef.current,
                        });
                    } else if (sessionIdRef.current && messageIdRef.current) {
                        // 2026-06-06 hotfix (T6): 内存立即更新(给 UI 看到), 持久化走 debounce
                        updateMessage(sessionIdRef.current, messageIdRef.current, { content: textRef.current }, { persist: false });
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        streamPersistRef.current.content = textRef.current;
                        scheduleStreamPersist();
                    }
                } else if (assistantEvent.type === "thinking_delta") {
                    const delta = assistantEvent.delta;
                    ensureAssistantMessage();
                    thinkingRef.current += delta;
                    setCurrentThinking(thinkingRef.current);
                    if (agentIdRef.current && messageIdRef.current) {
                        useAgentStore.getState().updateStreamMessage(agentIdRef.current, messageIdRef.current, {
                            thinking: thinkingRef.current,
                        });
                    } else if (sessionIdRef.current && messageIdRef.current) {
                        updateMessage(sessionIdRef.current, messageIdRef.current, { thinking: thinkingRef.current }, { persist: false });
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        streamPersistRef.current.thinking = thinkingRef.current;
                        scheduleStreamPersist();
                    }
                } else if (assistantEvent.type === "toolcall_start") {
                    const e = assistantEvent as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                    ensureAssistantMessage();
                    if (e.toolName === "plan_write") {
                        const title = typeof e.args.title === "string" ? e.args.title : "计划";
                        const content = typeof e.args.content === "string" ? e.args.content : "";
                        const card = {
                            id: e.toolCallId,
                            title,
                            content,
                            filename: typeof e.args.filename === "string" ? e.args.filename : undefined,
                            createdAt: Date.now(),
                        };
                        usePlanStore.getState().setCard(card);
                        publishInlinePlanCard(card);
                        pauseVisibleStreamingForPlanDecision();
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
                        }, { persist: false });
                        // 累积 toolCalls 快照,turn_end 时一并 flush
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        // 注意:turn_end flush 时直接从 store 取最新 toolCalls
                        scheduleStreamPersist();
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
                            }, { persist: false });
                            scheduleStreamPersist();
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
                    const card = {
                        id: e.toolCallId,
                        title,
                        content,
                        filename: typeof e.args?.filename === "string" ? e.args.filename : undefined,
                        createdAt: Date.now(),
                    };
                    usePlanStore.getState().setCard(card);
                    publishInlinePlanCard(card);
                    pauseVisibleStreamingForPlanDecision();
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
                        }, { persist: false });
                        if (!streamPersistRef.current ||
                            streamPersistRef.current.sessionId !== sessionIdRef.current ||
                            streamPersistRef.current.messageId !== messageIdRef.current) {
                            streamPersistRef.current = {
                                sessionId: sessionIdRef.current,
                                messageId: messageIdRef.current,
                            };
                        }
                        scheduleStreamPersist();
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
                        }, { persist: false });
                        scheduleStreamPersist();
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
                            publishInlinePlanCard(fallbackCard);
                        }
                    }
                    usePlanStore.getState().applyDoneMarkers(textRef.current);
                }
                // 2026-06-06 hotfix (T6): 强制 flush 累积的 content/thinking/toolCalls
                // 在 turn_end 这一刻把整个 assistant message 落盘一次
                flushStreamPersist();
                setIsStreaming(false);
                isStreamingRef.current = false;
                setStreamingMessageId(null);
                messageIdRef.current = null;
                sessionIdRef.current = null;
                if (usePlanStore.getState().activeExecution?.phase === "executing") {
                    usePlanStore.getState().markCompleted();
                }
                break;

            case "usage_update":
            case "context_update": {
                const session = useSessionStore.getState().getCurrentSession();
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
                const session = useSessionStore.getState().getCurrentSession();
                if (!session) break;
                const card = sanitizeCustomCard((event as unknown as { card?: unknown; details?: unknown }).card ?? (event as unknown as { details?: unknown }).details ?? event);
                addMessage(session.id, {
                    id: `cm_${card.id}`,
                    role: "assistant",
                    content: card.kind === "markdown-fallback" ? (card.content ?? "") : "",
                    timestamp: new Date(),
                    customCard: card,
                }, { persist: true });
                break;
            }

            case "agent_end":
                if (
                    !textRef.current &&
                    !thinkingRef.current &&
                    toolCallsRef.current.size === 0 &&
                    !usePlanStore.getState().activeCard
                ) {
                    setError("Pi 本轮没有返回内容，请检查模型/API Key 配置后重试。");
                }
                // 2026-06-06 hotfix (T6): 兜底 flush(防止 turn_end 没触发的情况)
                flushStreamPersist();
                setIsStreaming(false);
                isStreamingRef.current = false;
                setStreamingMessageId(null);
                messageIdRef.current = null;
                sessionIdRef.current = null;
                if (usePlanStore.getState().activeExecution?.phase === "executing") {
                    usePlanStore.getState().markCompleted();
                }
                // v1.0.17: 通知 useTaskProgress agent 结束
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
                break;

            case "extension_error":
                setError(eventMessage(event, "Pi 扩展错误"));
                flushStreamPersist();
                setIsStreaming(false);
                isStreamingRef.current = false;
                setStreamingMessageId(null);
                messageIdRef.current = null;
                if (usePlanStore.getState().activeExecution?.phase === "executing") {
                    usePlanStore.getState().markFailed();
                }
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
                break;
        }
    }, [updateMessage, addToolCall, updateToolCall, ensureAssistantMessage, flushStreamPersist, scheduleStreamPersist, updateCurrentUsage, addMessage, pauseVisibleStreamingForPlanDecision, publishInlinePlanCard]);

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
        const aid = agentIdRef.current;
        const session = aid ? null : getCurrentSession();
        const planEnabled = usePlanStore.getState().enabled;
        const isFollowUpWhileStreaming = isStreamingRef.current || promptInFlightRef.current;
        const isSlashCommand = content.trimStart().startsWith("/");
        const visibleContent = options.visibleContent ?? content;
        if (isFollowUpWhileStreaming) {
            if (planEnabled && !isSlashCommand) return;
            if (planEnabled && isSlashCommand) {
                pauseVisibleStreamingForPlanDecision();
            } else {
                if (!aid && session) {
                    addMessage(session.id, {
                        id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        role: "user",
                        content: visibleContent,
                        timestamp: new Date(),
                    });
                }
                try {
                    if (aid) {
                        await window.piAPI.agentsPrompt({ agentId: aid, message: content, streamingBehavior: "followUp" });
                    } else {
                        const result = await window.piAPI.sendPrompt(workspaceId, content);
                        if (isIpcError(result)) {
                            setError(result.fallback);
                        }
                    }
                } catch (err) {
                    setError(String(err));
                }
                return;
            }
        }
        promptInFlightRef.current = true;
        setIsStreaming(true);
        isStreamingRef.current = true;
        setError(null);
        textRef.current = "";
        thinkingRef.current = "";
        messageIdRef.current = null;
        sessionIdRef.current = null;
        streamPersistRef.current = null;
        toolCallsRef.current = new Map();
        setCurrentText("");
        setCurrentThinking("");
        setToolCalls(new Map());

        // v1.0.17: 通知 useTaskProgress 流式开始
        window.dispatchEvent(new CustomEvent("pi:stream-start"));

        // Agent workbench messages are owned by AgentRuntimeRegistry; legacy chats
        // still write the user message to the session store immediately.
        if (aid && options.visibleContent && options.visibleContent !== content) {
            appendAgentMessage(aid, "user", options.visibleContent);
        } else if (!aid && session) {
            sessionIdRef.current = session.id;
            addMessage(session.id, {
                id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: "user",
                content: visibleContent,
                timestamp: new Date(),
            });
        }

        try {
            if (planEnabled && !isSlashCommand) {
                usePlanStore.getState().startPlanning();
            }
            const pendingClarification = usePlanStore.getState().pendingPlanClarification;
            const clarifiedPlanContent = planEnabled && !isSlashCommand && pendingClarification?.workspaceId === workspaceId
                ? [
                    "原始请求:",
                    pendingClarification.originalContent,
                    "",
                    "补充目标:",
                    content,
                ].join("\n")
                : null;
            if (clarifiedPlanContent) {
                usePlanStore.getState().setPendingPlanClarification(null);
            } else if (planEnabled && !isSlashCommand && shouldAskForPlanGoal(content)) {
                appendInlinePlanClarification(workspaceId, content);
                setIsStreaming(false);
                isStreamingRef.current = false;
                promptInFlightRef.current = false;
                setStreamingMessageId(null);
                window.dispatchEvent(new CustomEvent("pi:stream-end"));
                return;
            }
            const permissionPrefix = aid || isSlashCommand ? "" : describePermissionsForPrompt(sessionIdRef.current, workspaceId);
            const guardedContent = `${permissionPrefix}${clarifiedPlanContent ?? content}`;
            const outbound = planEnabled && !isSlashCommand
                ? `/plan\n${guardedContent}`
                : guardedContent;
            if (aid) {
                await window.piAPI.agentsPrompt({ agentId: aid, message: outbound });
            } else {
                const result = await window.piAPI.sendPrompt(workspaceId, outbound);
                if (isIpcError(result)) {
                    setError(result.fallback);
                    setIsStreaming(false);
                    isStreamingRef.current = false;
                    setStreamingMessageId(null);
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
            setError(String(err));
            setIsStreaming(false);
            isStreamingRef.current = false;
            promptInFlightRef.current = false;
            if (isExecutePlanCommand(content)) {
                usePlanStore.getState().markFailed();
            }
            // v1.0.17: 通知 useTaskProgress 流式异常结束
            window.dispatchEvent(new CustomEvent("pi:stream-end"));
        }
    }, [getCurrentSession, addMessage, appendAgentMessage, appendInlinePlanClarification, pauseVisibleStreamingForPlanDecision]);

    const stopStreaming = useCallback((workspaceId: string) => {
        if (!window.piAPI) return;
        try {
            const aid = agentIdRef.current;
            if (aid && window.piAPI.agentsAbort) {
                void window.piAPI.agentsAbort(aid);
            } else {
                void Promise.resolve(window.piAPI.stop(workspaceId))
                    .then((result) => {
                        if (isIpcError(result)) {
                            setError(result.fallback);
                        }
                    })
                    .catch((err) => {
                        setError(`停止失败: ${eventMessage(err, "未知错误")}`);
                    });
            }
        } catch (err) {
            setError(`停止失败: ${eventMessage(err, "未知错误")}`);
        }
        setIsStreaming(false);
        isStreamingRef.current = false;
        promptInFlightRef.current = false;
        setStreamingMessageId(null);
        if (usePlanStore.getState().activeExecution?.phase === "pausing" || usePlanStore.getState().activeExecution?.phase === "executing") {
            usePlanStore.getState().markPaused();
        }
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
