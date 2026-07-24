// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { CommandPalette } from "./CommandPalette";

const filesList = vi.fn();
const detectProject = vi.fn();
const getGitStatus = vi.fn();
const gitAdd = vi.fn();
const searchSessionMessages = vi.fn();

function renderPalette(props?: Partial<React.ComponentProps<typeof CommandPalette>>): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <CommandPalette
        isOpen
        onClose={onClose}
        workspacePath="C:/repo/.env"
        {...props}
      />
    </I18nProvider>,
  );
  return { onClose };
}

describe("CommandPalette", () => {
  beforeEach(() => {
    filesList.mockReset();
    detectProject.mockReset();
    getGitStatus.mockReset();
    gitAdd.mockReset();
    searchSessionMessages.mockReset();
    filesList.mockResolvedValue([]);
    getGitStatus.mockResolvedValue({
      branch: "main",
      modified: [],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });
    gitAdd.mockResolvedValue(undefined);
    searchSessionMessages.mockResolvedValue([]);
    Object.defineProperty(window, "piAPI", {
      value: { filesList, detectProject, getGitStatus, gitAdd, searchSessionMessages },
      configurable: true,
    });
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "Generated UI History",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "",
              timestamp: new Date(0),
              generatedUi: {
                version: "v1",
                id: "ui-history",
                title: "交付摘要",
                sections: [
                  {
                    id: "summary",
                    kind: "summary",
                    content: "已生成 docs/report.md",
                  },
                ],
              },
            },
          ],
        },
      ],
      sessionsLoading: false,
      persistErrorCount: 0,
      lastPersistError: null,
    });
  });

  it("shows an error state when legacy file listing returns an IPC error", async () => {
    filesList.mockResolvedValueOnce({
      code: "ipcErrors.files.protectedPath",
      fallback: "敏感配置或凭据文件暂不允许直接读取",
      params: { path: "C:/repo/.env" },
    });

    renderPalette();

    await waitFor(() => {
      expect(filesList).toHaveBeenCalledWith("C:/repo/.env");
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("文件搜索失败")).toBeTruthy();
    expect(screen.getByText("敏感配置或凭据文件暂不允许直接读取")).toBeTruthy();
  });

  it("exposes mode tab and retry focus-visible rings for keyboard a11y", async () => {
    filesList.mockResolvedValueOnce({
      code: "ipcErrors.files.protectedPath",
      fallback: "敏感配置或凭据文件暂不允许直接读取",
      params: { path: "C:/repo/.env" },
    });

    renderPalette();

    for (const name of ["文件", "历史", "命令"] as const) {
      expect(screen.getByRole("tab", { name }).className).toContain("focus-visible:ring-2");
    }
    expect((await screen.findByRole("button", { name: "重试" })).className).toContain("focus-visible:ring-2");
  });

  it("loads project scripts in command mode and runs them in the terminal", async () => {
    const runCommandSpy = vi.fn();
    window.addEventListener("terminal:run-command", runCommandSpy);
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "node",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: ["package.json", "pnpm-lock.yaml"],
      packageManager: "pnpm",
      hasGit: true,
      scripts: { test: "vitest", build: "tsc" },
    });

    const { onClose } = renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));

    expect(await screen.findByRole("button", { name: "运行脚本 test" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "运行脚本 test" }));

    expect(runCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { command: "pnpm test", mode: "run" } }),
    );
    expect(screen.getByRole("status").textContent).toContain("已发送脚本 test 到终端");
    expect(onClose).not.toHaveBeenCalled();
    expect(detectProject).toHaveBeenCalledWith("C:/repo");
    window.removeEventListener("terminal:run-command", runCommandSpy);
  });

  it("keeps high-risk project scripts as terminal drafts with visible feedback", async () => {
    const runCommandSpy = vi.fn();
    window.addEventListener("terminal:run-command", runCommandSpy);
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "node",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: ["package.json"],
      packageManager: "pnpm",
      hasGit: true,
      scripts: { clean: "rm -rf dist" },
    });

    const { onClose } = renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.click(await screen.findByRole("button", { name: "运行脚本 clean" }));

    expect((runCommandSpy.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ command: "pnpm clean", mode: "draft" });
    expect(screen.getByRole("status").textContent).toContain("高风险脚本 clean 已填入终端，请确认后手动执行");
    expect(onClose).not.toHaveBeenCalled();
    window.removeEventListener("terminal:run-command", runCommandSpy);
  });

  it("keeps built-in commands available when project detection fails", async () => {
    const onRunCommand = vi.fn();
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      code: "ipcErrors.project.detectFailed",
      fallback: "项目识别失败",
    });

    renderPalette({ workspacePath: "C:/repo", onRunCommand });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));

    expect(await screen.findByText("项目脚本暂不可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    expect(onRunCommand).toHaveBeenCalledWith("new_chat");
  });

  it("exposes workbench navigation commands", async () => {
    const onRunCommand = vi.fn();
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });

    renderPalette({ workspacePath: "C:/repo", onRunCommand });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));

    expect(await screen.findByRole("button", { name: "打开文件" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 Source Control" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 Sessions" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开 Source Control" }));
    expect(onRunCommand).toHaveBeenCalledWith("open_git");
  });

  it("keeps built-in commands visible when git and project context are large", async () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`script${index}`, `echo ${index}`]),
    );
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "node",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: ["package.json"],
      packageManager: "pnpm",
      hasGit: true,
      scripts,
    });
    getGitStatus.mockResolvedValue({
      branch: "main",
      modified: Array.from({ length: 8 }, (_, index) => `src/file-${index}.ts`),
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });

    renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));

    expect(await screen.findByRole("button", { name: "打开变更 src/file-0.ts" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "运行脚本 script0" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "切换终端" })).toBeTruthy();
  });

  it("exposes searchable git change context actions in command mode", async () => {
    const openFileSpy = vi.fn();
    const openDiffSpy = vi.fn();
    const gitChangedSpy = vi.fn();
    window.addEventListener("workspace:open-file", openFileSpy);
    window.addEventListener("workspace:open-git-diff", openDiffSpy);
    window.addEventListener("workspace:git-changed", gitChangedSpy);
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    getGitStatus.mockResolvedValue({
      branch: "main",
      modified: ["src/a.ts", "src/b.ts"],
      added: ["src/new.ts"],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });

    renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));

    expect(await screen.findByRole("button", { name: "打开变更 src/a.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开变更 src/b.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开变更 src/new.ts" })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "src/b" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "打开变更 src/b.ts" }));
    expect(openFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { path: "C:/repo\\src/b.ts" } }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "new" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "查看 Diff src/new.ts" }));
    expect(openDiffSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { file: "src/new.ts" } }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "stage src/b" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "暂存 src/b.ts" }));

    await waitFor(() => {
      expect(gitAdd).toHaveBeenCalledWith("C:/repo", ["src/b.ts"]);
    });
    expect(gitChangedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { workspacePath: "C:/repo", files: ["src/b.ts"], reason: "stage" } }),
    );
    expect(screen.getByRole("status").textContent).toContain("已暂存 src/b.ts");

    window.removeEventListener("workspace:open-file", openFileSpy);
    window.removeEventListener("workspace:open-git-diff", openDiffSpy);
    window.removeEventListener("workspace:git-changed", gitChangedSpy);
  });

  it("keeps the palette open for git stage actions so feedback is visible", async () => {
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    getGitStatus.mockResolvedValue({
      branch: "main",
      modified: ["src/b.ts"],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });
    const { onClose } = renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "stage src/b" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "暂存 src/b.ts" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("已暂存 src/b.ts");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refreshes git context after staging a file", async () => {
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    getGitStatus
      .mockResolvedValueOnce({
        branch: "main",
        modified: ["src/b.ts"],
        added: [],
        deleted: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      })
      .mockResolvedValueOnce({
        branch: "main",
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      });

    renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "stage src/b" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "暂存 src/b.ts" }));

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "暂存 src/b.ts" })).toBeNull();
    });
    expect(screen.getByRole("status").textContent).toContain("已暂存 src/b.ts");
  });

  it("keeps the palette open and shows errors when git stage fails", async () => {
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    getGitStatus.mockResolvedValue({
      branch: "main",
      modified: ["src/b.ts"],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });
    gitAdd.mockResolvedValueOnce({
      code: "ipcErrors.git.addFailed",
      fallback: "git add 失败: permission denied",
    });
    const { onClose } = renderPalette({ workspacePath: "C:/repo" });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "stage src/b" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "暂存 src/b.ts" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("git add 失败: permission denied");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes after normal navigation commands", async () => {
    const onRunCommand = vi.fn();
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    const { onClose } = renderPalette({ workspacePath: "C:/repo", onRunCommand });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));

    expect(onRunCommand).toHaveBeenCalledWith("open_files");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("keeps workspace switching open so async errors are visible", async () => {
    const onRunCommand = vi.fn(() => {
      window.dispatchEvent(new CustomEvent("command-palette:status", {
        detail: { message: "打开目录选择器失败: dialog unavailable", tone: "error" },
      }));
    });
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    const { onClose } = renderPalette({ workspacePath: "C:/repo", onRunCommand });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.click(await screen.findByRole("button", { name: "切换 workspace" }));

    expect(onRunCommand).toHaveBeenCalledWith("switch_workspace");
    expect((await screen.findByRole("alert")).textContent).toContain("打开目录选择器失败: dialog unavailable");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps built-in command failures open so status feedback is visible", async () => {
    const onRunCommand = vi.fn(() => {
      window.dispatchEvent(new CustomEvent("command-palette:status", {
        detail: { message: "请先选择工作区", tone: "error" },
      }));
      return false;
    });
    filesList.mockResolvedValue([]);
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: true,
    });
    const { onClose } = renderPalette({ workspacePath: "", onRunCommand });

    fireEvent.click(screen.getByRole("tab", { name: "命令" }));
    fireEvent.click(await screen.findByRole("button", { name: "切换终端" }));

    expect(onRunCommand).toHaveBeenCalledWith("toggle_terminal");
    expect((await screen.findByRole("alert")).textContent).toContain("请先选择工作区");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces generated ui-only messages in history mode", async () => {
    renderPalette({
      workspacePath: "C:/repo",
      workspaceId: "ws1",
      onSelectHistory: vi.fn(),
    });

    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "report.md" },
    });

    expect(await screen.findByRole("button", { name: /docs\/report\.md/ })).toBeTruthy();
  });

  it("searches persisted messages that are not loaded into the renderer store", async () => {
    searchSessionMessages.mockResolvedValueOnce([{
      sessionId: "s-older",
      sessionTitle: "Older session",
      workspaceId: "ws1",
      messageId: "m-older",
      messageContent: "persisted-history-needle",
      messageRole: "user",
      timestamp: 1,
      matchIndex: 0,
      matchLength: 7,
    }]);
    const onSelectHistory = vi.fn();
    renderPalette({ workspaceId: "ws1", onSelectHistory });

    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), {
      target: { value: "history-needle" },
    });

    const result = await screen.findByRole("button", { name: "persisted-history-needle" });
    fireEvent.click(result);
    expect(searchSessionMessages).toHaveBeenCalledWith({ query: "history-needle", workspaceId: "ws1", limit: 30 });
    expect(onSelectHistory).toHaveBeenCalledWith("s-older", "m-older");
  });

  it("exposes search combobox focus-visible ring for keyboard a11y", () => {
    renderPalette();
    expect(screen.getByRole("combobox", { name: "搜索命令" }).className).toContain(
      "focus-visible:ring-2",
    );
  });

});
