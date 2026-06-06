// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("renders pending permission and allows the current session", () => {
    render(<PermissionRequestStack />);
    expect(screen.getByRole("alertdialog", { name: "权限请求 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "仅本对话" }));

    expect(permissionRespond).toHaveBeenCalledWith("perm_1", {
      requestId: "perm_1",
      decision: "allow_session",
    });
    expect(usePermissionStore.getState().pending).toHaveLength(0);
  });

  it("denies the first pending request with Escape", () => {
    render(<PermissionRequestStack />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(permissionRespond).toHaveBeenCalledWith("perm_1", {
      requestId: "perm_1",
      decision: "deny",
    });
  });
});
