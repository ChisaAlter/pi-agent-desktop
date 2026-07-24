// workspace-store 测试 (v1.0.8)
// 覆盖: addWorkspace / removeWorkspace / setCurrentWorkspace / updateWorkspace
// / getCurrentWorkspace / lastActiveAt 类型守卫

import { describe, it, expect, beforeEach, vi } from "vitest";

// mock window.piAPI 让 store loadWorkspaces() 不报 undefined
const mockApi = {
    listWorkspaces: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn().mockResolvedValue({}),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
    (globalThis as { window: unknown }).window = { piAPI: mockApi };
    mockApi.listWorkspaces.mockClear();
    mockApi.createWorkspace.mockReset();
    mockApi.createWorkspace.mockResolvedValue({});
    mockApi.deleteWorkspace.mockReset();
    mockApi.deleteWorkspace.mockResolvedValue(undefined);
});

// 模块加载会触发 loadWorkspaces() — 那是一次性副作用, 拿不到状态.
import { useWorkspaceStore } from "../workspace-store";

describe("workspace-store: addWorkspace", () => {
    it("添加后 workspaces 数组 +1, currentWorkspaceId 指向新 ws", () => {
        // 重置到已知状态
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const ws = useWorkspaceStore.getState().addWorkspace("foo", "/tmp/foo");
        const state = useWorkspaceStore.getState();
        expect(state.workspaces).toHaveLength(1);
        expect(state.workspaces[0]).toMatchObject({ name: "foo", path: "/tmp/foo" });
        expect(state.currentWorkspaceId).toBe(ws.id);
    });

    it("多次添加, 每次 currentWorkspaceId 都跟着切到最新", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        // 强制不同 id (Date.now() 同毫秒会撞)
        const bId = `b-${Date.now() + 1}`;
        useWorkspaceStore.setState((state) => ({
            workspaces: [
                ...state.workspaces,
                { id: bId, name: "b", path: "/b", createdAt: new Date(), lastActiveAt: new Date() },
            ],
            currentWorkspaceId: bId,
        }));
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(bId);
        expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
        expect(a.id).not.toBe(bId);
    });
});

describe("workspace-store: createWorkspace", () => {
    it("通过主进程创建后使用持久化 workspace 写入本地状态", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        mockApi.createWorkspace.mockResolvedValueOnce({
            id: "ws-main",
            name: "repo",
            path: "C:/repo",
            createdAt: Date.now(),
        });

        const ws = await useWorkspaceStore.getState().createWorkspace("repo", "C:/repo");

        expect(mockApi.createWorkspace).toHaveBeenCalledWith("repo", "C:/repo");
        expect(ws?.id).toBe("ws-main");
        expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(["ws-main"]);
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-main");
        expect(useWorkspaceStore.getState().lastError).toBeNull();
    });

    it("创建返回 IpcError 时不污染本地状态并记录错误", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        mockApi.createWorkspace.mockResolvedValueOnce({
            code: "ipcErrors.workspace.createFailed",
            fallback: "创建 workspace 失败: permission denied",
        });

        const ws = await useWorkspaceStore.getState().createWorkspace("repo", "C:/repo");

        expect(ws).toBeNull();
        expect(useWorkspaceStore.getState().workspaces).toEqual([]);
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull();
        expect(useWorkspaceStore.getState().lastError).toBe("创建 workspace 失败: permission denied");
    });

    it("创建 reject 时不污染本地状态并记录错误", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        mockApi.createWorkspace.mockRejectedValueOnce(new Error("create transport failed"));

        const ws = await useWorkspaceStore.getState().createWorkspace("repo", "C:/repo");

        expect(ws).toBeNull();
        expect(useWorkspaceStore.getState().workspaces).toEqual([]);
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull();
        expect(useWorkspaceStore.getState().lastError).toBe("create transport failed");
    });
});

describe("workspace-store: removeWorkspace", () => {
    it("删除后 workspaces 减 1", () => {
        // 用 setState 直接灌入两条, 避开 addWorkspace 同毫秒 id 撞车
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        const b = { id: "b", name: "b", path: "/b", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a, b], currentWorkspaceId: b.id });
        useWorkspaceStore.getState().removeWorkspace("a");
        const state = useWorkspaceStore.getState();
        expect(state.workspaces).toHaveLength(1);
        expect(state.workspaces[0].name).toBe("b");
    });

    it("删除 currentWorkspace 时, currentWorkspaceId 切到剩余的第一个", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        const bId = `b-${Date.now() + 1}`;
        useWorkspaceStore.setState((state) => ({
            workspaces: [
                ...state.workspaces,
                { id: bId, name: "b", path: "/b", createdAt: new Date(), lastActiveAt: new Date() },
            ],
            currentWorkspaceId: bId,
        }));
        useWorkspaceStore.getState().removeWorkspace(bId);
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(a.id);
    });

    it("删除最后一个, currentWorkspaceId = null", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        useWorkspaceStore.getState().removeWorkspace(a.id);
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull();
    });

    it("删除时调 window.piAPI.deleteWorkspace (best-effort sync)", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a], currentWorkspaceId: "a" });
        mockApi.deleteWorkspace.mockClear();
        useWorkspaceStore.getState().removeWorkspace("a");
        expect(mockApi.deleteWorkspace).toHaveBeenCalledWith("a");
    });

    it("删除同步返回 IpcError 时回滚本地状态并记录错误", async () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        const b = { id: "b", name: "b", path: "/b", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a, b], currentWorkspaceId: "b", lastError: null });
        mockApi.deleteWorkspace.mockResolvedValueOnce({
            code: "ipcErrors.workspace.deleteFailed",
            fallback: "删除工作区失败: disk locked",
        });

        useWorkspaceStore.getState().removeWorkspace("b");
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("a");

        await vi.waitFor(() => {
            expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(["a", "b"]);
            expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("b");
            expect(useWorkspaceStore.getState().lastError).toBe("删除工作区失败: disk locked");
        });
    });

    it("删除同步 reject 时回滚本地状态并记录错误", async () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a], currentWorkspaceId: "a", lastError: null });
        mockApi.deleteWorkspace.mockRejectedValueOnce(new Error("delete transport failed"));

        useWorkspaceStore.getState().removeWorkspace("a");
        expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);

        await vi.waitFor(() => {
            expect(useWorkspaceStore.getState().workspaces).toEqual([a]);
            expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("a");
            expect(useWorkspaceStore.getState().lastError).toBe("delete transport failed");
        });
    });
});

describe("workspace-store: setCurrentWorkspace", () => {
    it("切到指定 ws, lastActiveAt 更新到该 ws", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        const pastTime = new Date(2000, 0, 1);
        // 强制 lastActiveAt 是过去时间
        useWorkspaceStore.setState({
            workspaces: [{ ...a, lastActiveAt: pastTime }],
            currentWorkspaceId: a.id,
        });
        useWorkspaceStore.getState().setCurrentWorkspace(a.id);
        const updated = useWorkspaceStore.getState().workspaces[0];
        expect(updated.lastActiveAt.getTime()).toBeGreaterThan(pastTime.getTime());
    });

    it("切到不存在的 id 不会抛", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        expect(() => useWorkspaceStore.getState().setCurrentWorkspace("nope")).not.toThrow();
    });
});

describe("workspace-store: updateWorkspace", () => {
    it("部分更新, 不改其他字段", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        useWorkspaceStore.getState().updateWorkspace(a.id, { name: "a-renamed" });
        const updated = useWorkspaceStore.getState().workspaces[0];
        expect(updated.name).toBe("a-renamed");
        expect(updated.path).toBe("/a"); // 不动
    });
});

describe("workspace-store: updateGitStatus", () => {
    it("写 git status 到对应 workspace", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        useWorkspaceStore.getState().updateGitStatus(a.id, {
            branch: "main", modified: ["x"], added: [], deleted: [], untracked: [], ahead: 0, behind: 0,
        });
        expect(useWorkspaceStore.getState().workspaces[0].gitStatus?.branch).toBe("main");
    });
});

describe("workspace-store: getCurrentWorkspace", () => {
    it("currentWorkspaceId = null → null", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        expect(useWorkspaceStore.getState().getCurrentWorkspace()).toBeNull();
    });

    it("currentWorkspaceId 指向存在的 ws → 返 ws", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const a = useWorkspaceStore.getState().addWorkspace("a", "/a");
        const cur = useWorkspaceStore.getState().getCurrentWorkspace();
        expect(cur?.id).toBe(a.id);
    });

    // wave-97 residual
    it("currentWorkspaceId 指向已删除 id → null", () => {
        useWorkspaceStore.setState({
            workspaces: [],
            currentWorkspaceId: "ghost",
        });
        expect(useWorkspaceStore.getState().getCurrentWorkspace()).toBeNull();
    });
});

describe("workspace-store: clearError / no-op updates", () => {
    // wave-97 residual
    it("clearError 清掉 lastError", () => {
        useWorkspaceStore.setState({ lastError: "boom" });
        useWorkspaceStore.getState().clearError();
        expect(useWorkspaceStore.getState().lastError).toBeNull();
    });

    it("updateWorkspace 未知 id 不改动数组", () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a], currentWorkspaceId: "a" });
        useWorkspaceStore.getState().updateWorkspace("missing", { name: "x" });
        expect(useWorkspaceStore.getState().workspaces).toEqual([a]);
    });

    it("updateGitStatus 未知 id 不抛且不写 gitStatus", () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a], currentWorkspaceId: "a" });
        expect(() =>
            useWorkspaceStore.getState().updateGitStatus("missing", {
                branch: "main",
                modified: [],
                added: [],
                deleted: [],
                untracked: [],
                ahead: 0,
                behind: 0,
            }),
        ).not.toThrow();
        expect(useWorkspaceStore.getState().workspaces[0].gitStatus).toBeUndefined();
    });

    it("removeWorkspace 未知 id 保持列表", () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a], currentWorkspaceId: "a", lastError: null });
        useWorkspaceStore.getState().removeWorkspace("missing");
        expect(useWorkspaceStore.getState().workspaces).toEqual([a]);
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("a");
    });

    it("addWorkspace 同 path 会覆盖 id/name 而不是重复插入", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
        const first = useWorkspaceStore.getState().addWorkspace("old", "/same");
        const second = useWorkspaceStore.getState().addWorkspace("new", "/same", "ws-fixed");
        const state = useWorkspaceStore.getState();
        expect(state.workspaces).toHaveLength(1);
        expect(state.workspaces[0]).toMatchObject({ id: "ws-fixed", name: "new", path: "/same" });
        expect(state.currentWorkspaceId).toBe("ws-fixed");
        expect(first.path).toBe(second.path);
    });
});

describe("workspace-store: createEmptyWorkspace", () => {
    // wave-97 residual
    it("通过主进程创建空白工作区后写入本地状态", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        (mockApi as { createEmptyWorkspace?: ReturnType<typeof vi.fn> }).createEmptyWorkspace = vi
            .fn()
            .mockResolvedValueOnce({
                id: "ws-empty",
                name: "blank",
                path: "C:/parent/blank",
                createdAt: Date.now(),
            });

        const ws = await useWorkspaceStore.getState().createEmptyWorkspace("blank", "C:/parent");

        expect(mockApi.createEmptyWorkspace).toHaveBeenCalledWith("blank", "C:/parent");
        expect(ws?.id).toBe("ws-empty");
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-empty");
        expect(useWorkspaceStore.getState().lastError).toBeNull();
    });

    it("createEmptyWorkspace 返回 IpcError 时不污染本地状态", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        (mockApi as { createEmptyWorkspace?: ReturnType<typeof vi.fn> }).createEmptyWorkspace = vi
            .fn()
            .mockResolvedValueOnce({
                code: "ipcErrors.workspace.createEmptyFailed",
                fallback: "创建空白工作区失败: disk full",
            });

        const ws = await useWorkspaceStore.getState().createEmptyWorkspace("blank", "C:/parent");
        expect(ws).toBeNull();
        expect(useWorkspaceStore.getState().workspaces).toEqual([]);
        expect(useWorkspaceStore.getState().lastError).toBe("创建空白工作区失败: disk full");
    });

    it("createEmptyWorkspace 无 API 时本地拼接 path", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        delete (mockApi as { createEmptyWorkspace?: unknown }).createEmptyWorkspace;

        const ws = await useWorkspaceStore.getState().createEmptyWorkspace("blank", "C:/parent\\");
        expect(ws?.name).toBe("blank");
        expect(ws?.path).toBe("C:/parent\\blank");
        expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });
});

describe("workspace-store residual (wave-123)", () => {
    it("createWorkspace without createWorkspace API falls back to local addWorkspace", async () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        delete (mockApi as { createWorkspace?: unknown }).createWorkspace;

        const ws = await useWorkspaceStore.getState().createWorkspace("local-only", "C:/local/repo");
        expect(ws?.name).toBe("local-only");
        expect(ws?.path).toBe("C:/local/repo");
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(ws?.id);
        expect(useWorkspaceStore.getState().lastError).toBeNull();

        // restore for later suites
        (mockApi as { createWorkspace: ReturnType<typeof vi.fn> }).createWorkspace = vi
            .fn()
            .mockResolvedValue({});
    });

    it("removeWorkspace keeps current id when deleting a non-current workspace", () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        const b = { id: "b", name: "b", path: "/b", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a, b], currentWorkspaceId: "a", lastError: "stale" });
        useWorkspaceStore.getState().removeWorkspace("b");
        const state = useWorkspaceStore.getState();
        expect(state.workspaces.map((w) => w.id)).toEqual(["a"]);
        expect(state.currentWorkspaceId).toBe("a");
        expect(state.lastError).toBeNull();
    });

    it("setCurrentWorkspace updates only the selected workspace lastActiveAt", () => {
        const past = new Date(2000, 0, 1);
        const a = { id: "a", name: "a", path: "/a", createdAt: past, lastActiveAt: past };
        const b = { id: "b", name: "b", path: "/b", createdAt: past, lastActiveAt: past };
        useWorkspaceStore.setState({ workspaces: [a, b], currentWorkspaceId: "a" });
        useWorkspaceStore.getState().setCurrentWorkspace("b");
        const state = useWorkspaceStore.getState();
        expect(state.currentWorkspaceId).toBe("b");
        expect(state.workspaces.find((w) => w.id === "a")?.lastActiveAt.getTime()).toBe(past.getTime());
        expect(state.workspaces.find((w) => w.id === "b")!.lastActiveAt.getTime()).toBeGreaterThan(past.getTime());
    });

    it("updateGitStatus replaces previous gitStatus object for the workspace", () => {
        const a = { id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() };
        useWorkspaceStore.setState({ workspaces: [a], currentWorkspaceId: "a" });
        useWorkspaceStore.getState().updateGitStatus("a", {
            branch: "main",
            modified: ["x"],
            added: [],
            deleted: [],
            untracked: [],
            ahead: 1,
            behind: 0,
        });
        useWorkspaceStore.getState().updateGitStatus("a", {
            branch: "feature",
            modified: [],
            added: ["y"],
            deleted: [],
            untracked: [],
            ahead: 0,
            behind: 2,
        });
        expect(useWorkspaceStore.getState().workspaces[0].gitStatus).toEqual({
            branch: "feature",
            modified: [],
            added: ["y"],
            deleted: [],
            untracked: [],
            ahead: 0,
            behind: 2,
        });
    });
});

// wave-130 residual
describe("workspace-store residual clearError/add id/remove first", () => {
    beforeEach(() => {
        useWorkspaceStore.setState({
            workspaces: [],
            currentWorkspaceId: null,
            lastError: null,
            loaded: true,
        });
        mockApi.deleteWorkspace.mockReset();
        mockApi.deleteWorkspace.mockResolvedValue(undefined);
    });

    it("addWorkspace accepts explicit id", () => {
        const ws = useWorkspaceStore.getState().addWorkspace("named", "/tmp/named", "ws-fixed");
        expect(ws.id).toBe("ws-fixed");
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-fixed");
        expect(useWorkspaceStore.getState().workspaces[0]?.id).toBe("ws-fixed");
    });

    it("removeWorkspace of current picks first remaining and clears lastError", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "a", name: "a", path: "/a", createdAt: new Date(1), lastActiveAt: new Date(1) },
                { id: "b", name: "b", path: "/b", createdAt: new Date(2), lastActiveAt: new Date(2) },
            ],
            currentWorkspaceId: "a",
            lastError: "stale",
        });
        useWorkspaceStore.getState().removeWorkspace("a");
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("b");
        expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(["b"]);
        expect(useWorkspaceStore.getState().lastError).toBeNull();
    });

    it("clearError only clears lastError", () => {
        useWorkspaceStore.setState({
            workspaces: [{ id: "a", name: "a", path: "/a", createdAt: new Date(), lastActiveAt: new Date() }],
            currentWorkspaceId: "a",
            lastError: "boom",
        });
        useWorkspaceStore.getState().clearError();
        expect(useWorkspaceStore.getState().lastError).toBeNull();
        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("a");
        expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });
});
