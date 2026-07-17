// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";

const { sessionStoreImported, workspaceStoreImported } = vi.hoisted(() => ({
  sessionStoreImported: vi.fn(),
  workspaceStoreImported: vi.fn(),
}));

vi.mock("../../../stores/session-store", () => {
  sessionStoreImported();
  return {};
});

vi.mock("../../../stores/workspace-store", () => {
  workspaceStoreImported();
  return {};
});

import { UsageTab } from "./UsageTab";

describe("UsageTab", () => {
  beforeEach(() => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    Object.defineProperty(window, "piAPI", {
      configurable: true,
      value: {
        listSessionSummaries: vi.fn(async () => ([{
          id: "s1",
          workspaceId: "w1",
          title: "Usage session",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 4,
          usage: {
            provider: "openai",
            model: "gpt-test",
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            updatedAt: Date.now(),
          },
        }])),
        listSessions: vi.fn(async () => []),
        listWorkspaces: vi.fn(async () => ([{
          id: "w1",
          name: "Repo",
          path: "C:/repo",
          createdAt: 1,
          lastActiveAt: 2,
        }])),
      },
    });
  });

  it("loads usage data directly through IPC without importing auto-init stores", async () => {
    render(<UsageTab />, { wrapper: I18nProvider });

    expect(sessionStoreImported).not.toHaveBeenCalled();
    expect(workspaceStoreImported).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(window.piAPI.listSessionSummaries).toHaveBeenCalledTimes(1);
      expect(window.piAPI.listSessions).not.toHaveBeenCalled();
      expect(window.piAPI.listWorkspaces).toHaveBeenCalledTimes(1);
    });
    expect((await screen.findAllByText("150")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-test").length).toBeGreaterThan(0);
    expect(screen.getByTestId("usage-heatmap")).toBeTruthy();
    expect(screen.getByText("30 天内活跃 1 天")).toBeTruthy();
    expect(screen.getByTestId("usage-heatmap").querySelectorAll("button")).toHaveLength(30);
  });
});
