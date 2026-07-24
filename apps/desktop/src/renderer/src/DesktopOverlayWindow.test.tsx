// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopOverlayWindow } from "./DesktopOverlayWindow";
import { usePermissionStore } from "./stores/permission-store";

describe("DesktopOverlayWindow", () => {
  beforeEach(() => {
    usePermissionStore.setState({
      mode: "smart",
      pending: [],
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        agentsList: vi.fn(async () => []),
        onAgentsState: vi.fn(() => () => undefined),
        onPlanProgress: vi.fn(() => () => undefined),
        send: vi.fn(),
      },
      configurable: true,
    });
  });

  it("does not render permission cards inside the desktop overlay window", () => {
    usePermissionStore.setState({
      mode: "smart",
      pending: [
        {
          requestId: "overlay_permission",
          workspaceId: "ws1",
          kind: "select",
          source: "permission",
          title: "Overlay permission should stay in main window",
          createdAt: Date.now(),
        },
      ],
    });

    render(<DesktopOverlayWindow />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("exposes progress stop action focus-visible ring for keyboard a11y", async () => {
    const agentsList = vi.fn(async () => [
      {
        id: "agent-1",
        workspaceId: "ws1",
        status: "running",
        title: "running task",
      },
    ]);
    Object.defineProperty(window, "piAPI", {
      value: {
        agentsList,
        onAgentsState: vi.fn(() => () => undefined),
        onPlanProgress: vi.fn(() => () => undefined),
        send: vi.fn(),
      },
      configurable: true,
    });

    render(<DesktopOverlayWindow />);

    const stop = await screen.findByRole("button", { name: /停止|暂停/ });
    expect(stop.className).toContain("focus-visible:ring-2");
  });
});
