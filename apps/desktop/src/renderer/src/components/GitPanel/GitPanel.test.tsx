// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "./GitPanel";

const commit = vi.fn();
const refresh = vi.fn();
const loadDiff = vi.fn();
const loadStagedDiff = vi.fn();
const stageFiles = vi.fn();
const unstage = vi.fn();
const undo = vi.fn();

vi.mock("../../hooks/useGit", () => ({
  useGit: () => ({
    status: {
      branch: "main",
      modified: ["src/a.ts"],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    },
    branches: [],
    commits: [],
    isLoading: false,
    error: null,
    loadDiff,
    loadStagedDiff,
    stageFiles,
    unstage,
    undo,
    commit,
    refresh,
    checkout: vi.fn(async () => []),
    createBranch: vi.fn(async () => []),
    getOriginalContent: vi.fn(async () => ""),
    getChangedFiles: vi.fn(async () => []),
  }),
}));

describe("GitPanel", () => {
  beforeEach(() => {
    commit.mockReset();
    refresh.mockReset();
    loadDiff.mockReset();
    loadStagedDiff.mockReset();
    stageFiles.mockReset();
    unstage.mockReset();
    undo.mockReset();
    loadDiff.mockResolvedValue("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new");
    loadStagedDiff.mockResolvedValue("");
    stageFiles.mockResolvedValue(undefined);
    unstage.mockResolvedValue(undefined);
    undo.mockResolvedValue(undefined);
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
  });

  it("keeps commit disabled until at least one staged file exists", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.change(screen.getByRole("textbox", { name: "提交信息" }), {
      target: { value: "update files" },
    });

    expect((screen.getByRole("button", { name: "提交" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("先暂存文件后才能提交")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(commit).not.toHaveBeenCalled();
    expect(stageFiles).not.toHaveBeenCalled();
  });

  it("shows commit failures inline instead of using a blocking alert", async () => {
    commit.mockRejectedValue(new Error("no staged changes"));
    loadStagedDiff.mockResolvedValue(`
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`);

    render(<GitPanel workspacePath="C:/repo" />);

    await screen.findByText("只会提交 1 个暂存文件");

    fireEvent.change(screen.getByRole("textbox", { name: "提交信息" }), {
      target: { value: "update files" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("提交失败: no staged changes");
    });
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("renders staged files from staged diff and filters selected staged diff", async () => {
    loadStagedDiff.mockResolvedValue(`
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-before
+after
`);

    render(<GitPanel workspacePath="C:/repo" />);

    const staged = await screen.findByRole("button", { name: "打开 src/a.ts diff" });
    fireEvent.click(staged);

    await waitFor(() => {
      expect(screen.getByText("old")).toBeTruthy();
    });
    expect(screen.queryByText("before")).toBeNull();
  });

  it("shows a retryable staged diff error without hiding unstaged changes", async () => {
    loadStagedDiff.mockRejectedValueOnce(new Error("staged diff unavailable"));

    render(<GitPanel workspacePath="C:/repo" />);

    expect(await screen.findByText("读取 staged diff 失败")).toBeTruthy();
    expect(screen.getByText("staged diff unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 src/a.ts diff" })).toBeTruthy();

    loadStagedDiff.mockResolvedValueOnce(`
diff --git a/src/staged.ts b/src/staged.ts
--- a/src/staged.ts
+++ b/src/staged.ts
@@ -1 +1 @@
-old
+new
`);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("button", { name: "打开 src/staged.ts diff" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("读取 staged diff 失败")).toBeNull();
    });
  });

  it("keeps staged added and deleted badges from the staged diff metadata", async () => {
    loadStagedDiff.mockResolvedValue(`
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const fresh = true;
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const old = true;
`);

    render(<GitPanel workspacePath="C:/repo" />);

    expect(await screen.findByRole("button", { name: "打开 src/new.ts diff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 src/old.ts diff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消暂存 src/new.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消暂存 src/old.ts" })).toBeTruthy();
    expect(screen.getByText("2 staged / 1 changes · ahead 0 / behind 0")).toBeTruthy();
  });

  it("opens an external target diff when mounted from another panel", async () => {
    render(<GitPanel workspacePath="C:/repo" initialTarget={{ file: "src/a.ts", nonce: 1 }} />);

    await waitFor(() => {
      expect(loadDiff).toHaveBeenCalledWith("src/a.ts");
    });
    expect(await screen.findByText("old")).toBeTruthy();
  });

  it("shows a retryable error when loading a change diff fails", async () => {
    loadDiff
      .mockRejectedValueOnce(new Error("diff unavailable"))
      .mockResolvedValueOnce("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new");

    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "打开 src/a.ts diff" }));

    expect(await screen.findByText("读取 diff 失败")).toBeTruthy();
    expect(screen.getByText("diff unavailable")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(loadDiff).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("old")).toBeTruthy();
  });

  it("previews diff before discarding local changes", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "丢弃 src/a.ts" }));

    await waitFor(() => {
      expect(loadDiff).toHaveBeenCalledWith("src/a.ts");
    });
    expect(screen.getByRole("alert").textContent).toContain("即将丢弃 src/a.ts 的本地变更");
    expect(await screen.findByText("old")).toBeTruthy();
    expect(undo).not.toHaveBeenCalled();
  });

  it("keeps discard confirmation safe when diff preview fails", async () => {
    loadDiff.mockRejectedValueOnce(new Error("cannot read diff"));

    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "丢弃 src/a.ts" }));

    expect(await screen.findByText(/即将丢弃 src\/a\.ts/)).toBeTruthy();
    expect(screen.getByText("读取 diff 失败")).toBeTruthy();
    expect(screen.getByText("cannot read diff")).toBeTruthy();
    expect(undo).not.toHaveBeenCalled();
  });

  it("can cancel a pending discard without touching the working tree", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "丢弃 src/a.ts" }));
    await screen.findByRole("button", { name: "确认丢弃" });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(undo).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("已取消丢弃操作");
  });

  it("broadcasts workspace git changes after confirming discard", async () => {
    const changedSpy = vi.fn();
    window.addEventListener("workspace:git-changed", changedSpy);

    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "丢弃 src/a.ts" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认丢弃" }));

    await waitFor(() => {
      expect(undo).toHaveBeenCalledWith("src/a.ts");
    });
    expect(changedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { workspacePath: "C:/repo", files: ["src/a.ts"], reason: "discard" },
      }),
    );

    window.removeEventListener("workspace:git-changed", changedSpy);
  });

  it("broadcasts workspace git changes after stage and discard operations", async () => {
    const changedSpy = vi.fn();
    window.addEventListener("workspace:git-changed", changedSpy);

    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "暂存 src/a.ts" }));
    await waitFor(() => {
      expect(stageFiles).toHaveBeenCalledWith(["src/a.ts"]);
    });
    expect(changedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { workspacePath: "C:/repo", files: ["src/a.ts"], reason: "stage" },
      }),
    );

    window.removeEventListener("workspace:git-changed", changedSpy);
  });

  it("shows inline feedback after staging a single file", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "暂存 src/a.ts" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("已暂存 src/a.ts");
    });
  });

  it("uses separate accessible controls for opening and file actions", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    expect(await screen.findByRole("button", { name: "打开 src/a.ts diff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂存 src/a.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "丢弃 src/a.ts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Msrc\/a\.ts暂存/ })).toBeNull();
  });

  it("shows inline errors for batch stage failures", async () => {
    stageFiles.mockRejectedValueOnce(new Error("permission denied"));
    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(screen.getByRole("button", { name: "全部暂存" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("暂存失败: permission denied");
    });
  });

  it("broadcasts workspace git changes after commit", async () => {
    const changedSpy = vi.fn();
    window.addEventListener("workspace:git-changed", changedSpy);
    commit.mockResolvedValue(undefined);
    loadStagedDiff.mockResolvedValue(`
diff --git a/src/staged.ts b/src/staged.ts
--- a/src/staged.ts
+++ b/src/staged.ts
@@ -1 +1 @@
-old
+new
`);

    render(<GitPanel workspacePath="C:/repo" />);

    await screen.findByText("只会提交 1 个暂存文件");

    fireEvent.change(screen.getByRole("textbox", { name: "提交信息" }), {
      target: { value: "update files" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith("update files");
    });
    expect(stageFiles).not.toHaveBeenCalled();
    expect(changedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { workspacePath: "C:/repo", files: ["src/staged.ts"], reason: "commit" },
      }),
    );
    expect(await screen.findByText("已提交 1 个文件")).toBeTruthy();
    expect(screen.getByText("update files")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "复制摘要" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("update files\n\n- src/staged.ts");
    expect(await screen.findByRole("button", { name: "已复制" })).toBeTruthy();

    window.removeEventListener("workspace:git-changed", changedSpy);
  });

  it("shows clipboard failures when copying a commit summary", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValueOnce(new Error("clipboard denied")) },
      configurable: true,
    });
    commit.mockResolvedValue(undefined);
    loadStagedDiff.mockResolvedValue(`
diff --git a/src/staged.ts b/src/staged.ts
--- a/src/staged.ts
+++ b/src/staged.ts
@@ -1 +1 @@
-old
+new
`);

    render(<GitPanel workspacePath="C:/repo" />);

    await screen.findByText("只会提交 1 个暂存文件");
    fireEvent.change(screen.getByRole("textbox", { name: "提交信息" }), {
      target: { value: "update files" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(await screen.findByText("已提交 1 个文件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "复制摘要" }));

    expect((await screen.findByRole("alert")).textContent).toContain("复制提交摘要失败: clipboard denied");
    expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
  });

  it("refreshes when a file is saved in the same workspace", async () => {
    render(<GitPanel workspacePath="C:/repo" />);
    refresh.mockClear();

    window.dispatchEvent(new CustomEvent("workspace:file-saved", { detail: { workspacePath: "C:/repo", path: "C:/repo/src/a.ts" } }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("refreshes when git changes are broadcast for the same workspace", async () => {
    render(<GitPanel workspacePath="C:/repo" />);
    refresh.mockClear();

    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "C:/repo", files: ["src/a.ts"], reason: "stage" } }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(screen.getByRole("status").textContent).toContain("Git 状态已更新");
  });

  it("reloads the selected diff when an external git change touches that file", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "打开 src/a.ts diff" }));
    await screen.findByText("old");
    loadDiff.mockClear();
    refresh.mockClear();

    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "C:/repo", files: ["src/a.ts"], reason: "stage" } }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
      expect(loadDiff).toHaveBeenCalledWith("src/a.ts");
    });
    expect(screen.getByRole("status").textContent).toContain("Git 状态已更新");
  });

  it("ignores git change broadcasts from other workspaces", async () => {
    render(<GitPanel workspacePath="C:/repo" />);
    refresh.mockClear();

    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "D:/other", files: ["src/a.ts"], reason: "stage" } }));

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Git 状态已更新")).toBeNull();
  });

  it("exposes primary control focus-visible rings for keyboard a11y", async () => {
    render(<GitPanel workspacePath="C:/repo" />);

    expect(screen.getByRole("button", { name: "刷新 Git 状态" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "切换分支" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "提交" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "全部暂存" }).className).toContain("focus-visible:ring-2");
    expect((await screen.findByRole("button", { name: "打开 src/a.ts diff" })).className).toContain(
      "focus-visible:ring-2",
    );
    expect(screen.getByRole("button", { name: "暂存 src/a.ts" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "丢弃 src/a.ts" }).className).toContain("focus-visible:ring-2");
  });

  it("exposes new branch input focus-visible ring for keyboard a11y", async () => {
    render(<GitPanel workspacePath="C:/repo" />);
    fireEvent.click(screen.getByRole("button", { name: "切换分支" }));
    const input = await screen.findByRole("textbox", { name: "新分支名" });
    expect(input.className).toContain("focus-visible:ring-2");
  });

});
