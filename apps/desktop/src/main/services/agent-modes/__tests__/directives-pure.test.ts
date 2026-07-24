import { describe, expect, it } from "vitest";
import {
  BUILD_SWITCH,
  COMPOSE_DIRECTIVE,
  PLAN_DIRECTIVE_TEMPLATE,
  formatComposeDocsBlock,
  formatPlanDirective,
} from "../directives";
import { PLAN_DIRECTIVE } from "../plan-prompt";

describe("formatPlanDirective", () => {
  it("substitutes create path when plan file does not exist", () => {
    const text = formatPlanDirective(".pi/plans/new.md", false);
    expect(text).toContain("No plan file exists yet");
    expect(text).toContain(".pi/plans/new.md");
    expect(text).not.toContain("{{PLAN_FILE_INFO}}");
    expect(text).toContain("Plan mode is active");
  });

  it("substitutes edit path when plan file exists", () => {
    const text = formatPlanDirective(".pi/plans/existing.md", true);
    expect(text).toContain("A plan file already exists at .pi/plans/existing.md");
    expect(text).toContain("incremental edits");
    expect(text).not.toContain("{{PLAN_FILE_INFO}}");
  });

  it("keeps PLAN_DIRECTIVE_TEMPLATE placeholder for tests", () => {
    expect(PLAN_DIRECTIVE_TEMPLATE).toContain("{{PLAN_FILE_INFO}}");
    expect(PLAN_DIRECTIVE_TEMPLATE).toContain("Plan mode is active");
    expect(PLAN_DIRECTIVE_TEMPLATE).toContain("Phase 4: Final Plan");
  });
});

describe("formatComposeDocsBlock / constants", () => {
  it("formats compose docs directory block", () => {
    const block = formatComposeDocsBlock(".pi/compose");
    expect(block).toContain("<compose_docs_dir>");
    expect(block).toContain("`.pi/compose/specs`");
    expect(block).toContain("`.pi/compose/plans`");
    expect(block).toContain("`.pi/compose/reports`");
    expect(block).toContain("</compose_docs_dir>");
  });

  it("exposes compose and build-switch reminders", () => {
    expect(COMPOSE_DIRECTIVE).toContain("Compose Agent");
    expect(COMPOSE_DIRECTIVE).toContain("compose:ask");
    expect(BUILD_SWITCH).toContain("plan to build");
    expect(BUILD_SWITCH).toContain("no longer in read-only mode");
  });
});

describe("plan-prompt PLAN_DIRECTIVE", () => {
  it("keeps short read-only contract for message prepend", () => {
    expect(PLAN_DIRECTIVE).toContain("Plan mode is active");
    expect(PLAN_DIRECTIVE).toContain(".pi/plans/");
    expect(PLAN_DIRECTIVE).toContain("read-only");
  });
});

// wave-91 residual
describe("directive residual edges", () => {
  it("formatPlanDirective embeds absolute-looking paths without reintroducing placeholder", () => {
    const text = formatPlanDirective("C:/Users/x/.pi/plans/s1.md", true);
    expect(text).toContain("C:/Users/x/.pi/plans/s1.md");
    expect(text).not.toContain("{{PLAN_FILE_INFO}}");
    expect(text).toContain("A plan file already exists");
  });

  it("formatComposeDocsBlock keeps nested docsDir segments", () => {
    const block = formatComposeDocsBlock("workspace/.pi/compose-docs");
    expect(block).toContain("`workspace/.pi/compose-docs/specs`");
    expect(block).toContain("`workspace/.pi/compose-docs/plans`");
    expect(block).toContain("`workspace/.pi/compose-docs/reports`");
  });

  it("BUILD_SWITCH keeps actionable build transition contract", () => {
    expect(BUILD_SWITCH).toContain("system-reminder");
    expect(BUILD_SWITCH.toLowerCase()).toMatch(/build/);
    expect(BUILD_SWITCH.toLowerCase()).toMatch(/plan/);
  });
});

// wave-124 residual
describe("directive residual (wave-124)", () => {
  it("formatPlanDirective embeds empty path without placeholder leakage", () => {
    const create = formatPlanDirective("", false);
    const edit = formatPlanDirective("", true);
    expect(create).toContain("No plan file exists yet");
    expect(create).toContain("create your plan at  using the write tool");
    expect(edit).toContain("A plan file already exists at ");
    expect(create).not.toContain("{{PLAN_FILE_INFO}}");
    expect(edit).not.toContain("{{PLAN_FILE_INFO}}");
  });

  it("COMPOSE_DIRECTIVE keeps skill-first and completion verification contracts", () => {
    // product wording uses lowercase "you MUST invoke it"
    expect(COMPOSE_DIRECTIVE).toContain("you MUST invoke it");
    expect(COMPOSE_DIRECTIVE).toContain("compose:ask");
    expect(COMPOSE_DIRECTIVE).toContain("DO NOT claim completion without a preceding verification tool call");
    expect(COMPOSE_DIRECTIVE).toContain("User's explicit instructions");
  });
});

// wave-165 residual
describe("directive residual (wave-165)", () => {
  it("formatPlanDirective replaces only PLAN_FILE_INFO and keeps system-reminder wrapper", () => {
    const text = formatPlanDirective(".pi/plans/wave165.md", false);
    expect(text.startsWith("<system-reminder>")).toBe(true);
    expect(text.endsWith("</system-reminder>")).toBe(true);
    expect(text).toContain("create your plan at .pi/plans/wave165.md using the write tool");
    expect(text).toContain("Phase 4: Final Plan");
    expect(text).toContain("Phase 5: Exit plan mode");
    expect(text.match(/\{\{PLAN_FILE_INFO\}\}/g)).toBeNull();
  });

  it("formatComposeDocsBlock wraps tags and does not escape path characters", () => {
    const block = formatComposeDocsBlock("C:/Users/x/.pi/compose");
    expect(block.startsWith("<compose_docs_dir>")).toBe(true);
    expect(block.endsWith("</compose_docs_dir>")).toBe(true);
    expect(block).toContain("`C:/Users/x/.pi/compose/specs`");
    expect(block).toContain("`C:/Users/x/.pi/compose/plans`");
    expect(block).toContain("`C:/Users/x/.pi/compose/reports`");
  });

  it("BUILD_SWITCH and COMPOSE_DIRECTIVE remain non-empty multi-line reminders", () => {
    expect(BUILD_SWITCH.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(COMPOSE_DIRECTIVE.split("\n").length).toBeGreaterThan(20);
    expect(BUILD_SWITCH).toContain("<system-reminder>");
    expect(COMPOSE_DIRECTIVE).toContain("<system-reminder>");
    expect(PLAN_DIRECTIVE).toContain("plan_write");
  });
});

// wave-226 residual
describe("directive residual (wave-226)", () => {
  it("formatPlanDirective differs create vs edit for same path", () => {
    const path = ".pi/plans/feature.md";
    const create = formatPlanDirective(path, false);
    const edit = formatPlanDirective(path, true);
    expect(create).toContain(`create your plan at ${path}`);
    expect(create).toContain("write tool");
    expect(edit).toContain(`already exists at ${path}`);
    expect(edit).toContain("edit tool");
    expect(create).not.toEqual(edit);
    expect(create).toContain("Phase 1");
    expect(edit).toContain("explore");
  });

  it("BUILD_SWITCH states plan→build permission lift without plan file path", () => {
    expect(BUILD_SWITCH).toContain("operational mode has changed from plan to build");
    expect(BUILD_SWITCH).toContain("no longer in read-only mode");
    expect(BUILD_SWITCH).toContain("file changes");
    expect(BUILD_SWITCH).toContain("shell commands");
    expect(BUILD_SWITCH).not.toContain(".pi/plans/");
    expect(BUILD_SWITCH).not.toContain("{{PLAN_FILE_INFO}}");
  });

  it("formatComposeDocsBlock preserves windows and unix docsDir verbatim", () => {
    const win = formatComposeDocsBlock("C:\\Users\\x\\.pi\\compose");
    expect(win).toContain("`C:\\Users\\x\\.pi\\compose/specs`");
    expect(win).toContain("`C:\\Users\\x\\.pi\\compose/plans`");
    expect(win).toContain("`C:\\Users\\x\\.pi\\compose/reports`");
    const empty = formatComposeDocsBlock("");
    expect(empty).toContain("`/specs`");
    expect(empty).toContain("`/plans`");
    expect(empty).toContain("`/reports`");
  });
});



// wave-292 residual
describe("directive residual (wave-292)", () => {
  it("formatPlanDirective substitutes PLAN_FILE_INFO only once; template keeps placeholder", () => {
    expect(PLAN_DIRECTIVE_TEMPLATE).toContain("{{PLAN_FILE_INFO}}");
    const create = formatPlanDirective(".pi/plans/x.md", false);
    expect(create).not.toContain("{{PLAN_FILE_INFO}}");
    expect(create.split("No plan file exists yet").length).toBe(2);
    expect(create).toContain("create your plan at .pi/plans/x.md");
    expect(create).toContain("write tool");
    const edit = formatPlanDirective(".pi/plans/x.md", true);
    expect(edit).toContain("already exists at .pi/plans/x.md");
    expect(edit).toContain("edit tool");
    expect(edit).not.toContain("write tool");
  });

  it("formatComposeDocsBlock joins three lines; BUILD_SWITCH is compact system-reminder", () => {
    const block = formatComposeDocsBlock(".pi/compose");
    const lines = block.split("\n");
    expect(lines[0]).toBe("<compose_docs_dir>");
    expect(lines[2]).toBe("</compose_docs_dir>");
    expect(lines[1]).toContain("`.pi/compose/specs`");
    expect(lines[1]).toContain("`.pi/compose/plans`");
    expect(lines[1]).toContain("`.pi/compose/reports`");
    expect(BUILD_SWITCH).toContain("<system-reminder>");
    expect(BUILD_SWITCH).toContain("</system-reminder>");
    expect(BUILD_SWITCH).toContain("plan to build");
    expect(BUILD_SWITCH.split("\n").length).toBeLessThan(10);
  });
});


// wave-299 residual
describe("directive residual (wave-299)", () => {
  it("formatPlanDirective create vs edit branches keep system-reminder wrappers", () => {
    const create = formatPlanDirective(".pi/plans/demo.md", false);
    const edit = formatPlanDirective(".pi/plans/demo.md", true);
    for (const text of [create, edit]) {
      expect(text).toContain("<system-reminder>");
      expect(text).toContain("</system-reminder>");
      expect(text).toContain(".pi/plans/demo.md");
    }
    expect(create).toMatch(/create your plan/i);
    expect(create).toContain("write tool");
    expect(edit).toMatch(/already exists/i);
    expect(edit).toContain("edit tool");
    expect(edit).not.toContain("write tool");
  });

  it("COMPOSE_DIRECTIVE is multi-line system-reminder; BUILD_SWITCH mentions plan to build", () => {
    expect(COMPOSE_DIRECTIVE).toContain("<system-reminder>");
    expect(COMPOSE_DIRECTIVE).toContain("</system-reminder>");
    expect(COMPOSE_DIRECTIVE.split("\n").length).toBeGreaterThan(5);
    expect(BUILD_SWITCH).toMatch(/plan to build/i);
    expect(BUILD_SWITCH.includes("{{")).toBe(false);
  });

  it("formatComposeDocsBlock concatenates docsDir paths; empty docsDir yields root-relative", () => {
    const a = formatComposeDocsBlock(".pi/compose");
    expect(a).toContain("`.pi/compose/specs`");
    expect(a).toContain("`.pi/compose/plans`");
    expect(a).toContain("`.pi/compose/reports`");
    // product does not strip trailing slash — double slash is preserved
    const slash = formatComposeDocsBlock(".pi/compose/");
    expect(slash).toContain("`.pi/compose//specs`");
    const empty = formatComposeDocsBlock("");
    expect(empty).toContain("`/specs`");
    expect(empty).toContain("`/plans`");
    expect(empty).toContain("`/reports`");
  });



// wave-307 residual
describe("directive residual (wave-307)", () => {
  it("formatPlanDirective substitutes PLAN_FILE_INFO exactly once; path embedded raw", () => {
    const path = ".pi/plans/weird-name.md";
    const text = formatPlanDirective(path, false);
    // template placeholder removed
    expect(text.includes("{{PLAN_FILE_INFO}}")).toBe(false);
    // path appears in create branch line
    expect(text).toContain(path);
    expect(text).toContain("write tool");
    // second call with exists true does not leave write tool
    const edit = formatPlanDirective(path, true);
    expect(edit).toContain("edit tool");
    expect(edit).not.toContain("write tool");
    expect(edit).toContain("already exists at " + path);
  });

  it("formatComposeDocsBlock is three lines; middle line holds three backtick paths", () => {
    const block = formatComposeDocsBlock("D:/ws/.pi/compose");
    expect(block.split("\n")).toHaveLength(3);
    expect(block.startsWith("<compose_docs_dir>")).toBe(true);
    expect(block.endsWith("</compose_docs_dir>")).toBe(true);
    expect(block).toContain("`D:/ws/.pi/compose/specs`");
    expect(block).toContain("`D:/ws/.pi/compose/plans`");
    expect(block).toContain("`D:/ws/.pi/compose/reports`");
  });

  it("PLAN_DIRECTIVE_TEMPLATE still contains placeholder; COMPOSE/BUILD_SWITCH do not", () => {
    expect(PLAN_DIRECTIVE_TEMPLATE).toContain("{{PLAN_FILE_INFO}}");
    expect(COMPOSE_DIRECTIVE.includes("{{")).toBe(false);
    expect(BUILD_SWITCH.includes("{{")).toBe(false);
    expect(BUILD_SWITCH).toContain("<system-reminder>");
  });
});

});
