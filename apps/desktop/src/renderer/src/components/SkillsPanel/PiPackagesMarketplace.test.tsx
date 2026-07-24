// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePiPackagesStore } from "../../stores/pi-packages-store";
import { PiPackagesMarketplace } from "./PiPackagesMarketplace";

describe("PiPackagesMarketplace", () => {
  async function renderMarketplace(): Promise<void> {
    await act(async () => {
      render(<PiPackagesMarketplace />);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });
  }

  async function flushAsyncUpdates(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    usePiPackagesStore.setState({
      query: "",
      results: [],
      installed: [],
      loading: false,
      installedLoading: false,
      actionSource: null,
      error: null,
      retryAction: null,
      lastFailedAction: null,
      lastAction: null,
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        packagesSearch: vi.fn(async () => [
          {
            name: "pi-git",
            source: "npm:pi-git",
            description: "Git tools",
            url: "https://pi.dev/packages/pi-git",
            installed: false,
          },
          {
            name: "local-pack",
            source: "file:C:/repo/local-pack",
            description: "Local package",
            url: "https://pi.dev/packages/local-pack",
            installed: false,
          },
        ]),
        packagesListInstalled: vi.fn(async () => []),
        packagesInstall: vi.fn(async () => ({ success: true, message: "已安装 npm:pi-git", requiresRestart: true })),
        packagesRemove: vi.fn(async () => ({ success: true, message: "已卸载 npm:pi-git", requiresRestart: true })),
        packagesRefreshCatalog: vi.fn(async () => [
          {
            name: "pi-git",
            source: "npm:pi-git",
            description: "Git tools",
            url: "https://pi.dev/packages/pi-git",
            installed: false,
          },
        ]),
      },
      configurable: true,
    });
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    act(() => {
      usePiPackagesStore.setState({
        query: "",
        results: [],
        installed: [],
        loading: false,
        installedLoading: false,
        actionSource: null,
        error: null,
        retryAction: null,
        lastFailedAction: null,
        lastAction: null,
      });
    });
    vi.restoreAllMocks();
  });

  it("shows source protocol, target and trust guidance before installing", async () => {
    await renderMarketplace();

    const installButton = await screen.findByRole("button", { name: "安装 pi-git" });
    await act(async () => {
      fireEvent.click(installButton);
    });

    const dialog = await screen.findByRole("dialog", { name: "确认安装 Pi 插件" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText("协议")).toBeTruthy();
    expect(within(dialog).getByText("npm")).toBeTruthy();
    expect(within(dialog).getByText("pi-git")).toBeTruthy();
    expect(within(dialog).getByText("从 npm 包源安装，请确认包名和维护者可信。")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认安装" }));
    });
    await flushAsyncUpdates();

    await waitFor(() => expect(window.piAPI?.packagesInstall).toHaveBeenCalledWith("npm:pi-git"));
    await waitFor(() => expect(usePiPackagesStore.getState().actionSource).toBeNull());
  });

  it("uses file source trust copy for local packages", async () => {
    await renderMarketplace();

    const installButton = await screen.findByRole("button", { name: "安装 local-pack" });
    await act(async () => {
      fireEvent.click(installButton);
    });

    const dialog = await screen.findByRole("dialog", { name: "确认安装 Pi 插件" });
    expect(within(dialog).getByText("file")).toBeTruthy();
    expect(within(dialog).getByText("C:/repo/local-pack")).toBeTruthy();
    expect(within(dialog).getByText("从本地路径安装，请确认该目录内容可信。")).toBeTruthy();
  });

  it("keeps package install failures retryable", async () => {
    window.piAPI!.packagesInstall = vi.fn()
      .mockResolvedValueOnce({
        code: "ipcErrors.packages.installFailed",
        fallback: "安装失败: network unavailable",
      })
      .mockResolvedValueOnce({ success: true, message: "已安装 npm:pi-git", requiresRestart: true });

    await renderMarketplace();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "安装 pi-git" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "确认安装" }));
    });
    await flushAsyncUpdates();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("安装 npm:pi-git 失败：安装失败: network unavailable");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试安装" }));
    });
    await flushAsyncUpdates();

    await waitFor(() => {
      expect(window.piAPI?.packagesInstall).toHaveBeenCalledTimes(2);
    });
    expect((await screen.findByRole("status")).textContent).toContain("已安装 npm:pi-git");
  });

  it("can manually refresh the package catalog and retry refresh failures", async () => {
    window.piAPI!.packagesRefreshCatalog = vi.fn()
      .mockResolvedValueOnce({
        code: "ipcErrors.packages.refreshFailed",
        fallback: "刷新 Pi 插件市场失败: network unavailable",
      })
      .mockResolvedValueOnce([
        {
          name: "pi-subagents",
          source: "npm:pi-subagents",
          description: "Subagent workflow",
          url: "https://pi.dev/packages/pi-subagents",
          installed: false,
        },
      ]);

    await renderMarketplace();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "刷新目录" }));
    });
    await flushAsyncUpdates();

    expect((await screen.findByRole("alert")).textContent).toContain("刷新目录失败：刷新 Pi 插件市场失败: network unavailable");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试刷新目录" }));
    });
    await flushAsyncUpdates();

    expect(await screen.findByRole("button", { name: "安装 pi-subagents" })).toBeTruthy();
    expect(window.piAPI?.packagesRefreshCatalog).toHaveBeenCalledTimes(2);
  });

  it("exposes catalog and install dialog focus-visible rings", async () => {
    await renderMarketplace();

    const refresh = await screen.findByRole("button", { name: "刷新目录" });
    expect(refresh.className).toContain("focus-visible:ring-2");
    const install = await screen.findByRole("button", { name: "安装 pi-git" });
    expect(install.className).toContain("focus-visible:ring-2");
    expect(screen.getAllByRole("button", { name: "详情" })[0]?.className).toContain("focus-visible:ring-2");

    await act(async () => {
      fireEvent.click(install);
    });
    const dialog = await screen.findByRole("dialog", { name: "确认安装 Pi 插件" });
    expect(within(dialog).getByRole("button", { name: "取消" }).className).toContain("focus-visible:ring-2");
    expect(within(dialog).getByRole("button", { name: "确认安装" }).className).toContain("focus-visible:ring-2");
  });
});
