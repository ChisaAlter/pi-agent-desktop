import { describe, expect, it } from "vitest";
import {
    agentRegistry,
    buildAgentModePrompt,
    goalSlashCommands,
    isPlanModeToolAllowed,
    normalizeAgentMode,
} from "../agent-modes";

describe("agent modes", () => {
    it("normalizes unknown values to build", () => {
        expect(normalizeAgentMode("plan")).toBe("plan");
        expect(normalizeAgentMode("compose")).toBe("compose");
        expect(normalizeAgentMode("plan", { longHorizonEnabled: true, planModeEnabled: false })).toBe("build");
        expect(normalizeAgentMode("compose", { longHorizonEnabled: true, composeModeEnabled: false })).toBe("build");
        expect(normalizeAgentMode("max")).toBe("build");
        expect(normalizeAgentMode("other")).toBe("build");
        expect(normalizeAgentMode(undefined)).toBe("build");
    });

    it("filters primary agents through the long-horizon settings switches", () => {
        expect(agentRegistry({
            longHorizonEnabled: true,
            planModeEnabled: false,
            composeModeEnabled: true,
        }).map((agent) => agent.id)).toEqual([
            "build",
            "compose",
            "checkpoint-writer",
            "dream",
            "distill",
        ]);
    });

    it("leaves build prompts unchanged", () => {
        expect(buildAgentModePrompt("build", "hello")).toBe("hello");
    });

    it("does not inject mode prompts when long horizon is disabled", () => {
        expect(buildAgentModePrompt("plan", "hello", { longHorizonEnabled: false })).toBe("hello");
        expect(buildAgentModePrompt("compose", "hello", { longHorizonEnabled: false })).toBe("hello");
    });

    it("leaves plan and compose prompts untouched because runtime extensions now own those modes", () => {
        expect(buildAgentModePrompt("plan", "改输入区")).toBe("改输入区");
        expect(buildAgentModePrompt("compose", "全面审查代码")).toBe("全面审查代码");
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
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "rg --files" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git status --short" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "mkdir -p .pi/plans" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "powershell", args: { command: "Get-ChildItem -Force | Select-String AGENTS" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: 'find miniprogram/pages -type f -name "*.js" | sort' }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: 'find . -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" -type d 2>/dev/null | head -20' }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "pnpm test" }, workspacePath: "C:/repo" })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git clean -fd" }, workspacePath: "C:/repo" })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "mkdir -p src" }, workspacePath: "C:/repo" })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "cat README.md > out.txt" }, workspacePath: "C:/repo" })).toBe(false);
    });
});
