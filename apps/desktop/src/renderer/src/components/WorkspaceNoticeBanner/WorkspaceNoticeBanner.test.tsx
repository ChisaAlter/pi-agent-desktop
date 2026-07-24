// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceNoticeBanner, emitWorkspaceNotice } from "./WorkspaceNoticeBanner";

describe("WorkspaceNoticeBanner", () => {
  it("shows and dismisses workspace route notices", async () => {
    render(<WorkspaceNoticeBanner />);

    act(() => {
      emitWorkspaceNotice({ message: "切换工作区失败: path missing", tone: "error" });
    });

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("切换工作区失败: path missing");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "关闭工作区提示" }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses status role for non-error tones and exposes dismiss a11y", async () => {
    render(<WorkspaceNoticeBanner />);

    act(() => {
      emitWorkspaceNotice({ message: "工作区已切换", tone: "success" });
    });

    const status = await screen.findByRole("status");
    expect(status.getAttribute("data-workspace-notice")).toBe("success");
    expect(status.textContent).toContain("工作区已切换");

    const dismiss = screen.getByRole("button", { name: "关闭工作区提示" });
    expect(dismiss.getAttribute("type")).toBe("button");
    expect(dismiss.className).toContain("focus-visible:ring-2");
  });

  it("ignores notices without a message", async () => {
    render(<WorkspaceNoticeBanner />);

    act(() => {
      emitWorkspaceNotice({ message: "", tone: "info" });
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
