// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkspace } from "./FileWorkspace";

// Mock MonacoEditor to render a simple textarea for testing
vi.mock("../Editor/MonacoEditor", () => ({
  MonacoEditor: function MockMonacoEditor({
    value,
    onChange,
    onSave,
    readOnly,
    language,
  }: {
    value: string;
    onChange?: (value: string) => void;
    onSave?: () => void;
    readOnly?: boolean;
    language?: string;
  }) {
    return (
      <div data-testid="monaco-editor" data-language={language} data-readonly={readOnly}>
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              onSave?.();
            }
          }}
          aria-label="编辑文件内容"
          readOnly={readOnly}
        />
      </div>
    );
  },
  getLanguageFromFilename: (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    return ext === "ts" ? "typescript" : "plaintext";
  },
}));

const filesGetTree = vi.fn();
const filesReadTextFile = vi.fn();
const filesWriteTextFile = vi.fn();
const filesSearch = vi.fn();
const getGitStatus = vi.fn();
const gitDiff = vi.fn();
const openPath = vi.fn();
const revealPath = vi.fn();

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tree = {
  name: "repo",
  path: "C:/repo",
  type: "directory" as const,
  children: [
    {
      name: "src",
      path: "C:/repo/src",
      type: "directory" as const,
      children: [
        {
          name: "app.ts",
          path: "C:/repo/src/app.ts",
          type: "file" as const,
          extension: "ts",
          size: 24,
        },
        {
          name: "other.ts",
          path: "C:/repo/src/other.ts",
          type: "file" as const,
          extension: "ts",
          size: 12,
        },
      ],
    },
  ],
};

describe("FileWorkspace", () => {
  beforeEach(() => {
    filesGetTree.mockReset();
    filesReadTextFile.mockReset();
    filesWriteTextFile.mockReset();
    filesSearch.mockReset();
    getGitStatus.mockReset();
    gitDiff.mockReset();
    openPath.mockReset();
    revealPath.mockReset();
    filesGetTree.mockResolvedValue(tree);
    filesReadTextFile.mockResolvedValue({
      path: "C:/repo/src/app.ts",
      name: "app.ts",
      content: "export const app = true;",
      size: 24,
      mtimeMs: 1000,
      encoding: "utf-8",
      truncated: false,
      binary: false,
    });
    filesSearch.mockResolvedValue([{ path: "C:/repo/src/app.ts", name: "app.ts", size: 24, isDirectory: false }]);
    filesWriteTextFile.mockResolvedValue({ path: "C:/repo/src/app.ts", size: 25, savedAt: Date.now(), mtimeMs: 2000 });
    getGitStatus.mockResolvedValue({
      branch: "main",
      modified: ["src/app.ts"],
      added: [],
      deleted: [],
      untracked: ["src/other.ts"],
      ahead: 0,
      behind: 0,
    });
    gitDiff.mockResolvedValue("diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new");
    openPath.mockResolvedValue("");
    revealPath.mockResolvedValue(undefined);
    Object.defineProperty(window, "piAPI", {
      value: { filesGetTree, filesReadTextFile, filesWriteTextFile, filesSearch, getGitStatus, gitDiff, openPath, revealPath },
      configurable: true,
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });
  });

  it("loads a real file tree and previews selected text files", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    expect(await screen.findByRole("button", { name: /app\.ts/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /app\.ts/ }));

    await waitFor(() => {
      expect(screen.getByText("export const app = true;")).toBeTruthy();
    });
    expect(filesReadTextFile).toHaveBeenCalledWith("C:/repo/src/app.ts", "C:/repo");
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("ignores stale file read responses when switching files quickly", async () => {
    const appRead = deferred<Awaited<ReturnType<typeof filesReadTextFile>>>();
    const otherRead = deferred<Awaited<ReturnType<typeof filesReadTextFile>>>();
    filesReadTextFile.mockImplementation((path: string) => (path.endsWith("other.ts") ? otherRead.promise : appRead.promise));

    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(screen.getByRole("button", { name: /other\.ts/ }));

    await act(async () => {
      otherRead.resolve({
        path: "C:/repo/src/other.ts",
        name: "other.ts",
        content: "export const other = true;",
        size: 26,
        mtimeMs: 2000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      });
      await otherRead.promise;
    });

    expect(await screen.findByText("export const other = true;")).toBeTruthy();

    await act(async () => {
      appRead.resolve({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = true;",
        size: 24,
        mtimeMs: 1000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      });
      await appRead.promise;
    });

    expect(screen.getByLabelText("文件只读预览").textContent).toBe("export const other = true;");
    expect(screen.queryByText("export const app = true;")).toBeNull();
  });

  it("shows rejected file tree errors and can retry", async () => {
    filesGetTree
      .mockRejectedValueOnce(new Error("tree unavailable"))
      .mockResolvedValueOnce(tree);

    render(<FileWorkspace workspacePath="C:/repo" />);

    expect((await screen.findByRole("alert")).textContent).toContain("文件树加载失败");
    expect(screen.getByRole("alert").textContent).toContain("加载文件树失败: tree unavailable");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(filesGetTree).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole("button", { name: /app\.ts/ })).toBeTruthy();
  });

  it("ignores stale file tree responses after switching workspaces", async () => {
    const oldTree = deferred<typeof tree>();
    const nextTree = {
      name: "next",
      path: "D:/next",
      type: "directory" as const,
      children: [
        {
          name: "main.py",
          path: "D:/next/main.py",
          type: "file" as const,
          extension: "py",
          size: 18,
        },
      ],
    };
    filesGetTree
      .mockReturnValueOnce(oldTree.promise)
      .mockResolvedValueOnce(nextTree);

    const { rerender } = render(<FileWorkspace workspacePath="C:/repo" />);
    rerender(<FileWorkspace workspacePath="D:/next" />);

    expect(await screen.findByRole("button", { name: /main\.py/ })).toBeTruthy();

    await act(async () => {
      oldTree.resolve(tree);
      await oldTree.promise;
    });

    expect(screen.getByRole("button", { name: /main\.py/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /app\.ts/ })).toBeNull();
  });

  it("searches through files without direct filesystem access from renderer", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.change(screen.getByLabelText("搜索文件"), { target: { value: "app" } });

    await waitFor(() => {
      expect(filesSearch).toHaveBeenCalledWith("C:/repo", "app", { limit: 80 });
    });
    expect(await screen.findByTitle("Modified")).toBeTruthy();
  });

  it("selects directory search results without reading them as text files", async () => {
    filesSearch.mockResolvedValueOnce([
      { path: "C:/repo/src", name: "src", size: 0, isDirectory: true },
    ]);

    render(<FileWorkspace workspacePath="C:/repo" />);

    await waitFor(() => {
      expect(filesGetTree).toHaveBeenCalled();
    });
    filesReadTextFile.mockClear();

    fireEvent.change(screen.getByLabelText("搜索文件"), { target: { value: "src" } });
    fireEvent.click(await screen.findByRole("button", { name: /src/ }));

    expect(filesReadTextFile).not.toHaveBeenCalled();
    expect(screen.getAllByText("已选中目录").length).toBeGreaterThan(0);
    expect(screen.getByText("C:/repo/src")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "复制相对路径" })[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("src");
  });

  it("shows file search IPC errors and can retry", async () => {
    filesSearch
      .mockResolvedValueOnce({
        code: "ipcErrors.files.searchFailed",
        fallback: "文件搜索失败: permission denied",
      })
      .mockResolvedValueOnce([{ path: "C:/repo/src/app.ts", name: "app.ts", size: 24, isDirectory: false }]);

    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.change(screen.getByLabelText("搜索文件"), { target: { value: "app" } });

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("文件搜索失败: permission denied");
    expect(screen.queryByText("没有匹配文件")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(filesSearch).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole("button", { name: /app\.ts/ })).toBeTruthy();
  });

  it("shows protected path errors returned by IPC", async () => {
    filesReadTextFile.mockResolvedValueOnce({
      code: "ipcErrors.files.protectedPath",
      fallback: "敏感配置或凭据文件暂不允许直接读取",
      params: { path: "C:/repo/.env" },
    });
    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    expect((await screen.findAllByText("敏感配置或凭据文件暂不允许直接读取")).length).toBeGreaterThan(0);
  });

  it("shows rejected file read errors without leaving the preview loading", async () => {
    filesReadTextFile.mockRejectedValueOnce(new Error("disk offline"));

    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    expect((await screen.findAllByText("读取文件失败: disk offline")).length).toBeGreaterThan(0);
    expect(screen.queryByText("正在读取文件...")).toBeNull();
    expect(screen.queryByText("export const app = true;")).toBeNull();
  });

  it("collapses directories without losing selection state", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    const src = await screen.findByRole("button", { name: /src/ });
    expect(screen.getByRole("button", { name: /app\.ts/ })).toBeTruthy();

    fireEvent.click(src);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /app\.ts/ })).toBeNull();
    });
  });

  it("copies paths and can send selected files to chat", async () => {
    const switchSpy = vi.fn();
    const prefillSpy = vi.fn();
    window.addEventListener("app:switch-section", switchSpy);
    window.addEventListener("chatpanel:prefill", prefillSpy);

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");

    fireEvent.click(screen.getAllByRole("button", { name: "复制路径" })[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("C:/repo/src/app.ts");
    expect((await screen.findAllByText("已复制绝对路径")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "复制相对路径" })[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("src/app.ts");
    expect((await screen.findAllByText("已复制相对路径")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "引用到聊天" }));
    expect(prefillSpy).toHaveBeenCalled();
    expect(switchSpy).toHaveBeenCalled();

    window.removeEventListener("app:switch-section", switchSpy);
    window.removeEventListener("chatpanel:prefill", prefillSpy);
  });

  it("shows clipboard failures when copying paths", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi
          .fn()
          .mockRejectedValueOnce(new Error("clipboard denied"))
          .mockRejectedValueOnce(new Error("relative clipboard denied")),
      },
      configurable: true,
    });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");

    fireEvent.click(screen.getAllByRole("button", { name: "复制路径" })[0]);

    expect((await screen.findAllByText("复制路径失败: clipboard denied")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已复制绝对路径")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "复制相对路径" })[0]);

    expect((await screen.findAllByText("复制相对路径失败: relative clipboard denied")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已复制相对路径")).toBeNull();
  });

  it("surfaces system open and reveal action results", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("C:/repo/src/app.ts"));
    expect((await screen.findAllByText("已请求系统打开")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "定位" }));
    await waitFor(() => expect(revealPath).toHaveBeenCalledWith("C:/repo/src/app.ts"));
    expect((await screen.findAllByText("已请求系统定位")).length).toBeGreaterThan(0);
  });

  it("shows IPC fallback when system open actions fail", async () => {
    openPath.mockResolvedValueOnce({
      code: "ipcErrors.files.openFailed",
      fallback: "系统打开失败",
      params: { path: "C:/repo/src/app.ts" },
    });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");

    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect((await screen.findAllByText("系统打开失败")).length).toBeGreaterThan(0);
  });

  it("shows string failures returned by Electron shell open", async () => {
    openPath.mockResolvedValueOnce("No application is associated with the specified file");

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");

    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect((await screen.findAllByText("No application is associated with the specified file")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已请求系统打开")).toBeNull();
  });

  it("shows rejected reveal errors inline", async () => {
    revealPath.mockRejectedValueOnce(new Error("explorer unavailable"));

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");

    fireEvent.click(screen.getByRole("button", { name: "定位" }));

    expect((await screen.findAllByText("系统定位失败: explorer unavailable")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已请求系统定位")).toBeNull();
  });

  it("edits, saves and clears dirty state through IPC", async () => {
    const savedSpy = vi.fn();
    window.addEventListener("workspace:file-saved", savedSpy);
    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    expect(await screen.findByLabelText("文件只读预览")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "编辑文件内容" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "export const app = false;" } });

    expect(await screen.findByText("未保存")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(filesWriteTextFile).toHaveBeenCalledWith("C:/repo/src/app.ts", "export const app = false;", "C:/repo", { expectedMtimeMs: 1000 });
    });
    expect(await screen.findByText("已保存")).toBeTruthy();
    expect(screen.queryByText("未保存")).toBeNull();
    expect(savedSpy).toHaveBeenCalled();
    expect(gitDiff).not.toHaveBeenCalled();
    window.removeEventListener("workspace:file-saved", savedSpy);
  });

  it("keeps the dirty editor open on save failure and supports retrying", async () => {
    filesWriteTextFile
      .mockResolvedValueOnce({
        code: "ipcErrors.files.protectedPath",
        fallback: "保存失败：文件受保护",
        params: { path: "C:/repo/src/app.ts" },
      })
      .mockResolvedValueOnce({ path: "C:/repo/src/app.ts", size: 28, savedAt: Date.now() });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "export const app = 'retry';" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findAllByText("保存失败")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("保存失败：文件受保护").length).toBeGreaterThan(0);
    expect((screen.getByRole("textbox", { name: "编辑文件内容" }) as HTMLTextAreaElement).value).toBe("export const app = 'retry';");

    fireEvent.click(screen.getByRole("button", { name: "复制错误" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("保存失败：文件受保护");

    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(filesWriteTextFile).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("已保存")).toBeTruthy();
    expect(screen.queryByText("保存失败")).toBeNull();
  });

  it("keeps drafts safe when save IPC rejects and supports retrying", async () => {
    filesWriteTextFile
      .mockRejectedValueOnce(new Error("disk is offline"))
      .mockResolvedValueOnce({ path: "C:/repo/src/app.ts", size: 32, savedAt: Date.now(), mtimeMs: 2000 });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "export const app = 'offline';" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findAllByText("保存失败: disk is offline")).length).toBeGreaterThan(0);
    expect((screen.getByRole("textbox", { name: "编辑文件内容" }) as HTMLTextAreaElement).value).toBe("export const app = 'offline';");
    expect(screen.queryByText("保存中")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "复制错误" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("保存失败: disk is offline");

    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(filesWriteTextFile).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("已保存")).toBeTruthy();
  });

  it("shows clipboard failures when copying save errors", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValueOnce(new Error("clipboard unavailable")),
      },
      configurable: true,
    });
    filesWriteTextFile.mockResolvedValueOnce({
      code: "ipcErrors.files.protectedPath",
      fallback: "保存失败：文件受保护",
      params: { path: "C:/repo/src/app.ts" },
    });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "编辑文件内容" }), { target: { value: "export const app = 'fail';" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findAllByText("保存失败：文件受保护")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "复制错误" }));

    expect((await screen.findAllByText("复制错误信息失败: clipboard unavailable")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已复制错误信息")).toBeNull();
  });

  it("keeps drafts safe when the file changed on disk and can reload from disk", async () => {
    filesWriteTextFile.mockResolvedValueOnce({
      code: "ipcErrors.files.writeConflict",
      fallback: "文件已被其他进程修改。请重新读取文件后再保存，当前草稿已保留。",
      params: { path: "C:/repo/src/app.ts" },
    });
    filesReadTextFile
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = true;",
        size: 24,
        mtimeMs: 1000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = 'disk';",
        size: 26,
        mtimeMs: 3000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = 'disk';",
        size: 26,
        mtimeMs: 3000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "export const app = 'draft';" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("文件已被其他进程修改。请重新读取文件后再保存，当前草稿已保留。")).toBeTruthy();
    expect(await screen.findByText("export const app = 'disk';")).toBeTruthy();
    expect(screen.getByText("export const app = 'draft';")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "复制草稿" })[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("export const app = 'draft';");

    fireEvent.click(screen.getByRole("button", { name: "继续编辑草稿" }));
    expect((screen.getByRole("textbox", { name: "编辑文件内容" }) as HTMLTextAreaElement).value).toBe("export const app = 'draft';");
    fireEvent.click(screen.getAllByRole("button", { name: "查看冲突" })[0]);
    expect(await screen.findByText("磁盘文件已在外部发生变化。下面显示“磁盘版本”到“当前草稿”的差异，草稿仍保留在编辑器中。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新读取文件" }));
    await waitFor(() => {
      expect(screen.getByLabelText("文件只读预览").textContent).toBe("export const app = 'disk';");
    });
  });

  it("shows clipboard failures when copying conflict drafts", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValueOnce(new Error("draft copy denied")),
      },
      configurable: true,
    });
    filesWriteTextFile.mockResolvedValueOnce({
      code: "ipcErrors.files.writeConflict",
      fallback: "文件已被其他进程修改。请重新读取文件后再保存，当前草稿已保留。",
      params: { path: "C:/repo/src/app.ts" },
    });
    filesReadTextFile
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = true;",
        size: 24,
        mtimeMs: 1000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = 'disk';",
        size: 26,
        mtimeMs: 3000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "编辑文件内容" }), { target: { value: "export const app = 'draft';" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("文件已被其他进程修改。请重新读取文件后再保存，当前草稿已保留。")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "复制草稿" })[0]);

    expect((await screen.findAllByText("复制草稿失败: draft copy denied")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已复制当前草稿")).toBeNull();
  });

  it("can adopt the disk version from a save conflict", async () => {
    filesWriteTextFile.mockResolvedValueOnce({
      code: "ipcErrors.files.writeConflict",
      fallback: "文件已被其他进程修改。请重新读取文件后再保存，当前草稿已保留。",
      params: { path: "C:/repo/src/app.ts" },
    });
    filesReadTextFile
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = true;",
        size: 24,
        mtimeMs: 1000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: "C:/repo/src/app.ts",
        name: "app.ts",
        content: "export const app = 'disk';",
        size: 26,
        mtimeMs: 3000,
        encoding: "utf-8",
        truncated: false,
        binary: false,
      });

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "编辑文件内容" }), { target: { value: "export const app = 'draft';" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("磁盘文件已在外部发生变化。下面显示“磁盘版本”到“当前草稿”的差异，草稿仍保留在编辑器中。");
    fireEvent.click(screen.getAllByRole("button", { name: "采用磁盘版本" })[0]);

    expect(await screen.findByLabelText("文件只读预览")).toBeTruthy();
    expect(screen.getByLabelText("文件只读预览").textContent).toBe("export const app = 'disk';");
    expect(screen.queryByText("保存冲突")).toBeNull();
    expect(await screen.findByText("已采用磁盘版本")).toBeTruthy();
  });

  it("shows git status badges and opens the selected file diff", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    expect(await screen.findByTitle("Modified")).toBeTruthy();
    expect(screen.getByTitle("Untracked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");
    expect(screen.getByText("Modified (M)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看 Diff" }));

    await waitFor(() => {
      expect(gitDiff).toHaveBeenCalledWith("C:/repo", "src/app.ts");
    });
    expect(await screen.findByText("old")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回预览" }));
    expect(await screen.findByLabelText("文件只读预览")).toBeTruthy();
  });

  it("ignores stale diff responses after switching to another file", async () => {
    const diffRead = deferred<string>();
    gitDiff.mockReturnValueOnce(diffRead.promise);
    filesReadTextFile.mockImplementation(async (path: string) => ({
      path,
      name: path.endsWith("other.ts") ? "other.ts" : "app.ts",
      content: path.endsWith("other.ts") ? "export const other = true;" : "export const app = true;",
      size: 24,
      mtimeMs: path.endsWith("other.ts") ? 2000 : 1000,
      encoding: "utf-8",
      truncated: false,
      binary: false,
    }));

    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");
    fireEvent.click(screen.getByRole("button", { name: "查看 Diff" }));
    fireEvent.click(screen.getByRole("button", { name: /other\.ts/ }));

    expect(await screen.findByText("export const other = true;")).toBeTruthy();

    await act(async () => {
      diffRead.resolve("diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old app\n+new app");
      await diffRead.promise;
    });

    expect(screen.getByLabelText("文件只读预览").textContent).toBe("export const other = true;");
    expect(screen.queryByText("old app")).toBeNull();
  });

  it("reloads git status when workspace git changes", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "C:/repo", files: ["src/app.ts"], reason: "stage" } }));

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("reloads the open diff when workspace git changes touch the selected file", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");
    fireEvent.click(screen.getByRole("button", { name: "查看 Diff" }));
    await waitFor(() => {
      expect(gitDiff).toHaveBeenCalledWith("C:/repo", "src/app.ts");
    });

    gitDiff.mockClear();
    getGitStatus.mockClear();
    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "C:/repo", files: ["src/app.ts"], reason: "stage" } }));

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(1);
      expect(gitDiff).toHaveBeenCalledWith("C:/repo", "src/app.ts");
    });
  });

  it("keeps the open diff stable when unrelated files change in git", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    await screen.findByText("export const app = true;");
    fireEvent.click(screen.getByRole("button", { name: "查看 Diff" }));
    await waitFor(() => {
      expect(gitDiff).toHaveBeenCalledWith("C:/repo", "src/app.ts");
    });

    gitDiff.mockClear();
    getGitStatus.mockClear();
    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "C:/repo", files: ["src/other.ts"], reason: "stage" } }));

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(1);
    });
    expect(gitDiff).not.toHaveBeenCalled();
  });

  it("opens an external target file and can start in diff mode", async () => {
    render(
      <FileWorkspace
        workspacePath="C:/repo"
        initialTarget={{ path: "C:/repo/src/app.ts", mode: "diff", nonce: 1 }}
      />,
    );

    await waitFor(() => {
      expect(filesReadTextFile).toHaveBeenCalledWith("C:/repo/src/app.ts", "C:/repo");
    });
    await waitFor(() => {
      expect(gitDiff).toHaveBeenCalledWith("C:/repo", "src/app.ts");
    });
    expect(await screen.findByText("old")).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回预览" })).toBeTruthy();
  });

  it("discards unsaved edits back to the last loaded content", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "broken" } });
    fireEvent.click(screen.getByRole("button", { name: "丢弃修改" }));

    expect((editor as HTMLTextAreaElement).value).toBe("export const app = true;");
    expect(await screen.findByText("已丢弃未保存修改")).toBeTruthy();
  });

  it("saves with Ctrl+S from the editor", async () => {
    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "export const app = 1;" } });
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(filesWriteTextFile).toHaveBeenCalledWith("C:/repo/src/app.ts", "export const app = 1;", "C:/repo", { expectedMtimeMs: 1000 });
    });
  });

  it("asks before switching files with unsaved edits and respects cancellation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    filesReadTextFile.mockImplementation(async (path: string) => ({
      path,
      name: path.endsWith("other.ts") ? "other.ts" : "app.ts",
      content: path.endsWith("other.ts") ? "export const other = true;" : "export const app = true;",
      size: 24,
      encoding: "utf-8",
      truncated: false,
      binary: false,
    }));

    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const editor = await screen.findByRole("textbox", { name: "编辑文件内容" });
    fireEvent.change(editor, { target: { value: "dirty" } });

    fireEvent.click(screen.getByRole("button", { name: /other\.ts/ }));
    expect(confirm).toHaveBeenCalledWith("当前文件有未保存修改，切换文件将丢弃这些修改。继续？");
    expect((editor as HTMLTextAreaElement).value).toBe("dirty");

    fireEvent.click(screen.getByRole("button", { name: /other\.ts/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("文件只读预览").textContent).toBe("export const other = true;");
    });
  });

  it("keeps binary and truncated files read-only with explicit reasons", async () => {
    filesReadTextFile.mockResolvedValueOnce({
      path: "C:/repo/src/app.ts",
      name: "app.ts",
      content: "",
      size: 1024,
      encoding: "utf-8",
      truncated: false,
      binary: true,
    });
    const { unmount } = render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    expect(await screen.findByText("二进制文件暂不预览，可使用“打开”或“定位”查看。")).toBeTruthy();
    expect(screen.getAllByText("二进制文件不可直接编辑").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    unmount();

    filesReadTextFile.mockResolvedValueOnce({
      path: "C:/repo/src/app.ts",
      name: "app.ts",
      content: "partial",
      size: 1024 * 1024,
      encoding: "utf-8",
      truncated: true,
      binary: false,
    });
    render(<FileWorkspace workspacePath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: /app\.ts/ }));

    expect(await screen.findByText("文件过大，当前只显示前 512KB。为避免误保存，截断文件暂不可编辑。")).toBeTruthy();
    expect(screen.getAllByText("文件过大且已截断，暂不允许保存").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });
});
