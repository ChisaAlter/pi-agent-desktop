// approval-store 测试 (v1.0.8)
// 覆盖: addChange / approve / reject / approveAll / rejectAll / clearChanges
// / autoApprove / waitForApproval 异步流程

import { describe, it, expect, beforeEach } from "vitest";
import { useApprovalStore, generateWriteDiff, generateEditDiff } from "../approval-store";

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

describe("approval-store: approve / reject", () => {
    it("approve 后 status=approved, pending resolve 返 true", async () => {
        const id = useApprovalStore.getState().addChange({ toolCallId: "t", toolName: "write", filePath: "/a" });
        const waitPromise = useApprovalStore.getState().waitForApproval(id);
        useApprovalStore.getState().approveChange(id);
        const result = await waitPromise;
        expect(result).toBe(true);
        expect(useApprovalStore.getState().changes[0].status).toBe("approved");
    });

    it("reject 后 status=rejected, pending resolve 返 false", async () => {
        const id = useApprovalStore.getState().addChange({ toolCallId: "t", toolName: "write", filePath: "/a" });
        const waitPromise = useApprovalStore.getState().waitForApproval(id);
        useApprovalStore.getState().rejectChange(id);
        const result = await waitPromise;
        expect(result).toBe(false);
        expect(useApprovalStore.getState().changes[0].status).toBe("rejected");
    });
});

describe("approval-store: approveAll / rejectAll", () => {
    it("approveAll: 全部 pending 变 approved, 各自 promise resolve true", async () => {
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const b = useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        const wa = useApprovalStore.getState().waitForApproval(a);
        const wb = useApprovalStore.getState().waitForApproval(b);
        useApprovalStore.getState().approveAll();
        expect(await wa).toBe(true);
        expect(await wb).toBe(true);
        expect(useApprovalStore.getState().changes.every((c) => c.status === "approved")).toBe(true);
    });

    it("rejectAll: 全部 pending 变 rejected", async () => {
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const b = useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        const wa = useApprovalStore.getState().waitForApproval(a);
        const wb = useApprovalStore.getState().waitForApproval(b);
        useApprovalStore.getState().rejectAll();
        expect(await wa).toBe(false);
        expect(await wb).toBe(false);
    });

    it("approveAll 只动 pending, 不动已 approved/rejected", () => {
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        useApprovalStore.getState().rejectChange(a);
        useApprovalStore.getState().approveAll();
        const changes = useApprovalStore.getState().changes;
        expect(changes[0].status).toBe("rejected"); // 不动
        expect(changes[1].status).toBe("approved"); // pending → approved
    });
});

describe("approval-store: clearChanges", () => {
    it("清空 changes, 把 pending promises 全部 reject", async () => {
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const wa = useApprovalStore.getState().waitForApproval(a);
        useApprovalStore.getState().clearChanges();
        expect(await wa).toBe(false);
        expect(useApprovalStore.getState().changes).toHaveLength(0);
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
        useApprovalStore.getState().approveChange(id);
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
