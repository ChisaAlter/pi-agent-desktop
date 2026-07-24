import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PendingEdits } from "../pending-edits";

describe("PendingEdits", () => {
    let edits: PendingEdits;

    beforeEach(() => {
        vi.useFakeTimers();
        edits = new PendingEdits();
    });

    afterEach(() => {
        vi.useRealTimers();
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

    it("rejects and removes", () => {
        const id = edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.reject(id);
        expect(edits.get(id)).toBeUndefined();
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

    // wave-92 residual
    it("defaults autoApprove to false and toggles", () => {
        expect(edits.autoApprove).toBe(false);
        edits.autoApprove = true;
        expect(edits.autoApprove).toBe(true);
        edits.autoApprove = false;
        expect(edits.autoApprove).toBe(false);
    });

    it("finds tracked edits by toolCallId", () => {
        const id = edits.track("tc_lookup", "edit", "src/x.ts", {
            old_string: "a",
            new_string: "b",
        });
        expect(edits.getByToolCallId("tc_lookup")?.id).toBe(id);
        expect(edits.getByToolCallId("missing")).toBeUndefined();
    });

    it("ignores review/approve/reject/remove for unknown ids", () => {
        expect(() => edits.review("nope", "diff", "content")).not.toThrow();
        expect(() => edits.approve("nope")).not.toThrow();
        expect(() => edits.reject("nope")).not.toThrow();
        expect(() => edits.remove("nope")).not.toThrow();
        expect(edits.size()).toBe(0);
    });

    it("size tracks map length independently of list cache", () => {
        expect(edits.size()).toBe(0);
        const id = edits.track("tc_1", "write", "a.ts", { content: "1" });
        expect(edits.size()).toBe(1);
        expect(edits.list().length).toBe(1);
        edits.approve(id);
        expect(edits.size()).toBe(0);
        expect(edits.list().length).toBe(0);
    });

    it("evicts oldest entries when exceeding MAX_ENTRIES", () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        for (let i = 0; i < 205; i++) {
            vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
            edits.track(`tc_${i}`, "write", `f${i}.ts`, { content: String(i) });
        }
        expect(edits.size()).toBe(200);
        const paths = edits.list().map((e) => e.filePath);
        // newest first; first five tracks (f0..f4) should be gone
        expect(paths).not.toContain("f0.ts");
        expect(paths).not.toContain("f4.ts");
        expect(paths[0]).toBe("f204.ts");
        expect(paths.at(-1)).toBe("f5.ts");
    });

    it("stores edit-family old/new strings", () => {
        const id = edits.track("tc_e", "edit", "src/a.ts", {
            old_string: "before",
            new_string: "after",
        });
        const change = edits.get(id);
        expect(change?.toolName).toBe("edit");
        expect(change?.oldString).toBe("before");
        expect(change?.newString).toBe("after");
    });

    // wave-113 residual
    it("reuses list cache until a mutation invalidates it", () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        edits.track("tc_1", "write", "a.ts", { content: "1" });
        const first = edits.list();
        const second = edits.list();
        expect(second).toBe(first);

        vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
        edits.track("tc_2", "write", "b.ts", { content: "2" });
        const third = edits.list();
        expect(third).not.toBe(first);
        expect(third[0].filePath).toBe("b.ts");
        expect(third[1].filePath).toBe("a.ts");
    });

    it("returns the first tracked edit when multiple share a toolCallId", () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const firstId = edits.track("shared", "write", "first.ts", { content: "1" });
        vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
        edits.track("shared", "edit", "second.ts", { old_string: "a", new_string: "b" });
        expect(edits.getByToolCallId("shared")?.id).toBe(firstId);
        expect(edits.getByToolCallId("shared")?.filePath).toBe("first.ts");
    });

    it("review updates content without changing size and keeps cache coherent", () => {
        const id = edits.track("tc_r", "write", "a.ts", { content: "old" });
        expect(edits.size()).toBe(1);
        edits.review(id, "diff body", "final");
        expect(edits.size()).toBe(1);
        expect(edits.get(id)?.diff).toBe("diff body");
        expect(edits.get(id)?.newContent).toBe("final");
        expect(edits.list()[0].newContent).toBe("final");
    });

    it("clear after eviction still yields empty list and size 0", () => {
        for (let i = 0; i < 205; i++) {
            vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
            edits.track(`tc_${i}`, "write", `f${i}.ts`, { content: String(i) });
        }
        expect(edits.size()).toBe(200);
        edits.clear();
        expect(edits.size()).toBe(0);
        expect(edits.list()).toEqual([]);
        expect(edits.getByToolCallId("tc_204")).toBeUndefined();
    });

    // wave-126 residual
    it("approve/reject invalidate list cache and drop size", () => {
        const id = edits.track("tc_a", "write", "a.ts", { content: "1" });
        const cached = edits.list();
        expect(edits.list()).toBe(cached);
        edits.approve(id);
        expect(edits.list()).not.toBe(cached);
        expect(edits.size()).toBe(0);

        const id2 = edits.track("tc_b", "edit", "b.ts", { old_string: "a", new_string: "b" });
        const cached2 = edits.list();
        edits.reject(id2);
        expect(edits.list()).not.toBe(cached2);
        expect(edits.get(id2)).toBeUndefined();
    });

    it("review of unknown id leaves cache and size unchanged", () => {
        const id = edits.track("tc_r", "write", "a.ts", { content: "1" });
        const cached = edits.list();
        edits.review("missing", "diff", "final");
        expect(edits.list()).toBe(cached);
        expect(edits.size()).toBe(1);
        expect(edits.get(id)?.newContent).toBe("1");
    });

    it("tracks write content separately from edit old/new strings", () => {
        const writeId = edits.track("tc_w", "write", "w.ts", { content: "full" });
        const editId = edits.track("tc_e", "edit", "e.ts", {
            old_string: "old",
            new_string: "new",
        });
        expect(edits.get(writeId)?.newContent).toBe("full");
        expect(edits.get(writeId)?.oldString).toBeUndefined();
        expect(edits.get(editId)?.newContent).toBeUndefined();
        expect(edits.get(editId)?.oldString).toBe("old");
        expect(edits.get(editId)?.newString).toBe("new");
        expect(edits.size()).toBe(2);
    });

    // wave-141 residual
    it("toggles autoApprove independently of tracked edits", () => {
        expect(edits.autoApprove).toBe(false);
        edits.autoApprove = true;
        expect(edits.autoApprove).toBe(true);
        const id = edits.track("tc_aa", "write", "a.ts", { content: "1" });
        expect(edits.size()).toBe(1);
        expect(edits.get(id)).toBeDefined();
        edits.autoApprove = false;
        expect(edits.autoApprove).toBe(false);
        expect(edits.get(id)).toBeDefined();
    });

    it("lists newest-first and reuses cache until mutation", () => {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
        const older = edits.track("tc_old", "write", "old.ts", { content: "o" });
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 5)));
        const newer = edits.track("tc_new", "write", "new.ts", { content: "n" });
        const listed = edits.list();
        expect(listed.map((e) => e.id)).toEqual([newer, older]);
        expect(edits.list()).toBe(listed);
        edits.review(older, "diff", "updated");
        expect(edits.list()).not.toBe(listed);
        expect(edits.get(older)?.newContent).toBe("updated");
        expect(edits.get(older)?.diff).toBe("diff");
    });

    it("getByToolCallId finds first matching entry among many", () => {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
        edits.track("tc_shared", "write", "a.ts", { content: "1" });
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 1)));
        edits.track("tc_other", "edit", "b.ts", { old_string: "x", new_string: "y" });
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 2)));
        edits.track("tc_shared", "write", "c.ts", { content: "3" });
        const hit = edits.getByToolCallId("tc_shared");
        expect(hit?.filePath).toBe("a.ts");
        expect(edits.getByToolCallId("missing")).toBeUndefined();
    });

    it("remove and approve both drop entries; approve of unknown is no-op", () => {
        const a = edits.track("tc_a", "write", "a.ts", { content: "1" });
        const b = edits.track("tc_b", "write", "b.ts", { content: "2" });
        edits.remove(a);
        expect(edits.get(a)).toBeUndefined();
        expect(edits.size()).toBe(1);
        edits.approve("not-there");
        expect(edits.size()).toBe(1);
        edits.approve(b);
        expect(edits.size()).toBe(0);
    });

    it("evicts oldest entries first when exceeding MAX_ENTRIES", () => {
        for (let i = 0; i < 205; i++) {
            vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
            edits.track(`tc_${i}`, "write", `f${i}.ts`, { content: String(i) });
        }
        expect(edits.size()).toBe(200);
        // oldest 0..4 evicted; newest 204 retained
        expect(edits.getByToolCallId("tc_0")).toBeUndefined();
        expect(edits.getByToolCallId("tc_4")).toBeUndefined();
        expect(edits.getByToolCallId("tc_5")?.filePath).toBe("f5.ts");
        expect(edits.getByToolCallId("tc_204")?.filePath).toBe("f204.ts");
        const listed = edits.list();
        expect(listed[0]?.toolCallId).toBe("tc_204");
        expect(listed[listed.length - 1]?.toolCallId).toBe("tc_5");
    });

    // wave-167 residual
    it("reject unknown is no-op; reject known removes; clear empties map", () => {
        const id = edits.track("tc_r", "edit", "x.ts", { old_string: "a", new_string: "b" });
        edits.reject("missing");
        expect(edits.size()).toBe(1);
        edits.reject(id);
        expect(edits.get(id)).toBeUndefined();
        expect(edits.size()).toBe(0);
        edits.track("tc_c", "write", "c.ts", { content: "1" });
        edits.clear();
        expect(edits.size()).toBe(0);
        expect(edits.list()).toEqual([]);
    });

    it("review on missing id is no-op; track returns unique change_ ids", () => {
        edits.review("nope", "diff", "content");
        expect(edits.size()).toBe(0);
        const a = edits.track("tc1", "write", "a.ts", { content: "1" });
        const b = edits.track("tc2", "write", "b.ts", { content: "2" });
        expect(a).toMatch(/^change_/);
        expect(b).toMatch(/^change_/);
        expect(a).not.toBe(b);
        expect(edits.get(a)?.toolName).toBe("write");
        expect(edits.get(b)?.filePath).toBe("b.ts");
    });

    it("list empty before any track and after clear", () => {
        expect(edits.list()).toEqual([]);
        expect(edits.size()).toBe(0);
        const id = edits.track("tc", "write", "a.ts", { content: "x" });
        expect(edits.list()).toHaveLength(1);
        edits.remove(id);
        expect(edits.list()).toEqual([]);
    });

    // wave-185 residual
    it("list returns cached array reference until mutation invalidates", () => {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
        const id = edits.track("tc_cache", "write", "a.ts", { content: "1" });
        const first = edits.list();
        const second = edits.list();
        expect(first).toBe(second);
        edits.review(id, "diff", "2");
        const afterReview = edits.list();
        expect(afterReview).not.toBe(first);
        expect(afterReview[0]?.diff).toBe("diff");
        expect(afterReview[0]?.newContent).toBe("2");
    });

    it("approve/remove/clear each invalidate list cache", () => {
        const a = edits.track("tc_a", "write", "a.ts", { content: "1" });
        const b = edits.track("tc_b", "write", "b.ts", { content: "2" });
        const list1 = edits.list();
        expect(list1).toHaveLength(2);
        edits.approve(a);
        const list2 = edits.list();
        expect(list2).not.toBe(list1);
        expect(list2).toHaveLength(1);
        edits.remove(b);
        const list3 = edits.list();
        expect(list3).toEqual([]);
        edits.track("tc_c", "write", "c.ts", { content: "3" });
        const list4 = edits.list();
        edits.clear();
        expect(edits.list()).not.toBe(list4);
        expect(edits.list()).toEqual([]);
    });

    it("track stores edit old_string/new_string without inventing content", () => {
        const id = edits.track("tc_edit", "edit", "src/x.ts", {
            old_string: "old",
            new_string: "new",
        });
        const change = edits.get(id);
        expect(change?.toolName).toBe("edit");
        expect(change?.oldString).toBe("old");
        expect(change?.newString).toBe("new");
        expect(change?.newContent).toBeUndefined();
        expect(change?.diff).toBeUndefined();
    });

    // wave-204 residual
    it("getByToolCallId stops seeing entry after approve/remove; size tracks map", () => {
        const id = edits.track("tc_seen", "write", "seen.ts", { content: "1" });
        expect(edits.size()).toBe(1);
        expect(edits.getByToolCallId("tc_seen")?.id).toBe(id);
        edits.approve(id);
        expect(edits.getByToolCallId("tc_seen")).toBeUndefined();
        expect(edits.size()).toBe(0);
        const id2 = edits.track("tc_seen2", "edit", "e.ts", { old_string: "a", new_string: "b" });
        expect(edits.size()).toBe(1);
        edits.remove(id2);
        expect(edits.getByToolCallId("tc_seen2")).toBeUndefined();
        expect(edits.size()).toBe(0);
    });

    it("mutations do not flip autoApprove; reject missing is no-op for size", () => {
        edits.autoApprove = true;
        const id = edits.track("tc_a", "write", "a.ts", { content: "x" });
        edits.review(id, "d", "x2");
        edits.reject("missing-id");
        expect(edits.autoApprove).toBe(true);
        expect(edits.size()).toBe(1);
        edits.reject(id);
        expect(edits.autoApprove).toBe(true);
        expect(edits.size()).toBe(0);
    });

    it("list order is newest-first after staggered timestamps and review does not reorder", () => {
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 0, 0, 0)));
        const oldId = edits.track("tc_old", "write", "old.ts", { content: "1" });
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 0, 0, 5)));
        const newId = edits.track("tc_new", "write", "new.ts", { content: "2" });
        const list = edits.list();
        expect(list.map((e) => e.id)).toEqual([newId, oldId]);
        edits.review(oldId, "old-diff", "1b");
        const after = edits.list();
        expect(after.map((e) => e.id)).toEqual([newId, oldId]);
        expect(after[1]?.diff).toBe("old-diff");
        expect(after[1]?.newContent).toBe("1b");
    });

    // wave-224 residual
    it("clear empties map and size; get returns undefined for missing", () => {
        edits.track("tc1", "write", "a.ts", { content: "1" });
        edits.track("tc2", "edit", "b.ts", { old_string: "a", new_string: "b" });
        expect(edits.size()).toBe(2);
        edits.clear();
        expect(edits.size()).toBe(0);
        expect(edits.list()).toEqual([]);
        expect(edits.get("nope")).toBeUndefined();
        expect(edits.getByToolCallId("tc1")).toBeUndefined();
    });

    it("review on missing id is no-op; track stores write content and edit strings", () => {
        edits.review("missing", "d", "c");
        expect(edits.size()).toBe(0);
        const id = edits.track("tc_w", "write", "w.ts", { content: "body" });
        const w = edits.get(id)!;
        expect(w.newContent).toBe("body");
        expect(w.toolName).toBe("write");
        const id2 = edits.track("tc_e", "edit", "e.ts", { old_string: "old", new_string: "new" });
        const e = edits.get(id2)!;
        expect(e.oldString).toBe("old");
        expect(e.newString).toBe("new");
        expect(e.newContent).toBeUndefined();
    });

    it("list cache returns same array until mutation; approve invalidates", () => {
        const id = edits.track("tc_c", "write", "c.ts", { content: "1" });
        const a = edits.list();
        const b = edits.list();
        expect(a).toBe(b);
        edits.approve(id);
        const c = edits.list();
        expect(c).not.toBe(a);
        expect(c).toEqual([]);
    });

    // wave-245 residual
    it("evicts oldest when exceeding MAX_ENTRIES=200; keeps newest 200", () => {
        const ids: string[] = [];
        for (let i = 0; i < 205; i += 1) {
            vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 0, 0, i)));
            ids.push(edits.track(`tc_${i}`, "write", `f${i}.ts`, { content: String(i) }));
        }
        expect(edits.size()).toBe(200);
        // oldest 5 timestamps (i=0..4) evicted
        for (let i = 0; i < 5; i += 1) {
            expect(edits.get(ids[i]!)).toBeUndefined();
            expect(edits.getByToolCallId(`tc_${i}`)).toBeUndefined();
        }
        expect(edits.get(ids[5]!)).toBeDefined();
        expect(edits.get(ids[204]!)).toBeDefined();
        expect(edits.list()).toHaveLength(200);
        // newest first
        expect(edits.list()[0]?.toolCallId).toBe("tc_204");
    });

    it("getByToolCallId returns first insertion match; autoApprove defaults false", () => {
        expect(edits.autoApprove).toBe(false);
        const first = edits.track("dup", "write", "a.ts", { content: "1" });
        const second = edits.track("dup", "edit", "b.ts", { old_string: "a", new_string: "b" });
        expect(edits.getByToolCallId("dup")?.id).toBe(first);
        expect(edits.getByToolCallId("dup")?.filePath).toBe("a.ts");
        edits.remove(first);
        expect(edits.getByToolCallId("dup")?.id).toBe(second);
        edits.autoApprove = true;
        edits.clear();
        expect(edits.autoApprove).toBe(true);
        expect(edits.size()).toBe(0);
    });


    // wave-311 residual
    it("review mutates diff and newContent; approve and reject both delete; missing no-op", () => {
        const id = edits.track("tc_311", "write", "a.ts", { content: "v1" });
        edits.review(id, "diff-text", "v2");
        expect(edits.get(id)?.diff).toBe("diff-text");
        expect(edits.get(id)?.newContent).toBe("v2");
        edits.review("missing_id", "x", "y");
        expect(edits.size()).toBe(1);
        edits.approve(id);
        expect(edits.get(id)).toBeUndefined();
        expect(edits.size()).toBe(0);
        const id2 = edits.track("tc_311b", "edit", "b.ts", { old_string: "a", new_string: "b" });
        edits.reject(id2);
        expect(edits.get(id2)).toBeUndefined();
        edits.reject("nope");
        expect(edits.size()).toBe(0);
    });

    it("track id matches change_ms_rand6; list newest-first; remove invalidates cache", () => {
        vi.setSystemTime(new Date("2026-07-21T10:00:00.000Z"));
        const a = edits.track("t1", "write", "a.ts", { content: "1" });
        expect(a).toMatch(/^change_\d+_[a-z0-9]{6}$/);
        vi.setSystemTime(new Date("2026-07-21T10:00:01.000Z"));
        const b = edits.track("t2", "write", "b.ts", { content: "2" });
        const list1 = edits.list();
        expect(list1[0]?.id).toBe(b);
        expect(list1[1]?.id).toBe(a);
        const list2 = edits.list();
        expect(list2).toBe(list1);
        edits.remove(b);
        const list3 = edits.list();
        expect(list3).not.toBe(list1);
        expect(list3).toHaveLength(1);
        expect(list3[0]?.id).toBe(a);
    });
});
