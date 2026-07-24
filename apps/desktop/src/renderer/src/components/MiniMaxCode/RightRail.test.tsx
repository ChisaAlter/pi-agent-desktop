// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RightRail } from "./RightRail";
import { I18nProvider } from "../../i18n";
import { usePlanStore } from "../../stores/plan-store";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useQueueStore } from "../../stores/queue-store";

function renderWithI18n(ui: ReactElement): ReturnType<typeof render> {
  return render(ui, { wrapper: I18nProvider });
}

describe("RightRail", () => {
  const getGitStatus = vi.fn();
  const gitDiff = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    getGitStatus.mockReset();
    gitDiff.mockReset();

    Object.defineProperty(window, "piAPI", {
      value: { getGitStatus, gitDiff },
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
    useSessionStore.setState({ sessions: [], currentSessionId: null });
    useSettingsStore.setState({
      rightRailCollapsed: false,
      settings: {
        ...useSettingsStore.getState().settings,
        model: "",
        provider: "",
        language: "zh-CN",
        workspaceToolDefaults: {},
      },
    });
    usePlanStore.setState({
      enabled: false,
      activeCard: null,
      decisionRequest: null,
      goal: null,
      steps: [],
      status: "idle",
    });
    useQueueStore.getState().clear();
  });

  it("does not issue initial workspace IPC while the rail is collapsed", async () => {
    useSettingsStore.setState({ rightRailCollapsed: true });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);
    await Promise.resolve();

    expect(getGitStatus).not.toHaveBeenCalled();
    expect(gitDiff).not.toHaveBeenCalled();
  });

  it("renders environment git information from the current workspace", async () => {
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: ["a.ts", "b.ts"],
      added: ["c.ts"],
      deleted: [],
      untracked: ["d.ts"],
      ahead: 1,
      behind: 2,
    });
    gitDiff.mockResolvedValue([
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      "-old",
      "+new",
      "+another",
    ].join("\n"));

    renderWithI18n(<RightRail workspacePath="C:/ai/pi-agent-desktop/apps/desktop" />);

    await waitFor(() => {
      expect(screen.getByText("master")).toBeTruthy();
    });
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(getGitStatus).toHaveBeenCalledWith("C:/ai/pi-agent-desktop/apps/desktop");
    expect(gitDiff).toHaveBeenCalledWith("C:/ai/pi-agent-desktop/apps/desktop");
  });

  it("refreshes git summary when a workspace file is saved", async () => {
    getGitStatus
      .mockResolvedValueOnce({
        branch: "master",
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      })
      .mockResolvedValueOnce({
        branch: "master",
        modified: ["src/a.ts"],
        added: [],
        deleted: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      });
    gitDiff.mockResolvedValue("");

    renderWithI18n(<RightRail workspacePath="C:/repo" />);
    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new CustomEvent("workspace:file-saved", { detail: { workspacePath: "C:/repo", path: "C:/repo/src/a.ts" } }));

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(2);
    });
    // Changed paths surface in the compact project-files list after refresh.
    expect(await screen.findByRole("button", { name: "src/a.ts" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Diff" }).length).toBeGreaterThan(0);
  });

  it("refreshes git summary when workspace git changes", async () => {
    getGitStatus
      .mockResolvedValueOnce({
        branch: "master",
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
        ahead: 0,
        behind: 0,
      })
      .mockResolvedValueOnce({
        branch: "master",
        modified: [],
        added: ["src/new.ts"],
        deleted: [],
        untracked: [],
        ahead: 1,
        behind: 0,
      });
    gitDiff.mockResolvedValue("");

    renderWithI18n(<RightRail workspacePath="C:/repo" />);
    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath: "C:/repo", files: ["src/new.ts"], reason: "stage" } }));

    await waitFor(() => {
      expect(getGitStatus).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("1/0")).toBeTruthy();
  });

  it("prefers plan checklist over generic task activity", () => {
    usePlanStore.setState({
      steps: [
        { id: "s1", text: "梳理界面", status: "completed" },
        { id: "s2", text: "执行计划", status: "running" },
      ],
    });

    renderWithI18n(
      <RightRail
        tasks={[{ id: "t1", name: "普通任务", status: "running" }]}
      />,
    );

    expect(screen.getByText("梳理界面")).toBeTruthy();
    expect(screen.getByText("执行计划")).toBeTruthy();
    expect(screen.getByText("运行队列")).toBeTruthy();
    expect(screen.getByText("普通任务")).toBeTruthy();
  });

  it("renders one compact utility panel without token statistics", async () => {
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: [],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });
    gitDiff.mockResolvedValue("");

    renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);

    expect(await screen.findByText("环境信息")).toBeTruthy();
    expect(screen.queryByText("来源")).toBeNull();
    expect(screen.queryByText("本地")).toBeNull();
    expect(screen.queryByText("比较分支")).toBeNull();
    expect(screen.queryByText("Token 使用统计")).toBeNull();
    expect(screen.queryByText("总 Token")).toBeNull();
    expect(screen.queryByText("会话数")).toBeNull();
    expect(screen.getByText("进度")).toBeTruthy();
    expect(screen.getByTestId("right-rail-progress")).toBeTruthy();
    expect(screen.queryByText("工具权限")).toBeNull();
  });

  it("uses one restrained outer surface instead of separate cards", () => {
    const { container } = renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);
    const rail = screen.getByTestId("right-rail-panel");

    expect(rail.className).toContain("overflow-y-auto");
    expect(rail.className).toContain("rounded-[8px]");
    expect(rail.className).toContain("shadow-[var(--right-rail-shadow)]");
    expect(rail.className).toContain("text-[14px]");
    expect(rail.className).toContain("[font-family:var(--right-rail-font)]");
    expect(container.querySelectorAll('section[class*="rounded-"]')).toHaveLength(0);
  });

  it("follows the language setting for visible right rail cards", async () => {
    window.localStorage.setItem("pi-desktop.locale", "en-US");
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        language: "en-US",
      },
    }));
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: [],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });
    gitDiff.mockResolvedValue("");

    renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);

    expect(await screen.findByText("Environment")).toBeTruthy();
    expect(screen.queryByText("Token usage")).toBeNull();
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.queryByText("Sources")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Browse all files" })).toHaveLength(1);
    expect(screen.queryByText("Tool permissions")).toBeNull();
    expect(screen.queryByLabelText("Network")).toBeNull();
    expect(screen.queryByText("环境信息")).toBeNull();
    expect(screen.queryByText("工具权限")).toBeNull();
    expect(screen.queryByText("Token 使用统计")).toBeNull();
  });

  it("shows the active goal above plan progress from the shared plan store", () => {
    usePlanStore.setState({
      goal: {
        id: "goal-1",
        workspaceId: "w1",
        condition: "完成长程能力集成",
        status: "checking",
        reason: "等待 judge 检查",
        updatedAt: Date.now(),
      },
      steps: [
        { id: "T1", text: "实现 Goal 状态", status: "running" },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);

    expect(screen.getByText("任务目标：完成长程能力集成")).toBeTruthy();
    expect(screen.getByText("judge 检查中")).toBeTruthy();
    expect(screen.getByText("等待 judge 检查")).toBeTruthy();
    expect(screen.getByText("实现 Goal 状态")).toBeTruthy();
  });

  it("shows queue activity as a clickable task flow", () => {
    const switchSpy = vi.fn();
    window.addEventListener("app:switch-section", switchSpy);
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "修复 Git 工作流",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
        },
      ],
    });
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["改成只提交 staged"],
      followUp: ["跑完整测试"],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    expect(screen.getByText("运行队列")).toBeTruthy();
    expect(screen.getByText("修复 Git 工作流")).toBeTruthy();
    expect(screen.getByText("改成只提交 staged")).toBeTruthy();
    expect(screen.getByText("跑完整测试")).toBeTruthy();
    expect(screen.getByText("3 项")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /修复 Git 工作流/ }));
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: "session:s1" },
      }),
    );

    window.removeEventListener("app:switch-section", switchSpy);
  });

  it("shows queue errors and completion results in the task flow panel", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({ type: "extension_error", message: "tool crashed" } as never);

    const { rerender } = renderWithI18n(<RightRail workspacePath="C:/repo" />);

    expect(screen.getByRole("alert").textContent).toContain("tool crashed");

    useQueueStore.getState().clear();
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({ type: "agent_end" });
    rerender(<RightRail workspacePath="C:/repo" />);

    expect(screen.getByText("最近任务已完成")).toBeTruthy();
    expect(screen.getByText("Agent 已结束")).toBeTruthy();
  });

  it("shows auto retry and recent queue activity in the task flow panel", () => {
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "长任务恢复",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
        },
      ],
    });
    useQueueStore.getState().applyEvent({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "429 Too Many Requests",
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    expect(screen.getAllByText("自动重试中").length).toBeGreaterThan(0);
    expect(screen.getAllByText("自动重试").length).toBeGreaterThan(0);
    expect(screen.getByText("长任务恢复")).toBeTruthy();
  });

  it("shows recent tool execution activity from queue events", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "pnpm test" },
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    expect(screen.getAllByText("bash 运行中").length).toBeGreaterThan(0);
  });

  it("includes fallback tool tasks in the task flow", () => {
    renderWithI18n(
      <RightRail
        tasks={[{ id: "t1", name: "运行测试", status: "running" }]}
      />,
    );

    expect(screen.getByText("运行队列")).toBeTruthy();
    expect(screen.getAllByText("运行测试").length).toBeGreaterThan(0);
    expect(screen.getByText("Tool")).toBeTruthy();
  });

  it("puts environment controls first, excludes usage stats, and opens Files and Git from visible rail actions", async () => {
    const switchSpy = vi.fn();
    window.addEventListener("app:switch-section", switchSpy);
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: [],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 1,
      behind: 0,
    });
    gitDiff.mockResolvedValue("");
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          usage: {
            model: "claude-sonnet",
            provider: "anthropic",
            contextWindow: 100000,
            inputTokens: 1200,
            outputTokens: 300,
            totalTokens: 1500,
            estimatedCostUsd: 0.0123,
            compactionStatus: "running",
            updatedAt: Date.now(),
          },
          toolPermissions: {
            fileRead: true,
            fileWrite: false,
            shell: false,
            git: true,
            network: false,
            extensions: true,
          },
        },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);

    expect(screen.queryByText("运行状态")).toBeNull();
    expect(screen.queryByText("思考")).toBeNull();
    expect(screen.queryByText("claude-sonnet")).toBeNull();
    expect(screen.queryByText("anthropic")).toBeNull();
    expect(screen.queryByText("输入 1.2K")).toBeNull();
    expect(screen.queryByText("Token 使用统计")).toBeNull();
    expect(screen.queryByText("1.5K")).toBeNull();
    expect(screen.queryByText("输入 Token")).toBeNull();
    expect(screen.queryByText("输出 Token")).toBeNull();
    expect(screen.queryByText("anthropic/claude-sonnet")).toBeNull();
    expect(screen.queryByText("会话数")).toBeNull();
    expect(screen.queryByText("工具权限")).toBeNull();
    expect(screen.queryByLabelText("文件写入")).toBeNull();
    expect(screen.queryByLabelText("网络")).toBeNull();
    expect(screen.queryByText("最近工具")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "浏览全部文件" })[0]);
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: "files" },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "查看变更文件，打开 Git 面板" }));
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: "git" },
      }),
    );

    window.removeEventListener("app:switch-section", switchSpy);
  });

  it("exposes browse/file/diff focus-visible rings for keyboard a11y", async () => {
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: ["a.ts", "b.ts", "c.ts", "d.ts"],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    });
    gitDiff.mockResolvedValue("");

    renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);

    const browse = await screen.findByRole("button", { name: "浏览全部文件" });
    expect(browse.className).toContain("focus-visible:ring-2");

    await waitFor(() => {
      expect(screen.getByTitle("在文件工作区打开 a.ts")).toBeTruthy();
    });
    expect(screen.getByTitle("在文件工作区打开 a.ts").className).toContain("focus-visible:ring-2");
    expect(screen.getByTitle("查看 a.ts 的 Git diff").className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: /展开其余/ }).className).toContain("focus-visible:ring-2");
  });
});
