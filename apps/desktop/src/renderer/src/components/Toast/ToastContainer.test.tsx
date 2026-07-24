// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../../stores/toast-store";
import { ToastContainer } from "./ToastContainer";

describe("ToastContainer motion", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it("executes retry immediately and retains the toast for its exit transition", () => {
    vi.useFakeTimers();
    const retryAction = vi.fn();
    useToastStore.setState({
      toasts: [{
        id: "toast_motion",
        message: "Retry this operation",
        tone: "error",
        createdAt: 1,
        retryAction,
      }],
    });

    render(<ToastContainer />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(retryAction).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(screen.getByRole("status").getAttribute("data-motion-state")).toBe("exit");

    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("exposes retry and dismiss focus-visible rings for keyboard a11y", () => {
    useToastStore.setState({
      toasts: [{
        id: "toast_a11y",
        message: "Need focus rings",
        tone: "info",
        createdAt: 1,
        retryAction: vi.fn(),
      }],
    });

    render(<ToastContainer />);
    expect(screen.getByRole("button", { name: "重试" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "关闭通知" }).className).toContain("focus-visible:ring-2");
  });
});
