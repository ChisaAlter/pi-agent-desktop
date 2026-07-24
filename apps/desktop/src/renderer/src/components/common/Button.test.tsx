// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("defaults to type=button and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("type")).toBe("button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables while loading and shows spinner", () => {
    render(
      <Button isLoading variant="danger" size="sm">
        Delete
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /Delete/ });
    expect(btn).toHaveProperty("disabled", true);
    expect(btn.querySelector("svg.animate-spin")).toBeTruthy();
  });

  it("respects explicit type and disabled prop", () => {
    render(
      <Button type="submit" disabled>
        Go
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn.getAttribute("type")).toBe("submit");
    expect(btn).toHaveProperty("disabled", true);
  });

  it("exposes focus-visible ring classes for keyboard a11y", () => {
    render(<Button>Focus me</Button>);
    const btn = screen.getByRole("button", { name: "Focus me" });
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:ring-offset-2");
    expect(btn.className).toContain("focus-visible:ring-blue-500");
  });
});
