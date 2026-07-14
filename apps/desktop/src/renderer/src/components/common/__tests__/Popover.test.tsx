// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Popover } from "../Popover";

describe("Popover", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the neutral floating surface for composer menus", () => {
    render(
      <Popover trigger={<button type="button">Open menu</button>}>
        <button type="button" role="menuitem">Model option</button>
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("bg-[var(--mm-bg-popover)]");
    expect(menu.className).toContain("border-[var(--mm-border)]");
  });

  it("opens upward with an eight-pixel gap and caps height to the space above the trigger", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 255 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 234,
      height: 22,
      left: 112,
      right: 262,
      top: 212,
      width: 150,
      x: 112,
      y: 212,
      toJSON: () => ({}),
    });

    render(
      <Popover align="end" trigger={<button type="button">Open model menu</button>}>
        <button type="button" role="menuitem">Model option</button>
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open model menu" }));

    const menu = screen.getByRole("menu");
    expect(menu.style.top).toBe("64px");
    expect(menu.style.right).toBe("58px");
    expect(menu.style.maxHeight).toBe("196px");
  });

  it("runs the selected action immediately and retains the menu for a bounded exit", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    render(
      <Popover trigger={<button type="button">Open action menu</button>}>
        {(close) => (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              action();
              close();
            }}
          >
            Run action
          </button>
        )}
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open action menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run action" }));

    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("menu").getAttribute("data-motion-state")).toBe("exit");

    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
