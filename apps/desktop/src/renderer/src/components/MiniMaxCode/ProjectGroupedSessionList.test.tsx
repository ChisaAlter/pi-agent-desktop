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
    const onSwitch = vi.fn();
    render(
      <I18nProvider>
        <ProjectGroupedSessionList
          currentWorkspaceId="w1"
          currentSessionId="s1"
          onSelectSession={onSelect}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onSwitchWorkspace={onSwitch}
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

  it("switches workspace when group header is clicked", () => {
    const onSwitch = vi.fn();
    render(
      <I18nProvider>
        <ProjectGroupedSessionList
          currentWorkspaceId="w1"
          currentSessionId="s1"
          onSelectSession={vi.fn()}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onSwitchWorkspace={onSwitch}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText("Beta"));
    expect(onSwitch).toHaveBeenCalledWith("w2");
  });

  it("group headers expose aria-expanded and a new-conversation action instead of count/chevron", () => {
    const onNew = vi.fn();
    render(
      <I18nProvider>
        <ProjectGroupedSessionList
          currentWorkspaceId="w1"
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onSwitchWorkspace={vi.fn()}
          onNewConversationInWorkspace={onNew}
        />
      </I18nProvider>,
    );

    const alphaHeader = screen.getByText("Alpha").closest("button");
    const betaHeader = screen.getByText("Beta").closest("button");
    expect(alphaHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(betaHeader?.getAttribute("aria-expanded")).toBe("false");
    expect(alphaHeader?.getAttribute("type")).toBe("button");
    // No session-count badge / chevron trailing text
    expect(alphaHeader?.textContent ?? "").not.toMatch(/\d/);
    expect(screen.getByRole("button", { name: "在 Alpha 新建对话" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "在 Beta 新建对话" }));
    expect(onNew).toHaveBeenCalledWith("w2");
  });
});
