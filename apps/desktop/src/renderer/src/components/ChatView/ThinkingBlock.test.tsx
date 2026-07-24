// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock";

describe("ThinkingBlock", () => {
  it("renders nothing when content empty", () => {
    const { container } = render(<ThinkingBlock content="" />);
    expect(container.textContent).toBe("");
  });

  it("toggles expansion with aria-expanded and label", () => {
    render(<ThinkingBlock content="step one" count={2} />);
    const btn = screen.getByRole("button", { name: /展开思考/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/思考 2 次/)).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("step one")).toBeTruthy();
    expect(screen.getByRole("button", { name: /收起思考/ })).toBeTruthy();
  });

  it("shows streaming label and keeps content expanded when defaultExpanded", () => {
    render(
      <ThinkingBlock content="partial..." isStreaming defaultExpanded />,
    );
    expect(screen.getByText("思考中")).toBeTruthy();
    expect(screen.getByText("partial...")).toBeTruthy();
    expect(screen.getByRole("button", { name: /收起思考/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("exposes thinking toggle focus-visible ring for keyboard a11y", () => {
    render(<ThinkingBlock content="step one" />);
    expect(screen.getByRole("button", { name: /展开思考/ }).className).toContain(
      "focus-visible:ring-2",
    );
  });
});
