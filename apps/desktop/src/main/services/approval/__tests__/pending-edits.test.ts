import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PendingEdits } from "../pending-edits";

describe("PendingEdits", () => {
    let edits: PendingEdits;
    let workspacePath: string;

    beforeEach(() => {
        vi.useFakeTimers();
        edits = new PendingEdits();
        workspacePath = mkdtempSync(join(tmpdir(), "pending-edits-"));
    });

    afterEach(() => {
        vi.useRealTimers();
        rmSync(workspacePath, { recursive: true, force: true });
    });

    it("tracks a write and returns changeId", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "hello" });
        expect(id).toMatch(/^change_/);
    });

    it("retrieves tracked edit by id", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "hello" });
        const change = edits.get(id);
        expect(change?.filePath).toBe("src/foo.ts");
        expect(change?.newContent).toBe("hello");
    });

    it("marks as reviewed with diff", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "hello" });
        edits.review(id, "--- a\n+++ b\n@@\n-old\n+new\n", "hello");
        const change = edits.get(id);
        expect(change?.diff).toContain("+new");
    });

    it("removes a change by id", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "x" });
        edits.remove(id);
        expect(edits.get(id)).toBeUndefined();
    });

    it("lists all tracked edits", () => {
        edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.track("tc_2", "edit", "b.ts", { old_string: "a", new_string: "b" });
        expect(edits.list().length).toBe(2);
    });

    it("approves and removes", () => {
        const id = edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.approve(id);
        expect(edits.get(id)).toBeUndefined();
    });

    it("reject 会把已有文件恢复成 oldContent", async () => {
        const filePath = join(workspacePath, "a.ts");
        writeFileSync(filePath, "new content", "utf-8");
        const id = edits.track("tc_1", "write", "a.ts", {
            content: "new content",
            oldContent: "old content",
        });

        await edits.reject(id, workspacePath);

        expect(edits.get(id)).toBeUndefined();
        expect(readFileSync(filePath, "utf-8")).toBe("old content");
    });

    it("reject 会删除原本不存在的新文件", async () => {
        const filePath = join(workspacePath, "brand-new.ts");
        writeFileSync(filePath, "new content", "utf-8");
        const id = edits.track("tc_1", "write", "brand-new.ts", { content: "new content" });

        await edits.reject(id, workspacePath);

        expect(edits.get(id)).toBeUndefined();
        expect(existsSync(filePath)).toBe(false);
    });

    it("lists sorted by timestamp desc (newest first)", () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        edits.track("tc_1", "write", "old.ts", { content: "1" });
        vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
        edits.track("tc_2", "write", "new.ts", { content: "2" });
        const list = edits.list();
        expect(list[0].filePath).toBe("new.ts");
        expect(list[1].filePath).toBe("old.ts");
    });

    it("clear removes all", () => {
        edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.track("tc_2", "write", "b.ts", { content: "2" });
        edits.clear();
        expect(edits.list().length).toBe(0);
    });
});

