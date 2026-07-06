/**
 * Tests for insertReminders / buildModeReminder.
 *
 * Verifies the 3 reminder cases ported from MiMo Code:
 *  1. Plan mode → PLAN_DIRECTIVE with plan file info substituted
 *  2. Compose mode → COMPOSE_DIRECTIVE + compose_docs_dir + optional skills
 *  3. Plan→Build transition → BUILD_SWITCH + plan execution prompt
 *
 * Also verifies LongHorizonSettings toggles gate the reminders correctly.
 */
import { describe, expect, it } from "vitest";
import {
    buildModeReminder,
    planFilePathForSession,
    PLAN_DIRECTIVE_TEMPLATE,
    COMPOSE_DIRECTIVE,
    BUILD_SWITCH,
} from "../insert-reminders";
import { formatPlanDirective, formatComposeDocsBlock } from "../directives";

describe("buildModeReminder — plan mode", () => {
    it("injects PLAN_DIRECTIVE when entering plan mode", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "plan",
            longHorizonEnabled: true,
            planModeEnabled: true,
            planFilePath: ".pi/plans/abc.md",
            planFileExists: false,
        });
        expect(blocks).toHaveLength(1);
        expect(blocks[0].kind).toBe("plan");
        expect(reminder).toContain("Plan mode is active");
        expect(reminder).toContain("No plan file exists yet. You should create your plan at .pi/plans/abc.md");
    });

    it("substitutes plan file path when plan file exists", () => {
        const { reminder } = buildModeReminder({
            currentMode: "plan",
            planFilePath: ".pi/plans/xyz.md",
            planFileExists: true,
        });
        expect(reminder).toContain("A plan file already exists at .pi/plans/xyz.md");
        expect(reminder).toContain("You can read it and make incremental edits using the edit tool");
    });

    it("uses default plan path when not provided", () => {
        const { reminder } = buildModeReminder({ currentMode: "plan" });
        expect(reminder).toContain(".pi/plans/current.md");
    });

    it("returns empty reminder when planModeEnabled is false", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "plan",
            planModeEnabled: false,
        });
        expect(reminder).toBe("");
        expect(blocks).toHaveLength(0);
    });

    it("returns empty reminder when longHorizon is disabled", () => {
        const { reminder } = buildModeReminder({
            currentMode: "plan",
            longHorizonEnabled: false,
        });
        expect(reminder).toBe("");
    });
});

describe("buildModeReminder — compose mode", () => {
    it("injects COMPOSE_DIRECTIVE + compose_docs_dir block", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "compose",
            composeModeEnabled: true,
        });
        expect(blocks).toHaveLength(2);
        expect(blocks[0].kind).toBe("compose");
        expect(blocks[1].kind).toBe("compose-docs");
        expect(reminder).toContain("You are the Compose Agent");
        expect(reminder).toContain("<compose_docs_dir>");
        expect(reminder).toContain(".pi/compose/specs");
    });

    it("includes compose_skills block when provided", () => {
        const skillsBlock = "<compose_skills>\n  <skill>\n    <name>compose:debug</name>\n  </skill>\n</compose_skills>";
        const { reminder, blocks } = buildModeReminder({
            currentMode: "compose",
            composeSkillsBlock: skillsBlock,
        });
        expect(blocks).toHaveLength(3);
        expect(blocks[1].kind).toBe("compose-skills");
        expect(reminder).toContain("<compose_skills>");
        expect(reminder).toContain("compose:debug");
    });

    it("uses custom composeDocsDir when provided", () => {
        const { reminder } = buildModeReminder({
            currentMode: "compose",
            composeDocsDir: "custom/docs",
        });
        expect(reminder).toContain("custom/docs/specs");
        expect(reminder).toContain("custom/docs/plans");
        expect(reminder).toContain("custom/docs/reports");
    });

    it("returns empty reminder when composeModeEnabled is false", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "compose",
            composeModeEnabled: false,
        });
        expect(reminder).toBe("");
        expect(blocks).toHaveLength(0);
    });

    it("skips empty compose_skills block", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "compose",
            composeSkillsBlock: "   ",
        });
        // Only compose + compose-docs blocks; empty skills block skipped.
        // Note: COMPOSE_DIRECTIVE itself mentions `<compose_skills>` in its
        // "Compose Skills Visibility" section, so we check block count
        // rather than substring presence.
        expect(blocks).toHaveLength(2);
        expect(blocks.find((b) => b.kind === "compose-skills")).toBeUndefined();
        // The standalone skills block (with actual skill entries) is absent —
        // only the in-directive mention remains.
        expect(reminder).not.toContain("<skill>");
        expect(reminder).not.toContain("</compose_skills>");
    });
});

describe("buildModeReminder — plan→build transition", () => {
    it("injects BUILD_SWITCH + plan execution prompt when transitioning plan→build", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "build",
            previousMode: "plan",
            planFilePath: ".pi/plans/abc.md",
            planFileExists: true,
        });
        expect(blocks).toHaveLength(1);
        expect(blocks[0].kind).toBe("build-switch");
        expect(reminder).toContain("operational mode has changed from plan to build");
        expect(reminder).toContain("A plan file exists at .pi/plans/abc.md");
        expect(reminder).toContain("You should execute on the plan defined within it");
    });

    it("does NOT inject BUILD_SWITCH when plan file doesn't exist", () => {
        const { reminder, blocks } = buildModeReminder({
            currentMode: "build",
            previousMode: "plan",
            planFileExists: false,
        });
        expect(reminder).toBe("");
        expect(blocks).toHaveLength(0);
    });

    it("does NOT inject BUILD_SWITCH when previous mode wasn't plan", () => {
        const { reminder } = buildModeReminder({
            currentMode: "build",
            previousMode: "build",
            planFileExists: true,
        });
        expect(reminder).toBe("");
    });

    it("does NOT inject BUILD_SWITCH when previousMode is undefined", () => {
        const { reminder } = buildModeReminder({
            currentMode: "build",
            planFileExists: true,
        });
        expect(reminder).toBe("");
    });
});

describe("buildModeReminder — build mode (no transition)", () => {
    it("returns empty reminder for plain build mode", () => {
        const { reminder, blocks } = buildModeReminder({ currentMode: "build" });
        expect(reminder).toBe("");
        expect(blocks).toHaveLength(0);
    });
});

describe("planFilePathForSession", () => {
    it("returns .pi/plans/<sessionId>.md for safe session IDs", () => {
        expect(planFilePathForSession("abc123")).toBe(".pi/plans/abc123.md");
        expect(planFilePathForSession("session-xyz")).toBe(".pi/plans/session-xyz.md");
        expect(planFilePathForSession("task_001")).toBe(".pi/plans/task_001.md");
    });

    it("sanitizes unsafe characters from session ID", () => {
        expect(planFilePathForSession("a/b/c")).toBe(".pi/plans/abc.md");
        expect(planFilePathForSession("a:b")).toBe(".pi/plans/ab.md");
        expect(planFilePathForSession("a b")).toBe(".pi/plans/ab.md");
    });

    it("falls back to 'current' when session ID is empty or all-unsafe", () => {
        expect(planFilePathForSession("")).toBe(".pi/plans/current.md");
        expect(planFilePathForSession("/./")).toBe(".pi/plans/current.md");
    });
});

describe("formatPlanDirective", () => {
    it("substitutes 'No plan file exists yet' when exists=false", () => {
        const result = formatPlanDirective(".pi/plans/x.md", false);
        expect(result).toContain("No plan file exists yet. You should create your plan at .pi/plans/x.md");
        expect(result).not.toContain("A plan file already exists");
    });

    it("substitutes 'A plan file already exists' when exists=true", () => {
        const result = formatPlanDirective(".pi/plans/y.md", true);
        expect(result).toContain("A plan file already exists at .pi/plans/y.md");
        expect(result).not.toContain("No plan file exists yet");
    });

    it("preserves the rest of the template", () => {
        const result = formatPlanDirective(".pi/plans/z.md", false);
        expect(result).toContain("Plan mode is active");
        expect(result).toContain("## Plan Workflow");
        expect(result).toContain("Phase 1: Initial Understanding");
    });
});

describe("formatComposeDocsBlock", () => {
    it("returns compose_docs_dir block with the given dir", () => {
        const result = formatComposeDocsBlock(".pi/compose");
        expect(result).toContain("<compose_docs_dir>");
        expect(result).toContain("</compose_docs_dir>");
        expect(result).toContain(".pi/compose/specs");
        expect(result).toContain(".pi/compose/plans");
        expect(result).toContain(".pi/compose/reports");
    });
});

describe("directive text exports", () => {
    it("PLAN_DIRECTIVE_TEMPLATE contains the {{PLAN_FILE_INFO}} placeholder", () => {
        expect(PLAN_DIRECTIVE_TEMPLATE).toContain("{{PLAN_FILE_INFO}}");
        expect(PLAN_DIRECTIVE_TEMPLATE).toContain("Plan mode is active");
    });

    it("COMPOSE_DIRECTIVE contains the compose agent identity", () => {
        expect(COMPOSE_DIRECTIVE).toContain("You are the Compose Agent");
        expect(COMPOSE_DIRECTIVE).toContain("EXTREMELY-IMPORTANT");
        expect(COMPOSE_DIRECTIVE).toContain("Compose skills override default system prompt behavior");
    });

    it("BUILD_SWITCH contains the plan→build transition text", () => {
        expect(BUILD_SWITCH).toContain("operational mode has changed from plan to build");
        expect(BUILD_SWITCH).toContain("no longer in read-only mode");
    });
});
