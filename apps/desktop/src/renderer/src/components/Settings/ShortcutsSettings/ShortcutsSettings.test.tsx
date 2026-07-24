// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsSettings } from "./ShortcutsSettings";

const updateSettings = vi.fn();

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../stores/settings-store", () => ({
  useSettingsStore: (
    selector: (s: {
      settings: { shortcutOverrides: Array<{ id: string; keys: string }> };
      updateSettings: typeof updateSettings;
    }) => unknown,
  ) =>
    selector({
      settings: {
        shortcutOverrides: [{ id: "open-command-palette", keys: "Ctrl+K" }],
      },
      updateSettings,
    }),
}));

vi.mock("../../../shortcuts/registry", () => ({
  SHORTCUTS: [
    {
      id: "open-command-palette",
      keys: "Ctrl+P",
      labelKey: "shortcuts.palette",
      category: "nav",
    },
    {
      id: "new-session",
      keys: "Ctrl+N",
      labelKey: "shortcuts.new",
      category: "chat",
    },
  ],
  groupByCategory: (items: Array<{ category: string }>) => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()].map(([category, groupItems]) => ({
      category,
      items: groupItems,
    }));
  },
}));

vi.mock("../_shared", () => ({
  SettingsPage: ({
    children,
    actions,
    title,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
    title: string;
  }) => (
    <div>
      <h1>{title}</h1>
      {actions}
      {children}
    </div>
  ),
  SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionTitle: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

describe("ShortcutsSettings", () => {
  it("renders shortcut rows and reset-all when overrides exist", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("settings.shortcuts.heading")).toBeTruthy();
    expect(screen.getByText("重置全部")).toBeTruthy();
    expect(screen.getByLabelText("修改 open-command-palette")).toBeTruthy();
    expect(screen.getByLabelText("重置 open-command-palette")).toBeTruthy();
  });

  it("enters recorder mode on 修改", () => {
    render(<ShortcutsSettings />);
    fireEvent.click(screen.getByLabelText("修改 open-command-palette"));
    expect(screen.getByText("按下新的快捷键...")).toBeTruthy();
    fireEvent.click(screen.getByText("取消"));
    expect(screen.queryByText("按下新的快捷键...")).toBeNull();
  });

  it("resets a single override", () => {
    updateSettings.mockClear();
    render(<ShortcutsSettings />);
    fireEvent.click(screen.getByLabelText("重置 open-command-palette"));
    expect(updateSettings).toHaveBeenCalledWith({ shortcutOverrides: [] });
  });

  it("exposes recorder cancel focus-visible ring for keyboard a11y", () => {
    render(<ShortcutsSettings />);
    fireEvent.click(screen.getByLabelText("修改 open-command-palette"));
    expect(screen.getByRole("button", { name: "取消" }).className).toContain("focus-visible:ring-2");
  });
});
