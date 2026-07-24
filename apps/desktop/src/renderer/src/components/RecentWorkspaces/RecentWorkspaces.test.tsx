// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { formatTimeAgo, RecentWorkspaces } from "./RecentWorkspaces";

const { useWorkspaceStore } = vi.hoisted(() => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock("../../stores/workspace-store", () => ({
  useWorkspaceStore,
}));

describe("formatTimeAgo", () => {
  const now = new Date("2026-07-21T12:00:00Z").getTime();

  it("covers minute/hour/day buckets", () => {
    expect(formatTimeAgo(new Date(now - 30_000), now)).toBe("刚刚");
    expect(formatTimeAgo(new Date(now - 5 * 60_000), now)).toBe("5 分钟前");
    expect(formatTimeAgo(new Date(now - 3 * 60 * 60_000), now)).toBe("3 小时前");
    expect(formatTimeAgo(new Date(now - 2 * 24 * 60 * 60_000), now)).toBe("2 天前");
  });
});

describe("RecentWorkspaces", () => {
  beforeEach(() => {
    useWorkspaceStore.mockReset();
  });

  it("returns null when only the current workspace exists", () => {
    useWorkspaceStore.mockReturnValue({
      workspaces: [
        {
          id: "cur",
          name: "Current",
          path: "C:/cur",
          lastActiveAt: new Date(),
        },
      ],
      currentWorkspaceId: "cur",
    });
    const { container } = render(<RecentWorkspaces onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists other workspaces sorted by lastActiveAt and invokes onSelect", () => {
    const older = {
      id: "old",
      name: "Older",
      path: "C:/old",
      lastActiveAt: new Date("2026-07-20T10:00:00Z"),
    };
    const newer = {
      id: "new",
      name: "Newer",
      path: "C:/new",
      lastActiveAt: new Date("2026-07-21T10:00:00Z"),
    };
    useWorkspaceStore.mockReturnValue({
      workspaces: [
        { id: "cur", name: "Current", path: "C:/cur", lastActiveAt: new Date() },
        older,
        newer,
      ],
      currentWorkspaceId: "cur",
    });
    const onSelect = vi.fn();
    render(<RecentWorkspaces onSelect={onSelect} />);
    expect(screen.getByText("最近工作区")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.textContent).toContain("Newer");
    expect(buttons[1]?.textContent).toContain("Older");
    fireEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith(newer);
  });

  it("applies focus-visible rings on workspace rows", () => {
    useWorkspaceStore.mockReturnValue({
      workspaces: [
        { id: "cur", name: "Current", path: "C:/cur", lastActiveAt: new Date() },
        {
          id: "other",
          name: "Other",
          path: "C:/other",
          lastActiveAt: new Date("2026-07-21T10:00:00Z"),
        },
      ],
      currentWorkspaceId: "cur",
    });
    render(<RecentWorkspaces onSelect={vi.fn()} />);
    const row = screen.getByRole("button", { name: /Other/ });
    expect(row.getAttribute("type")).toBe("button");
    expect(row.className).toContain("focus-visible:ring-2");
  });
});
