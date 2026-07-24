// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GitRailControls } from "./GitRailControls";

const git = {
  branch: "master",
  modified: ["src/app.ts"],
  added: [],
  deleted: [],
  untracked: ["src/new.ts"],
  ahead: 1,
  behind: 0,
};

describe("GitRailControls", () => {
  const gitBranches = vi.fn();
  const gitCheckout = vi.fn();
  const gitCreateBranch = vi.fn();
  const gitDiffStaged = vi.fn();
  const gitAdd = vi.fn();
  const gitCommit = vi.fn();
  const gitPush = vi.fn();
  const onRefresh = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    gitBranches.mockReset();
    gitCheckout.mockReset();
    gitCreateBranch.mockReset();
    gitDiffStaged.mockReset();
    gitAdd.mockReset();
    gitCommit.mockReset();
    gitPush.mockReset();
    onRefresh.mockReset();
    gitBranches.mockResolvedValue([
      { name: "master", isCurrent: true, isRemote: false },
      { name: "develop", isCurrent: false, isRemote: false },
    ]);
    gitCheckout.mockResolvedValue([
      { name: "master", isCurrent: false, isRemote: false },
      { name: "develop", isCurrent: true, isRemote: false },
    ]);
    gitCreateBranch.mockResolvedValue([
      { name: "master", isCurrent: false, isRemote: false },
      { name: "feature/rail", isCurrent: true, isRemote: false },
    ]);
    gitDiffStaged.mockResolvedValue("");
    gitAdd.mockResolvedValue(undefined);
    gitCommit.mockResolvedValue("[master abc123] test commit");
    gitPush.mockResolvedValue("pushed");
    onRefresh.mockResolvedValue(undefined);
    Object.defineProperty(window, "piAPI", {
      value: { gitBranches, gitCheckout, gitCreateBranch, gitDiffStaged, gitAdd, gitCommit, gitPush },
      configurable: true,
    });
  });

  function renderControls(status = git): ReturnType<typeof render> {
    return render(
      <I18nProvider>
        <GitRailControls workspacePath="C:/repo" git={status} diffStats={{ additions: 12, deletions: 3 }} onRefresh={onRefresh} />
      </I18nProvider>,
    );
  }

  it("opens the real Git changes workspace from the changes row", () => {
    const switchSpy = vi.fn();
    window.addEventListener("app:switch-section", switchSpy);
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "查看变更文件，打开 Git 面板" }));

    expect(switchSpy).toHaveBeenCalledWith(expect.objectContaining({ detail: { section: "git" } }));
    window.removeEventListener("app:switch-section", switchSpy);
  });

  it("loads branches and checks out a selected branch", async () => {
    renderControls();
    fireEvent.click(screen.getByText("master").closest("button")!);

    const dialog = await screen.findByRole("dialog", { name: "分支管理" });
    expect(gitBranches).toHaveBeenCalledWith("C:/repo");
    fireEvent.click(within(dialog).getByRole("button", { name: "develop" }));

    await waitFor(() => expect(gitCheckout).toHaveBeenCalledWith("C:/repo", "develop"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("creates and checks out a new branch", async () => {
    renderControls();
    fireEvent.click(screen.getByText("master").closest("button")!);

    const dialog = await screen.findByRole("dialog", { name: "分支管理" });
    fireEvent.change(within(dialog).getByPlaceholderText("新分支名"), { target: { value: "feature/rail" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并检出" }));

    await waitFor(() => expect(gitCreateBranch).toHaveBeenCalledWith("C:/repo", "feature/rail"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("stages unstaged files and commits with the entered message", async () => {
    gitDiffStaged.mockResolvedValueOnce("").mockResolvedValueOnce("diff --git a/src/app.ts b/src/app.ts");
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "提交或推送" }));

    const dialog = await screen.findByRole("dialog", { name: "提交或推送" });
    fireEvent.change(within(dialog).getByPlaceholderText("提交信息（留空将自动生成）..."), { target: { value: "fix: rail workflow" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交" }));

    await waitFor(() => expect(gitCommit).toHaveBeenCalledWith("C:/repo", "fix: rail workflow"));
    expect(gitAdd).toHaveBeenCalledWith("C:/repo", ["src/app.ts", "src/new.ts"]);
    expect(gitPush).not.toHaveBeenCalled();
  });

  it("commits and pushes through the dedicated Git IPC", async () => {
    gitDiffStaged.mockResolvedValueOnce("").mockResolvedValueOnce("diff --git a/src/app.ts b/src/app.ts");
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "提交或推送" }));

    const dialog = await screen.findByRole("dialog", { name: "提交或推送" });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交并推送" }));

    await waitFor(() => expect(gitCommit).toHaveBeenCalled());
    expect(gitPush).toHaveBeenCalledWith("C:/repo");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("pushes existing commits without creating a new commit", async () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "提交或推送" }));

    const dialog = await screen.findByRole("dialog", { name: "提交或推送" });
    fireEvent.click(within(dialog).getByRole("button", { name: "推送" }));

    await waitFor(() => expect(gitPush).toHaveBeenCalledWith("C:/repo"));
    expect(gitCommit).not.toHaveBeenCalled();
  });

  it("exposes row and dialog action focus-visible rings for keyboard a11y", async () => {
    renderControls();

    expect(screen.getByRole("button", { name: "查看变更文件，打开 Git 面板" }).className).toContain(
      "focus-visible:ring-2",
    );
    expect(screen.getByRole("button", { name: "提交或推送" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByText("master").closest("button")?.className).toContain("focus-visible:ring-2");

    fireEvent.click(screen.getByText("master").closest("button")!);
    const branchDialog = await screen.findByRole("dialog", { name: "分支管理" });
    expect(within(branchDialog).getByRole("button", { name: "develop" }).className).toContain(
      "focus-visible:ring-2",
    );
    expect(within(branchDialog).getByRole("button", { name: "创建并检出" }).className).toContain(
      "focus-visible:ring-2",
    );

    fireEvent.click(screen.getByRole("button", { name: "提交或推送" }));
    const commitDialog = await screen.findByRole("dialog", { name: "提交或推送" });
    for (const name of ["提交", "提交并推送", "推送"] as const) {
      expect(within(commitDialog).getByRole("button", { name }).className).toContain("focus-visible:ring-2");
    }
  });
});