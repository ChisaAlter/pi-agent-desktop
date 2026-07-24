// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SettingsNav } from "./SettingsNav";
import type { SettingsNavSection, SettingsSearchResult } from "./tab-defs";

const sections: SettingsNavSection[] = [
  {
    id: "common",
    label: "常用",
    tabs: [
      {
        id: "appearance",
        sectionId: "common",
        label: "界面",
        caption: "主题与字体",
        pageTitle: "外观",
        pageDescription: "desc",
        searchEntries: [],
      },
      {
        id: "general",
        sectionId: "common",
        label: "通用",
        caption: "语言与通知",
        pageTitle: "通用",
        pageDescription: "desc",
        searchEntries: [],
      },
    ],
  },
];

const searchResults: SettingsSearchResult[] = [
  {
    id: "r1",
    tabId: "appearance",
    anchor: "theme",
    pageLabel: "界面",
    pageCaption: "主题与字体",
    label: "主题",
    description: "切换浅色/深色",
  },
];

function renderNav(overrides: Partial<Parameters<typeof SettingsNav>[0]> = {}) {
  const props = {
    sections,
    searchQuery: "",
    searchResults: [],
    activeTab: "appearance" as const,
    activeAnchor: "",
    onSearchQueryChange: vi.fn(),
    onSelectTab: vi.fn(),
    onSelectSearchResult: vi.fn(),
    ...overrides,
  };
  const result = render(
    <I18nProvider>
      <SettingsNav {...props} />
    </I18nProvider>,
  );
  return { ...result, props };
}

describe("SettingsNav", () => {
  it("renders sections and selects tabs", () => {
    const { props } = renderNav();
    expect(screen.getByRole("tablist", { name: "设置分类" })).toBeTruthy();
    const appearance = screen.getByRole("tab", { name: "界面" });
    expect(appearance.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "通用" }));
    expect(props.onSelectTab).toHaveBeenCalledWith("general");
  });

  it("updates search query and shows empty search state", () => {
    const { props } = renderNav({ searchQuery: "zzz" });
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "theme" } });
    expect(props.onSearchQueryChange).toHaveBeenCalledWith("theme");
    expect(screen.getByText("没有匹配项")).toBeTruthy();
  });

  it("lists search results and selects them", () => {
    const { props } = renderNav({
      searchQuery: "主题",
      searchResults,
      activeTab: "appearance",
      activeAnchor: "theme",
    });
    const resultTab = screen.getByRole("tab", { name: "界面 · 主题" });
    expect(resultTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(resultTab);
    expect(props.onSelectSearchResult).toHaveBeenCalledWith(searchResults[0]);
  });

  it("exposes tab and search-result focus-visible rings", () => {
    renderNav();
    const appearance = screen.getByRole("tab", { name: "界面" });
    expect(appearance.getAttribute("type")).toBe("button");
    expect(appearance.className).toContain("focus-visible:ring-2");

    renderNav({
      searchQuery: "主题",
      searchResults,
      activeTab: "appearance",
      activeAnchor: "theme",
    });
    const resultTab = screen.getByRole("tab", { name: "界面 · 主题" });
    expect(resultTab.className).toContain("focus-visible:ring-2");
  });

  it("wave-88 residual: settings search input keeps focus-visible ring", () => {
    renderNav();
    const input = screen.getByRole("searchbox");
    expect(input.className).toContain("focus-visible:ring-2");
  });

});
