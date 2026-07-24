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

  // wave-105 residual
  it("forbids source edits and requires user confirmation before exit", () => {
    expect(PLAN_DIRECTIVE).toMatch(/Do NOT modify source code/i);
    expect(PLAN_DIRECTIVE).toMatch(/build\/test/i);
    expect(PLAN_DIRECTIVE).toMatch(/Wait for user confirmation/i);
    expect(PLAN_DIRECTIVE).toMatch(/verification checkpoints/i);
    expect(PLAN_DIRECTIVE).toMatch(/risks/i);
  });

  // wave-124 residual
  it("keeps seven joined directive lines with plan_write path contract", () => {
    const lines = PLAN_DIRECTIVE.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("Plan mode is active. You are read-only.");
    expect(lines[1]).toContain("plan_write");
    expect(lines[1]).toContain(".pi/plans/");
    expect(lines[6]).toContain("Wait for user confirmation");
    expect(PLAN_DIRECTIVE).not.toContain("<system-reminder>");
  });

  // wave-138 residual
  it("requires explore-first structure with goal/files/steps and choice options", () => {
    expect(PLAN_DIRECTIVE).toMatch(/Explore the repository with read-only tools first/i);
    expect(PLAN_DIRECTIVE).toMatch(/goal/i);
    expect(PLAN_DIRECTIVE).toMatch(/files to touch/i);
    expect(PLAN_DIRECTIVE).toMatch(/step sequence/i);
    expect(PLAN_DIRECTIVE).toContain("A)");
    expect(PLAN_DIRECTIVE).toContain("B)");
    expect(PLAN_DIRECTIVE).toContain("C)");
    expect(PLAN_DIRECTIVE).not.toMatch(/write tool with a path outside/i);
  });

  // wave-166 residual
  it("mentions write tool only for .pi/plans path and forbids non-plan writes", () => {
    expect(PLAN_DIRECTIVE).toMatch(/write tool with a `\.pi\/plans\/` path/i);
    expect(PLAN_DIRECTIVE).toMatch(/Do NOT modify source code/i);
    expect(PLAN_DIRECTIVE).toMatch(/any write outside `\.pi\/plans\/`/i);
    expect(PLAN_DIRECTIVE.split("\n").every((line) => line.length > 0)).toBe(true);
  });

  // wave-226 residual
  it("PLAN_DIRECTIVE is exactly seven non-empty lines joined by single newlines", () => {
    expect(PLAN_DIRECTIVE.endsWith("\n")).toBe(false);
    const lines = PLAN_DIRECTIVE.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    expect(PLAN_DIRECTIVE.includes("\n\n")).toBe(false);
  });

  it("PLAN_DIRECTIVE forbids shell mutations and keeps plan_write as the write path", () => {
    expect(PLAN_DIRECTIVE).toMatch(/plan_write/i);
    expect(PLAN_DIRECTIVE).toMatch(/\.pi\/plans\//);
    expect(PLAN_DIRECTIVE).toMatch(/Do NOT modify source code/i);
    expect(PLAN_DIRECTIVE).not.toContain("BUILD_SWITCH");
    expect(PLAN_DIRECTIVE).not.toContain("<system-reminder>");
  });

  // wave-242 residual
  it("PLAN_DIRECTIVE line order: read-only → write path → forbid → explore → structure → choices → wait", () => {
    const lines = PLAN_DIRECTIVE.split("\n");
    expect(lines[0]).toMatch(/Plan mode is active/i);
    expect(lines[0]).toMatch(/read-only/i);
    expect(lines[1]).toMatch(/plan_write|\.pi\/plans\//i);
    expect(lines[2]).toMatch(/Do NOT modify source code/i);
    expect(lines[3]).toMatch(/Explore the repository/i);
    expect(lines[4]).toMatch(/goal|files to touch|step sequence/i);
    expect(lines[5]).toMatch(/A\)|B\)|C\)/);
    expect(lines[6]).toMatch(/Wait for user confirmation/i);
  });


  // wave-292 residual
  it("PLAN_DIRECTIVE exact line[2]/[4] contracts; no trailing newline", () => {
    const lines = PLAN_DIRECTIVE.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[2]).toBe(
      "Do NOT modify source code, run build/test commands, or perform any write outside `.pi/plans/`.",
    );
    expect(lines[4]).toBe(
      "Structure the plan: goal, files to touch, step sequence, verification checkpoints, risks.",
    );
    expect(PLAN_DIRECTIVE.startsWith("Plan mode is active.")).toBe(true);
    expect(PLAN_DIRECTIVE.endsWith("implementation.")).toBe(true);
    expect(PLAN_DIRECTIVE.includes("\r")).toBe(false);
  });

  it("mentions plan_write and write-tool plans path only; choice options A/B/C", () => {
    expect(PLAN_DIRECTIVE).toContain("plan_write tool");
    expect(PLAN_DIRECTIVE).toContain("write tool with a `.pi/plans/` path");
    expect(PLAN_DIRECTIVE).toContain("A) / B) / C)");
    expect(PLAN_DIRECTIVE).not.toContain("BUILD_SWITCH");
    expect(PLAN_DIRECTIVE).not.toContain("Compose Agent");
  });


  // wave-298 residual
  it("PLAN_DIRECTIVE is exactly 7 newline-joined lines with read-only and plan_write contract", () => {
    const lines = PLAN_DIRECTIVE.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("Plan mode is active. You are read-only.");
    expect(PLAN_DIRECTIVE).toContain(".pi/plans/");
    expect(PLAN_DIRECTIVE).toContain("plan_write");
    expect(PLAN_DIRECTIVE).toContain("Do NOT modify source code");
    expect(PLAN_DIRECTIVE).toContain("A) / B) / C)");
    expect(PLAN_DIRECTIVE).toContain("Wait for user confirmation");
    expect(PLAN_DIRECTIVE.includes("\n\n")).toBe(false);
  });

  it("PLAN_DIRECTIVE structure mentions goal/files/steps/verification/risks", () => {
    expect(PLAN_DIRECTIVE).toMatch(/goal/i);
    expect(PLAN_DIRECTIVE).toMatch(/files to touch/i);
    expect(PLAN_DIRECTIVE).toMatch(/step sequence/i);
    expect(PLAN_DIRECTIVE).toMatch(/verification/i);
    expect(PLAN_DIRECTIVE).toMatch(/risks/i);
    expect(PLAN_DIRECTIVE).toMatch(/Explore the repository/i);
  });


  // wave-318 residual
  it("PLAN_DIRECTIVE contracts read-only, plans path only, and wait for confirmation", () => {
    expect(PLAN_DIRECTIVE).toContain("Plan mode is active. You are read-only.");
    expect(PLAN_DIRECTIVE).toContain("Output plans ONLY to `.pi/plans/<slug>.md`");
    expect(PLAN_DIRECTIVE).toContain("Do NOT modify source code, run build/test commands");
    expect(PLAN_DIRECTIVE).toContain("Wait for user confirmation before exiting plan mode");
    expect(PLAN_DIRECTIVE.split(String.fromCharCode(10))).toHaveLength(7);
  });

  it("PLAN_DIRECTIVE structure and choice options; no compose-mode leftovers", () => {
    expect(PLAN_DIRECTIVE).toContain("Structure the plan: goal, files to touch, step sequence, verification checkpoints, risks.");
    expect(PLAN_DIRECTIVE).toContain("End your plan with A) / B) / C) choice options");
    expect(PLAN_DIRECTIVE).toContain("Explore the repository with read-only tools first");
    expect(PLAN_DIRECTIVE).not.toContain("Compose");
    expect(PLAN_DIRECTIVE).not.toContain("BUILD_SWITCH");
  });


});
