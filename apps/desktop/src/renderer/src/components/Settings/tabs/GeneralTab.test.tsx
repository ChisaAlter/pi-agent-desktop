// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings-store";
import { GeneralTab } from "./GeneralTab";

describe("GeneralTab", () => {
  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "en-US");
    window.localStorage.removeItem("pi-desktop-sound-settings");
    Object.defineProperty(window, "piAPI", {
      value: {
        setSettings: vi.fn(async () => undefined),
      },
      configurable: true,
    });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        language: "en-US",
        autoSave: true,
        showLineNumbers: false,
        wordWrap: false,
      },
      lastWriteError: null,
    }));
  });

  it("uses the current language for notification and sound settings", () => {
    render(
      <I18nProvider>
        <GeneralTab />
      </I18nProvider>,
    );

    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Control system notifications and sound alerts.")).toBeTruthy();
    expect(screen.getByText("System notifications")).toBeTruthy();
    expect(screen.getByText("Sound alerts")).toBeTruthy();
    expect(screen.getByLabelText("Volume")).toBeTruthy();
    expect(screen.queryByText("通知")).toBeNull();
    expect(screen.queryByText("系统通知")).toBeNull();
    expect(screen.queryByText("提示音")).toBeNull();
  });
});
