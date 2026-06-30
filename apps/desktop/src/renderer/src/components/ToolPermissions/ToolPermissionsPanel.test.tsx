// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { ToolPermissionsPanel } from "./ToolPermissionsPanel";

const developmentPermissions = {
  fileRead: true,
  fileWrite: true,
  shell: true,
  git: true,
  network: false,
  extensions: true,
};

function renderWithI18n(ui: ReactElement): ReturnType<typeof render> {
  return render(ui, { wrapper: I18nProvider });
}

describe("ToolPermissionsPanel", () => {
  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    Object.defineProperty(window, "piAPI", {
      value: {
        setSettings: vi.fn(async () => undefined),
        updateSessionMetadata: vi.fn(async () => undefined),
      },
      configurable: true,
    });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        language: "zh-CN",
        workspaceToolDefaults: {},
      },
      lastWriteError: null,
    });
    useSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      persistErrorCount: 0,
      lastPersistError: null,
    });
  });

  it("updates current session permissions and shows save feedback", () => {
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [
        {
          id: "s1",
          workspaceId: "w1",
          title: "任务",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          toolPermissions: { ...developmentPermissions, shell: false },
        },
      ],
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);

    fireEvent.click(screen.getByLabelText("Bash / PowerShell"));

    expect(useSessionStore.getState().sessions[0].toolPermissions?.shell).toBe(true);
    expect(window.piAPI.updateSessionMetadata).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        toolPermissions: expect.objectContaining({ shell: true }),
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("已应用到当前会话");
  });

  it("updates workspace defaults and shows success feedback", async () => {
    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);

    fireEvent.click(screen.getByRole("button", { name: "最小权限" }));

    expect(useSettingsStore.getState().settings.workspaceToolDefaults?.w1?.shell).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("已更新工作区默认权限");
    await waitFor(() => {
      expect(window.piAPI.setSettings).toHaveBeenCalledWith({
        workspaceToolDefaults: expect.objectContaining({
          w1: expect.objectContaining({ shell: false }),
        }),
      });
    });
  });

  it("reflects workspace checkbox changes immediately and can toggle them back", () => {
    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);

    const network = screen.getByLabelText("网络") as HTMLInputElement;
    expect(network.checked).toBe(false);

    fireEvent.click(network);
    expect(network.checked).toBe(true);
    expect(useSettingsStore.getState().settings.workspaceToolDefaults?.w1?.network).toBe(true);

    fireEvent.click(network);
    expect(network.checked).toBe(false);
    expect(useSettingsStore.getState().settings.workspaceToolDefaults?.w1?.network).toBe(false);
  });

  it("uses the current language for labels and feedback", () => {
    window.localStorage.setItem("pi-desktop.locale", "en-US");
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        language: "en-US",
      },
    }));

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);

    fireEvent.click(screen.getByRole("button", { name: "Minimal" }));

    expect(screen.getByText("Tool permissions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Development" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All enabled" })).toBeTruthy();
    expect(screen.getByLabelText("Network")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Updated workspace default permissions");
    expect(screen.queryByText("工具权限")).toBeNull();
    expect(screen.queryByRole("button", { name: "最小权限" })).toBeNull();
  });

  it("surfaces workspace permission write failures", async () => {
    window.piAPI.setSettings = vi.fn(async () => ({
      code: "ipcErrors.settings.writeFailed",
      fallback: "磁盘不可写",
    })) as unknown as Window["piAPI"]["setSettings"];

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);

    fireEvent.click(screen.getByRole("button", { name: "全部开启" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("工具权限保存失败：磁盘不可写");
    });
  });

  it("disables permission controls until a workspace or session is available", () => {
    renderWithI18n(<ToolPermissionsPanel />);

    expect(screen.getByRole("status").textContent).toContain("选择工作区后可配置默认工具权限");
    expect((screen.getByRole("button", { name: "最小权限" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("文件读取") as HTMLInputElement).disabled).toBe(true);
  });
});
