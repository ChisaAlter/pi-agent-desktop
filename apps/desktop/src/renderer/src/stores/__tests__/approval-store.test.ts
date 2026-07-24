// approval-store 测试 (v1.0.8)
// 覆盖: addChange / approve / reject / approveAll / rejectAll / clearChanges
// / autoApprove / waitForApproval 异步流程

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useApprovalStore, generateWriteDiff, generateEditDiff } from "../approval-store";

beforeEach(() => {
    // 重置 store 到干净状态 (pendingResolves 已是模块级, clearChanges 会清)
    useApprovalStore.getState().clearChanges();
    useApprovalStore.setState({
        changes: [],
        autoApprove: false,
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
        // 不调 waitForApproval 之前的, 直接再 wait 一次 — pendingResolves 已清
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

    // wave-95 residual
    it("generateWriteDiff keeps unchanged lines with leading space", () => {
        const diff = generateWriteDiff("/tmp/x.ts", "same\nold", "same\nnew");
        expect(diff).toContain(" same");
        expect(diff).toContain("-old");
        expect(diff).toContain("+new");
    });

    it("generateEditDiff handles empty old content as pure additions", () => {
        const diff = generateEditDiff("/tmp/x.ts", "", "only-new");
        expect(diff).toContain("+only-new");
        expect(diff).not.toMatch(/^-only-new/m);
    });

    // wave-113 residual
    it("generateWriteDiff uses basename for windows-style paths", () => {
        const diff = generateWriteDiff("C:\\proj\\src\\app.ts", "a", "b");
        expect(diff).toContain("diff --git a/app.ts b/app.ts");
        expect(diff).toContain("--- a/app.ts");
        expect(diff).toContain("+++ b/app.ts");
    });

    it("generateWriteDiff handles shorter new content with pure deletions", () => {
        const diff = generateWriteDiff("/tmp/x.ts", "keep\ngone", "keep");
        expect(diff).toContain(" keep");
        expect(diff).toContain("-gone");
        expect(diff).not.toContain("+gone");
    });

    it("generateEditDiff uses basename and emits full replace hunk", () => {
        const diff = generateEditDiff("C:/ws/lib/util.ts", "old", "new");
        expect(diff).toContain("diff --git a/util.ts b/util.ts");
        expect(diff).toContain("-old");
        expect(diff).toContain("+new");
    });
});

describe("approval-store: waitForApproval residual", () => {
    // wave-113 residual
    it("times out to false when still pending", async () => {
        vi.useFakeTimers();
        try {
            const id = useApprovalStore.getState().addChange({
                toolCallId: "t-timeout",
                toolName: "write",
                filePath: "/tmp/x.ts",
            });
            const waitPromise = useApprovalStore.getState().waitForApproval(id, 1000);
            await vi.advanceTimersByTimeAsync(1000);
            await expect(waitPromise).resolves.toBe(false);
            // status stays pending — timeout only resolves the waiter
            expect(useApprovalStore.getState().changes[0].status).toBe("pending");
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejectAll leaves already-approved changes untouched", async () => {
        const a = useApprovalStore.getState().addChange({ toolCallId: "t1", toolName: "write", filePath: "/a" });
        const b = useApprovalStore.getState().addChange({ toolCallId: "t2", toolName: "edit", filePath: "/b" });
        useApprovalStore.getState().approveChange(a);
        const wb = useApprovalStore.getState().waitForApproval(b);
        useApprovalStore.getState().rejectAll();
        expect(await wb).toBe(false);
        const changes = useApprovalStore.getState().changes;
        expect(changes[0].status).toBe("approved");
        expect(changes[1].status).toBe("rejected");
    });

    it("waitForApproval returns false immediately for already-rejected change", async () => {
        const id = useApprovalStore.getState().addChange({ toolCallId: "t", toolName: "write", filePath: "/a" });
        useApprovalStore.getState().rejectChange(id);
        await expect(useApprovalStore.getState().waitForApproval(id)).resolves.toBe(false);
    });

    // wave-126 residual
    it("approve/reject unknown ids are no-ops and leave pending waiters hanging until timeout", async () => {
        vi.useFakeTimers();
        try {
            const id = useApprovalStore.getState().addChange({
                toolCallId: "t",
                toolName: "write",
                filePath: "/a",
            });
            useApprovalStore.getState().approveChange("missing");
            useApprovalStore.getState().rejectChange("missing");
            expect(useApprovalStore.getState().changes[0].status).toBe("pending");

            const waitPromise = useApprovalStore.getState().waitForApproval(id, 500);
            await vi.advanceTimersByTimeAsync(500);
            await expect(waitPromise).resolves.toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("addChange preserves optional write/edit fields", () => {
        const id = useApprovalStore.getState().addChange({
            toolCallId: "tc",
            toolName: "edit",
            filePath: "/tmp/x.ts",
            oldString: "a",
            newString: "b",
            oldContent: "a",
            newContent: "b",
            diff: "diff body",
        });
        const change = useApprovalStore.getState().changes.find((c) => c.id === id);
        expect(change?.oldString).toBe("a");
        expect(change?.newString).toBe("b");
        expect(change?.oldContent).toBe("a");
        expect(change?.newContent).toBe("b");
        expect(change?.diff).toBe("diff body");
        expect(change?.status).toBe("pending");
    });

    it("generateWriteDiff marks new file mode for undefined/empty oldContent (falsy check)", () => {
        // product: if (!oldContent) — empty string is treated as new file too
        const created = generateWriteDiff("/tmp/new.ts", undefined, "x");
        expect(created).toContain("new file mode");
        const emptyOld = generateWriteDiff("/tmp/old.ts", "", "x");
        expect(emptyOld).toContain("new file mode");
        expect(emptyOld).toContain("+x");
        const replaced = generateWriteDiff("/tmp/old.ts", "prev", "x");
        expect(replaced).not.toContain("new file mode");
        expect(replaced).toContain("-prev");
        expect(replaced).toContain("+x");
    });

    // wave-204 residual
    it("clearChanges rejects pending waiters with false and empties list", async () => {
        const a = useApprovalStore.getState().addChange({
            toolCallId: "t1",
            toolName: "write",
            filePath: "/a",
        });
        const b = useApprovalStore.getState().addChange({
            toolCallId: "t2",
            toolName: "edit",
            filePath: "/b",
        });
        const wa = useApprovalStore.getState().waitForApproval(a);
        const wb = useApprovalStore.getState().waitForApproval(b);
        useApprovalStore.getState().clearChanges();
        await expect(wa).resolves.toBe(false);
        await expect(wb).resolves.toBe(false);
        expect(useApprovalStore.getState().changes).toEqual([]);
    });

    it("waitForApproval with timeoutMs 0 does not auto-reject; approve later resolves true", async () => {
        vi.useFakeTimers();
        try {
            const id = useApprovalStore.getState().addChange({
                toolCallId: "t0",
                toolName: "write",
                filePath: "/z",
            });
            const waitPromise = useApprovalStore.getState().waitForApproval(id, 0);
            await vi.advanceTimersByTimeAsync(60_000);
            // still pending — no timeout registered when timeoutMs <= 0
            expect(useApprovalStore.getState().changes[0].status).toBe("pending");
            useApprovalStore.getState().approveChange(id);
            await expect(waitPromise).resolves.toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("generateWriteDiff multi-line mix of equal/add/remove lines", () => {
        const diff = generateWriteDiff(
            "C:\\ws\\src\\app.ts",
            "a\nb\nc",
            "a\nB\nc\nd",
        );
        expect(diff).toContain("diff --git a/app.ts b/app.ts");
        expect(diff).toContain("--- a/app.ts");
        expect(diff).toContain("+++ b/app.ts");
        expect(diff).toContain(" a\n");
        expect(diff).toContain("-b\n");
        expect(diff).toContain("+B\n");
        expect(diff).toContain(" c\n");
        expect(diff).toContain("+d\n");
        expect(diff).not.toContain("new file mode");
    });

    it("generateEditDiff uses basename for Windows paths and full replace hunk", () => {
        const diff = generateEditDiff("C:\\proj\\pkg\\index.ts", "line1\nline2", "only");
        expect(diff).toContain("diff --git a/index.ts b/index.ts");
        expect(diff).toContain("-line1\n");
        expect(diff).toContain("-line2\n");
        expect(diff).toContain("+only\n");
        expect(diff).toContain("@@ -1,2 +1,1 @@");
    });

    it("waitForApproval autoApprove marks change approved when still pending", async () => {
        useApprovalStore.getState().setAutoApprove(true);
        const id = useApprovalStore.getState().addChange({
            toolCallId: "ta",
            toolName: "write",
            filePath: "/auto",
        });
        await expect(useApprovalStore.getState().waitForApproval(id)).resolves.toBe(true);
        expect(useApprovalStore.getState().changes[0].status).toBe("approved");
    });

    // wave-241 residual
    it("generateWriteDiff treats empty-string oldContent as new file; undefined too", () => {
        const emptyOld = generateWriteDiff("C:/ws/new.ts", "", "line\n");
        expect(emptyOld).toContain("new file mode 100644");
        expect(emptyOld).toContain("--- /dev/null");
        expect(emptyOld).toContain("+line\n");
        expect(emptyOld).toContain("+\n"); // trailing empty line after split
        const undefOld = generateWriteDiff("C:/ws/new.ts", undefined, "only");
        expect(undefOld).toContain("new file mode 100644");
        expect(undefOld).toContain("+only\n");
        expect(undefOld).not.toContain("--- a/");
    });

    it("generateWriteDiff line-aligned equal/add/remove; basename from mixed separators", () => {
        const diff = generateWriteDiff("C:/a\\b/file.md", "a\nb\nc", "a\nc");
        expect(diff).toContain("diff --git a/file.md b/file.md");
        expect(diff).toContain(" a\n");
        expect(diff).toContain("-b\n");
        expect(diff).toContain("-c\n");
        expect(diff).toContain("+c\n");
        // shorter new: trailing old lines removed
        expect(diff).toContain("@@ -1,3 +1,2 @@");
    });

    it("generateEditDiff full replace even when strings equal; empty old/new", () => {
        const same = generateEditDiff("x.ts", "same", "same");
        expect(same).toContain("-same\n");
        expect(same).toContain("+same\n");
        const empty = generateEditDiff("x.ts", "", "a");
        expect(empty).toContain("@@ -1,1 +1,1 @@");
        expect(empty).toContain("-\n");
        expect(empty).toContain("+a\n");
    });
});
