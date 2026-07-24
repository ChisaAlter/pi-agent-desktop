import { describe, expect, it } from "vitest";
import type { FileTreeNode, GitStatus, TextFileContent } from "@shared";
import {
  basename,
  escapeDiffLine,
  flattenTree,
  formatBytes,
  lineRows,
  makeConflictDiff,
  makeGitMarks,
  modeDescription,
  modeLabel,
  nonEditableReason,
  normalizePath,
  relativeToWorkspace,
  resolveWorkspacePath,
  shellActionFailure,
} from "./file-workspace-utils";

describe("file-workspace-utils", () => {
  describe("basename", () => {
    it("handles posix and windows separators", () => {
      expect(basename("src/app.ts")).toBe("app.ts");
      expect(basename("C:\\\\Users\\\\demo\\\\file.md")).toBe("file.md");
      expect(basename("alone")).toBe("alone");
    });
  });

  describe("formatBytes", () => {
    it("formats sizes and missing values", () => {
      expect(formatBytes(undefined)).toBe("-");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(2048)).toBe("2 KB");
      expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
    });
  });

  describe("flattenTree", () => {
    it("returns empty for null and DFS-walks children", () => {
      expect(flattenTree(null)).toEqual([]);
      const tree: FileTreeNode = {
        name: "root",
        path: "/w",
        type: "directory",
        children: [
          {
            name: "a.ts",
            path: "/w/a.ts",
            type: "file",
          },
          {
            name: "sub",
            path: "/w/sub",
            type: "directory",
            children: [{ name: "b.ts", path: "/w/sub/b.ts", type: "file" }],
          },
        ],
      };
      expect(flattenTree(tree).map((n) => n.path)).toEqual([
        "/w",
        "/w/a.ts",
        "/w/sub",
        "/w/sub/b.ts",
      ]);
    });
  });

  describe("lineRows / escapeDiffLine / makeConflictDiff", () => {
    it("normalizes empty and CRLF content", () => {
      expect(lineRows("")).toEqual([""]);
      expect(lineRows("a\r\nb\nc")).toEqual(["a", "b", "c"]);
      expect(escapeDiffLine("x\r")).toBe("x");
    });

    it("builds a conflict unified-diff style payload", () => {
      const diff = makeConflictDiff("notes.md", "disk\r\nline", "draft");
      expect(diff).toContain("diff --git a/notes.md b/notes.md");
      expect(diff).toContain("--- a/notes.md");
      expect(diff).toContain("+++ b/notes.md");
      expect(diff).toContain("@@ -1,2 +1,1 @@");
      expect(diff).toContain("-disk");
      expect(diff).toContain("-line");
      expect(diff).toContain("+draft");
    });
  });

  describe("mode labels", () => {
    it("maps view modes", () => {
      expect(modeLabel("preview")).toBe("只读预览");
      expect(modeLabel("edit")).toBe("编辑");
      expect(modeLabel("diff")).toBe("Diff");
      expect(modeLabel("conflict")).toBe("冲突");
      expect(modeDescription("preview")).toBe("只读");
      expect(modeDescription("edit")).toBe("可编辑");
    });
  });

  describe("nonEditableReason", () => {
    it("returns reasons for binary/truncated and null otherwise", () => {
      expect(nonEditableReason(null)).toBeNull();
      const base: TextFileContent = {
        path: "/w/a",
        name: "a",
        content: "x",
        size: 1,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      };
      expect(nonEditableReason(base)).toBeNull();
      expect(nonEditableReason({ ...base, binary: true })).toContain("二进制");
      expect(nonEditableReason({ ...base, truncated: true })).toContain("过大");
    });
  });

  describe("shellActionFailure", () => {
    it("extracts ipc and string failures", () => {
      expect(shellActionFailure(null)).toBeNull();
      expect(shellActionFailure({ code: "E", fallback: "boom" })).toBe("boom");
      expect(shellActionFailure({ __brand: "IpcError", code: "E", fallback: "branded" })).toBe(
        "branded",
      );
      expect(shellActionFailure("  open failed  ")).toBe("  open failed  ");
      expect(shellActionFailure("   ")).toBeNull();
      expect(shellActionFailure({ ok: true })).toBeNull();
    });
  });

  describe("path helpers", () => {
    it("normalizes slashes", () => {
      expect(normalizePath("C:\\\\w\\\\src\\\\a.ts")).toBe("C:/w/src/a.ts");
      expect(normalizePath("a//b///c")).toBe("a/b/c");
    });

    it("computes relative and absolute workspace paths", () => {
      expect(relativeToWorkspace("C:/proj/src/a.ts", "C:/proj")).toBe("src/a.ts");
      expect(relativeToWorkspace("C:/proj", "C:/proj/")).toBe("");
      expect(relativeToWorkspace("C:/other/x", "C:/proj")).toBe("C:/other/x");

      expect(resolveWorkspacePath("src/a.ts", "C:/proj")).toBe("C:/proj/src/a.ts");
      expect(resolveWorkspacePath("C:/proj/src/a.ts", "C:/proj")).toBe("C:/proj/src/a.ts");
      // normalizePath collapses leading // so UNC is not preserved as absolute here
      expect(resolveWorkspacePath("//server/share/f", "C:/proj")).toBe("C:/proj/server/share/f");
      expect(resolveWorkspacePath("C:/proj", "C:/proj")).toBe("C:/proj");
    });
  });

  describe("makeGitMarks", () => {
    it("returns empty map for null status", () => {
      expect(makeGitMarks(null).size).toBe(0);
    });

    it("marks modified/added/deleted/untracked with normalized paths", () => {
      const status: GitStatus = {
        branch: "main",
        modified: ["src\\\\a.ts"],
        added: ["src/b.ts"],
        deleted: ["old.ts"],
        untracked: ["tmp/x"],
        ahead: 0,
        behind: 0,
      };
      const marks = makeGitMarks(status);
      expect(marks.get("src/a.ts")?.label).toBe("M");
      expect(marks.get("src/b.ts")?.label).toBe("A");
      expect(marks.get("old.ts")?.label).toBe("D");
      expect(marks.get("tmp/x")?.label).toBe("?");
      expect(marks.get("src/a.ts")?.text).toBe("Modified");
    });

    // wave-111 residual: later status lists overwrite earlier marks for same path
    it("lets later git status lists overwrite earlier marks for the same path", () => {
      const status: GitStatus = {
        branch: "main",
        modified: ["dup.ts"],
        added: ["dup.ts"],
        deleted: [],
        untracked: ["dup.ts"],
        ahead: 0,
        behind: 0,
      };
      const marks = makeGitMarks(status);
      expect(marks.get("dup.ts")?.label).toBe("?");
    });
  });

  // wave-111 residual
  describe("residual path/size/edit edges", () => {
    it("basename tolerates trailing separators and empty-ish paths", () => {
      expect(basename("src/app/")).toBe("app");
      expect(basename("C:\\\\Users\\\\demo\\\\")).toBe("demo");
      expect(basename("")).toBe("");
    });

    it("formatBytes covers B/KB boundary and multi-MB", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1023)).toBe("1023 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    });

    it("binary reason wins when both binary and truncated", () => {
      const content: TextFileContent = {
        path: "/w/a",
        name: "a",
        content: "",
        size: 1,
        encoding: "utf-8",
        truncated: true,
        binary: true,
      };
      expect(nonEditableReason(content)).toContain("二进制");
    });

    it("resolveWorkspacePath joins relative and keeps abs windows paths", () => {
      expect(resolveWorkspacePath("/src/a.ts", "C:/proj/")).toBe("C:/proj/src/a.ts");
      expect(resolveWorkspacePath("C:/proj/src/a.ts", "C:/proj/")).toBe("C:/proj/src/a.ts");
      expect(relativeToWorkspace("C:\\\\proj\\\\src\\\\a.ts", "C:\\\\proj\\\\")).toBe("src/a.ts");
    });

    it("makeConflictDiff keeps min hunk counts of 1 for empty sides", () => {
      const diff = makeConflictDiff("empty.md", "", "");
      expect(diff).toContain("@@ -1,1 +1,1 @@");
      expect(diff).toContain("\n-\n+");
    });
  });

  // wave-126 residual
  describe("residual mode/shell/path edges", () => {
    it("maps all modeDescription labels", () => {
      expect(modeDescription("diff")).toBe("差异视图");
      expect(modeDescription("conflict")).toBe("冲突视图");
    });

    it("shellActionFailure ignores blank strings and non-error objects", () => {
      expect(shellActionFailure("")).toBeNull();
      expect(shellActionFailure("\t")).toBeNull();
      expect(shellActionFailure({ code: "E", fallback: "" })).toBe("");
      expect(shellActionFailure(0)).toBeNull();
      expect(shellActionFailure(false)).toBeNull();
    });

    it("flattenTree walks empty children arrays without inventing nodes", () => {
      const tree: FileTreeNode = {
        name: "root",
        path: "/w",
        type: "directory",
        children: [],
      };
      expect(flattenTree(tree)).toEqual([tree]);
    });

    it("relativeToWorkspace returns empty for trailing-slash workspace equality", () => {
      expect(relativeToWorkspace("C:/proj/", "C:/proj")).toBe("");
      expect(relativeToWorkspace("C:/proj/src", "C:/proj/")).toBe("src");
    });

    it("makeGitMarks last-write-wins when path appears in multiple lists", () => {
      const status: GitStatus = {
        branch: "main",
        modified: ["x.ts"],
        added: [],
        deleted: ["x.ts"],
        untracked: [],
        ahead: 0,
        behind: 0,
      };
      expect(makeGitMarks(status).get("x.ts")?.label).toBe("D");
    });
  });

  // wave-300 residual
  describe("wave-300 residual path/size/diff edges", () => {
    it("formatBytes uses round(/102.4)/10 for KB and MB fractions", () => {
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1023)).toBe("1023 B");
      expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    });

    it("modeLabel/modeDescription cover all ViewMode keys", () => {
      for (const mode of ["preview", "edit", "diff", "conflict"] as const) {
        expect(modeLabel(mode).length).toBeGreaterThan(0);
        expect(modeDescription(mode).length).toBeGreaterThan(0);
      }
      expect(modeLabel("diff")).toBe("Diff");
      expect(modeDescription("conflict")).toBe("冲突视图");
    });

    it("makeConflictDiff headers and body prefixes; normalizePath collapses slashes", () => {
      const diff = makeConflictDiff("a/b.md", "old\n", "new");
      expect(diff.split("\n")[0]).toBe("diff --git a/a/b.md b/a/b.md");
      expect(diff).toContain("--- a/a/b.md");
      expect(diff).toContain("+++ b/a/b.md");
      expect(diff).toMatch(/^-old/m);
      expect(diff).toMatch(/^\+new/m);
      expect(normalizePath("a\\\\b//c")).toBe("a/b/c");
      expect(resolveWorkspacePath("C:/ws/file.ts", "C:/ws")).toBe("C:/ws/file.ts");
      expect(relativeToWorkspace("C:/ws/file.ts", "C:/ws")).toBe("file.ts");
    });

    it("shellActionFailure returns ipc fallback and non-empty strings only", () => {
      expect(shellActionFailure({ code: "X", fallback: "denied" })).toBe("denied");
      expect(shellActionFailure("fail")).toBe("fail");
      expect(shellActionFailure("")).toBeNull();
      expect(shellActionFailure(null)).toBeNull();
      expect(shellActionFailure({})).toBeNull();
    });
  });




  // wave-308 residual
  describe("wave-308 residual file-workspace-utils", () => {
    it("basename filters empty segments; formatBytes undefined and exact MB boundary", () => {
      expect(basename("")).toBe("");
      expect(basename("///")).toBe("///");
      expect(basename("C:\\a\\b.ts")).toBe("b.ts");
      expect(basename("/only")).toBe("only");
      expect(formatBytes(undefined)).toBe("-");
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
    });

    it("flattenTree walks depth-first push-before-children; null empty", () => {
      expect(flattenTree(null)).toEqual([]);
      const tree = {
        name: "root",
        path: "/r",
        type: "directory" as const,
        children: [
          {
            name: "a",
            path: "/r/a",
            type: "directory" as const,
            children: [{ name: "f", path: "/r/a/f", type: "file" as const }],
          },
          { name: "b", path: "/r/b", type: "file" as const },
        ],
      };
      expect(flattenTree(tree).map((n) => n.name)).toEqual(["root", "a", "f", "b"]);
    });

    it("lineRows empty yields single empty string; CRLF normalized; makeConflictDiff counts", () => {
      expect(lineRows("")).toEqual([""]);
      expect(lineRows("a" + String.fromCharCode(13, 10) + "b")).toEqual(["a", "b"]);
      expect(escapeDiffLine("x" + String.fromCharCode(13) + "y")).toBe("xy");
      const emptyDiff = makeConflictDiff("e.txt", "", "");
      expect(emptyDiff).toContain("@@ -1,1 +1,1 @@");
      expect(emptyDiff).toContain("-");
      expect(emptyDiff).toContain("+");
      const multi = makeConflictDiff("m.txt", "a\nb", "a\nb\nc");
      expect(multi).toContain("@@ -1,2 +1,3 @@");
    });

    it("nonEditableReason binary/truncated; relative/resolve workspace edges", () => {
      expect(nonEditableReason(null)).toBeNull();
      expect(
        nonEditableReason({ path: "x", content: "", binary: true, truncated: false } as never),
      ).toBe("二进制文件不可直接编辑");
      expect(
        nonEditableReason({ path: "x", content: "y", binary: false, truncated: true } as never),
      ).toBe("文件过大且已截断，暂不允许保存");
      expect(relativeToWorkspace("C:/ws", "C:/ws")).toBe("");
      expect(relativeToWorkspace("C:/ws/", "C:/ws")).toBe("");
      expect(relativeToWorkspace("C:/other/f", "C:/ws")).toBe("C:/other/f");
      // product normalizePath collapses // so UNC check never sees double-slash; treated as relative after stripping leading /
      expect(resolveWorkspacePath("//server/share/a", "C:/ws")).toBe("C:/ws/server/share/a");
      expect(resolveWorkspacePath("D:/abs/file.ts", "C:/ws")).toBe("D:/abs/file.ts");
      expect(resolveWorkspacePath("rel/x.ts", "C:/ws")).toBe("C:/ws/rel/x.ts");
      expect(resolveWorkspacePath("/leading", "C:/ws")).toBe("C:/ws/leading");
    });

    it("makeGitMarks later categories overwrite; normalizePath on keys", () => {
      const status = {
        modified: ["src\\a.ts"],
        added: ["src/a.ts"],
        deleted: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      } as never;
      const marks = makeGitMarks(status);
      expect(marks.get("src/a.ts")?.label).toBe("A");
      expect(makeGitMarks(null).size).toBe(0);
    });
  });

});
