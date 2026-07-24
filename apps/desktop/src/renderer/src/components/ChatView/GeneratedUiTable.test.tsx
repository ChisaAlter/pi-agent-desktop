// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GeneratedUiTable } from "./GeneratedUiTable";

const section = {
  id: "tbl",
  kind: "table" as const,
  caption: "Metrics",
  columns: [
    { key: "name", label: "Name", sortable: true },
    { key: "score", label: "Score", format: "number" as const, sortable: true },
  ],
  rows: [
    { name: "beta", score: 2 },
    { name: "alpha", score: 10 },
  ],
};

describe("GeneratedUiTable", () => {
  it("renders caption and cells", () => {
    render(<GeneratedUiTable section={section} />);
    expect(screen.getByText("Metrics")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("toggles sort on sortable headers with aria-sort", () => {
    render(<GeneratedUiTable section={section} />);
    const nameHeader = screen.getByRole("button", { name: /Name/ });
    fireEvent.click(nameHeader);
    const th = nameHeader.closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
    // alpha should come before beta when sorted asc by name
    const cells = screen.getAllByText(/alpha|beta/);
    expect(cells[0]?.textContent).toBe("alpha");

    fireEvent.click(nameHeader);
    expect(th?.getAttribute("aria-sort")).toBe("descending");
  });

  it("exposes sortable header focus-visible ring for keyboard a11y", () => {
    render(<GeneratedUiTable section={section} />);
    expect(screen.getByRole("button", { name: /Name/ }).className).toContain("focus-visible:ring-2");
  });
});
