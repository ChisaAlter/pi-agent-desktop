// WorkspaceRegistry
// Multi-workspace orchestration: workspaceId -> AgentSession mapping
// get() reuses sessions; lazy-inits bridge + interceptor + subscriptions on first call
// Event types use @shared/events PiEvent (no 'as any')

import { createWorkspaceSession, resolveBundledDesktopExtensionPaths, type WorkspaceSession } from "./factory";
import { createEventBridge, type IpcSender } from "./event-bridge";
import { createApprovalInterceptor } from "../approval/interceptor";
import { createExtensionUiBridge } from "../extensions/extension-ui-bridge";
import type { AgentMode } from "@shared";
import type { PiEvent } from "@shared/events";
import type { PendingEdits } from "../approval/pending-edits";
import log from "electron-log/main";

/** 内部存储: session + 已初始化的 bridge/interceptor/subscription */
interface WorkspaceEntry {
    session: WorkspaceSession;
    subscribed: boolean;
    // in-flight 订阅 promise: 防止并发首次调用重复订阅 (TOCTOU)
    subscribing?: Promise<void>;
    // 看门狗"最后活动时间"检测: 任何 agent 事件都更新此值
    lastActivity?: number;
    // entry 创建时间, 用作 lastActivity 的初始回退
    createdAt: number;
}

/**
 * Maximum number of concurrent workspace sessions kept hot in the registry.
 * Beyond this, the least-recently-accessed entry is disposed (LRU) to bound
 * memory consumption. 8 matches the typical user ceiling of pinned workspaces.
 */
const MAX_WORKSPACES = 8;

export class WorkspaceRegistry {
    private entries = new Map<string, WorkspaceEntry>();
    // in-flight 创建 promise: 防止并发首次调用创建重复 session (TOCTOU)
    private creating = new Map<string, Promise<WorkspaceEntry>>();
    /**
     * Optional stop-gate hook threaded into `createEventBridge` for every
     * workspace's event subscription. Set externally (e.g. from `main/index.ts`
     * after `GoalService` is constructed) so the registry can be created early
     * without depending on the goal service.
     */
    private onTurnEndHook?: (workspaceId: string) => void;
    /**
     * Optional workspace-dispose hook invoked from {@link dispose} so that
     * workspace-scoped in-memory state held by sibling services (e.g.
     * GoalService's react/turn counters) can be cleared when the session is
     * torn down. Mirrors the {@link setOnTurnEnd} threading pattern so the
     * registry can be created early without depending on the goal service.
     */
    private onDisposeWorkspaceHook?: (workspaceId: string) => void;

    /**
     * Install a stop-gate hook invoked on every `turn_end` Pi event forwarded
     * by {@link createEventBridge}. Safe to call at any time — live
     * subscriptions resolve the latest hook dynamically.
     */
    setOnTurnEnd(hook: ((workspaceId: string) => void) | undefined): void {
        this.onTurnEndHook = hook;
    }

    /**
     * Install a hook invoked from {@link dispose} whenever a workspace session
     * is torn down. Use it to clear sibling services' workspace-scoped caches
     * (e.g. GoalService's react/turn counters) so they don't leak across
     * session recreation.
     */
    setOnDisposeWorkspace(hook: ((workspaceId: string) => void) | undefined): void {
        this.onDisposeWorkspaceHook = hook;
    }

    /**
     * Look up an existing workspace session WITHOUT triggering lazy creation.
     * Returns `null` when no session has been created yet — used by
     * `GoalService.agentSessionLookup` to deliver judge-driven followUp
     * messages without forcing a session into existence.
     */
    tryGetWorkspaceSession(workspaceId: string): WorkspaceSession | null {
        const entry = this.entries.get(workspaceId);
        return entry?.session ?? null;
    }

    async get(
        workspaceId: string,
        workspacePath: string,
        pendingEdits?: PendingEdits,
        send?: IpcSender,
        getMode?: () => AgentMode,
        generatedUiEnabled = true,
    ): Promise<WorkspaceSession> {
        const existing = this.entries.get(workspaceId);
        if (existing) {
            // LRU: move to end (most recently used) so eviction picks the oldest entry.
            this.entries.delete(workspaceId);
            this.entries.set(workspaceId, existing);
            return existing.session;
        }

        // 复用进行中的创建 promise, 保证每个 workspaceId 只创建一次
        let creating = this.creating.get(workspaceId);
        if (!creating) {
            creating = (async () => {
                const session = await createWorkspaceSession({
                    workspaceId,
                    workspacePath,
                    uiContext: createExtensionUiBridge(workspaceId),
                    desktopExtensions: resolveBundledDesktopExtensionPaths({ generatedUiEnabled }),
                });
                const entry: WorkspaceEntry = {
                    session,
                    subscribed: false,
                    createdAt: Date.now(),
                };
                this.entries.set(workspaceId, entry);
                // LRU eviction: if we exceeded the cap, dispose the oldest entry.
                // The newly-added entry sits at the tail (most recent), so the
                // head is guaranteed to be a different workspace.
                if (this.entries.size > MAX_WORKSPACES) {
                    const oldestId = this.entries.keys().next().value;
                    if (typeof oldestId === "string" && oldestId !== workspaceId) {
                        this.dispose(oldestId);
                    }
                }
                return entry;
            })();
            this.creating.set(workspaceId, creating);
            // 无论成功失败, 都清理 in-flight 标记 (成功后 entries 已持有)
            void creating.finally(() => this.creating.delete(workspaceId));
        }
        const entry = await creating;

        if (send && pendingEdits && !entry.subscribed) {
            await this.ensureSubscribed(entry, workspaceId, workspacePath, pendingEdits, send, getMode);
        }

        return entry.session;
    }

    has(workspaceId: string): boolean {
        return this.entries.has(workspaceId);
    }

    async setModelForAll(provider: string, modelId: string): Promise<void> {
        await Promise.all([...this.entries.values()].map(async (entry) => {
            const switched = await entry.session.setModel(provider, modelId);
            if (!switched) {
                log.warn("[WorkspaceRegistry] model not found for live session:", provider, modelId);
            }
        }));
    }

    private async ensureSubscribed(
        entry: WorkspaceEntry,
        workspaceId: string,
        workspacePath: string,
        pendingEdits: PendingEdits,
        send: IpcSender,
        getMode?: () => AgentMode,
    ): Promise<void> {
        if (entry.subscribed) return;
        // 复用进行中的订阅 promise, 保证每个 entry 只订阅一次 (TOCTOU)
        if (entry.subscribing) return entry.subscribing;

        entry.subscribing = (async () => {
            try {
                const bridge = createEventBridge(
                    workspaceId,
                    send,
                    {
                        onTurnEnd: (id) => this.onTurnEndHook?.(id),
                    },
                );
                const interceptor = createApprovalInterceptor(workspaceId, {
                    abort: () => entry.session.session.abort(),
                    pendingEdits,
                    send,
                    workspacePath,
                    getMode,
                });
                // 卡死看门狗: agent_start 起计时, agent_end/turn_end/extension_error 清除.
                // 采用"最后活动时间"检测: 任何 agent 事件都更新 lastActivity 并重置计时器,
                // 超过 WATCHDOG_MS 无任何事件 → 视为 session 崩溃, 合成 extension_error 通知 renderer 翻转状态.
                let watchdog: NodeJS.Timeout | null = null;
                const WATCHDOG_MS = 5 * 60 * 1000; // 5 分钟无任何活动即判定卡死
                const armWatchdog = () => {
                    entry.lastActivity = Date.now();
                    if (watchdog) clearTimeout(watchdog);
                    watchdog = setTimeout(() => {
                        watchdog = null;
                        const idle = Date.now() - (entry.lastActivity ?? entry.createdAt);
                        if (idle > WATCHDOG_MS) {
                            log.error("[WorkspaceRegistry] session watchdog fired (stuck running):", workspaceId);
                            const stuckEvent = {
                                type: "extension_error",
                                message: "会话运行超时未结束，可能已崩溃。请重新发起对话。",
                                workspaceId,
                            };
                            try {
                                bridge.handleEvent(stuckEvent as unknown as PiEvent);
                            } catch (err) {
                                log.error("[chat.ipc] watchdog bridge error:", err);
                            }
                        }
                    }, WATCHDOG_MS);
                };
                const disarmWatchdog = () => {
                    if (watchdog) {
                        clearTimeout(watchdog);
                        watchdog = null;
                    }
                };
                // 订阅事件: 先过 interceptor (决策), 再过 bridge (推 renderer)
                // 外部包 @earendil-works/pi-coding-agent 的 subscribe 签名是 (cb: (event: unknown) => void)
                // 这里把它当 PiEvent 用 (类型安全)
                entry.session.session.subscribe(async (rawEvent) => {
                    const event = rawEvent as unknown as PiEvent;
                    // 任何事件都视为活动, 更新最后活动时间
                    entry.lastActivity = Date.now();
                    try {
                        await interceptor.handleEvent(event);
                    } catch (err) {
                        log.error("[chat.ipc] interceptor error:", err);
                    }
                    try {
                        bridge.handleEvent(event);
                    } catch (err) {
                        log.error("[chat.ipc] event-bridge error:", err);
                    }
                    // 看门狗联动: 起始事件 arm, 结束事件 disarm, 中间事件重置计时器
                    if (event?.type === "agent_start" || event?.type === "message_start") {
                        armWatchdog();
                    } else if (
                        event?.type === "agent_end" ||
                        event?.type === "turn_end" ||
                        event?.type === "extension_error"
                    ) {
                        disarmWatchdog();
                    } else if (watchdog) {
                        // 已 arm 状态下, 任何中间事件都重置计时器 (持续活动不卡死)
                        armWatchdog();
                    }
                });
                entry.subscribed = true;
                // dispose 时清理看门狗, 避免泄漏 + 避免对已销毁 session 触发假卡死
                const origDispose = entry.session.dispose.bind(entry.session);
                entry.session.dispose = () => {
                    disarmWatchdog();
                    origDispose();
                };
            } finally {
                // 无论成功失败, 都清理 in-flight 标记 (成功后 subscribed 已为 true)
                entry.subscribing = undefined;
            }
        })();
        return entry.subscribing;
    }

    dispose(workspaceId: string): void {
        const entry = this.entries.get(workspaceId);
        if (entry) {
            try {
                entry.session.dispose();
            } catch (err) {
                log.warn("[WorkspaceRegistry] dispose error for", workspaceId, err);
            }
            this.entries.delete(workspaceId);
        }
        // Notify sibling services so they can clear workspace-scoped caches
        // (e.g. GoalService's react/turn counters). Fire even when no entry
        // existed so services don't accumulate state for disposed workspaces.
        try {
            this.onDisposeWorkspaceHook?.(workspaceId);
        } catch (err) {
            log.warn("[WorkspaceRegistry] onDisposeWorkspace hook error for", workspaceId, err);
        }
    }

    disposeAll(): void {
        for (const [id, entry] of this.entries) {
            try {
                entry.session.dispose();
            } catch (err) {
                log.warn("[WorkspaceRegistry] dispose error for", id, err);
            }
        }
        this.entries.clear();
    }

    size(): number {
        return this.entries.size;
    }
}
