// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { SessionCenter } from "./SessionCenter";

describe("SessionCenter", () => {
  beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
      value: {
        createSession: vi.fn(async (workspaceId: string, title?: string, id?: string) => ({
          id: id ?? "forked-session",
          title: title ?? "未命名会话",
          workspaceId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        })),
        renameSession: vi.fn(async () => undefined),
        deleteSession: vi.fn(async () => undefined),
        updateSessionMetadata: vi.fn(async () => undefined),
        appendMessage: vi.fn(async () => undefined),
        selectWorkspace: vi.fn(async () => undefined),
      },
      configurable: true,
    });
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws1", name: "repo", path: "C:/repo", createdAt: new Date(0), lastActiveAt: new Date(0) },
      ],
      currentWorkspaceId: "ws1",
    });
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "Fix source control",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          messages: [
            { id: "m1", role: "user", content: "检查 staged commit 行为", timestamp: new Date(1) },
            {
              id: "m2",
              role: "assistant",
              content: "只提交 staged 文件，保留 unstaged 变更",
              timestamp: new Date(2),
              toolCalls: [
                { id: "tc1", name: "bash", status: "completed", input: { command: "git status" } },
                { id: "tc2", name: "bash", status: "completed", input: { command: "pnpm test" } },
              ],
            },
            { id: "m3", role: "user", content: "再跑测试", timestamp: new Date(3) },
          ],
        },
        {
          id: "s1-child",
          title: "Fix source control branch",
          workspaceId: "ws1",
          createdAt: new Date(4),
          updatedAt: new Date(4),
          parentSessionId: "s1",
          messages: [
            { id: "cm1", role: "user", content: "继续 Git 分支", timestamp: new Date(4) },
          ],
        },
      ],
      persistErrorCount: 0,
      lastPersistError: null,
      sessionsLoading: false,
    });
  });

  it("shows matched message snippets and can fork from the matched message", async () => {
    const onOpenChat = vi.fn();
    render(
      <I18nProvider>
        <SessionCenter onOpenChat={onOpenChat} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "搜索会话" }), {
      target: { value: "staged 文件" },
    });

    expect(screen.getByText(/匹配消息/)).toBeTruthy();
    expect(screen.getByText(/只提交 staged 文件/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "从这里继续" }));

    await waitFor(() => expect(onOpenChat).toHaveBeenCalled());
    const fork = useSessionStore.getState().sessions.find((session) => session.forkedFromMessageId === "m2");
    expect(fork).toBeTruthy();
    expect(fork?.forkedFromMessageId).toBe("m2");
    expect(fork?.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(useSessionStore.getState().currentSessionId).toBe(fork?.id);
    expect(window.piAPI?.selectWorkspace).toHaveBeenCalledWith("C:/repo");
  });

  it("shows an inline error when continuing a session fails", async () => {
    window.piAPI!.createSession = vi.fn(async () => ({
      code: "ipcErrors.sessions.createFailed",
      fallback: "创建会话失败: disk full",
    })) as unknown as Window["piAPI"]["createSession"];
    const onOpenChat = vi.fn();
    render(
      <I18nProvider>
        <SessionCenter onOpenChat={onOpenChat} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "继续" })[0]);

    expect((await screen.findByRole("alert")).textContent).toContain("创建会话分支失败：创建会话失败: disk full");
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(useSessionStore.getState().currentSessionId).toBe("s1");
  });

  it("shows session activity stats and branch counts for quick recovery", () => {
    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    expect(screen.getByText("3 messages")).toBeTruthy();
    expect(screen.getByText("2 tools")).toBeTruthy();
    expect(screen.getByText("1 branches")).toBeTruthy();
    expect(screen.getByText("1 messages")).toBeTruthy();
    expect(screen.getByText("0 tools")).toBeTruthy();
    expect(screen.getByText(/分支自 Fix source control/)).toBeTruthy();
  });

  it("sorts sessions by last opened time before updated time", () => {
    useSessionStore.setState({
      sessions: [
        {
          id: "old-opened",
          title: "Recently opened task",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(1),
          lastOpenedAt: new Date(10),
          messages: [],
        },
        {
          id: "newer-updated",
          title: "Recently edited task",
          workspaceId: "ws1",
          createdAt: new Date(0),
          updatedAt: new Date(9),
          messages: [],
        },
      ],
    });

    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    const titles = screen.getAllByRole("textbox", { name: /重命名会话/ }).map((input) => (input as HTMLInputElement).value);
    expect(titles).toEqual(["Recently opened task", "Recently edited task"]);
  });

  it("keeps sessions visible when their workspace is missing", () => {
    useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null });
    useSessionStore.setState({
      currentSessionId: "orphan",
      sessions: [
        {
          id: "orphan",
          title: "Recovered orphan session",
          workspaceId: "missing-ws",
          createdAt: new Date(0),
          updatedAt: new Date(10),
          messages: [{ id: "m1", role: "user", content: "restore me", timestamp: new Date(1) }],
        },
      ],
    });
    const onOpenChat = vi.fn();

    render(
      <I18nProvider>
        <SessionCenter onOpenChat={onOpenChat} />
      </I18nProvider>,
    );

    expect(screen.getByText("未知工作区")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "重命名会话 Recovered orphan session" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(onOpenChat).toHaveBeenCalled();
    expect(window.piAPI?.selectWorkspace).not.toHaveBeenCalled();
    expect(useSessionStore.getState().currentSessionId).toBe("orphan");
  });

  it("commits session title edits only on blur or enter", async () => {
    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    const title = screen.getByRole("textbox", { name: "重命名会话 Fix source control" });
    fireEvent.change(title, { target: { value: "Fix source control polish" } });

    expect(useSessionStore.getState().sessions.find((session) => session.id === "s1")?.title).toBe("Fix source control");
    expect(window.piAPI?.renameSession).not.toHaveBeenCalled();

    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => {
      expect(window.piAPI?.renameSession).toHaveBeenCalledWith("s1", "Fix source control polish");
    });
    expect(useSessionStore.getState().sessions.find((session) => session.id === "s1")?.title).toBe("Fix source control polish");
    expect(screen.getByRole("status").textContent).toContain("已重命名为 Fix source control polish");
  });

  it("restores empty and escaped session title drafts without persisting them", () => {
    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    const title = screen.getByRole("textbox", { name: "重命名会话 Fix source control" });
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.blur(title);

    expect(useSessionStore.getState().sessions.find((session) => session.id === "s1")?.title).toBe("Fix source control");
    expect(window.piAPI?.renameSession).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("会话标题不能为空");

    const restored = screen.getByRole("textbox", { name: "重命名会话 Fix source control" }) as HTMLInputElement;
    expect(restored.value).toBe("Fix source control");
    fireEvent.change(restored, { target: { value: "temporary title" } });
    fireEvent.keyDown(restored, { key: "Escape" });

    expect((screen.getByRole("textbox", { name: "重命名会话 Fix source control" }) as HTMLInputElement).value).toBe("Fix source control");
    expect(window.piAPI?.renameSession).not.toHaveBeenCalled();
  });

  it("commits a session title edit on blur", async () => {
    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    const title = screen.getByRole("textbox", { name: "重命名会话 Fix source control branch" });
    fireEvent.change(title, { target: { value: "Branch recovery" } });
    fireEvent.blur(title);

    await waitFor(() => {
      expect(window.piAPI?.renameSession).toHaveBeenCalledWith("s1-child", "Branch recovery");
    });
  });

  it("emits a visible workspace notice when opening a session cannot select its workspace", async () => {
    window.piAPI!.selectWorkspace = vi.fn(async () => ({
      code: "ipcErrors.workspace.selectFailed",
      fallback: "切换 workspace 失败: path missing",
    }));
    const noticeSpy = vi.fn();
    window.addEventListener("workspace:notice", noticeSpy);

    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "打开" })[0]);

    await waitFor(() => {
      expect(noticeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { message: "切换 workspace 失败: path missing", tone: "error" },
        }),
      );
    });
    expect((await screen.findByRole("alert")).textContent).toContain("打开会话时切换 workspace 失败：切换 workspace 失败: path missing");
    window.removeEventListener("workspace:notice", noticeSpy);
  });

  it("shows an inline error when continuing succeeds but workspace selection fails", async () => {
    window.piAPI!.selectWorkspace = vi.fn(async () => ({
      code: "ipcErrors.workspace.selectFailed",
      fallback: "切换 workspace 失败: path missing",
    }));
    const onOpenChat = vi.fn();

    render(
      <I18nProvider>
        <SessionCenter onOpenChat={onOpenChat} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "继续" })[0]);

    await waitFor(() => expect(onOpenChat).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toContain("创建分支后切换 workspace 失败：切换 workspace 失败: path missing");
  });

  it("requires confirmation before deleting a session", () => {
    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[1]);

    expect(useSessionStore.getState().sessions.some((session) => session.id === "s1-child")).toBe(true);
    expect(screen.getByRole("button", { name: "确认删除" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消删除" }));
    expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
    expect(useSessionStore.getState().sessions.some((session) => session.id === "s1-child")).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(useSessionStore.getState().sessions.some((session) => session.id === "s1-child")).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("已删除 Fix source control branch");
  });

  it("can undo archive and restore operations from the inline notice", () => {
    render(
      <I18nProvider>
        <SessionCenter />
      </I18nProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "归档" })[0]);

    expect(useSessionStore.getState().sessions.find((session) => session.id === "s1")?.archived).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("已归档 Fix source control");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    expect(useSessionStore.getState().sessions.find((session) => session.id === "s1")?.archived).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
