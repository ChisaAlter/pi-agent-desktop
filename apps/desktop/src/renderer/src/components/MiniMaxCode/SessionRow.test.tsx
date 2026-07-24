// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionRow } from "./SessionRow";
import type { Session } from "../../stores/session-store";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "Demo Session",
    workspaceId: "w1",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    favorite: false,
    archived: false,
    ...overrides,
  } as Session;
}

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === "sidebar.sessions.deleteConfirm") return `删除 ${opts?.name ?? ""}?`;
  if (key === "sidebar.sessions.unnamed") return "未命名";
  if (key === "sidebar.sessions.pin") return "置顶";
  if (key === "sidebar.sessions.unpin") return "取消置顶";
  if (key === "sidebar.sessions.archive") return "归档";
  if (key === "sidebar.sessions.restore") return "恢复";
  if (key === "sidebar.sessions.rename") return "重命名";
  if (key === "sidebar.sessions.renameSession") return "重命名会话";
  if (key === "sidebar.sessions.delete") return "删除";
  if (key === "common.cancel") return "取消";
  if (key === "common.confirm") return "确认";
  return key;
};

describe("SessionRow", () => {
  it("selects session via primary button", () => {
    const onSelect = vi.fn();
    render(
      <SessionRow
        session={makeSession()}
        active
        depth={0}
        archived={false}
        onSelect={onSelect}
        onArchive={vi.fn()}
        onToggleFavorite={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        t={t}
      />,
    );
    const btn = screen.getByRole("button", { name: "Demo Session" });
    expect(btn.getAttribute("aria-current")).toBe("page");
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renames via context menu", () => {
    const onRename = vi.fn();
    const { container } = render(
      <SessionRow
        session={makeSession()}
        active={false}
        depth={0}
        archived={false}
        onSelect={vi.fn()}
        onArchive={vi.fn()}
        onToggleFavorite={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
        t={t}
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Renamed");
  });

  it("confirms delete from context menu", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <SessionRow
        session={makeSession()}
        active={false}
        depth={0}
        archived={false}
        onSelect={vi.fn()}
        onArchive={vi.fn()}
        onToggleFavorite={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
        t={t}
      />,
    );
    fireEvent.contextMenu(container.firstElementChild as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("exposes select, action, menu and confirm focus-visible rings", () => {
    const { container } = render(
      <SessionRow
        session={makeSession()}
        active={false}
        depth={0}
        archived={false}
        onSelect={vi.fn()}
        onArchive={vi.fn()}
        onToggleFavorite={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByRole("button", { name: "Demo Session" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "置顶 Demo Session" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "归档 Demo Session" }).className).toContain("focus-visible:ring-2");

    fireEvent.contextMenu(container.firstElementChild as HTMLElement);
    expect(screen.getByRole("menuitem", { name: "重命名" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("menuitem", { name: "删除" }).className).toContain("focus-visible:ring-2");
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("button", { name: "取消" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "确认" }).className).toContain("focus-visible:ring-2");
  });
});
