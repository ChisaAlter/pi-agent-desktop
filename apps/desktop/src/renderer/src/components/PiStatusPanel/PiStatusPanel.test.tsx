// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { usePiStatusStore } from "../../stores/pi-status-store";
import { PiStatusPanel } from "./PiStatusPanel";

describe("PiStatusPanel", () => {
  const uninstall = vi.fn();

  beforeEach(() => {
    uninstall.mockReset();
    usePiStatusStore.setState({
      status: {
        installed: true,
        localVersion: "0.75.5",
        latestVersion: "0.75.5",
        updateAvailable: false,
        executablePath: "C:/pi/pi.exe",
        installMethod: "npm",
        configExists: true,
        defaultProvider: "anthropic",
        defaultModel: "claude-sonnet",
      },
      loading: false,
      error: null,
      progress: null,
      isOperating: false,
      uninstall,
      checkStatus: vi.fn(async () => undefined),
      refreshStatus: vi.fn(async () => undefined),
      setupListeners: vi.fn(),
      cleanupListeners: vi.fn(),
    });
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  it("confirms Pi CLI uninstall inside the app instead of window.confirm", () => {
    render(
      <I18nProvider>
        <PiStatusPanel />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "卸载" }));

    expect(screen.getByRole("dialog", { name: "确认卸载 Pi CLI" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "卸载" })[1]);

    expect(uninstall).toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("cancels in-app uninstall confirmation without calling uninstall", () => {
    render(
      <I18nProvider>
        <PiStatusPanel />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "卸载" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(uninstall).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "确认卸载 Pi CLI" })).toBeNull();
  });

  it("shows install CTA when Pi CLI is not installed", () => {
    usePiStatusStore.setState({
      status: {
        installed: false,
        localVersion: null,
        latestVersion: "0.80.0",
        updateAvailable: false,
        executablePath: null,
        installMethod: "unknown",
        configExists: false,
        defaultProvider: null,
        defaultModel: null,
      },
      loading: false,
      error: null,
      progress: null,
      isOperating: false,
      uninstall,
      install: vi.fn(),
      checkStatus: vi.fn(async () => undefined),
      refreshStatus: vi.fn(async () => undefined),
      setupListeners: vi.fn(),
      cleanupListeners: vi.fn(),
    });

    render(
      <I18nProvider>
        <PiStatusPanel />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "安装 Pi CLI" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "卸载" })).toBeNull();
  });

  it("surfaces string error as alert", () => {
    usePiStatusStore.setState({
      ...usePiStatusStore.getState(),
      error: "检测失败: path missing",
    });

    render(
      <I18nProvider>
        <PiStatusPanel />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain("检测失败: path missing");
  });
});
