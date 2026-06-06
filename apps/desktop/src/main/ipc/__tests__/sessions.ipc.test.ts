// 2026-06-06 hotfix: sessions.ipc 单测
// 覆盖 7 个 handler (4 原有 + 3 新增) + zod 校验失败路径

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, Message } from "@shared";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn(),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

import { setupSessionsIpc, type SessionsIpcDeps } from "../sessions.ipc";
import type { SessionPersistence } from "../../services/session-store";

// ── In-memory store mock ───────────────────────────────────────────────

function makeStore(seed: Session[] = []): SessionPersistence & {
    raw: Session[];
    writes: number;
} {
    const raw: Session[] = [...seed];
    let writes = 0;
    return {
        raw,
        get writes() {
            return writes;
        },
        get(_key) {
            return raw;
        },
        set(_key, value) {
            writes += 1;
            const snapshot = [...value];
            raw.length = 0;
            for (const v of snapshot) raw.push(v);
        },
    };
}

function setupWithStore(seed: Session[] = []) {
    const store = makeStore(seed);
    setupSessionsIpc({ store } as SessionsIpcDeps);
    return store;
}

const userMsg: Message = {
    id: "m1",
    role: "user",
    content: "hello",
    timestamp: new Date("2026-06-06T10:00:00Z"),
};

const asstMsg: Message = {
    id: "m2",
    role: "assistant",
    content: "world",
    timestamp: new Date("2026-06-06T10:00:01Z"),
};

// ── 原有 4 个 handler ──────────────────────────────────────────────────

describe("session:list", () => {
    beforeEach(() => handlers.clear());

    it("返回 store.get('sessions') 的内容", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "a",
                messages: [],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        const store = setupWithStore(seed);
        const handler = handlers.get("session:list")!;
        const result = await handler();
        expect(result).toBe(store.raw);
    });
});

describe("session:create", () => {
    beforeEach(() => handlers.clear());

    it("创建 session, 初始化 messages: []", async () => {
        const store = setupWithStore();
        const handler = handlers.get("session:create")!;
        const result = (await handler({}, "ws1", "title", "s1")) as Session;
        expect(result.id).toBe("s1");
        expect(result.title).toBe("title");
        expect(result.messages).toEqual([]);
        expect(store.raw).toHaveLength(1);
    });

    it("服务抛错时返 IpcError 而不是 throw", async () => {
        setupWithStore();
        // store.set 抛错模拟
        const orig = (handlers.get("session:create") as (...a: unknown[]) => unknown);
        // 上面已经注册了,改成改 store,看是否能优雅返 IpcError
        const store = makeStore();
        handlers.clear();
        setupSessionsIpc({ store } as SessionsIpcDeps);
        // 注入一个抛错的 store.set
        const origSet = store.set;
        store.set = () => {
            throw new Error("disk full");
        };
        const handler = handlers.get("session:create")!;
        const result = (await handler({}, "ws1", "t")) as { code: string; fallback: string };
        expect(result.code).toBe("ipcErrors.session.createFailed");
        expect(result.fallback).toContain("disk full");
        store.set = origSet;
        void orig;
    });
});

describe("session:rename", () => {
    beforeEach(() => handlers.clear());

    it("id 存在则改 title + updatedAt", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "old",
                messages: [],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        setupWithStore(seed);
        const handler = handlers.get("session:rename")!;
        const result = (await handler({}, "s1", "new")) as Session;
        expect(result.title).toBe("new");
    });

    it("id 不存在返 IpcError", async () => {
        setupWithStore();
        const handler = handlers.get("session:rename")!;
        const result = (await handler({}, "ghost", "x")) as { code: string };
        expect(result.code).toBe("ipcErrors.session.renameFailed");
    });
});

describe("session:delete", () => {
    beforeEach(() => handlers.clear());

    it("删指定 id 返 undefined", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "a",
                messages: [],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        const store = setupWithStore(seed);
        const handler = handlers.get("session:delete")!;
        const result = await handler({}, "s1");
        expect(result).toBeUndefined();
        expect(store.raw).toHaveLength(0);
    });

    it("id 不存在静默 noop, 返 undefined (跟原 index.ts 行为一致)", async () => {
        // 旧 index.ts 实现: filter 不命中,不抛错,返 undefined.
        // services/session-store.deleteSession 行为是"找不到也静默",
        // 保持向后兼容,UI 端 toast 提示由 caller 处理.
        setupWithStore();
        const handler = handlers.get("session:delete")!;
        const result = await handler({}, "ghost");
        expect(result).toBeUndefined();
    });
});

// ── 新增 3 个 handler ────────────────────────────────────────────────

describe("session:append-message", () => {
    beforeEach(() => handlers.clear());

    it("追加到 session.messages 末尾", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "t",
                messages: [],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        setupWithStore(seed);
        const handler = handlers.get("session:append-message")!;
        const result = await handler({}, "s1", userMsg);
        expect(result).toBeUndefined();
        // store 的 session.messages 应该有 1 条
        const s = (handlers.get("session:list") as (...a: unknown[]) => unknown)();
        const sessions = (await s) as Session[];
        expect(sessions[0].messages).toHaveLength(1);
        expect(sessions[0].messages[0].id).toBe("m1");
    });

    it("参数缺 id 返 IpcError (zod 校验失败)", async () => {
        setupWithStore();
        const handler = handlers.get("session:append-message")!;
        const result = (await handler({}, "s1", { role: "user", content: "x" })) as {
            code: string;
        };
        expect(result.code).toBe("ipcErrors.session.appendMessageInvalid");
    });

    it("role 非法值返 IpcError", async () => {
        setupWithStore();
        const handler = handlers.get("session:append-message")!;
        const result = (await handler({}, "s1", {
            id: "m1",
            role: "bot", // 非法
            content: "x",
            timestamp: new Date(),
        })) as { code: string };
        expect(result.code).toBe("ipcErrors.session.appendMessageInvalid");
    });

    it("session 不存在返 IpcError", async () => {
        setupWithStore();
        const handler = handlers.get("session:append-message")!;
        const result = (await handler({}, "ghost", userMsg)) as { code: string };
        expect(result.code).toBe("ipcErrors.session.appendMessageFailed");
    });
});

describe("session:update-message", () => {
    beforeEach(() => handlers.clear());

    it("局部更新 content", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "t",
                messages: [asstMsg],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        setupWithStore(seed);
        const handler = handlers.get("session:update-message")!;
        const result = await handler({}, "s1", "m2", { content: "new content" });
        expect(result).toBeUndefined();
        const sessions = ((handlers.get("session:list") as (...a: unknown[]) => unknown)() as
            Promise<Session[]>);
        const list = await sessions;
        expect(list[0].messages[0].content).toBe("new content");
    });

    it("messageId 不存在返 IpcError", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "t",
                messages: [asstMsg],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        setupWithStore(seed);
        const handler = handlers.get("session:update-message")!;
        const result = (await handler({}, "s1", "ghost", { content: "x" })) as {
            code: string;
        };
        expect(result.code).toBe("ipcErrors.session.updateMessageFailed");
    });

    it("参数类型错返 IpcError (zod)", async () => {
        setupWithStore();
        const handler = handlers.get("session:update-message")!;
        const result = (await handler({}, "s1", "m2", { role: 123 })) as { code: string };
        expect(result.code).toBe("ipcErrors.session.updateMessageInvalid");
    });
});

describe("session:update-tool-call", () => {
    beforeEach(() => handlers.clear());

    it("局部更新 tool call status", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "t",
                messages: [
                    {
                        id: "m2",
                        role: "assistant",
                        content: "",
                        timestamp: new Date(),
                        toolCalls: [
                            {
                                id: "tc1",
                                name: "read",
                                status: "running",
                                startTime: new Date(),
                            },
                        ],
                    },
                ],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        setupWithStore(seed);
        const handler = handlers.get("session:update-tool-call")!;
        const result = await handler({}, "s1", "m2", "tc1", { status: "completed" });
        expect(result).toBeUndefined();
        const sessions = (await (handlers.get("session:list") as (
            ...a: unknown[]
        ) => unknown)()) as Session[];
        const tc = sessions[0].messages[0].toolCalls![0];
        expect(tc.status).toBe("completed");
    });

    it("tool call id 不存在返 IpcError", async () => {
        const seed: Session[] = [
            {
                id: "s1",
                workspaceId: "ws1",
                title: "t",
                messages: [asstMsg],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        setupWithStore(seed);
        const handler = handlers.get("session:update-tool-call")!;
        const result = (await handler({}, "s1", "m2", "ghost", {
            status: "completed",
        })) as { code: string };
        expect(result.code).toBe("ipcErrors.session.updateToolCallFailed");
    });

    it("status 非法值返 IpcError", async () => {
        setupWithStore();
        const handler = handlers.get("session:update-tool-call")!;
        const result = (await handler({}, "s1", "m2", "tc1", { status: "magic" })) as {
            code: string;
        };
        expect(result.code).toBe("ipcErrors.session.updateToolCallInvalid");
    });
});

// ── 防重复注册回归(no-duplicate-ipc.test.ts 已经扫过字面量) ─────────

describe("IPC channel 名称字面量", () => {
    it("注册了 7 个 session:* handler", () => {
        handlers.clear();
        setupWithStore();
        const sessionHandlers = Array.from(handlers.keys()).filter((k) =>
            k.startsWith("session:"),
        );
        expect(sessionHandlers.sort()).toEqual(
            [
                "session:append-message",
                "session:create",
                "session:delete",
                "session:list",
                "session:rename",
                "session:update-message",
                "session:update-tool-call",
            ].sort(),
        );
    });
});
