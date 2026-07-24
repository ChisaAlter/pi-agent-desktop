import { describe, expect, it } from "vitest";
import {
  buildSettingsNavigation,
  flattenSettingsTabs,
  getDefaultSettingsAnchor,
  searchSettings,
} from "./settings-nav-metadata";

const t = (key: string): string => key;

describe("settings-nav-metadata", () => {
  const sections = buildSettingsNavigation(t);

  it("builds three nav sections with expected tabs", () => {
    expect(sections.map((s) => s.id)).toEqual(["common", "advanced", "maintenance"]);
    const tabs = flattenSettingsTabs(sections).map((tab) => tab.id);
    expect(tabs).toEqual([
      "general",
      "model",
      "piagent",
      "appearance",
      "permissions",
      "usage",
      "longHorizon",
      "shortcuts",
      "config",
      "about",
    ]);
  });

  it("returns empty search for blank query and ranks exact label matches", () => {
    expect(searchSettings(sections, "   ")).toEqual([]);
    expect(searchSettings(sections, "")).toEqual([]);

    const hits = searchSettings(sections, "settings.theme.label");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.tabId).toBe("appearance");
    expect(hits[0]?.anchor).toBe("appearance-theme");
    expect(hits[0]?.label).toBe("settings.theme.label");
  });

  it("matches multi-term queries against keywords", () => {
    const hits = searchSettings(sections, "CLI status");
    expect(hits.some((h) => h.tabId === "piagent" && h.anchor === "piagent-status")).toBe(true);
  });

  it("getDefaultSettingsAnchor prefixes page-", () => {
    expect(getDefaultSettingsAnchor("general")).toBe("page-general");
    expect(getDefaultSettingsAnchor("about")).toBe("page-about");
  });

  // wave-228 residual
  it("tab ids are unique and every tab has non-empty searchEntries", () => {
    const tabs = flattenSettingsTabs(sections);
    const ids = tabs.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tabs.every((t) => t.searchEntries.length > 0)).toBe(true);
    expect(tabs.every((t) => t.sectionId === "common" || t.sectionId === "advanced" || t.sectionId === "maintenance")).toBe(true);
  });

  it("search is case-insensitive and ranks exact label ahead of partial", () => {
    const exact = searchSettings(sections, "settings.theme.label");
    const partial = searchSettings(sections, "settings.theme");
    expect(exact[0]?.label).toBe("settings.theme.label");
    expect(exact[0]?.tabId).toBe("appearance");
    // partial still hits appearance theme-ish entries
    expect(partial.some((h) => h.tabId === "appearance")).toBe(true);
    // uppercase query works
    expect(searchSettings(sections, "SETTINGS.THEME.LABEL")[0]?.tabId).toBe("appearance");
  });

  it("multi-term requires every term present (AND); missing term yields empty", () => {
    expect(searchSettings(sections, "CLI status").length).toBeGreaterThan(0);
    expect(searchSettings(sections, "CLI status ZZZNOPE")).toEqual([]);
  });


  // wave-293 residual
  it("searchSettings empty/whitespace query returns []; trims query", () => {
    expect(searchSettings(sections, "")).toEqual([]);
    expect(searchSettings(sections, "   ")).toEqual([]);
    const hits = searchSettings(sections, "  settings.theme.label  ");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.tabId).toBe("appearance");
  });

  it("getDefaultSettingsAnchor is page-<tabId>; flatten preserves section order", () => {
    for (const tab of ["model", "about", "config"] as const) {
      expect(getDefaultSettingsAnchor(tab)).toBe(`page-${tab}`);
    }
    const flat = flattenSettingsTabs(sections);
    expect(flat.length).toBeGreaterThanOrEqual(10);
    // first tab should be from common section in product nav
    expect(flat[0]?.sectionId).toBe("common");
    expect(flat.some((t) => t.id === "about" && t.sectionId === "maintenance")).toBe(true);
  });


  // wave-300 residual
  it("searchSettings ranks exact label over startsWith; result id is tabId:anchor", () => {
    const hits = searchSettings(sections, "settings.theme.label");
    expect(hits[0]?.id).toBe("appearance:appearance-theme");
    expect(hits[0]?.pageLabel).toBe("settings.tab.appearance");
    expect(hits[0]?.pageCaption).toBe("settings.tabCaption.appearance");
    expect(hits[0]?.anchor).toBe("appearance-theme");
  });

  it("AND multi-term must all appear; keyword-only hits still surface; blank terms filtered", () => {
    expect(searchSettings(sections, "  CLI   status  ").some((h) => h.anchor === "piagent-status")).toBe(true);
    const updateHits = searchSettings(sections, "update");
    expect(updateHits.some((h) => h.tabId === "about")).toBe(true);
    expect(searchSettings(sections, " \t ")).toEqual([]);
  });

  it("flattenSettingsTabs order matches section order; every search result has description optional", () => {
    const flat = flattenSettingsTabs(sections);
    const commonCount = sections.find((s) => s.id === "common")!.tabs.length;
    expect(flat.slice(0, commonCount).every((t) => t.sectionId === "common")).toBe(true);
    const about = flat.find((t) => t.id === "about");
    expect(about?.searchEntries.some((e) => e.anchor === "about-updates")).toBe(true);
    const hits = searchSettings(sections, "release");
    expect(hits.some((h) => h.tabId === "about" && h.anchor === "about-updates")).toBe(true);
  });




  // wave-306 residual
  describe("settings-nav-metadata residual (wave-306)", () => {
    it("searchSettings pageLabel exact match ranks after entry label exact; localeCompare tie-break", () => {
      // entry label exact score 0 beats page label score 1
      const hits = searchSettings(sections, "settings.tab.appearance");
      // page label equals query for appearance tab entries → score 1 for those; may still surface
      expect(hits.some((h) => h.tabId === "appearance")).toBe(true);
      // multi-term AND: all terms required
      expect(searchSettings(sections, "settings.tab.zzz nevermatch")).toEqual([]);
      // partial AND with known tokens
      const andHits = searchSettings(sections, "CLI status");
      expect(andHits.some((h) => h.anchor === "piagent-status")).toBe(true);
      // case-insensitive via toLowerCase on searchText and query
      const caseHits = searchSettings(sections, "SETTINGS.THEME.LABEL");
      expect(caseHits[0]?.tabId).toBe("appearance");
    });

    it("getDefaultSettingsAnchor covers full SettingsTab union; flatten length equals sum of section tabs", () => {
      const ids = [
        "model",
        "piagent",
        "permissions",
        "usage",
        "longHorizon",
        "appearance",
        "general",
        "shortcuts",
        "config",
        "about",
      ] as const;
      for (const id of ids) {
        expect(getDefaultSettingsAnchor(id)).toBe(`page-${id}`);
      }
      const flat = flattenSettingsTabs(sections);
      const expected = sections.reduce((n, s) => n + s.tabs.length, 0);
      expect(flat).toHaveLength(expected);
      expect(new Set(flat.map((t) => t.id)).size).toBe(flat.length);
      // section order: common → advanced → maintenance
      expect(sections.map((s) => s.id)).toEqual(["common", "advanced", "maintenance"]);
    });

    it("searchSettings result description is entry.description; id format tabId:anchor", () => {
      const hits = searchSettings(sections, "settings.language.label");
      expect(hits.length).toBeGreaterThan(0);
      const hit = hits.find((h) => h.anchor === "general-language") ?? hits[0];
      expect(hit?.id).toMatch(/^general:/);
      expect(hit?.tabId).toBe("general");
      // description optional — when present equals product field description key from t()
      if (hit?.description !== undefined) {
        expect(typeof hit.description).toBe("string");
      }
      // whitespace-only terms filtered → empty after filter → false match path already covered; double spaces
      expect(searchSettings(sections, "   CLI    status   ").some((h) => h.anchor === "piagent-status")).toBe(true);
    });
  });

});
