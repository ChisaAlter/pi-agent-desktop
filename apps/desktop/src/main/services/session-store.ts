// Session persistence module (main process)
// Centralizes all session read/write with async mutex
// Prevents race conditions from high-frequency text_delta + turn_end concurrency
//
// 设计:
//  - 所有写操作走 withLock 串行化(electron-store 全量写不是原子的)
//  - store 引用通过参数注入(测试时 mock 一个 minimal {get,set} 对象即可)
//  - 写失败 throw,IPC 层包成 IpcError
//  - messages 持久化在主进程 session 内,renderer 端 loadSessions 拿到的就是
//    完整 Session(含 messages),不再硬编码 []

import type { Session, Message, ToolCall } from "@shared";

/**
 * 主进程 store 的最小可持久化接口 — 仅取 electron-store 的 get/set 子集,
 * 测试时可以用普通 object 模拟,避免引入 electron 运行时依赖.
 */
export interface SessionPersistence {
    get<K extends "sessions">(key: K): Session[];
    set<K extends "sessions">(key: K, value: Session[]): void;
}

// ── Mutex: 按 key 串行化写操作 ────────────────────────────────────────────

const mutexChains = new Map<string, Promise<unknown>>();

/**
 * 按 key 串行化异步或同步操作: 同一 key 的操作排队执行, 不同 key 可并行.
 * 解决: renderer 端流式 text_delta + turn_end 同时调用 appendMessage/updateMessage
 * 时,主进程 store.set 全量写会因并发 mutate 同一对象导致丢字段.
 * 按 session 粒度加锁后, 不同 session 的操作互不阻塞, 提升并发吞吐.
 */
function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = mutexChains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn); // run regardless of previous success/failure
    mutexChains.set(key, next);
    // Cleanup: remove from map when settled to prevent memory leak.
    // Use then(onFulfilled, onRejected) instead of finally: finally would
    // propagate `next`'s rejection to its own returned promise, producing an
    // unhandled rejection when the caller already handled `next` directly.
    const cleanup = (): void => {
        if (mutexChains.get(key) === next) mutexChains.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
}

// ── Session index ──────────────────────────────────────────────────────
//
// NOTE: electron-store 8.x 的 get() 返回深拷贝 (structuredClone), 不是 live 引用.
// 因此 sessionIndex 缓存的对象引用与下次 store.get("sessions") 返回的不是同一个对象,
// 直接修改 index 里的对象不会反映到 store. 所有写操作必须从 store.get("sessions")
// 返回的数组里 find target 并就地修改, 再 store.set 写回.
// sessionIndex 仅用于 O(1) "session 是否存在" 判断, 不作为修改入口.

const sessionIndex = new Map<string, boolean>();
let indexedStore: SessionPersistence | null = null;

function ensureIndexSynced(store: SessionPersistence): void {
    if (indexedStore !== store) {
        sessionIndex.clear();
        for (const s of store.get("sessions")) {
            sessionIndex.set(s.id, true);
        }
        indexedStore = store;
    }
}

// ── 基础 CRUD ─────────────────────────────────────────────────────────

/**
 * 返回 store 数据的深拷贝, 避免 caller 持有 live 引用原地修改污染持久化态.
 * electron-store 的 get 返回同一个内存对象, IPC handler 在主进程内持有该引用时
 * 任何外部 mutate 会被下次 set 写盘. structuredClone 既快又支持嵌套结构.
 */
function cloneForRead<T>(value: T): T {
    if (value == null || typeof value !== "object") return value;
    try {
        return structuredClone(value);
    } catch {
        // 兜底: 含不可克隆值 (函数等) 时退回 JSON 拷贝
        return JSON.parse(JSON.stringify(value)) as T;
    }
}

export async function listSessions(store: SessionPersistence): Promise<Session[]> {
    return cloneForRead(store.get("sessions"));
}

export async function getSession(
    store: SessionPersistence,
    id: string,
): Promise<Session | undefined> {
    const target = store.get("sessions").find((s) => s.id === id);
    return target ? cloneForRead(target) : undefined;
}

export async function createSession(
    store: SessionPersistence,
    workspaceId: string,
    title?: string,
    id?: string,
): Promise<Session> {
    return withLock("__global__", () => {
        ensureIndexSynced(store);
        const session: Session = {
            id: id ?? `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            workspaceId,
            title: (title ?? "").trim() || "未命名会话",
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            favorite: false,
            tags: [],
            readOnly: false,
            lastOpenedAt: Date.now(),
        };
        const all = store.get("sessions");
        all.push(session);
        sessionIndex.set(session.id, true);
        store.set("sessions", all);
        return cloneForRead(session);
    });
}

export async function renameSession(
    store: SessionPersistence,
    id: string,
    title: string,
): Promise<Session> {
    return withLock(id, () => {
        ensureIndexSynced(store);
        const all = store.get("sessions");
        const target = all.find((s) => s.id === id);
        if (!target) {
            throw new Error(`Session not found: ${id}`);
        }
        const trimmed = (title ?? "").trim() || target.title;
        target.title = trimmed;
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return cloneForRead(target);
    });
}

export async function deleteSession(
    store: SessionPersistence,
    id: string,
): Promise<void> {
    return withLock("__global__", () => {
        ensureIndexSynced(store);
        const all = store.get("sessions").filter((s) => s.id !== id);
        sessionIndex.delete(id);
        store.set("sessions", all);
    });
}

export async function archiveSession(
    store: SessionPersistence,
    id: string,
    archived: boolean,
): Promise<Session> {
    return withLock(id, () => {
        ensureIndexSynced(store);
        const all = store.get("sessions");
        const target = all.find((s) => s.id === id);
        if (!target) {
            throw new Error(`Session not found: ${id}`);
        }
        target.archived = archived;
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return cloneForRead(target);
    });
}

export async function updateSessionMetadata(
    store: SessionPersistence,
    id: string,
    updates: Pick<
        Partial<Session>,
        | "summary"
        | "lastOutputPaths"
        | "favorite"
        | "tags"
        | "archived"
        | "readOnly"
        | "lastOpenedAt"
        | "usage"
        | "toolPermissions"
        | "parentSessionId"
        | "forkedFromMessageId"
        | "forkedAt"
    >,
): Promise<Session> {
    return withLock(id, () => {
        ensureIndexSynced(store);
        const all = store.get("sessions");
        const target = all.find((s) => s.id === id);
        if (!target) {
            throw new Error(`Session not found: ${id}`);
        }
        if (typeof updates.summary === "string") {
            target.summary = updates.summary;
        }
        if (Array.isArray(updates.lastOutputPaths)) {
            target.lastOutputPaths = updates.lastOutputPaths.filter((p) => typeof p === "string");
        }
        if (typeof updates.favorite === "boolean") {
            target.favorite = updates.favorite;
        }
        if (Array.isArray(updates.tags)) {
            target.tags = updates.tags
                .map((tag) => tag.trim())
                .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
        }
        if (typeof updates.archived === "boolean") {
            target.archived = updates.archived;
        }
        if (typeof updates.readOnly === "boolean") {
            target.readOnly = updates.readOnly;
        }
        if (typeof updates.lastOpenedAt === "number") {
            target.lastOpenedAt = updates.lastOpenedAt;
        }
        if (updates.usage && typeof updates.usage.updatedAt === "number") {
            target.usage = updates.usage;
        }
        if (updates.toolPermissions) {
            target.toolPermissions = updates.toolPermissions;
        }
        if (typeof updates.parentSessionId === "string") {
            target.parentSessionId = updates.parentSessionId;
        }
        if (typeof updates.forkedFromMessageId === "string") {
            target.forkedFromMessageId = updates.forkedFromMessageId;
        }
        if (typeof updates.forkedAt === "number") {
            target.forkedAt = updates.forkedAt;
        }
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return cloneForRead(target);
    });
}

// ── Messages 持久化 ───────────────────────────────────────────────────

/**
 * 追加一条 message 到 session 末尾.
 *  - 已存在 message(同 id)则不追加,返回当前 session(幂等)
 *  - session 不存在抛错
 */
export async function appendMessage(
    store: SessionPersistence,
    sessionId: string,
    message: Message,
): Promise<Session> {
    return withLock(sessionId, () => {
        ensureIndexSynced(store);
        const all = store.get("sessions");
        const target = all.find((s) => s.id === sessionId);
        if (!target) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        if (target.messages.some((m) => m.id === message.id)) {
            return cloneForRead(target);
        }
        target.messages.push(message);
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return cloneForRead(target);
    });
}

/**
 * 局部更新一条 message (e.g. text_delta 累积后写 content).
 *  - 不修改 message id / role / timestamp
 *  - updates 用 Object.assign 浅合并,toolCalls 数组整体替换(由调用方传完整)
 */
export async function updateMessage(
    store: SessionPersistence,
    sessionId: string,
    messageId: string,
    updates: Partial<Message>,
): Promise<Session> {
    return withLock(sessionId, () => {
        ensureIndexSynced(store);
        const all = store.get("sessions");
        const target = all.find((s) => s.id === sessionId);
        if (!target) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const msg = target.messages.find((m) => m.id === messageId);
        if (!msg) {
            throw new Error(`Message not found: ${messageId} in session ${sessionId}`);
        }
        // 浅合并 — caller 传完整 toolCalls 数组(不增量)
        Object.assign(msg, updates);
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return cloneForRead(target);
    });
}

/**
 * 局部更新一个 tool call.
 *  - message 不存在抛错
 *  - tool call 不存在抛错(避免静默新增,因为 streaming 流程强依赖按 id 命中)
 */
export async function updateToolCall(
    store: SessionPersistence,
    sessionId: string,
    messageId: string,
    toolCallId: string,
    updates: Partial<ToolCall>,
): Promise<Session> {
    return withLock(sessionId, () => {
        ensureIndexSynced(store);
        const all = store.get("sessions");
        const target = all.find((s) => s.id === sessionId);
        if (!target) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const msg = target.messages.find((m) => m.id === messageId);
        if (!msg) {
            throw new Error(`Message not found: ${messageId} in session ${sessionId}`);
        }
        if (!msg.toolCalls) {
            msg.toolCalls = [];
        }
        const tc = msg.toolCalls.find((t) => t.id === toolCallId);
        if (!tc) {
            throw new Error(
                `ToolCall not found: ${toolCallId} in message ${messageId}`,
            );
        }
        Object.assign(tc, updates);
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return cloneForRead(target);
    });
}
