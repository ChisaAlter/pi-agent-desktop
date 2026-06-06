// 主进程侧 session 持久化模块
// 2026-06-06 hotfix: 把 sessions 数组的所有读写操作集中,加入 async mutex
// 串行化避免 text_delta 高频 + turn_end 收尾并发的 race,加 messages 字段
// 持久化支持
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

// ── Mutex: 串行化所有写操作 ────────────────────────────────────────────

let mutexChain: Promise<unknown> = Promise.resolve();

/**
 * 把异步或同步操作串行化,前一个完成后下一个才进.
 * 解决: renderer 端流式 text_delta + turn_end 同时调用 appendMessage/updateMessage
 * 时,主进程 store.set 全量写会因并发 mutate 同一对象导致丢字段.
 */
async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = mutexChain;
    let release: () => void = () => undefined;
    mutexChain = new Promise<void>((resolve) => {
        release = resolve;
    });
    try {
        await prev;
        return await fn();
    } finally {
        release();
    }
}

// ── 基础 CRUD ─────────────────────────────────────────────────────────

export async function listSessions(store: SessionPersistence): Promise<Session[]> {
    return store.get("sessions");
}

export async function getSession(
    store: SessionPersistence,
    id: string,
): Promise<Session | undefined> {
    return store.get("sessions").find((s) => s.id === id);
}

export async function createSession(
    store: SessionPersistence,
    workspaceId: string,
    title?: string,
    id?: string,
): Promise<Session> {
    return withLock(() => {
        const session: Session = {
            id: id ?? `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            workspaceId,
            title: (title ?? "").trim() || "未命名会话",
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const all = store.get("sessions");
        all.push(session);
        store.set("sessions", all);
        return session;
    });
}

export async function renameSession(
    store: SessionPersistence,
    id: string,
    title: string,
): Promise<Session> {
    return withLock(() => {
        const all = store.get("sessions");
        const target = all.find((s) => s.id === id);
        if (!target) {
            throw new Error(`Session not found: ${id}`);
        }
        const trimmed = (title ?? "").trim() || target.title;
        target.title = trimmed;
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return target;
    });
}

export async function deleteSession(
    store: SessionPersistence,
    id: string,
): Promise<void> {
    return withLock(() => {
        const all = store.get("sessions").filter((s) => s.id !== id);
        store.set("sessions", all);
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
    return withLock(() => {
        const all = store.get("sessions");
        const target = all.find((s) => s.id === sessionId);
        if (!target) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        if (target.messages.some((m) => m.id === message.id)) {
            return target;
        }
        target.messages.push(message);
        target.updatedAt = Date.now();
        store.set("sessions", all);
        return target;
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
    return withLock(() => {
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
        return target;
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
    return withLock(() => {
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
        return target;
    });
}
