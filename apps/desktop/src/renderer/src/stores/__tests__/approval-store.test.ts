// approval-store 测试 (v1.0.8)
// 覆盖: addChange / approve / reject / approveAll / rejectAll / clearChanges
// / autoApprove / waitForApproval 异步流程

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DeferredEdit, FileReview } from "@shared";
import { bindApprovalEventSubscriptions, useApprovalStore, generateWriteDiff, generateEditDiff } from "../approval-store";

const invokeMock = vi.fn();

function setWindowPiApi(value: { invoke: typeof invokeMock }): void {
    Object.defineProperty(globalThis, "window", {
        value: { piAPI: value },
        configurable: true,
        writable: true,
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

beforeEach(() => {
    // 重置 store 到干净状态
    useApprovalStore.setState({
        changes: [],
        autoApprove: false,
        _pendingResolves: new Map(),
    });
});

describe("approval-store: addChange", () => {
    it("加一条 change, 默认 status=pending, 有 id/timestamp", () => {
        const id = useApprovalStore.getState().addChange({
            toolCallId: "tc_1",
            toolName: "write",
            filePath: "/tmp/foo.ts",
        });
        const change = useApprovalStore.getState().changes[0];
        expect(change.id).toBe(id);
        expect(change.status).toBe("pending");
        expect(change.timestamp).toBeInstanceOf(Date);
    });

    it("两次 add → id 不同", () => {
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const b = useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        expect(a).not.toBe(b);
    });
});

describe("approval-store: bindApprovalEventSubscriptions", () => {
    it("把 deferred/review 事件灌进 store", () => {
        let deferredHandler: ((payload: DeferredEdit) => void) | undefined;
        let reviewHandler: ((payload: FileReview) => void) | undefined;
        const unsubDeferred = vi.fn();
        const unsubReview = vi.fn();
        const unsubscribe = bindApprovalEventSubscriptions({
            onApprovalDeferred: (cb) => {
                deferredHandler = cb;
                return unsubDeferred;
            },
            onApprovalReview: (cb) => {
                reviewHandler = cb;
                return unsubReview;
            },
        });

        deferredHandler?.({
            workspaceId: "ws_1",
            changeId: "change_1",
            toolCallId: "tc_1",
            filePath: "src/foo.ts",
            op: "write",
            timestamp: 1,
        });
        reviewHandler?.({
            workspaceId: "ws_1",
            changeId: "change_1",
            toolCallId: "tc_1",
            filePath: "src/foo.ts",
            diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1,0 +1,1 @@\n+hello\n",
            newContent: "hello\n",
            timestamp: 2,
        });

        const change = useApprovalStore.getState().changes[0];
        expect(change).toMatchObject({
            id: "change_1",
            workspaceId: "ws_1",
            toolCallId: "tc_1",
            toolName: "write",
            filePath: "src/foo.ts",
            status: "pending",
            diff: expect.stringContaining("+hello"),
            newContent: "hello\n",
        });

        unsubscribe();
        expect(unsubDeferred).toHaveBeenCalledTimes(1);
        expect(unsubReview).toHaveBeenCalledTimes(1);
    });

    it("在缺少 approval 订阅接口时安全降级为空操作", () => {
        const unsubscribe = bindApprovalEventSubscriptions({} as never);
        expect(useApprovalStore.getState().changes).toHaveLength(0);
        expect(() => unsubscribe()).not.toThrow();
    });
});

describe("approval-store: approve / reject", () => {
    it("approve 后回流 main, status=approved, pending resolve 返 true", async () => {
        setWindowPiApi({ invoke: invokeMock.mockResolvedValue(undefined) });
        const id = useApprovalStore.getState().addChange({
            workspaceId: "ws_1",
            toolCallId: "t",
            toolName: "write",
            filePath: "/a",
        });
        const waitPromise = useApprovalStore.getState().waitForApproval(id);
        await useApprovalStore.getState().approveChange(id);
        const result = await waitPromise;
        expect(result).toBe(true);
        expect(useApprovalStore.getState().changes[0].status).toBe("approved");
        expect(invokeMock).toHaveBeenCalledWith("approval:approve", "ws_1", id);
    });

    it("reject 后回流 main, status=rejected, pending resolve 返 false", async () => {
        setWindowPiApi({ invoke: invokeMock.mockResolvedValue(undefined) });
        const id = useApprovalStore.getState().addChange({
            workspaceId: "ws_1",
            toolCallId: "t",
            toolName: "write",
            filePath: "/a",
        });
        const waitPromise = useApprovalStore.getState().waitForApproval(id);
        await useApprovalStore.getState().rejectChange(id);
        const result = await waitPromise;
        expect(result).toBe(false);
        expect(useApprovalStore.getState().changes[0].status).toBe("rejected");
        expect(invokeMock).toHaveBeenCalledWith("approval:reject", "ws_1", id);
    });
});

describe("approval-store: approveAll / rejectAll", () => {
    it("approveAll: 全部 pending 变 approved, 各自 promise resolve true", async () => {
        setWindowPiApi({ invoke: invokeMock.mockResolvedValue(undefined) });
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const b = useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        const wa = useApprovalStore.getState().waitForApproval(a);
        const wb = useApprovalStore.getState().waitForApproval(b);
        await useApprovalStore.getState().approveAll();
        expect(await wa).toBe(true);
        expect(await wb).toBe(true);
        expect(useApprovalStore.getState().changes.every((c) => c.status === "approved")).toBe(true);
    });

    it("rejectAll: 全部 pending 变 rejected", async () => {
        setWindowPiApi({ invoke: invokeMock.mockResolvedValue(undefined) });
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const b = useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        const wa = useApprovalStore.getState().waitForApproval(a);
        const wb = useApprovalStore.getState().waitForApproval(b);
        await useApprovalStore.getState().rejectAll();
        expect(await wa).toBe(false);
        expect(await wb).toBe(false);
    });

    it("approveAll 只动 pending, 不动已 approved/rejected", async () => {
        setWindowPiApi({ invoke: invokeMock.mockResolvedValue(undefined) });
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        await useApprovalStore.getState().rejectChange(a);
        await useApprovalStore.getState().approveAll();
        const changes = useApprovalStore.getState().changes;
        expect(changes[0].status).toBe("rejected"); // 不动
        expect(changes[1].status).toBe("approved"); // pending → approved
    });
});

describe("approval-store: clearChanges", () => {
    it("只清已处理项, 不吞掉仍 pending 的 change", async () => {
        setWindowPiApi({ invoke: invokeMock.mockResolvedValue(undefined) });
        const handled = useApprovalStore.getState().addChange({
            workspaceId: "ws_1",
            toolCallId: "t1",
            toolName: "write",
            filePath: "/a",
        });
        const pending = useApprovalStore.getState().addChange({
            workspaceId: "ws_1",
            toolCallId: "t2",
            toolName: "write",
            filePath: "/b",
        });
        await useApprovalStore.getState().approveChange(handled);
        invokeMock.mockClear();

        await useApprovalStore.getState().clearChanges();

        expect(useApprovalStore.getState().changes).toHaveLength(1);
        expect(useApprovalStore.getState().changes[0].id).toBe(pending);
        expect(useApprovalStore.getState().changes[0].status).toBe("pending");
        expect(invokeMock).toHaveBeenCalledWith("approval:remove", "ws_1", handled);
    });
});

describe("approval-store: autoApprove", () => {
    it("autoApprove=true 时, waitForApproval 直接返 true", async () => {
        useApprovalStore.setState({ autoApprove: true });
        const id = useApprovalStore.getState().addChange({ toolCallId: "t", toolName: "write", filePath: "/a" });
        const result = await useApprovalStore.getState().waitForApproval(id);
        expect(result).toBe(true);
        expect(useApprovalStore.getState().changes[0].status).toBe("approved");
    });

    it("waitForApproval 调时 change 已是 approved, 直接返 true", async () => {
        const id = useApprovalStore.getState().addChange({ toolCallId: "t", toolName: "write", filePath: "/a" });
        await useApprovalStore.getState().approveChange(id);
        // 不调 waitForApproval 之前的, 直接再 wait 一次 — 但 _pendingResolves 已清
        // 模拟 UI 重新问的边界: 改手动塞回 changes
        useApprovalStore.setState({
            changes: [
                ...useApprovalStore.getState().changes.map((c) =>
                    c.id === id ? { ...c, status: "approved" as const } : c
                ),
            ],
        });
        const result = await useApprovalStore.getState().waitForApproval(id);
        expect(result).toBe(true);
    });

    it("toggleAutoApprove / setAutoApprove", () => {
        expect(useApprovalStore.getState().autoApprove).toBe(false);
        useApprovalStore.getState().toggleAutoApprove();
        expect(useApprovalStore.getState().autoApprove).toBe(true);
        useApprovalStore.getState().setAutoApprove(false);
        expect(useApprovalStore.getState().autoApprove).toBe(false);
    });
});

describe("approval-store: diff helpers", () => {
    it("generateWriteDiff: 新文件 (oldContent=undefined) 所有行都是 +", () => {
        const diff = generateWriteDiff("/tmp/new.ts", undefined, "line1\nline2");
        expect(diff).toContain("new file mode");
        expect(diff).toContain("+line1");
        expect(diff).toContain("+line2");
        expect(diff).not.toContain("-line1");
    });

    it("generateWriteDiff: 旧文件, 变化行 +/-, 共同行 ' '", () => {
        const diff = generateWriteDiff("/tmp/x.ts", "line1\nline2", "line1\nline2-changed");
        expect(diff).toContain(" line1");
        expect(diff).toContain("-line2");
        expect(diff).toContain("+line2-changed");
    });

    it("generateEditDiff: old → new 全替换", () => {
        const diff = generateEditDiff("/tmp/x.ts", "old1\nold2", "new1\nnew2");
        expect(diff).toContain("-old1");
        expect(diff).toContain("-old2");
        expect(diff).toContain("+new1");
        expect(diff).toContain("+new2");
    });
});
