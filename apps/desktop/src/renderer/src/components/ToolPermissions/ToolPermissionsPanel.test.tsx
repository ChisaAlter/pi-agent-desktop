// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ipcError, type IpcError, type Session as PersistedSession } from "@shared";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAgentStore } from "../../stores/agent-store";
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
        agentsSyncPermissions: vi.fn(async () => ({ activeTools: ["read", "edit"], deniedTools: ["bash"] })),
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
    useAgentStore.setState({ agents: [], currentAgentId: null });
  });

  it("shows success only after session persistence and live-agent runtime sync both succeed", async () => {
    let resolvePersist!: (value: PersistedSession | IpcError) => void;
    window.piAPI.updateSessionMetadata = vi.fn<Window["piAPI"]["updateSessionMetadata"]>(
      () => new Promise<PersistedSession | IpcError>((resolve) => { resolvePersist = resolve; }),
    );
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
    useAgentStore.setState({
      agents: [{ id: "agent_1", workspaceId: "w1", sessionId: "s1", title: "任务", status: "idle", createdAt: 1, updatedAt: 1 }],
      currentAgentId: "agent_1",
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);

    fireEvent.click(screen.getByLabelText("Bash / PowerShell"));

    await waitFor(() => {
      expect(window.piAPI.updateSessionMetadata).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          toolPermissions: expect.objectContaining({ shell: true }),
        }),
      );
    });
    expect(window.piAPI.agentsSyncPermissions).not.toHaveBeenCalled();
    expect(screen.queryByText(/运行时已启用/)).toBeNull();

    resolvePersist({
      id: "s1",
      workspaceId: "w1",
      title: "任务",
      createdAt: 1,
      updatedAt: 2,
      messages: [],
      toolPermissions: { ...developmentPermissions, shell: true },
    });
    await waitFor(() => expect(window.piAPI.agentsSyncPermissions).toHaveBeenCalledWith("agent_1"));
    expect(useSessionStore.getState().sessions[0].toolPermissions?.shell).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("运行时已启用：read、edit");
    expect(screen.getByRole("status").textContent).toContain("已禁用：bash");
  });

  it("reports runtime sync failure without claiming success after persistence", async () => {
    window.piAPI.agentsSyncPermissions = vi.fn(async () => ipcError("ipcErrors.agents.syncFailed", "runtime unavailable"));
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [{ id: "s1", workspaceId: "w1", title: "任务", createdAt: new Date(), updatedAt: new Date(), messages: [], toolPermissions: developmentPermissions }],
    });
    useAgentStore.setState({
      agents: [{ id: "agent_1", workspaceId: "w1", sessionId: "s1", title: "任务", status: "idle", createdAt: 1, updatedAt: 1 }],
      currentAgentId: "agent_1",
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);
    fireEvent.click(screen.getByLabelText("网络"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("runtime unavailable"));
    expect(screen.queryByText(/运行时已启用/)).toBeNull();
  });

  it("explains that persisted session permissions take effect on the next agent session when no live agent exists", async () => {
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [{ id: "s1", workspaceId: "w1", title: "任务", createdAt: new Date(), updatedAt: new Date(), messages: [], toolPermissions: developmentPermissions }],
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);
    fireEvent.click(screen.getByLabelText("网络"));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("下次 agent session 生效"));
    expect(window.piAPI.agentsSyncPermissions).not.toHaveBeenCalled();
  });

  it("syncs the agent bound to the current session when another agent tab is selected", async () => {
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [{ id: "s1", workspaceId: "w1", title: "任务", createdAt: new Date(), updatedAt: new Date(), messages: [], toolPermissions: developmentPermissions }],
    });
    useAgentStore.setState({
      agents: [
        { id: "agent_other", workspaceId: "w1", sessionId: "s2", title: "其他", status: "idle", createdAt: 1, updatedAt: 1 },
        { id: "agent_bound", workspaceId: "w1", sessionId: "s1", title: "任务", status: "idle", createdAt: 1, updatedAt: 1 },
      ],
      currentAgentId: "agent_other",
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);
    fireEvent.click(screen.getByLabelText("网络"));

    await waitFor(() => expect(window.piAPI.agentsSyncPermissions).toHaveBeenCalledWith("agent_bound"));
    expect(screen.getByRole("status").textContent).toContain("运行时已启用：read、edit");
  });

  it("serializes rapid session changes and merges each change from the latest stored permissions", async () => {
    const resolvers: Array<(value: PersistedSession | IpcError) => void> = [];
    window.piAPI.updateSessionMetadata = vi.fn<Window["piAPI"]["updateSessionMetadata"]>(
      () => new Promise<PersistedSession | IpcError>((resolve) => { resolvers.push(resolve); }),
    );
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [{ id: "s1", workspaceId: "w1", title: "任务", createdAt: new Date(), updatedAt: new Date(), messages: [], toolPermissions: developmentPermissions }],
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);
    fireEvent.click(screen.getByLabelText("文件写入"));
    fireEvent.click(screen.getByLabelText("网络"));

    await waitFor(() => expect(window.piAPI.updateSessionMetadata).toHaveBeenCalledTimes(1));
    expect(window.piAPI.updateSessionMetadata).toHaveBeenNthCalledWith(1, "s1", {
      toolPermissions: expect.objectContaining({ fileWrite: false, network: false }),
    });

    resolvers[0]({ id: "s1", workspaceId: "w1", title: "任务", createdAt: 1, updatedAt: 2, messages: [] });
    await waitFor(() => expect(window.piAPI.updateSessionMetadata).toHaveBeenCalledTimes(2));
    expect(window.piAPI.updateSessionMetadata).toHaveBeenNthCalledWith(2, "s1", {
      toolPermissions: expect.objectContaining({ fileWrite: false, network: true }),
    });

    resolvers[1]({ id: "s1", workspaceId: "w1", title: "任务", createdAt: 1, updatedAt: 3, messages: [] });
    await waitFor(() => {
      expect(useSessionStore.getState().sessions[0].toolPermissions).toMatchObject({ fileWrite: false, network: true });
    });
  });

  it("discovers an agent created while session permissions are being saved", async () => {
    let resolvePersist!: (value: PersistedSession | IpcError) => void;
    window.piAPI.updateSessionMetadata = vi.fn<Window["piAPI"]["updateSessionMetadata"]>(
      () => new Promise<PersistedSession | IpcError>((resolve) => { resolvePersist = resolve; }),
    );
    useSessionStore.setState({
      currentSessionId: "s1",
      sessions: [{ id: "s1", workspaceId: "w1", title: "任务", createdAt: new Date(), updatedAt: new Date(), messages: [], toolPermissions: developmentPermissions }],
    });

    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);
    fireEvent.click(screen.getByLabelText("网络"));
    await waitFor(() => expect(window.piAPI.updateSessionMetadata).toHaveBeenCalledTimes(1));
    await act(async () => {
      useAgentStore.setState({
        agents: [{ id: "agent_late", workspaceId: "w1", sessionId: "s1", title: "任务", status: "idle", createdAt: 1, updatedAt: 1 }],
        currentAgentId: "agent_late",
      });
      resolvePersist({ id: "s1", workspaceId: "w1", title: "任务", createdAt: 1, updatedAt: 2, messages: [] });
    });

    await waitFor(() => expect(window.piAPI.agentsSyncPermissions).toHaveBeenCalledWith("agent_late"));
    expect(screen.getByRole("status").textContent).toContain("运行时已启用：read、edit");
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

  it("exposes preset button focus-visible rings for keyboard a11y", () => {
    renderWithI18n(<ToolPermissionsPanel workspaceId="w1" />);
    const minimal = screen.getByRole("button", { name: "最小权限" });
    expect(minimal.getAttribute("type")).toBe("button");
    expect(minimal.className).toContain("focus-visible:ring-2");
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
