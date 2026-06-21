import { describe, expect, it } from "vitest";
import {
    buildAgentModePrompt,
    composeSlashCommands,
    goalSlashCommands,
    isPlanModeToolAllowed,
    normalizeAgentMode,
} from "../agent-modes";

describe("agent modes", () => {
    it("normalizes unknown values to build", () => {
        expect(normalizeAgentMode("plan")).toBe("plan");
        expect(normalizeAgentMode("compose")).toBe("compose");
        expect(normalizeAgentMode("max", { longHorizonEnabled: true, maxModeEnabled: true })).toBe("max");
        expect(normalizeAgentMode("max", { longHorizonEnabled: true, maxModeEnabled: false })).toBe("build");
        expect(normalizeAgentMode("max", { longHorizonEnabled: false, maxModeEnabled: true })).toBe("build");
        expect(normalizeAgentMode("other")).toBe("build");
        expect(normalizeAgentMode(undefined)).toBe("build");
    });

    it("leaves build prompts unchanged", () => {
        expect(buildAgentModePrompt("build", "hello")).toBe("hello");
    });

    it("does not inject mode prompts when long horizon is disabled", () => {
        expect(buildAgentModePrompt("plan", "hello", { longHorizonEnabled: false })).toBe("hello");
        expect(buildAgentModePrompt("compose", "hello", { longHorizonEnabled: false })).toBe("hello");
        expect(buildAgentModePrompt("max", "hello", { longHorizonEnabled: false, maxModeEnabled: true })).toBe("hello");
    });

    it("wraps plan prompts with a MiMo-style read-only planning reminder", () => {
        const prompt = buildAgentModePrompt("plan", "改输入区");

        expect(prompt).toContain("Plan mode is active");
        expect(prompt).toContain(".pi/plans/");
        expect(prompt).toContain("MUST NOT make edits");
        expect(prompt).toContain("改输入区");
    });

    it("wraps compose prompts with compose workflow and real local skill summaries", () => {
        const prompt = buildAgentModePrompt("compose", "全面审查代码");

        expect(prompt).toContain("Compose mode is active");
        expect(prompt).toContain("<compose_skills>");
        expect(prompt).toContain("compose:plan");
        expect(prompt).toContain("全面审查代码");
    });

    it("exposes compose slash commands backed by the local compose bundle", () => {
        expect(composeSlashCommands()).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "compose:plan", source: "skill" }),
            expect.objectContaining({ name: "compose:verify", source: "skill" }),
        ]));
    });

    it("exposes goal slash commands only through the long-horizon command bundle", () => {
        expect(goalSlashCommands()).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "goal", source: "builtin", requiresArgument: true }),
        ]));
    });

    it("allows plan mode to write only plan markdown files", () => {
        expect(isPlanModeToolAllowed({ toolName: "read", args: { file_path: "src/app.ts" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "write", args: { file_path: ".pi/plans/input.md" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "edit", args: { path: "C:/repo/.pi/plans/input.md" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "write", args: { file_path: "src/app.ts" }, workspacePath: "C:/repo" })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "pnpm test" }, workspacePath: "C:/repo" })).toBe(false);
    });
});
