// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsWindow from "./SettingsWindow";
import { useSettingsStore } from "./stores/settings-store";

describe("SettingsWindow", () => {
  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "en-US");
    Object.defineProperty(window, "piAPI", {
      value: {
        windowIsMaximized: vi.fn(async () => false),
        onWindowMaximizeChanged: vi.fn(() => () => undefined),
        windowClose: vi.fn(async () => undefined),
        loadPiConfig: vi.fn(async () => ({ models: [], currentModel: null })),
        configListManagedModels: vi.fn(async () => ({ models: [] })),
      },
      configurable: true,
    });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        language: "en-US",
      },
      piModels: [],
      lastWriteError: null,
    }));
  });

  it("uses the current language for the window title", async () => {
    render(<SettingsWindow />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeTruthy();
    });
    expect(screen.queryByText("系统设置")).toBeNull();
  });
});
