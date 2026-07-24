// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupByProvider, ModelSelector } from "./ModelSelector";
import type { PiModelInfo } from "../../stores/settings-store";

const models: PiModelInfo[] = [
  {
    id: "m1",
    name: "Model One",
    provider: "openai",
    providerName: "OpenAI",
    description: "first",
  },
  {
    id: "m2",
    name: "Model Two",
    provider: "openai",
    providerName: "OpenAI",
  },
  {
    id: "m3",
    name: "Model Three",
    provider: "anthropic",
    providerName: "Anthropic",
  },
] as PiModelInfo[];

const { updateSettings, useSettingsStore } = vi.hoisted(() => {
  const updateSettings = vi.fn();
  const useSettingsStore = vi.fn(() => ({
    settings: { model: "m1", provider: "openai" },
    piModels: models,
    updateSettings,
  }));
  return { updateSettings, useSettingsStore };
});

vi.mock("../../stores/settings-store", () => ({ useSettingsStore }));

describe("groupByProvider", () => {
  it("groups by providerName with fallback to provider", () => {
    const groups = groupByProvider([
      { id: "a", name: "A", provider: "p1", providerName: "P1" },
      { id: "b", name: "B", provider: "p1" },
      { id: "c", name: "C", provider: "p2", providerName: "P2" },
    ] as PiModelInfo[]);
    expect(Array.from(groups.keys())).toEqual(["P1", "p1", "P2"]);
    expect(groups.get("P1")?.map((m) => m.id)).toEqual(["a"]);
    expect(groups.get("p1")?.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("ModelSelector", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    useSettingsStore.mockImplementation(() => ({
      settings: { model: "m1", provider: "openai" },
      piModels: models,
      updateSettings,
    }));
  });

  it("returns null when no models", () => {
    useSettingsStore.mockImplementation(() => ({
      settings: { model: "", provider: "" },
      piModels: [],
      updateSettings,
    }));
    const { container } = render(<ModelSelector />);
    expect(container.textContent).toBe("");
  });

  it("opens listbox and selects a model", () => {
    render(<ModelSelector />);
    const trigger = screen.getByRole("button", { name: "选择模型" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "可用模型" })).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: /Model Three/ }));
    expect(updateSettings).toHaveBeenCalledWith({ model: "m3", provider: "anthropic" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks current model as selected", () => {
    render(<ModelSelector />);
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    const selected = screen.getByRole("option", { name: /Model One/ });
    expect(selected.getAttribute("aria-selected")).toBe("true");
  });

  it("exposes trigger and option focus-visible rings for keyboard a11y", () => {
    render(<ModelSelector />);
    const trigger = screen.getByRole("button", { name: "选择模型" });
    expect(trigger.className).toContain("focus-visible:ring-2");
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: /Model One/ }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("option", { name: /Model Three/ }).className).toContain("focus-visible:ring-2");
  });
});
