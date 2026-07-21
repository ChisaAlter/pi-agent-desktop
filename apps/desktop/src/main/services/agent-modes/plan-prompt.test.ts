import { describe, expect, it } from "vitest";
import { PLAN_DIRECTIVE } from "./plan-prompt";

describe("PLAN_DIRECTIVE", () => {
  it("constrains plan mode to read-only and .pi/plans writes", () => {
    expect(PLAN_DIRECTIVE).toContain("Plan mode is active");
    expect(PLAN_DIRECTIVE).toContain("read-only");
    expect(PLAN_DIRECTIVE).toContain(".pi/plans/");
    expect(PLAN_DIRECTIVE).toContain("plan_write");
    expect(PLAN_DIRECTIVE).toMatch(/A\)|B\)|C\)/);
  });

  it("is multi-line and non-empty", () => {
    const lines = PLAN_DIRECTIVE.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});
