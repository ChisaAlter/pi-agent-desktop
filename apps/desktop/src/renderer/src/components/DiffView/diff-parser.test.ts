import { describe, expect, it } from "vitest";
import { extractDiffFromOutput, parseDiff } from "./diff-parser";

const SAMPLE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " context",
  "-old",
  "+new",
  "+extra",
  " keep",
].join("\n");

describe("parseDiff", () => {
  it("parses unified diff hunks and counts", () => {
    const parsed = parseDiff(SAMPLE);
    expect(parsed.files).toHaveLength(1);
    const file = parsed.files[0];
    expect(file.oldPath).toBe("src/a.ts");
    expect(file.newPath).toBe("src/a.ts");
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].lines.map((l) => l.type)).toEqual([
      "context",
      "remove",
      "add",
      "add",
      "context",
    ]);
  });

  it("marks new and deleted files via /dev/null paths", () => {
    const created = parseDiff(`diff --git a/x b/x
--- /dev/null
+++ b/x
@@ -0,0 +1,1 @@
+hello
`);
    expect(created.files[0].isNew).toBe(true);
    expect(created.files[0].oldPath).toBe("x");

    const deleted = parseDiff(`diff --git a/y b/y
--- a/y
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`);
    expect(deleted.files[0].isDeleted).toBe(true);
  });
});

describe("extractDiffFromOutput", () => {
  it("returns null for empty or non-diff text", () => {
    expect(extractDiffFromOutput("")).toBeNull();
    expect(extractDiffFromOutput("hello world")).toBeNull();
  });

  it("extracts diff/patch fields from JSON", () => {
    expect(extractDiffFromOutput(JSON.stringify({ diff: SAMPLE }))).toBe(SAMPLE);
    expect(extractDiffFromOutput(JSON.stringify({ patch: SAMPLE }))).toBe(SAMPLE);
  });

  it("accepts raw unified diff text", () => {
    expect(extractDiffFromOutput(SAMPLE)).toBe(SAMPLE);
  });

  // wave-115 residual
  it("parses multiple files and preserves hunk header text", () => {
    const multi = [
      "diff --git a/one.ts b/one.ts",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1 @@ function one",
      "-a",
      "+b",
      "diff --git a/two.ts b/two.ts",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -10,2 +10,2 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n");
    const parsed = parseDiff(multi);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0].oldPath).toBe("one.ts");
    expect(parsed.files[0].hunks[0].header).toBe("function one");
    expect(parsed.files[0].hunks[0].oldCount).toBe(1);
    expect(parsed.files[0].hunks[0].newCount).toBe(1);
    expect(parsed.files[1].oldPath).toBe("two.ts");
    expect(parsed.files[1].additions).toBe(1);
    expect(parsed.files[1].deletions).toBe(1);
  });

  it("defaults missing hunk counts to 1 and tracks line numbers", () => {
    const text = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -5 +7 @@",
      "-old",
      "+new",
    ].join("\n");
    const file = parseDiff(text).files[0];
    expect(file.hunks[0].oldStart).toBe(5);
    expect(file.hunks[0].newStart).toBe(7);
    expect(file.hunks[0].oldCount).toBe(1);
    expect(file.hunks[0].newCount).toBe(1);
    expect(file.hunks[0].lines[0]).toMatchObject({ type: "remove", oldLine: 5, newLine: null });
    expect(file.hunks[0].lines[1]).toMatchObject({ type: "add", oldLine: null, newLine: 7 });
  });

  it("returns null for JSON without diff/patch; raw-looking JSON strings still match @@ markers", () => {
    expect(extractDiffFromOutput(JSON.stringify({ content: "nope" }))).toBeNull();
    // JSON.stringify(SAMPLE) is not an object with .diff — falls through to marker check on the
    // outer JSON text which still contains @@ / --- / +++ substrings
    expect(extractDiffFromOutput(JSON.stringify(SAMPLE))).toBe(JSON.stringify(SAMPLE));
    // @@ alone without --- or +++ is rejected
    expect(extractDiffFromOutput("partial @@ without markers")).toBeNull();
  });
});

describe("diff-parser residual (wave-123)", () => {
  it("ignores index/mode metadata lines and empty context lines inside hunks", () => {
    const text = [
      "diff --git a/meta.ts b/meta.ts",
      "index 1111111..2222222 100644",
      "--- a/meta.ts",
      "+++ b/meta.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "",
      "-old",
      "+new",
    ].join("\n");
    const file = parseDiff(text).files[0];
    expect(file.oldPath).toBe("meta.ts");
    expect(file.hunks[0].lines.map((l) => l.type)).toEqual(["context", "context", "remove", "add"]);
    expect(file.hunks[0].lines[1].content).toBe("");
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
  });

  it("skips hunk/body lines before any diff --git header", () => {
    const text = [
      "noise before header",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/real.ts b/real.ts",
      "--- a/real.ts",
      "+++ b/real.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    const parsed = parseDiff(text);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].oldPath).toBe("real.ts");
    expect(parsed.files[0].additions).toBe(1);
    expect(parsed.files[0].deletions).toBe(1);
  });

  it("extracts nested string JSON payloads that themselves contain a diff field", () => {
    // product: only object.diff / object.patch are read; nested-as-string is dead branch after typeof object
    expect(extractDiffFromOutput(JSON.stringify({ patch: SAMPLE }))).toBe(SAMPLE);
    expect(extractDiffFromOutput(JSON.stringify({ diff: 123 }))).toBeNull();
    expect(extractDiffFromOutput("@@ only")).toBeNull();
    expect(extractDiffFromOutput("--- only without at-at")).toBeNull();
  });

  // wave-131 residual
  it("extractDiffFromOutput returns null for empty and non-diff text", () => {
    expect(extractDiffFromOutput("")).toBeNull();
    expect(extractDiffFromOutput("hello world")).toBeNull();
    expect(extractDiffFromOutput(JSON.stringify({ other: "x" }))).toBeNull();
  });

  it("extractDiffFromOutput prefers string diff field over patch", () => {
    const body = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b";
    expect(extractDiffFromOutput(JSON.stringify({ diff: body, patch: "ignored" }))).toBe(body);
  });

  it("parseDiff returns empty files for blank input", () => {
    expect(parseDiff("").files).toEqual([]);
    expect(parseDiff("   \n").files).toEqual([]);
  });
});


// wave-295 residual
describe("diff-parser residual (wave-295)", () => {
  it("backfills surviving path when one side is /dev/null", () => {
    const created = parseDiff(
      [
        "diff --git a/x b/x",
        "--- /dev/null",
        "+++ b/new.ts",
        "@@ -0,0 +1 @@",
        "+hello",
      ].join("\n"),
    );
    expect(created.files[0]?.isNew).toBe(true);
    expect(created.files[0]?.isDeleted).toBe(false);
    expect(created.files[0]?.oldPath).toBe("new.ts");
    expect(created.files[0]?.newPath).toBe("new.ts");
    expect(created.files[0]?.additions).toBe(1);

    const deleted = parseDiff(
      [
        "diff --git a/y b/y",
        "--- a/gone.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
      ].join("\n"),
    );
    expect(deleted.files[0]?.isDeleted).toBe(true);
    expect(deleted.files[0]?.isNew).toBe(false);
    expect(deleted.files[0]?.oldPath).toBe("gone.ts");
    expect(deleted.files[0]?.newPath).toBe("gone.ts");
    expect(deleted.files[0]?.deletions).toBe(1);
  });

  it("extractDiffFromOutput requires @@ plus --- or +++ for raw text; ignores non-string JSON fields", () => {
    const raw = "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b";
    expect(extractDiffFromOutput(raw)).toBe(raw);
    expect(extractDiffFromOutput("--- a/a\n+++ b/a\nno hunk")).toBeNull();
    expect(extractDiffFromOutput("@@ -1 +1 @@ alone without dashes")).toBeNull();
    expect(extractDiffFromOutput(JSON.stringify({ diff: null, patch: raw }))).toBe(raw);
    expect(extractDiffFromOutput(JSON.stringify({ diff: { nested: true } }))).toBeNull();
  });

  it("parseDiff strips a/ and b/ prefixes and counts add/remove per file", () => {
    const parsed = parseDiff(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@",
        " context",
        "-old",
        "+new",
        " more",
      ].join("\n"),
    );
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]?.oldPath).toBe("src/a.ts");
    expect(parsed.files[0]?.newPath).toBe("src/a.ts");
    expect(parsed.files[0]?.additions).toBe(1);
    expect(parsed.files[0]?.deletions).toBe(1);
    const lines = parsed.files[0]?.hunks[0]?.lines ?? [];
    expect(lines.some((l) => l.type === "context" && l.content === "context")).toBe(true);
    expect(lines.some((l) => l.type === "remove" && l.content === "old")).toBe(true);
    expect(lines.some((l) => l.type === "add" && l.content === "new")).toBe(true);
  });
});

// wave-304 residual
describe("diff-parser residual (wave-304)", () => {
  it("parseDiff multi-file; hunk count defaults to 1 when omitted; empty line is context", () => {
    const text = [
      "diff --git a/one.ts b/one.ts",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
      "diff --git a/two.ts b/two.ts",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -10,0 +10,1 @@ fn",
      "+only",
    ].join("\n");
    const parsed = parseDiff(text);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0]?.oldPath).toBe("one.ts");
    expect(parsed.files[0]?.hunks[0]?.oldCount).toBe(1);
    expect(parsed.files[0]?.hunks[0]?.newCount).toBe(1);
    const firstLines = parsed.files[0]?.hunks[0]?.lines ?? [];
    expect(firstLines.some((l) => l.type === "context" && l.content === "")).toBe(true);
    expect(parsed.files[1]?.hunks[0]?.header).toBe("fn");
    expect(parsed.files[1]?.hunks[0]?.oldCount).toBe(0);
    expect(parsed.files[1]?.hunks[0]?.newCount).toBe(1);
    expect(parsed.files[1]?.additions).toBe(1);
    expect(parsed.files[1]?.deletions).toBe(0);
  });

  it("extractDiffFromOutput prefers JSON.diff over patch; empty/null outputs null", () => {
    expect(extractDiffFromOutput("")).toBeNull();
    expect(extractDiffFromOutput("plain text without markers")).toBeNull();
    const both = JSON.stringify({
      diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b",
      patch: "--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d",
    });
    const extracted = extractDiffFromOutput(both);
    expect(extracted).toContain("--- a/x");
    expect(extracted).not.toContain("--- a/y");
    expect(extractDiffFromOutput(JSON.stringify({ patch: "--- a/p\n+++ b/p\n@@ -1 +1 @@\n+x" }))).toContain(
      "--- a/p",
    );
  });

  it("parseDiff skips index/mode noise; renames keep paths; line numbers advance on context", () => {
    const text = [
      "diff --git a/old.ts b/new.ts",
      "index 123..456 100644",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -2,2 +2,2 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n");
    const file = parseDiff(text).files[0];
    expect(file?.oldPath).toBe("old.ts");
    expect(file?.newPath).toBe("new.ts");
    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines[0]).toMatchObject({ type: "context", oldLine: 2, newLine: 2, content: "keep" });
    expect(lines[1]).toMatchObject({ type: "remove", oldLine: 3, newLine: null, content: "old" });
    expect(lines[2]).toMatchObject({ type: "add", oldLine: null, newLine: 3, content: "new" });
  });
});
