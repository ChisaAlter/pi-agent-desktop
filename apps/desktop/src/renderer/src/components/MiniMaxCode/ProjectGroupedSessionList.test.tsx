// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ProjectGroupedSessionList } from "./ProjectGroupedSessionList";
import type { Session } from "../../stores/session-store";
import type { Workspace } from "../../stores/workspace-store";

const now = Date.now();

const workspaces: Workspace[] = [
  {
    id: "w1",
    name: "Alpha",
    path: "C:\\proj\\alpha",
    createdAt: new Date(now),
    lastActiveAt: new Date(now),
  },
  {
    id: "w2",
    name: "Beta",
    path: "C:\\proj\\beta",
    createdAt: new Date(now),
    lastActiveAt: new Date(now),
  },
];

const sessions: Session[] = [
  {
    id: "s1",
    title: "Alpha Chat",
    workspaceId: "w1",
    messages: [],
    createdAt: new Date(now),
    updatedAt: new Date(now),
  } as Session,
  {
    id: "s2",
    title: "Beta Chat",
    workspaceId: "w2",
    messages: [],
    createdAt: new Date(now - 1000),
    updatedAt: new Date(now - 1000),
  } as Session,
  {
    id: "s3",
    title: "Archived Alpha",
    workspaceId: "w1",
    messages: [],
    createdAt: new Date(now - 2000),
    updatedAt: new Date(now - 2000),
    archived: true,
  } as Session,
];

vi.mock("../../stores/session-store", () => ({
  useSessionStore: (selector: (s: { sessions: Session[] }) => unknown) =>
    selector({ sessions }),
}));

vi.mock("../../stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { workspaces: Workspace[] }) => unknown) =>
    selector({ workspaces }),
}));

vi.mock("./SessionRow", () => ({
  SessionRow: ({
    session,
    onSelect,
  }: {
    session: Session;
    onSelect: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      row-{session.title}
    </button>
  ),
}));

describe("ProjectGroupedSessionList", () => {
  it("expands current workspace group and selects a session", () => {
    const onSelect = vi.fn();
    render(
      <I18nProvider>
        <ProjectGroupedSessionList
          currentWorkspaceId="w1"
          currentSessionId="s1"
          onSelectSession={onSelect}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    // current workspace expanded → session row visible
    expect(screen.getByText("row-Alpha Chat")).toBeTruthy();
    // beta collapsed by default
    expect(screen.queryByText("row-Beta Chat")).toBeNull();
    expect(screen.queryByText("row-Archived Alpha")).toBeNull();

    fireEvent.click(screen.getByText("row-Alpha Chat"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("toggles expand/collapse only when group header is clicked, without selecting a session", () => {
    const onSelect = vi.fn();
    render(
      <I18nProvider>
        <ProjectGroupedSessionList
          currentWorkspaceId="w1"
          currentSessionId="s1"
          onSelectSession={onSelect}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </I18nProvider>,
    );

    const betaHeader = screen.getByText("Beta").closest("button");
    expect(betaHeader).toBeTruthy();
    // Beta starts collapsed
    expect(betaHeader!.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("row-Beta Chat")).toBeNull();

    fireEvent.click(screen.getByText("Beta"));
    expect(betaHeader!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("row-Beta Chat")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Beta"));
    // AnimatedCollapse keeps content briefly; contract is collapse state, not immediate unmount.
    expect(betaHeader!.getAttribute("aria-expanded")).toBe("false");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens a workspace removal menu and confirms through the callback", () => {
    const onRemove = vi.fn();
    render(
      <I18nProvider>
        <ProjectGroupedSessionList
          currentWorkspaceId="w1"
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onRemoveWorkspace={onRemove}
        />
      </I18nProvider>,
    );

    const alphaRow = screen.getByText("Alpha").closest("div") as HTMLElement;
    fireEvent.contextMenu(alphaRow);
    expect(screen.getByRole("menuitem", { name: "移除" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "移除" }));
    const dialog = screen.getByRole("dialog", { name: "移除「Alpha」？" });
    expect(screen.getByText(/不会删除磁盘上的项目文件/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.contextMenu(alphaRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "移除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onRemove).toHaveBeenCalledWith("w1");
    expect(dialog).toBeTruthy();
  });
});
