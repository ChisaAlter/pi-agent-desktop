// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePiPackagesStore } from "../../stores/pi-packages-store";
import { useSkillsStore } from "../../stores/skills-store";
import { InstalledAddons } from "./InstalledAddons";

describe("InstalledAddons", () => {
  beforeEach(() => {
    usePiPackagesStore.setState({
      query: "",
      results: [],
      installed: [{ name: "pi-git", source: "npm:pi-git", scope: "global" }],
      loading: false,
      installedLoading: false,
      actionSource: null,
      error: null,
      retryAction: null,
      lastAction: null,
    });
    useSkillsStore.setState({
      skillhubAvailable: true,
      marketQuery: "",
      marketResults: [],
      marketLoading: false,
      installed: [{ slug: "web-search", enabled: true }],
      installedLoading: false,
      error: null,
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        packagesListInstalled: vi.fn(async () => [{ name: "pi-git", source: "npm:pi-git", scope: "global" }]),
        packagesSearch: vi.fn(async () => []),
        packagesRemove: vi.fn(async () => ({ success: true, message: "已卸载 npm:pi-git", requiresRestart: true })),
        packagesUpdate: vi.fn(async () => ({ success: true, message: "已更新 npm:pi-git", requiresRestart: true })),
        skillsInstalled: vi.fn(async () => [{ slug: "web-search", enabled: true }]),
        skillsToggle: vi.fn(async () => undefined),
        skillsUninstall: vi.fn(async () => undefined),
      },
      configurable: true,
    });
  });

  it("shows package action success in the installed tab", async () => {
    render(<InstalledAddons />);

    fireEvent.click(await screen.findByRole("button", { name: "更新 pi-git" }));

    expect((await screen.findByRole("status")).textContent).toContain("已更新 npm:pi-git");
    expect(screen.getByRole("status").textContent).toContain("新 Pi 会话或重启当前会话后生效");
  });

  it("keeps package remove failures visible and retryable", async () => {
    window.piAPI!.packagesRemove = vi.fn()
      .mockResolvedValueOnce({
        code: "ipcErrors.packages.removeFailed",
        fallback: "卸载失败: permission denied",
      })
      .mockResolvedValueOnce({ success: true, message: "已卸载 npm:pi-git", requiresRestart: true });

    render(<InstalledAddons />);

    fireEvent.click(await screen.findByRole("button", { name: "卸载 pi-git" }));
    fireEvent.click(await screen.findByRole("button", { name: "卸载" }));

    expect((await screen.findByRole("alert")).textContent).toContain("卸载失败: permission denied");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(window.piAPI?.packagesRemove).toHaveBeenCalledTimes(2);
    });
    expect((await screen.findByRole("status")).textContent).toContain("已卸载 npm:pi-git");
  });

  it("shows skill toggle failures in the installed tab", async () => {
    window.piAPI!.skillsToggle = vi.fn(async () => {
      throw new Error("toggle failed");
    });

    render(<InstalledAddons />);

    fireEvent.click(await screen.findByRole("button", { name: "禁用 web-search" }));

    expect((await screen.findByRole("alert")).textContent).toContain("toggle failed");
  });

  it("exposes action and dialog focus-visible rings for keyboard a11y", async () => {
    render(<InstalledAddons />);

    const update = await screen.findByRole("button", { name: "更新 pi-git" });
    const remove = screen.getByRole("button", { name: "卸载 pi-git" });
    const toggle = screen.getByRole("button", { name: "禁用 web-search" });
    expect(update.className).toContain("focus-visible:ring-2");
    expect(remove.className).toContain("focus-visible:ring-2");
    expect(toggle.className).toContain("focus-visible:ring-2");

    fireEvent.click(remove);
    expect(screen.getByRole("button", { name: "取消" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "卸载" }).className).toContain("focus-visible:ring-2");
  });
});
