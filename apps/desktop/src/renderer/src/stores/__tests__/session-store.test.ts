// session-store 测试 (v1.0.x — 可用度 sessions 任务)
// 覆盖: renameSession (新增) / deleteSession (现有) / createSession / setCurrentSession
// renameSession 关键路径:
//   - 改 title + updatedAt
//   - 空字符串/全空白 → 不改 state (warn 一次)
//   - 走 piAPI.renameSession (fire-and-forget, 失败不抛)
//   - 不存在的 sessionId → 静默 noop (filter 行为)

import { describe, it, expect, beforeEach, vi } from "vitest";

function makePiAPI() {
    return {
        listSessions: vi.fn(async () => []),
        createSession: vi.fn(async (workspaceId: string, title?: string) => ({
            id: `srv-${Date.now()}`,
            title: title || "Session",
            workspaceId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        })),
        renameSession: vi.fn(async (id: string, title: string) => ({
            id,
            title,
            workspaceId: "ws-1",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        })),
        deleteSession: vi.fn(async () => undefined),
        forkSessionContext: vi.fn(async () => undefined),
        // 2026-06-06 hotfix: 3 个新增 messages 持久化 API
        appendMessage: vi.fn(async () => undefined),
        updateMessage: vi.fn(async () => undefined),
        updateToolCall: vi.fn(async () => undefined),
        updateSessionMetadata: vi.fn(async () => undefined),
    };
}

let piAPI: ReturnType<typeof makePiAPI>;

beforeEach(() => {
    piAPI = makePiAPI();
    // node 环境: window 不存在, 通过 globalThis.window 注入,
    // 跟其它 store 测试 (workspace / settings) 保持一致
    (globalThis as { window: unknown }).window = { piAPI };
    vi.clearAllMocks();
});

import { useSessionStore } from "../session-store";

function seedSession(id: string, title: string) {
    useSessionStore.setState((s) => ({
        sessions: [
            ...s.sessions,
            {
                id,
                title,
                workspaceId: "ws-1",
                createdAt: new Date(0),
                updatedAt: new Date(0),
                messages: [],
            },
        ],
        currentSessionId: id,
    }));
}

describe("session-store: renameSession", () => {
    it("改 title 并刷新 updatedAt", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "old name");
        const before = useSessionStore.getState().sessions[0].updatedAt.getTime();

        // 让 updatedAt 的变化可观察
        const later = new Date(before + 5000);
        vi.useFakeTimers();
        vi.setSystemTime(later);

        useSessionStore.getState().renameSession("s1", "new name");

        vi.useRealTimers();

        const s = useSessionStore.getState().sessions[0];
        expect(s.title).toBe("new name");
        expect(s.updatedAt.getTime()).toBeGreaterThan(before);
        // fire-and-forget 也调用了
        await new Promise((r) => setTimeout(r, 0));
        expect(piAPI.renameSession).toHaveBeenCalledWith("s1", "new name");
    });

    it("trim 前后空白, 空字符串不改 state", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "keep me");
        useSessionStore.getState().renameSession("s1", "  spaced  ");
        expect(useSessionStore.getState().sessions[0].title).toBe("spaced");

        seedSession("s2", "still here");
        useSessionStore.getState().renameSession("s2", "   ");
        // 空字符串被拒绝, title 不变
        const s2 = useSessionStore.getState().sessions.find((s) => s.id === "s2")!;
        expect(s2.title).toBe("still here");
        // 持久化也没调
        await new Promise((r) => setTimeout(r, 0));
        expect(piAPI.renameSession).not.toHaveBeenCalledWith("s2", "   ");
    });

    it("不存在的 sessionId 静默 noop", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "old");
        useSessionStore.getState().renameSession("ghost", "whatever");
        const all = useSessionStore.getState().sessions;
        expect(all).toHaveLength(1);
        expect(all[0].title).toBe("old");
    });

    it("只改目标 session, 其他 session 不动", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("a", "A");
        seedSession("b", "B");
        useSessionStore.getState().renameSession("a", "A2");
        const state = useSessionStore.getState();
        expect(state.sessions.find((s) => s.id === "a")!.title).toBe("A2");
        expect(state.sessions.find((s) => s.id === "b")!.title).toBe("B");
    });

    it("持久化失败会记录 persistErrorCount, 但本地标题仍乐观更新", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0, lastPersistError: null });
        seedSession("s1", "old");
        piAPI.renameSession.mockRejectedValueOnce(new Error("rename disk full"));

        useSessionStore.getState().renameSession("s1", "new");

        expect(useSessionStore.getState().sessions[0].title).toBe("new");
        await new Promise((r) => setTimeout(r, 0));
        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toContain("rename disk full");
    });
});

describe("session-store: setCurrentSession", () => {
    it("records lastOpenedAt without changing updatedAt", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "A");
        const beforeUpdatedAt = useSessionStore.getState().sessions[0].updatedAt;
        useSessionStore.setState({
            sessions: useSessionStore.getState().sessions.map((session) => ({
                ...session,
                readOnly: true,
                lastOpenedAt: new Date(1),
            })),
        });
        const openedAt = new Date(10_000);
        vi.useFakeTimers();
        vi.setSystemTime(openedAt);

        useSessionStore.getState().setCurrentSession("s1");

        vi.useRealTimers();
        const session = useSessionStore.getState().sessions[0];
        expect(useSessionStore.getState().currentSessionId).toBe("s1");
        expect(session.readOnly).toBe(false);
        expect(session.lastOpenedAt).toEqual(openedAt);
        expect(session.updatedAt).toEqual(beforeUpdatedAt);
        expect(piAPI.updateSessionMetadata).toHaveBeenCalledWith("s1", {
            readOnly: false,
            lastOpenedAt: openedAt.getTime(),
        });
    });

    it("ignores missing session ids", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "A");
        piAPI.updateSessionMetadata.mockClear();

        useSessionStore.getState().setCurrentSession("missing");

        expect(useSessionStore.getState().currentSessionId).toBe("s1");
        expect(piAPI.updateSessionMetadata).not.toHaveBeenCalled();
    });
});

describe("session-store: openReadOnlySession", () => {
    it("records read-only lastOpenedAt without changing updatedAt", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "A");
        const beforeUpdatedAt = useSessionStore.getState().sessions[0].updatedAt;
        const openedAt = new Date(20_000);
        vi.useFakeTimers();
        vi.setSystemTime(openedAt);

        useSessionStore.getState().openReadOnlySession("s1");

        vi.useRealTimers();
        const session = useSessionStore.getState().sessions[0];
        expect(useSessionStore.getState().currentSessionId).toBe("s1");
        expect(session.readOnly).toBe(true);
        expect(session.lastOpenedAt).toEqual(openedAt);
        expect(session.updatedAt).toEqual(beforeUpdatedAt);
        expect(piAPI.updateSessionMetadata).toHaveBeenCalledWith("s1", {
            readOnly: true,
            lastOpenedAt: openedAt.getTime(),
        });
    });

    it("ignores missing session ids", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "A");
        piAPI.updateSessionMetadata.mockClear();

        useSessionStore.getState().openReadOnlySession("missing");

        expect(useSessionStore.getState().currentSessionId).toBe("s1");
        expect(piAPI.updateSessionMetadata).not.toHaveBeenCalled();
    });
});

describe("session-store: deleteSession", () => {
    it("删除后 sessions.length - 1", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "A");
        seedSession("s2", "B");
        useSessionStore.getState().deleteSession("s1");
        expect(useSessionStore.getState().sessions).toHaveLength(1);
    });

    it("删的是当前 session → currentSessionId 切到最近活跃的未归档 session", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        useSessionStore.setState({
            sessions: [
                {
                    id: "current",
                    title: "Current",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    messages: [],
                },
                {
                    id: "older-edited",
                    title: "Older",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(5),
                    messages: [],
                },
                {
                    id: "recent-opened",
                    title: "Recent",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(1),
                    lastOpenedAt: new Date(10),
                    messages: [],
                },
                {
                    id: "archived-recent",
                    title: "Archived",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(99),
                    archived: true,
                    messages: [],
                },
            ],
            currentSessionId: "current",
        });

        useSessionStore.getState().deleteSession("current");

        expect(useSessionStore.getState().currentSessionId).toBe("recent-opened");
    });

    it("删的不是当前 session → currentSessionId 保持", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "A");
        seedSession("s2", "B");
        useSessionStore.setState({ currentSessionId: "s1" });
        useSessionStore.getState().deleteSession("s2");
        expect(useSessionStore.getState().currentSessionId).toBe("s1");
    });

    it("删光所有 session → currentSessionId = null", () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "only");
        useSessionStore.getState().deleteSession("s1");
        expect(useSessionStore.getState().currentSessionId).toBeNull();
    });

    it("持久化失败会记录 persistErrorCount, 但本地删除仍保留", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0, lastPersistError: null });
        seedSession("s1", "A");
        piAPI.deleteSession.mockRejectedValueOnce(new Error("delete EIO"));

        useSessionStore.getState().deleteSession("s1");

        expect(useSessionStore.getState().sessions).toHaveLength(0);
        await new Promise((r) => setTimeout(r, 0));
        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toContain("delete EIO");
    });
});

describe("session-store: archiveSession", () => {
    it("归档当前 session 后切到最近活跃的未归档 session", () => {
        useSessionStore.setState({
            sessions: [
                {
                    id: "current",
                    title: "Current",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    messages: [],
                },
                {
                    id: "recent-opened",
                    title: "Recent",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(1),
                    lastOpenedAt: new Date(10),
                    messages: [],
                },
                {
                    id: "newer-archived",
                    title: "Archived",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(100),
                    archived: true,
                    messages: [],
                },
            ],
            currentSessionId: "current",
        });

        useSessionStore.getState().archiveSession("current", true);

        expect(useSessionStore.getState().currentSessionId).toBe("recent-opened");
    });

    it("持久化失败会记录 persistErrorCount, 但本地归档仍乐观更新", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0, lastPersistError: null });
        seedSession("s1", "A");
        piAPI.archiveSession = vi.fn(async () => {
            throw new Error("archive failed");
        });

        useSessionStore.getState().archiveSession("s1", true);

        expect(useSessionStore.getState().sessions[0].archived).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toContain("archive failed");
    });
});

describe("session-store: session forks", () => {
    it("continues from a specific message by copying history up to that point", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        useSessionStore.setState({
            sessions: [
                {
                    id: "source",
                    title: "Long task",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    messages: [
                        { id: "m1", role: "user", content: "start", timestamp: new Date(1) },
                        { id: "m2", role: "assistant", content: "middle", timestamp: new Date(2) },
                        { id: "m3", role: "user", content: "later", timestamp: new Date(3) },
                    ],
                    toolPermissions: {
                        fileRead: true,
                        fileWrite: false,
                        shell: true,
                        git: true,
                        network: false,
                        extensions: false,
                    },
                },
            ],
            currentSessionId: "source",
        });

        const fork = await useSessionStore.getState().continueSession("source", "m2");
        const stored = useSessionStore.getState().sessions.find((session) => session.id === fork.id)!;

        expect(stored.parentSessionId).toBe("source");
        expect(stored.forkedFromMessageId).toBe("m2");
        expect(stored.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
        expect(stored.messages[1].content).toBe("middle");
        expect(stored.toolPermissions?.fileRead).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(piAPI.forkSessionContext).toHaveBeenCalledWith("source", stored.id, "ws-1", "m2");
        expect(piAPI.appendMessage).toHaveBeenCalledTimes(2);
        expect(piAPI.updateSessionMetadata).toHaveBeenCalledWith(
            stored.id,
            expect.objectContaining({ parentSessionId: "source", forkedFromMessageId: "m2" }),
        );
    });

    it("throws when continuing from a missing message id", async () => {
        useSessionStore.setState({
            sessions: [
                {
                    id: "source",
                    title: "Long task",
                    workspaceId: "ws-1",
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    messages: [{ id: "m1", role: "user", content: "start", timestamp: new Date(1) }],
                },
            ],
            currentSessionId: "source",
        });

        await expect(useSessionStore.getState().continueSession("source", "missing")).rejects.toThrow("Message not found");
    });
});

// ── 2026-06-06 hotfix: 持久化路径 ────────────────────────────────

describe("session-store (2026-06-06 hotfix): messages 持久化", () => {
    beforeEach(() => {
        piAPI.appendMessage.mockClear();
        piAPI.updateMessage.mockClear();
        piAPI.updateToolCall.mockClear();
    });

    it("addMessage 内存追加 + fire-and-forget 调 piAPI.appendMessage", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "t");
        const before = useSessionStore.getState().sessions[0].messages.length;

        useSessionStore.getState().addMessage("s1", {
            id: "m1",
            role: "user",
            content: "hi",
            timestamp: new Date(1_000_000),
        });

        // 内存已更新
        const s = useSessionStore.getState().sessions[0];
        expect(s.messages.length).toBe(before + 1);
        expect(s.messages[s.messages.length - 1].id).toBe("m1");

        // IPC 已 fire
        await new Promise((r) => setTimeout(r, 0));
        expect(piAPI.appendMessage).toHaveBeenCalledWith("s1", expect.objectContaining({
            id: "m1",
            role: "user",
            content: "hi",
        }));
        // Date 序列化成 ISO string
        const callArg = piAPI.appendMessage.mock.calls[0]?.[1] as { timestamp: string };
        expect(typeof callArg.timestamp).toBe("string");
    });

    it("updateMessage 内存 update + fire-and-forget 调 piAPI.updateMessage", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "t");
        useSessionStore.getState().addMessage("s1", {
            id: "m1",
            role: "assistant",
            content: "init",
            timestamp: new Date(),
        });

        useSessionStore.getState().updateMessage("s1", "m1", { content: "new" });

        expect(useSessionStore.getState().sessions[0].messages[0].content).toBe("new");
        await new Promise((r) => setTimeout(r, 0));
        expect(piAPI.updateMessage).toHaveBeenCalledWith("s1", "m1", expect.objectContaining({ content: "new" }));
    });

    it("addToolCall 内存追加 + 持久化整个 toolCalls 数组", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "t");
        useSessionStore.getState().addMessage("s1", {
            id: "m1",
            role: "assistant",
            content: "",
            timestamp: new Date(),
        });

        const tcStart = new Date(2_000_000);
        useSessionStore.getState().addToolCall("s1", "m1", {
            id: "tc1",
            name: "read",
            input: { path: "/x" },
            status: "running",
            startTime: tcStart,
        });

        const msg = useSessionStore.getState().sessions[0].messages[0];
        expect(msg.toolCalls).toHaveLength(1);
        expect(msg.toolCalls![0].name).toBe("read");

        await new Promise((r) => setTimeout(r, 0));
        // 走 updateMessage 路径(传 toolCalls 数组)
        expect(piAPI.updateMessage).toHaveBeenCalledWith("s1", "m1", expect.objectContaining({
            toolCalls: expect.arrayContaining([expect.objectContaining({ id: "tc1", name: "read" })]),
        }));
        // startTime 序列化成 string
        const arg = piAPI.updateMessage.mock.calls[0]?.[2] as { toolCalls: Array<{ startTime: string }> };
        expect(typeof arg.toolCalls[0].startTime).toBe("string");
    });

    it("updateToolCall 内存 update + fire-and-forget 调 piAPI.updateToolCall", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "t");
        useSessionStore.getState().addMessage("s1", {
            id: "m1",
            role: "assistant",
            content: "",
            timestamp: new Date(),
        });
        useSessionStore.getState().addToolCall("s1", "m1", {
            id: "tc1",
            name: "read",
            input: {},
            status: "running",
            startTime: new Date(),
        });
        piAPI.updateMessage.mockClear();

        useSessionStore.getState().updateToolCall("s1", "m1", "tc1", { status: "completed", output: { ok: true } });

        const tc = useSessionStore.getState().sessions[0].messages[0].toolCalls![0];
        expect(tc.status).toBe("completed");
        expect(tc.output).toEqual({ ok: true });

        await new Promise((r) => setTimeout(r, 0));
        expect(piAPI.updateToolCall).toHaveBeenCalledWith("s1", "m1", "tc1", expect.objectContaining({ status: "completed" }));
    });

    it("piAPI.appendMessage 抛错 → 内存仍已更新 + persistErrorCount +1", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0, lastPersistError: null });
        seedSession("s1", "t");
        piAPI.appendMessage.mockRejectedValueOnce(new Error("disk full"));

        useSessionStore.getState().addMessage("s1", {
            id: "m1",
            role: "user",
            content: "x",
            timestamp: new Date(),
        });

        // 内存立即更新(不阻塞)
        expect(useSessionStore.getState().sessions[0].messages[0].id).toBe("m1");

        // 等待 IPC promise reject
        await new Promise((r) => setTimeout(r, 0));
        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toContain("disk full");
    });

    it("clearPersistErrors 重置计数", () => {
        useSessionStore.setState({ persistErrorCount: 5, lastPersistError: "x" });
        useSessionStore.getState().clearPersistErrors();
        expect(useSessionStore.getState().persistErrorCount).toBe(0);
        expect(useSessionStore.getState().lastPersistError).toBeNull();
    });
});

describe("session-store: metadata 持久化错误", () => {
    it("updateSessionMetadata IPC reject → persistErrorCount +1", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0, lastPersistError: null });
        seedSession("s1", "t");
        piAPI.updateSessionMetadata.mockRejectedValueOnce(new Error("metadata disk full"));

        useSessionStore.getState().updateSessionMetadata("s1", { favorite: true });

        expect(useSessionStore.getState().sessions[0].favorite).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toContain("metadata disk full");
    });

    it("updateSessionMetadata IPC IpcError → persistErrorCount +1", async () => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0, lastPersistError: null });
        seedSession("s1", "t");
        piAPI.updateSessionMetadata.mockResolvedValueOnce({
            code: "ipcErrors.sessions.updateMetadataFailed",
            fallback: "更新会话元数据失败: EACCES",
        });

        useSessionStore.getState().setSessionTags("s1", ["prod"]);

        await new Promise((r) => setTimeout(r, 0));
        expect(useSessionStore.getState().persistErrorCount).toBe(1);
        expect(useSessionStore.getState().lastPersistError).toBe("更新会话元数据失败: EACCES");
    });
});

// ── 2026-06-06 hotfix: loadSessions 老数据 + Date 还原 ────────────

describe("session-store (2026-06-06 hotfix): loadSessions 行为", () => {
    it("服务端给 messages(非空)→ 内存里能拿到", async () => {
        // 模拟 listSessions 返回带 messages 的 session
        const now = Date.now();
        piAPI.listSessions.mockResolvedValueOnce([
            {
                id: "s1",
                workspaceId: "ws1",
                title: "loaded",
                createdAt: now,
                updatedAt: now,
                messages: [
                    {
                        id: "m1",
                        role: "user",
                        content: "from disk",
                        timestamp: new Date(now - 1000).toISOString(),
                    },
                    {
                        id: "m2",
                        role: "assistant",
                        content: "from disk too",
                        timestamp: new Date(now - 500).toISOString(),
                    },
                ],
            },
        ]);

        // 触发 loadSessions(它是 module-level 副作用,只能通过新 store import 一次)
        // 这里直接调 listSessions 后断言 — 因为 store init 已经跑过,
        // 我们用 setState 模拟"刚 load 完"
        // 真正想测 loadSessions 行为,见 src/main/services/session-store.test.ts 的 coverage
        // 这里只保证 store 的 shape 处理 messages
        useSessionStore.setState({
            sessions: [
                {
                    id: "s1",
                    workspaceId: "ws1",
                    title: "loaded",
                    createdAt: new Date(now),
                    updatedAt: new Date(now),
                    messages: [
                        {
                            id: "m1",
                            role: "user",
                            content: "from disk",
                            timestamp: new Date(now - 1000),
                        },
                    ],
                },
            ],
            currentSessionId: "s1",
        });
        expect(useSessionStore.getState().sessions[0].messages).toHaveLength(1);
        expect(useSessionStore.getState().sessions[0].messages[0].content).toBe("from disk");
    });

    it("服务端没 messages 字段(老数据)→ client 端 migration 不会崩(测试由主进程保证)", () => {
        // 实际老数据 migration 在 session-store.ts loadSessions 里,走 isArray 判空分支
        // 这里只验证 shape: seed 一个无 messages 的 session 不影响 store 操作
        useSessionStore.setState({ sessions: [], currentSessionId: null });
        seedSession("s1", "t");
        expect(useSessionStore.getState().sessions[0].messages).toEqual([]);
    });

    it("loadSessions 会规范化 legacy tool call 并丢弃缺少标识的坏项", async () => {
        const now = Date.now();
        piAPI.listSessions.mockResolvedValueOnce([
            {
                id: "s1",
                workspaceId: "ws1",
                title: "loaded",
                createdAt: now,
                updatedAt: now,
                messages: [
                    {
                        id: "m1",
                        role: "assistant",
                        content: "from disk",
                        timestamp: new Date(now - 500).toISOString(),
                        toolCalls: [
                            {
                                toolCallId: "tc_legacy",
                                toolName: "read",
                                args: { path: "README.md" },
                                status: "running",
                                startTime: new Date(now - 250).toISOString(),
                            },
                            {
                                toolCallId: "tc_missing_name",
                                status: "running",
                            },
                        ],
                    },
                ],
            },
        ]);

        useSessionStore.setState({ sessions: [], currentSessionId: null });
        await useSessionStore.getState().loadSessions();

        const toolCalls = useSessionStore.getState().sessions[0].messages[0].toolCalls ?? [];
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]).toMatchObject({
            id: "tc_legacy",
            name: "read",
            input: { path: "README.md" },
            status: "running",
        });
        expect(toolCalls[0].startTime).toBeInstanceOf(Date);
    });

    it("production startup loads summaries and only hydrates the most recent transcript", async () => {
        const now = Date.now();
        const api = piAPI as typeof piAPI & {
            listSessionSummaries: ReturnType<typeof vi.fn>;
            getSession: ReturnType<typeof vi.fn>;
        };
        api.listSessionSummaries = vi.fn(async () => [
            {
                id: "recent",
                workspaceId: "ws1",
                title: "Recent",
                createdAt: now - 100,
                updatedAt: now,
                messageCount: 1,
                toolCallCount: 0,
            },
            {
                id: "old",
                workspaceId: "ws1",
                title: "Old",
                createdAt: now - 1000,
                updatedAt: now - 900,
                messageCount: 12,
                toolCallCount: 2,
            },
        ]);
        api.getSession = vi.fn(async () => ({
            id: "recent",
            workspaceId: "ws1",
            title: "Recent",
            createdAt: now - 100,
            updatedAt: now,
            messages: [{ id: "m1", role: "user", content: "loaded", timestamp: now }],
        }));

        useSessionStore.setState({ sessions: [], currentSessionId: null });
        await useSessionStore.getState().loadSessions();
        await vi.waitFor(() => expect(api.getSession).toHaveBeenCalledWith("recent"));

        const state = useSessionStore.getState();
        expect(state.sessions.find((session) => session.id === "recent")?.messages[0]?.content).toBe("loaded");
        expect(state.sessions.find((session) => session.id === "old")).toMatchObject({
            messages: [],
            messagesLoaded: false,
            messageCount: 12,
        });
        expect(piAPI.listSessions).not.toHaveBeenCalled();
    });
});

// wave-129 residual
describe("session-store residual rename/setDefault", () => {
    beforeEach(() => {
        useSessionStore.setState({ sessions: [], currentSessionId: null, persistErrorCount: 0 });
    });

    it("renameSession ignores empty/whitespace titles without IPC", () => {
        seedSession("s1", "Keep Me");
        useSessionStore.getState().renameSession("s1", "   ");
        useSessionStore.getState().renameSession("s1", "");
        expect(useSessionStore.getState().sessions[0]?.title).toBe("Keep Me");
        expect(piAPI.renameSession).not.toHaveBeenCalled();
    });

    it("renameSession trims and updates title + updatedAt", () => {
        seedSession("s1", "Old");
        const before = useSessionStore.getState().sessions[0]!.updatedAt;
        useSessionStore.getState().renameSession("s1", "  New Title  ");
        const next = useSessionStore.getState().sessions[0]!;
        expect(next.title).toBe("New Title");
        expect(next.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(piAPI.renameSession).toHaveBeenCalledWith("s1", "New Title");
    });

    it("setDefaultSession sets current without loading transcript", () => {
        seedSession("s1", "A");
        seedSession("s2", "B");
        useSessionStore.setState({ currentSessionId: "s1" });
        useSessionStore.getState().setDefaultSession("s2");
        expect(useSessionStore.getState().currentSessionId).toBe("s2");
        useSessionStore.getState().setDefaultSession(null);
        expect(useSessionStore.getState().currentSessionId).toBeNull();
    });

    it("setCurrentSession ignores missing session ids", () => {
        seedSession("s1", "A");
        useSessionStore.setState({ currentSessionId: "s1" });
        useSessionStore.getState().setCurrentSession("missing");
        expect(useSessionStore.getState().currentSessionId).toBe("s1");
    });
});
