// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionRequestStack } from "./PermissionRequestStack";
import { usePermissionStore } from "../../stores/permission-store";

describe("PermissionRequestStack", () => {
  const permissionRespond = vi.fn();

  beforeEach(() => {
    permissionRespond.mockClear();
    Object.defineProperty(window, "piAPI", {
      value: { permissionRespond },
      configurable: true,
    });
    usePermissionStore.setState({
      mode: "smart",
      pending: [
        {
          requestId: "perm_1",
          workspaceId: "ws1",
          kind: "select",
          source: "permission",
          title: "Permission Required",
          message: "bash: pnpm test",
          options: ["Yes", "No"],
          createdAt: 1,
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds immediately and retains the permission card for its exit transition", () => {
    vi.useFakeTimers();
    render(<PermissionRequestStack workspaceId="ws1" />);
    const dialog = screen.getByRole("alertdialog", { name: "权限请求 1" });

    fireEvent.click(screen.getByRole("button", { name: "仅本对话" }));

    expect(permissionRespond).toHaveBeenCalledWith("perm_1", {
      requestId: "perm_1",
      decision: "allow_session",
    });
    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(dialog.getAttribute("data-motion-state")).toBe("exit");

    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("denies the first pending request with Escape", () => {
    render(<PermissionRequestStack workspaceId="ws1" />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(permissionRespond).toHaveBeenCalledWith("perm_1", {
      requestId: "perm_1",
      decision: "deny",
    });
  });

  it("hides pending requests from other agents in the same workspace", () => {
    usePermissionStore.setState((state) => ({
      pending: [
        {
          ...state.pending[0],
          requestId: "perm_other_agent",
          workspaceId: "ws1",
          agentId: "agent_other",
        },
      ],
    }));

    render(<PermissionRequestStack workspaceId="ws1" agentId="agent_current" />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("handles Escape against the first visible request only", () => {
    usePermissionStore.setState((state) => ({
      pending: [
        {
          ...state.pending[0],
          requestId: "perm_hidden",
          workspaceId: "ws1",
          agentId: "agent_other",
        },
        {
          ...state.pending[0],
          requestId: "perm_visible",
          workspaceId: "ws1",
          agentId: "agent_current",
        },
      ],
    }));

    render(<PermissionRequestStack workspaceId="ws1" agentId="agent_current" />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(permissionRespond).toHaveBeenCalledWith("perm_visible", {
      requestId: "perm_visible",
      decision: "deny",
    });
    expect(permissionRespond).not.toHaveBeenCalledWith("perm_hidden", expect.anything());
  });

  it("renders the permission stack in a top-level overlay above the floating right rail", () => {
    render(
      <div data-testid="host-shell">
        <PermissionRequestStack workspaceId="ws1" />
      </div>,
    );

    const overlay = screen.getByTestId("permission-request-overlay");

    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("z-[90]");
    expect((overlay as HTMLElement).style.left).toBe("var(--pi-global-composer-left, 0px)");
    expect((overlay as HTMLElement).style.right).toBe("var(--pi-global-composer-right, 0px)");
    expect((overlay as HTMLElement).style.bottom).toBe("calc(var(--pi-global-composer-height, 103px) + 12px)");
  });

  it("expands the more menu and dispatches the selected decision", () => {
    render(<PermissionRequestStack workspaceId="ws1" />);

    fireEvent.click(screen.getByRole("button", { name: "更多权限决策" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /始终授权/ }));

    expect(permissionRespond).toHaveBeenCalledWith("perm_1", {
      requestId: "perm_1",
      decision: "allow_always",
    });
    expect(usePermissionStore.getState().pending).toHaveLength(0);
  });

  it("does not render permission cards in desktop overlay mode", () => {
    render(<PermissionRequestStack workspaceId="ws1" displayMode="desktop" />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders extension select options and returns the selected value", () => {
    usePermissionStore.setState((state) => ({
      pending: [{
        ...state.pending[0],
        requestId: "question_1",
        source: "extension",
        title: "下一步",
        message: "当前目录为空，你希望怎么继续？",
        options: ["提供 Git 地址", "使用其他路径"],
      }],
    }));

    render(<PermissionRequestStack workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: "提供 Git 地址" }));

    expect(permissionRespond).toHaveBeenCalledWith("question_1", {
      requestId: "question_1",
      value: "提供 Git 地址",
    });
  });

  it("exposes permission decision focus-visible rings for keyboard a11y", () => {
    render(<PermissionRequestStack workspaceId="ws1" />);

    expect(screen.getByRole("button", { name: /拒绝/ }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "仅本对话" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "更多权限决策" }).className).toContain("focus-visible:ring-2");
    fireEvent.click(screen.getByRole("button", { name: "更多权限决策" }));
    expect(screen.getByRole("menuitem", { name: /始终授权/ }).className).toContain("focus-visible:ring-2");
  });
});
