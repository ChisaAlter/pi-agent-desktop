import { describe, expect, it } from "vitest";
import type { DiffLine } from "./diff-parser";
import { splitHunkLines } from "./DiffViewer";

function ctx(oldLine: number, newLine: number, content = "ctx"): DiffLine {
  return { type: "context", oldLine, newLine, content };
}

function add(newLine: number, content = "add"): DiffLine {
  return { type: "add", oldLine: null, newLine, content };
}

function rem(oldLine: number, content = "rem"): DiffLine {
  return { type: "remove", oldLine, newLine: null, content };
}

describe("splitHunkLines", () => {
  it("keeps short context runs unfolded", () => {
    const lines = [ctx(1, 1), ctx(2, 2), add(3), ctx(3, 4)];
    const segments = splitHunkLines(lines);
    expect(segments.every((s) => s.type === "lines")).toBe(true);
    expect(segments.flatMap((s) => (s.type === "lines" ? s.lines : [])).length).toBe(4);
  });

  it("folds long context runs with head/tail kept", () => {
    // CONTEXT_EXPAND = 3 → need > 7 consecutive context lines to fold
    const lines: DiffLine[] = [];
    for (let i = 1; i <= 10; i++) lines.push(ctx(i, i, `c${i}`));
    lines.push(add(11, "+x"));
    const segments = splitHunkLines(lines);
    expect(segments.some((s) => s.type === "fold")).toBe(true);
    const fold = segments.find((s) => s.type === "fold");
    expect(fold && fold.type === "fold" ? fold.count : 0).toBe(4); // 10 - 3 - 3
    // change line still present after fold
    const lastLines = segments[segments.length - 1];
    expect(lastLines?.type).toBe("lines");
    if (lastLines?.type === "lines") {
      expect(lastLines.lines.some((l) => l.type === "add")).toBe(true);
    }
  });

  it("does not fold mixed change lines", () => {
    const lines = [rem(1), add(1), rem(2), add(2)];
    const segments = splitHunkLines(lines);
    expect(segments).toHaveLength(4);
    expect(segments.every((s) => s.type === "lines")).toBe(true);
  });

  // wave-107 residual
  it("returns empty for empty input and does not fold at the 7-line threshold", () => {
    expect(splitHunkLines([])).toEqual([]);
    const exactlySeven: DiffLine[] = [];
    for (let i = 1; i <= 7; i++) exactlySeven.push(ctx(i, i, `c${i}`));
    const segments = splitHunkLines(exactlySeven);
    expect(segments.some((s) => s.type === "fold")).toBe(false);
    expect(segments).toHaveLength(1);
    if (segments[0]?.type === "lines") expect(segments[0].lines).toHaveLength(7);
  });

  it("folds multiple context runs independently", () => {
    const lines: DiffLine[] = [];
    for (let i = 1; i <= 9; i++) lines.push(ctx(i, i, `a${i}`));
    lines.push(add(10, "+mid"));
    for (let i = 11; i <= 20; i++) lines.push(ctx(i, i, `b${i}`));
    const segments = splitHunkLines(lines);
    const folds = segments.filter((s) => s.type === "fold");
    expect(folds).toHaveLength(2);
    expect(folds[0]?.type === "fold" && folds[0].count).toBe(3); // 9 - 3 - 3
    expect(folds[1]?.type === "fold" && folds[1].count).toBe(4); // 10 - 3 - 3
  });
});


// wave-294 residual
describe("splitHunkLines residual (wave-294)", () => {
  it("folds at 8 context lines with count 2 and records head/tail line anchors", () => {
    const lines: DiffLine[] = [];
    for (let i = 1; i <= 8; i++) lines.push(ctx(i, i, `c${i}`));
    const segments = splitHunkLines(lines);
    expect(segments).toHaveLength(3);
    expect(segments[0]?.type).toBe("lines");
    expect(segments[1]?.type).toBe("fold");
    expect(segments[2]?.type).toBe("lines");
    if (segments[0]?.type === "lines") {
      expect(segments[0].lines.map((l) => l.content)).toEqual(["c1", "c2", "c3"]);
    }
    if (segments[2]?.type === "lines") {
      expect(segments[2].lines.map((l) => l.content)).toEqual(["c6", "c7", "c8"]);
    }
    const fold = segments[1];
    if (fold?.type === "fold") {
      expect(fold.count).toBe(2); // 8 - 3 - 3
      expect(fold.oldStart).toBe(3);
      expect(fold.newStart).toBe(3);
      expect(fold.oldEnd).toBe(6);
      expect(fold.newEnd).toBe(6);
    }
  });

  it("emits single-line change segments between context runs", () => {
    const lines = [ctx(1, 1), rem(2), add(2), ctx(3, 3)];
    const segments = splitHunkLines(lines);
    expect(segments.map((s) => s.type)).toEqual(["lines", "lines", "lines", "lines"]);
    if (segments[1]?.type === "lines") expect(segments[1].lines[0]?.type).toBe("remove");
    if (segments[2]?.type === "lines") expect(segments[2].lines[0]?.type).toBe("add");
  });

  it("uses null anchors when folded head/tail line numbers are null", () => {
    // context lines with null old/new (malformed but product still reads fields)
    const weird: DiffLine[] = [];
    for (let i = 0; i < 9; i++) {
      weird.push({ type: "context", oldLine: null, newLine: null, content: `w${i}` });
    }
    const segments = splitHunkLines(weird);
    const fold = segments.find((s) => s.type === "fold");
    expect(fold?.type).toBe("fold");
    if (fold?.type === "fold") {
      expect(fold.count).toBe(3); // 9 - 3 - 3
      expect(fold.oldStart).toBeNull();
      expect(fold.newStart).toBeNull();
      expect(fold.oldEnd).toBeNull();
      expect(fold.newEnd).toBeNull();
    }
  });
});

// wave-305 residual
describe("splitHunkLines residual (wave-305)", () => {
  it("threshold: 7 context stays unfolded; 8 folds with head/tail of 3", () => {
    const seven: DiffLine[] = [];
    for (let i = 1; i <= 7; i++) seven.push(ctx(i, i, `s${i}`));
    expect(splitHunkLines(seven).some((s) => s.type === "fold")).toBe(false);

    const eight: DiffLine[] = [];
    for (let i = 1; i <= 8; i++) eight.push(ctx(i, i, `e${i}`));
    const segs = splitHunkLines(eight);
    expect(segs.map((s) => s.type)).toEqual(["lines", "fold", "lines"]);
    if (segs[1]?.type === "fold") expect(segs[1].count).toBe(2);
  });

  it("interleaved changes never fold; consecutive context merges into one lines segment", () => {
    const lines = [rem(1, "a"), add(1, "b"), ctx(2, 2, "c"), ctx(3, 3, "d")];
    const segs = splitHunkLines(lines);
    // product: each non-context is its own segment; consecutive context collapses
    expect(segs.every((s) => s.type === "lines")).toBe(true);
    expect(segs).toHaveLength(3);
    if (segs[2]?.type === "lines") expect(segs[2].lines).toHaveLength(2);
  });

  it("fold anchors come from last head line and first tail line", () => {
    const lines: DiffLine[] = [];
    for (let i = 10; i <= 20; i++) lines.push(ctx(i, i + 100, `c${i}`));
    const segs = splitHunkLines(lines);
    const fold = segs.find((s) => s.type === "fold");
    expect(fold?.type).toBe("fold");
    if (fold?.type === "fold") {
      // head is lines 10-12; tail 18-20; folded 13-17 → count 5
      expect(fold.count).toBe(5);
      expect(fold.oldStart).toBe(12);
      expect(fold.newStart).toBe(112);
      expect(fold.oldEnd).toBe(18);
      expect(fold.newEnd).toBe(118);
    }
  });
});
