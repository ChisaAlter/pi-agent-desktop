// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const detectProject = vi.fn();
  const openPath = vi.fn();
  const revealPath = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    getGitStatus.mockReset();
    gitDiff.mockReset();
    detectProject.mockReset();
    openPath.mockReset();
    revealPath.mockReset();
    detectProject.mockResolvedValue({
      type: "unknown",
      name: "repo",
      rootPath: "C:/repo",
      configFiles: [],
      hasGit: false,
    });
    Object.defineProperty(window, "piAPI", {
      value: { getGitStatus, gitDiff, detectProject, openPath, revealPath },
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
    useSessionStore.setState({ sessions: [], currentSessionId: null });
    useSettingsStore.setState({
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
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
    expect(getGitStatus).toHaveBeenCalledWith("C:/ai/pi-agent-desktop/apps/desktop");
    expect(gitDiff).toHaveBeenCalledWith("C:/ai/pi-agent-desktop/apps/desktop");
  });

  it("renders detected project metadata in the environment panel", async () => {
    getGitStatus.mockResolvedValue(null);
    gitDiff.mockResolvedValue("");
    detectProject.mockResolvedValue({
      type: "node",
      name: "pi-workbench",
      version: "1.2.3",
      rootPath: "C:/repo",
      configFiles: ["package.json", "pnpm-lock.yaml"],
      packageManager: "pnpm",
      hasGit: true,
      scripts: { test: "vitest", build: "tsc" },
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    expect(await screen.findByText("pi-workbench")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
    expect(screen.getByText("pnpm")).toBeTruthy();
    expect(screen.getByText("package.json, pnpm-lock.yaml")).toBeTruthy();
    expect(screen.getByText("test, build")).toBeTruthy();
    expect(detectProject).toHaveBeenCalledWith("C:/repo");
  });

  it("runs detected project scripts in the terminal", async () => {
    const runCommandSpy = vi.fn();
    window.addEventListener("terminal:run-command", runCommandSpy);
    getGitStatus.mockResolvedValue(null);
    gitDiff.mockResolvedValue("");
    detectProject.mockResolvedValue({
      type: "node",
      name: "pi-workbench",
      rootPath: "C:/repo",
      configFiles: ["package.json", "pnpm-lock.yaml"],
      packageManager: "pnpm",
      hasGit: true,
      scripts: { test: "vitest", build: "tsc" },
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "test" }));

    expect(runCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { command: "pnpm test", mode: "run" },
      }),
    );
    expect(screen.getAllByRole("status").some((item) => item.textContent?.includes("已发送命令到终端"))).toBe(true);
    window.removeEventListener("terminal:run-command", runCommandSpy);
  });

  it("expands the full changed file list on demand", async () => {
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

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    await waitFor(() => {
      expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "展开其余 1 个文件" }));

    expect(screen.getAllByText("d.ts").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "收起文件" })).toBeTruthy();
  });

  it("can jump from changed files to Files and Git diff panels", async () => {
    const openFileSpy = vi.fn();
    const openGitDiffSpy = vi.fn();
    window.addEventListener("workspace:open-file", openFileSpy);
    window.addEventListener("workspace:open-git-diff", openGitDiffSpy);
    getGitStatus.mockResolvedValue({
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

    fireEvent.click(await screen.findByRole("button", { name: "src/a.ts" }));
    expect(openFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { path: "C:/repo\\src/a.ts", mode: undefined },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(openGitDiffSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { file: "src/a.ts" },
      }),
    );
    expect(screen.getAllByRole("status").some((item) => item.textContent?.includes("已打开 diff src/a.ts"))).toBe(true);

    window.removeEventListener("workspace:open-file", openFileSpy);
    window.removeEventListener("workspace:open-git-diff", openGitDiffSpy);
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
    expect(await screen.findByText("src/a.ts")).toBeTruthy();
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
    expect(await screen.findByText("src/new.ts")).toBeTruthy();
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

  it("renders environment, tool permissions, progress, and file output cards", async () => {
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
    expect(screen.getByText("工具权限")).toBeTruthy();
    expect(screen.getByText("Token 使用统计")).toBeTruthy();
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByText("进度")).toBeTruthy();
    expect(screen.getByText("文件输出")).toBeTruthy();
    expect((screen.getByLabelText("网络") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("最近工具")).toBeNull();
  });

  it("keeps cards in natural-height scroll flow instead of shrinkable flex columns", () => {
    const { container } = renderWithI18n(<RightRail workspacePath="C:/repo" workspaceId="w1" />);

    const rail = container.querySelector("aside");

    expect(rail?.className ?? "").toContain("overflow-y-auto");
    expect(rail?.className ?? "").toContain("space-y-3");
    expect(rail?.className ?? "").not.toMatch(/\bflex-col\b/);
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
    expect(screen.getByText("Tool permissions")).toBeTruthy();
    expect(screen.getByText("Token usage")).toBeTruthy();
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("File output")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browse all files" })).toBeTruthy();
    expect(screen.getByLabelText("Network")).toBeTruthy();
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
    useQueueStore.getState().applyEvent({ type: "auto_retry_start" });

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

  it("shows file outputs from authoritative output sources and excludes planning or git heuristics", async () => {
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: ["src/generated.ts"],
      added: [],
      deleted: [],
      untracked: [],
      ahead: 0,
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
          lastOutputPaths: ["plans/output.md"],
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "计划里提到 C:/repo/plan_probe.txt，但这还不是实际产物。",
              timestamp: new Date(),
              toolCalls: [
                {
                  id: "tc1",
                  name: "write",
                  status: "completed",
                  output: "Wrote docs/result.md",
                },
                {
                  id: "tc2",
                  name: "plan_write",
                  status: "completed",
                  input: { filename: "create-plan-probe" },
                },
                {
                  id: "tc3",
                  name: "bash",
                  status: "completed",
                  input: { command: "echo PLAN_OK > \"C:/repo/plan_probe.txt\"" },
                },
              ],
            },
          ],
        },
      ],
    });
    usePlanStore.setState({
      ...usePlanStore.getState(),
      activeCard: {
        id: "plan_1",
        title: "创建并验证 plan_probe.txt",
        content: "1. 创建文件\n2. 验证存在",
        filename: "create-plan-probe",
        createdAt: Date.now(),
      },
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    await waitFor(() => {
      expect(screen.getByText("output.md")).toBeTruthy();
    });
    const fileOutputSection = screen.getByText("文件输出").closest("section");
    expect(fileOutputSection).toBeTruthy();
    const fileOutputs = within(fileOutputSection!);
    expect(fileOutputs.getByText("output.md")).toBeTruthy();
    expect(fileOutputs.getByText("result.md")).toBeTruthy();
    expect(fileOutputs.getByText("plan_probe.txt")).toBeTruthy();
    expect(fileOutputs.queryByText("create-plan-probe")).toBeNull();
    expect(fileOutputs.queryByText("generated.ts")).toBeNull();
  });

  it("shows shell action errors for file outputs", async () => {
    openPath.mockResolvedValueOnce({
      code: "ipcErrors.protectedPath.blocked",
      fallback: "受保护路径不可打开",
    });
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastOutputPaths: ["secrets/.env"],
          messages: [],
        },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "系统打开" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("受保护路径不可打开");
    });
    expect(openPath).toHaveBeenCalledWith("C:/repo\\secrets/.env");
  });

  it("shows string failures from Electron shell for file outputs", async () => {
    openPath.mockResolvedValueOnce("No application is associated with the specified file");
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastOutputPaths: ["reports/result.unknown"],
          messages: [],
        },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "系统打开" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("No application is associated with the specified file");
    });
    expect(screen.queryByText("已请求系统打开")).toBeNull();
  });

  it("shows rejected reveal errors for file outputs", async () => {
    revealPath.mockRejectedValueOnce(new Error("explorer unavailable"));
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastOutputPaths: ["reports/result.md"],
          messages: [],
        },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "定位" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("系统定位失败: explorer unavailable");
    });
    expect(screen.queryByText("已请求系统定位")).toBeNull();
  });

  it("shows clipboard failures for file output paths", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => { throw new Error("clipboard denied"); }) },
      configurable: true,
    });
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastOutputPaths: ["reports/result.md"],
          messages: [],
        },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "复制路径" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("复制路径失败: clipboard denied");
    });
    expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
  });

  it("can reference a file output back into chat", async () => {
    const prefillSpy = vi.fn();
    const switchSpy = vi.fn();
    window.addEventListener("chatpanel:prefill", prefillSpy);
    window.addEventListener("app:switch-section", switchSpy);
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastOutputPaths: ["reports/result.md"],
          messages: [],
        },
      ],
    });

    renderWithI18n(<RightRail workspacePath="C:/repo" />);

    fireEvent.click(await screen.findByRole("button", { name: "引用" }));

    expect(prefillSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { text: "@C:/repo\\reports/result.md " },
      }),
    );
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: "chat" },
      }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("已引用到聊天");

    window.removeEventListener("chatpanel:prefill", prefillSpy);
    window.removeEventListener("app:switch-section", switchSpy);
  });

  it("puts environment controls first, keeps session tool permissions in the rail, and opens Files and Git from visible rail actions", async () => {
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
    expect(await screen.findByText("工具权限")).toBeTruthy();
    expect(screen.getByText("Token 使用统计")).toBeTruthy();
    expect(screen.getAllByText("1.5K").length).toBeGreaterThan(0);
    expect(screen.queryByText("预估费用")).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(screen.getByText("输入 Token")).toBeTruthy();
    expect(screen.getByText("输出 Token")).toBeTruthy();
    expect(screen.getByText("anthropic/claude-sonnet")).toBeTruthy();
    expect(screen.getByText("Session")).toBeTruthy();
    expect((screen.getByLabelText("文件写入") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("网络") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("最近工具")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "浏览全部文件" }));
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: "files" },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /提交或推送/ }));
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: "git" },
      }),
    );

    window.removeEventListener("app:switch-section", switchSpy);
  });
});
