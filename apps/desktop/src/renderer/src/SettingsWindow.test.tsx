// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsWindow from "./SettingsWindow";
import { useSettingsStore } from "./stores/settings-store";

describe("SettingsWindow", () => {
  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "en-US");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        windowIsMaximized: vi.fn(async () => false),
        onWindowMaximizeChanged: vi.fn(() => () => undefined),
        windowClose: vi.fn(async () => undefined),
        onSettingsTabSelected: vi.fn(() => () => undefined),
        settingsWindowReady: vi.fn(async () => undefined),
        getSettings: vi.fn(async () => useSettingsStore.getState().settings),
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

  it("marks the independent settings frame for first-show motion", () => {
    render(<SettingsWindow />);

    const frame = screen.getByTestId("settings-window-frame");
    expect(frame.className).toContain("settings-window-enter");
    expect(frame.getAttribute("data-settings-window-motion")).toBe("enter");
  });

  it("subscribes before requesting and applying the initial settings tab", async () => {
    const onSettingsTabSelected = window.piAPI.onSettingsTabSelected as ReturnType<typeof vi.fn>;
    const settingsWindowReady = window.piAPI.settingsWindowReady as ReturnType<typeof vi.fn>;
    settingsWindowReady.mockResolvedValueOnce("model");

    render(<SettingsWindow />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Model" }).getAttribute("aria-selected")).toBe("true");
    });
    expect(onSettingsTabSelected).toHaveBeenCalledTimes(1);
    expect(settingsWindowReady).toHaveBeenCalledTimes(1);
    expect(onSettingsTabSelected.mock.invocationCallOrder[0]).toBeLessThan(
      settingsWindowReady.mock.invocationCallOrder[0],
    );
  });

  it("closes immediately without waiting for a pending settings write", () => {
    let resolveFlush: (() => void) | undefined;
    const flushPendingSettingsWrite = vi.fn(() => new Promise<void>((resolve) => {
      resolveFlush = resolve;
    }));
    useSettingsStore.setState({ flushPendingSettingsWrite });

    render(<SettingsWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));

    expect(flushPendingSettingsWrite).toHaveBeenCalledOnce();
    expect(window.piAPI.windowClose).toHaveBeenCalledOnce();
    resolveFlush?.();
  });
});
