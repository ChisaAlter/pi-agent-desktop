// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { useSessionStore, type Session } from "../../../stores/session-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import { ProjectGroupedSessionList } from "../ProjectGroupedSessionList";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  const now = new Date();
  return {
    title: overrides.id,
    workspaceId: "w1",
    createdAt: now,
    updatedAt: now,
    messages: [],
    ...overrides,
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [
      { id: "w1", name: "repo", path: "C:/repo", createdAt: new Date(0), lastActiveAt: new Date(0) },
    ],
    currentWorkspaceId: "w1",
  });
  useSessionStore.setState({ sessions: [], currentSessionId: null });
});

describe("ProjectGroupedSessionList", () => {
  it("renders a folder workspace row and toggles its sessions", () => {
    useSessionStore.setState({
      sessions: [makeSession({ id: "s1", title: "缩进会话", workspaceId: "w1" })],
    });

    renderWithI18n(
      <ProjectGroupedSessionList
        currentWorkspaceId="w1"
        currentSessionId={null}
        onSelectSession={() => undefined}
        onArchiveSession={() => undefined}
        onDeleteSession={() => undefined}
        onSwitchWorkspace={() => undefined}
      />,
    );

    const workspaceButton = screen.getByTitle("C:/repo");
    expect(workspaceButton.querySelector("svg")).toBeTruthy();
    expect(workspaceButton.getAttribute("aria-expanded")).toBe("true");
    expect(workspaceButton.className).not.toContain("bg-[var(--mm-bg-selected)]");
    expect(workspaceButton.className).not.toContain("hover:bg-");
    expect(workspaceButton.className).not.toContain("shadow-");
    expect(screen.getByRole("button", { name: "缩进会话" }).parentElement?.style.paddingLeft).toBe("24px");

    fireEvent.click(workspaceButton);

    expect(workspaceButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "缩进会话" })).toBeNull();
  });

  it("keeps workspace group order stable when switching workspaces", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "w1", name: "repo", path: "C:/repo", createdAt: new Date(0), lastActiveAt: new Date("2026-06-02T00:00:00.000Z") },
        { id: "w2", name: "docs", path: "C:/docs", createdAt: new Date(1), lastActiveAt: new Date("2026-06-01T00:00:00.000Z") },
      ],
      currentWorkspaceId: "w1",
    });
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s1", title: "repo 会话", workspaceId: "w1" }),
        makeSession({ id: "s2", title: "docs 会话", workspaceId: "w2" }),
      ],
    });

    function Harness(): React.JSX.Element {
      const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
      return (
        <ProjectGroupedSessionList
          currentWorkspaceId={currentWorkspaceId}
          currentSessionId={null}
          onSelectSession={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
          onSwitchWorkspace={(workspaceId) => useWorkspaceStore.getState().setCurrentWorkspace(workspaceId)}
        />
      );
    }

    const { container } = renderWithI18n(<Harness />);

    const workspaceButtons = (): string[] =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button[title="C:/repo"], button[title="C:/docs"]'))
        .map((button) => (button.textContent ?? "").replace(/[▾▸\d\s]/g, ""));

    const beforeSwitch = workspaceButtons();
    expect(beforeSwitch).toEqual(["repo", "docs"]);

    fireEvent.click(screen.getByText("docs"));

    const afterSwitch = workspaceButtons();
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("w2");
    expect(afterSwitch).toEqual(["repo", "docs"]);
  });

  it("keeps hidden project actions from intercepting clicks until hover or focus", () => {
    const longTitle = "了解一下这个项目并检查所有关键入口";
    useSessionStore.setState({
      sessions: [makeSession({ id: "s_long", title: longTitle, workspaceId: "w1" })],
    });

    const { container } = renderWithI18n(
      <ProjectGroupedSessionList
        currentWorkspaceId="w1"
        currentSessionId="s_long"
        onSelectSession={() => undefined}
        onArchiveSession={() => undefined}
        onDeleteSession={() => undefined}
        onSwitchWorkspace={() => undefined}
      />,
    );

    const titleButton = screen.getByRole("button", { name: longTitle });
    const actions = container.querySelector('[data-session-actions="s_long"]');
    expect(titleButton.className).toContain("pr-0");
    expect(actions?.className ?? "").toContain("absolute");
    expect(actions?.className ?? "").toContain("right-1");
    expect(actions?.className ?? "").toContain("pointer-events-none");
    expect(actions?.className ?? "").toContain("group-hover:pointer-events-auto");
    expect(actions?.className ?? "").toContain("group-focus-within:pointer-events-auto");
    expect(actions?.querySelector("button")?.className ?? "").toContain("pointer-events-none");
    expect(actions?.querySelector("button")?.className ?? "").toContain("group-hover:pointer-events-auto");
    expect(actions?.className ?? "").toContain("bg-[var(--mm-bg-panel)]");
    expect(actions?.className ?? "").toContain("shadow-");
    expect(actions?.querySelector("button")?.className ?? "").toContain("h-7");
    expect(actions?.querySelector("button")?.className ?? "").toContain("w-7");
  });

  it("marks the selected project session with shadow instead of reordering by lastOpenedAt", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "older", title: "较早项目", workspaceId: "w1", updatedAt: new Date("2026-06-01T00:00:00.000Z"), lastOpenedAt: new Date("2026-06-23T00:00:00.000Z") }),
        makeSession({ id: "newer", title: "较新项目", workspaceId: "w1", updatedAt: new Date("2026-06-22T00:00:00.000Z") }),
      ],
    });

    renderWithI18n(
      <ProjectGroupedSessionList
        currentWorkspaceId="w1"
        currentSessionId="older"
        onSelectSession={() => undefined}
        onArchiveSession={() => undefined}
        onDeleteSession={() => undefined}
        onSwitchWorkspace={() => undefined}
      />,
    );

    const sessionButtons = screen.getAllByRole("button")
      .filter((button) => ["较新项目", "较早项目"].includes(button.getAttribute("aria-label") ?? ""));
    expect(sessionButtons.map((button) => button.textContent)).toEqual(["较新项目", "较早项目"]);
    expect(screen.getByRole("button", { name: "较早项目" }).className).toContain("shadow-");
  });

  it("does not render relative time in project session rows", () => {
    useSessionStore.setState({
      sessions: [makeSession({ id: "s_no_time", title: "项目行不显示时间", workspaceId: "w1" })],
    });

    renderWithI18n(
      <ProjectGroupedSessionList
        currentWorkspaceId="w1"
        currentSessionId="s_no_time"
        onSelectSession={() => undefined}
        onArchiveSession={() => undefined}
        onDeleteSession={() => undefined}
        onSwitchWorkspace={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "项目行不显示时间" }).textContent).toBe("项目行不显示时间");
    expect(screen.queryByText(/分钟前|刚刚|小时前/)).toBeNull();
  });

  it("does not select the session when clicking a floating project action", () => {
    const onSelect = vi.fn();
    const onArchive = vi.fn();
    useSessionStore.setState({
      sessions: [makeSession({ id: "s1", title: "项目会话", workspaceId: "w1" })],
    });

    renderWithI18n(
      <ProjectGroupedSessionList
        currentWorkspaceId="w1"
        currentSessionId={null}
        onSelectSession={onSelect}
        onArchiveSession={onArchive}
        onDeleteSession={() => undefined}
        onSwitchWorkspace={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "归档 项目会话" }));

    expect(onArchive).toHaveBeenCalledWith("s1", true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
