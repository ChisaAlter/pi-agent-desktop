// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { MiniMaxCodeTitleBar } from "./MiniMaxCodeTitleBar";

describe("MiniMaxCodeTitleBar", () => {
  beforeEach(() => {
    window.nodeAPI = { platform: "win32" } as never;
    window.piAPI = {
      windowIsMaximized: vi.fn().mockResolvedValue(false),
      onWindowMaximizeChanged: vi.fn(() => () => undefined),
      windowMinimize: vi.fn(),
      windowToggleMaximize: vi.fn(),
      windowClose: vi.fn(),
    } as never;
  });

  it("renders banner with title and window controls on Windows", async () => {
    render(
      <I18nProvider>
        <MiniMaxCodeTitleBar title="Pi Desktop" statusLabel="就绪" statusTone="ready" />
      </I18nProvider>,
    );
    const banner = screen.getByRole("banner");
    expect(banner).toBeTruthy();
    expect(banner.className).toContain("app-region-drag");
    expect(banner.className).toContain("rounded-t-[var(--mm-window-radius)]");
    expect(screen.getByText("Pi Desktop")).toBeTruthy();
    expect(screen.getByText("就绪")).toBeTruthy();
    expect(screen.getByText("就绪").closest(".app-region-no-drag")).toBeTruthy();

    const minimize = await screen.findByRole("button", { name: /最小化|Minimize/i });
    fireEvent.click(minimize);
    expect(window.piAPI!.windowMinimize).toHaveBeenCalled();
  });

  it("double-clicks empty titlebar chrome to toggle maximize", async () => {
    render(
      <I18nProvider>
        <MiniMaxCodeTitleBar title="Pi Desktop" />
      </I18nProvider>,
    );
    await screen.findByRole("button", { name: /最大化|Maximize/i });
    fireEvent.doubleClick(screen.getByRole("banner"));
    expect(window.piAPI!.windowToggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("uses onClose override for close button", async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <MiniMaxCodeTitleBar title="Settings" onClose={onClose} />
      </I18nProvider>,
    );
    const close = await screen.findByRole("button", { name: /关闭|Close/i });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.piAPI!.windowClose).not.toHaveBeenCalled();
  });
});
