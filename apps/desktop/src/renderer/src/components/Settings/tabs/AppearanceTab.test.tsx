// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { AppearanceTab } from "./AppearanceTab";

const { useSettingsStore, setTheme, updateSettings } = vi.hoisted(() => {
  const setTheme = vi.fn();
  const updateSettings = vi.fn();
  const useSettingsStore = Object.assign(
    vi.fn(() => ({
      settings: { theme: "light", fontSize: 14 },
      updateSettings,
    })),
    { getState: () => ({ setTheme }) },
  );
  return { useSettingsStore, setTheme, updateSettings };
});

vi.mock("../../../stores/settings-store", () => ({ useSettingsStore }));

describe("AppearanceTab", () => {
  beforeEach(() => {
    setTheme.mockReset();
    updateSettings.mockReset();
  });

  it("switches theme via theme cards", () => {
    render(
      <I18nProvider>
        <AppearanceTab />
      </I18nProvider>,
    );
    // three theme buttons
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(buttons[1]!);
    expect(setTheme).toHaveBeenCalled();
  });

  it("updates font size from range input", () => {
    render(
      <I18nProvider>
        <AppearanceTab />
      </I18nProvider>,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "18" } });
    expect(updateSettings).toHaveBeenCalledWith({ fontSize: 18 });
  });

  it("exposes theme card focus-visible rings for keyboard a11y", () => {
    render(
      <I18nProvider>
        <AppearanceTab />
      </I18nProvider>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const btn of buttons.slice(0, 3)) {
      expect(btn.className).toContain("focus-visible:ring-2");
      expect(btn.getAttribute("type")).toBe("button");
    }
  });
});
