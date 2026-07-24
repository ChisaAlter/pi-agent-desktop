import { describe, expect, it } from "vitest";
import {
    SYSTEM_SUBAGENTS,
    agentRegistry,
    buildAgentModePrompt,
    goalSlashCommands,
    isPlanModeToolAllowed,
    normalizeAgentMode,
} from "../agent-modes";
import { PLAN_DIRECTIVE } from "../agent-modes/plan-prompt";
import { BUILD_SWITCH } from "../agent-modes/directives";

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

    it("leaves build prompts unchanged when not transitioning from plan", () => {
        expect(buildAgentModePrompt("build", "hello")).toBe("hello");
    });

    it("injects BUILD_SWITCH on plan→build transition", () => {
        const outbound = buildAgentModePrompt("build", "implement now", {
            previousMode: "plan",
            longHorizonEnabled: true,
        });
        expect(outbound).toContain("operational mode has changed from plan to build");
        expect(outbound).toContain("no longer in read-only mode");
        expect(outbound).toContain("Plan mode constraints are lifted");
        expect(outbound).toContain("implement now");
        expect(outbound.endsWith("implement now")).toBe(true);
    });

    it("does not inject BUILD_SWITCH when long horizon is disabled", () => {
        expect(buildAgentModePrompt("build", "implement", {
            previousMode: "plan",
            longHorizonEnabled: false,
        })).toBe("implement");
    });

    it("does not inject BUILD_SWITCH when previous mode was already build", () => {
        expect(buildAgentModePrompt("build", "continue", {
            previousMode: "build",
        })).toBe("continue");
    });

    it("does not inject mode prompts when long horizon is disabled", () => {
        expect(buildAgentModePrompt("plan", "hello", { longHorizonEnabled: false })).toBe("hello");
        expect(buildAgentModePrompt("compose", "hello", { longHorizonEnabled: false })).toBe("hello");
    });

    it("leaves compose prompts untouched when workflow runtime is not enabled", () => {
        expect(buildAgentModePrompt("compose", "全面审查代码")).toBe("全面审查代码");
    });

    it("prepends plan directive when plan mode is enabled (default options)", () => {
        const outbound = buildAgentModePrompt("plan", "改输入区", {
            planModeEnabled: true,
            longHorizonEnabled: true,
        });
        expect(outbound).toContain("Plan mode is active");
        expect(outbound).toContain("You are read-only");
        expect(outbound.startsWith(PLAN_DIRECTIVE)).toBe(true);
        expect(outbound.endsWith("改输入区")).toBe(true);
        expect(outbound).toBe([PLAN_DIRECTIVE, "", "改输入区"].join("\n"));
    });

    it("prepends plan directive when planModeEnabled and longHorizonEnabled are undefined (default-enabled behavior)", () => {
        const outbound = buildAgentModePrompt("plan", "hello world", {});
        expect(outbound).toContain("Plan mode is active");
        expect(outbound).toContain("Output plans ONLY to `.pi/plans/");
        expect(outbound.endsWith("hello world")).toBe(true);
    });

    it("returns content unchanged when plan mode is explicitly disabled", () => {
        expect(buildAgentModePrompt("plan", "改输入区", {
            planModeEnabled: false,
            longHorizonEnabled: true,
        })).toBe("改输入区");
    });

    it("returns content unchanged for plan mode when long horizon is disabled", () => {
        expect(buildAgentModePrompt("plan", "改输入区", {
            planModeEnabled: true,
            longHorizonEnabled: false,
        })).toBe("改输入区");
    });

    it("returns content unchanged for build mode regardless of options (backward compat)", () => {
        expect(buildAgentModePrompt("build", "hello")).toBe("hello");
        expect(buildAgentModePrompt("build", "hello", {
            planModeEnabled: true,
            longHorizonEnabled: true,
        })).toBe("hello");
        expect(buildAgentModePrompt("build", "hello", {
            planModeEnabled: false,
            longHorizonEnabled: false,
        })).toBe("hello");
    });

    it("injects workflow-tool instructions for compose mode when workflow runtime is enabled", () => {
        const outbound = buildAgentModePrompt("compose", "全面审查代码", {
            longHorizonEnabled: true,
            composeModeEnabled: true,
            workflowEnabled: true,
            composeWorkflowEnabled: true,
        });

        expect(outbound).toContain("Compose workflow runtime is enabled.");
        expect(outbound).toContain("call the `workflow` tool");
        expect(outbound).toContain("Compose mode alone is not a reason to start a workflow.");
        expect(outbound).toContain("simple questions, explanations, web research, or read-only exploration");
        expect(outbound).toContain("single small edit");
        expect(outbound).toContain("multiple dependent implementation steps");
        expect(outbound).toContain("全面审查代码");
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
        expect(isPlanModeToolAllowed({ toolName: "plan_write", args: { filename: "create-plan-probe" }, workspacePath: "C:/repo" })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "plan_write", args: { filename: ".pi/plans/chat-input.md" }, workspacePath: "C:/repo" })).toBe(true);
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

    // wave-133 residual
    it("forces build when long horizon is disabled regardless of requested mode", () => {
        expect(normalizeAgentMode("plan", { longHorizonEnabled: false })).toBe("build");
        expect(normalizeAgentMode("compose", { longHorizonEnabled: false })).toBe("build");
        expect(normalizeAgentMode(null, { longHorizonEnabled: false })).toBe("build");
        expect(normalizeAgentMode(123, {})).toBe("build");
    });

    it("returns only primary build agent when long horizon is off", () => {
        expect(agentRegistry({ longHorizonEnabled: false }).map((a) => a.id)).toEqual(["build"]);
        const noPlanCompose = agentRegistry({
            longHorizonEnabled: true,
            planModeEnabled: false,
            composeModeEnabled: false,
        }).map((a) => a.id);
        expect(noPlanCompose[0]).toBe("build");
        expect(noPlanCompose).not.toContain("plan");
        expect(noPlanCompose).not.toContain("compose");
        expect(noPlanCompose).toEqual(expect.arrayContaining(["checkpoint-writer", "dream", "distill"]));
    });

    it("trims outbound content and leaves compose plain when only one workflow flag is set", () => {
        expect(buildAgentModePrompt("build", "  hi  ")).toBe("hi");
        expect(
            buildAgentModePrompt("compose", " task ", {
                longHorizonEnabled: true,
                workflowEnabled: true,
                composeWorkflowEnabled: false,
            }),
        ).toBe("task");
        expect(
            buildAgentModePrompt("compose", " task ", {
                longHorizonEnabled: true,
                workflowEnabled: false,
                composeWorkflowEnabled: true,
            }),
        ).toBe("task");
    });

    it("rejects empty-path writes, empty bash, and mutating tools; plan_write notes.md ok", () => {
        expect(isPlanModeToolAllowed({ toolName: "write", args: { content: "x" }, workspacePath: "C:/repo" })).toBe(
            false,
        );
        expect(isPlanModeToolAllowed({ toolName: "write", args: { path: "" }, workspacePath: "C:/repo" })).toBe(false);
        // empty command short-circuits to not read-only
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "   " }, workspacePath: "C:/repo" })).toBe(
            false,
        );
        expect(isPlanModeToolAllowed({ toolName: "Browser", args: { url: "https://x" }, workspacePath: "C:/repo" })).toBe(
            false,
        );
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "notes.md" },
                workspacePath: "C:/repo",
            }),
        ).toBe(true);
    });

    // wave-150 residual
    it("goalSlashCommands exposes goal entry as a shallow clone", () => {
        const cmds = goalSlashCommands();
        const names = cmds.map((c) => c.name);
        expect(names).toContain("goal");
        expect(cmds.length).toBeGreaterThanOrEqual(1);
        const a = goalSlashCommands();
        const b = goalSlashCommands();
        expect(a).not.toBe(b);
        expect(a[0]).not.toBe(b[0]);
        expect(a.map((c) => c.name)).toEqual(b.map((c) => c.name));
        for (const c of cmds) {
            expect(c.name.length).toBeGreaterThan(0);
        }
    });

    it("normalizeAgentMode treats empty string and boolean as build", () => {
        expect(normalizeAgentMode("")).toBe("build");
        expect(normalizeAgentMode(true)).toBe("build");
        expect(normalizeAgentMode({ mode: "plan" })).toBe("build");
        expect(normalizeAgentMode("PLAN")).toBe("build");
        expect(normalizeAgentMode("plan", { planModeEnabled: true })).toBe("plan");
    });

    it("buildAgentModePrompt plan prepends directive only when planMode enabled", () => {
        expect(buildAgentModePrompt("plan", "x", { planModeEnabled: false })).toBe("x");
        const on = buildAgentModePrompt("plan", "x", { planModeEnabled: true, longHorizonEnabled: true });
        expect(on.startsWith(PLAN_DIRECTIVE) || on.includes("Plan mode is active")).toBe(true);
        expect(on.endsWith("x")).toBe(true);
    });

    it("agentRegistry always keeps system subagents even when plan/compose off", () => {
        const ids = agentRegistry({
            longHorizonEnabled: true,
            planModeEnabled: false,
            composeModeEnabled: false,
        }).map((a) => a.id);
        expect(ids).toContain("build");
        expect(ids).toContain("checkpoint-writer");
        expect(ids).toContain("dream");
        expect(ids).toContain("distill");
        expect(ids).not.toContain("plan");
        expect(ids).not.toContain("compose");
    });

    // wave-171 residual
    it("isPlanModeToolAllowed shell/git/mkdir edges and case-insensitive tool names", () => {
        const ws = "C:/repo";
        // tool name case folded
        expect(isPlanModeToolAllowed({ toolName: "READ", args: { file_path: "x" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "Shell", args: { command: "ls" }, workspacePath: ws })).toBe(true);
        // cmd/script aliases
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { cmd: "rg foo" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { script: "cat a" }, workspacePath: ws })).toBe(true);
        // git worktree list ok; worktree add blocked
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git worktree list" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git worktree add ../x" }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git" }, workspacePath: ws })).toBe(false);
        // redirect to /dev/null stripped then allowed; real redirects still blocked
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls 2>/dev/null" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls > out.txt" }, workspacePath: ws })).toBe(false);
        // pipeline mixed: read-only segments only
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls | sort | head" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls | rm -rf /" }, workspacePath: ws })).toBe(false);
        // mkdir only .pi/plans
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "mkdir --parents .pi/plans" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "mkdir -p .pi/plans src" }, workspacePath: ws })).toBe(false);
        // unknown / high-risk tools
        expect(isPlanModeToolAllowed({ toolName: "network", args: {}, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "apply_patch", args: { path: "src/a.ts" }, workspacePath: ws })).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "apply_patch",
                args: { path: ".pi/plans/x.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        // escape outside plans via absolute path
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { file_path: "C:/other/.pi/plans/x.md" },
                workspacePath: ws,
            }),
        ).toBe(false);
    });

    // wave-188 residual
    it("BUILD_SWITCH only on plan→build; compose previous and plan→plan do not inject", () => {
        expect(
            buildAgentModePrompt("build", "go", {
                previousMode: "compose",
                longHorizonEnabled: true,
            }),
        ).toBe("go");
        expect(
            buildAgentModePrompt("plan", "stay", {
                previousMode: "plan",
                planModeEnabled: true,
                longHorizonEnabled: true,
            }),
        ).toContain("Plan mode is active");
        expect(
            buildAgentModePrompt("plan", "stay", {
                previousMode: "plan",
                planModeEnabled: true,
                longHorizonEnabled: true,
            }),
        ).not.toContain("operational mode has changed");
    });

    it("trims outbound content for plan/build and rejects empty shell command in plan mode", () => {
        const plan = buildAgentModePrompt("plan", "  hello  ", { planModeEnabled: true });
        expect(plan.endsWith("hello")).toBe(true);
        expect(plan).not.toContain("  hello  ");
        expect(buildAgentModePrompt("build", "  x  ")).toBe("x");
        const ws = "C:/repo";
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "" }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "   " }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: {}, workspacePath: ws })).toBe(false);
    });

    // wave-197 residual
    it("compose prompt needs both workflow flags; single flag leaves content plain", () => {
        expect(
            buildAgentModePrompt("compose", "task", {
                workflowEnabled: true,
                composeWorkflowEnabled: false,
            }),
        ).toBe("task");
        expect(
            buildAgentModePrompt("compose", "task", {
                workflowEnabled: false,
                composeWorkflowEnabled: true,
            }),
        ).toBe("task");
        const both = buildAgentModePrompt("compose", "task", {
            workflowEnabled: true,
            composeWorkflowEnabled: true,
        });
        expect(both).toContain("Compose workflow runtime is enabled.");
        expect(both.endsWith("task")).toBe(true);
    });

    it("plan→build injects BUILD_SWITCH; plan-mode allows read tools and git status", () => {
        const switched = buildAgentModePrompt("build", "go", { previousMode: "plan" });
        expect(switched).toContain("operational mode has changed");
        expect(switched).toContain("go");
        const ws = "C:/repo";
        expect(isPlanModeToolAllowed({ toolName: "read", args: {}, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "grep", args: {}, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git status" }, workspacePath: ws })).toBe(true);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "git commit -m x" }, workspacePath: ws })).toBe(false);
    });

    // wave-202 residual
    it("plan-mode rejects shell metacharacters even when segments look read-only", () => {
        const ws = "C:/repo";
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls && pwd" }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls || true" }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls; pwd" }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "echo $(pwd)" }, workspacePath: ws })).toBe(false);
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls `pwd`" }, workspacePath: ws })).toBe(false);
        // still allows pure pipelines of read-only commands
        expect(isPlanModeToolAllowed({ toolName: "bash", args: { command: "ls | sort" }, workspacePath: ws })).toBe(true);
    });

    it("write tools honor filePath/relativePath aliases; plan_write bare name resolves under .pi/plans", () => {
        const ws = "C:/repo";
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { filePath: ".pi/plans/ok.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "edit",
                args: { relativePath: ".pi/plans/ok.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { relative_path: "src/app.ts" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "wave-202" },
                workspacePath: ws,
            }),
        ).toBe(true);
        // bare nested name is rewritten under .pi/plans/ and still matches plan md path
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "nested/dir.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        // empty filename cannot resolve a plan path
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "" },
                workspacePath: ws,
            }),
        ).toBe(false);
    });

    it("agentRegistry defaults include plan+compose+subagents; goalSlashCommands clones requiresArgument", () => {
        const ids = agentRegistry({}).map((a) => a.id);
        expect(ids).toEqual([
            "build",
            "plan",
            "compose",
            "checkpoint-writer",
            "dream",
            "distill",
        ]);
        const goal = goalSlashCommands().find((c) => c.name === "goal");
        expect(goal?.requiresArgument).toBe(true);
        expect(goal?.source).toBe("builtin");
        expect(normalizeAgentMode("compose", { composeModeEnabled: true })).toBe("compose");
        expect(normalizeAgentMode("plan", { planModeEnabled: false, composeModeEnabled: true })).toBe("build");
    });

    // wave-207 residual
    it("normalizeAgentMode rejects unknown/empty and longHorizon-off forces build", () => {
        expect(normalizeAgentMode(undefined)).toBe("build");
        expect(normalizeAgentMode(null)).toBe("build");
        expect(normalizeAgentMode("")).toBe("build");
        expect(normalizeAgentMode("BUILD")).toBe("build");
        expect(normalizeAgentMode("unknown")).toBe("build");
        expect(normalizeAgentMode("plan", { longHorizonEnabled: false, planModeEnabled: true })).toBe("build");
        expect(normalizeAgentMode("compose", { longHorizonEnabled: false, composeModeEnabled: true })).toBe("build");
        expect(normalizeAgentMode("compose", { composeModeEnabled: false })).toBe("build");
    });

    it("agentRegistry longHorizon off returns only build; goalSlashCommands returns fresh clones", () => {
        expect(agentRegistry({ longHorizonEnabled: false }).map((a) => a.id)).toEqual(["build"]);
        const a = goalSlashCommands();
        const b = goalSlashCommands();
        expect(a).not.toBe(b);
        expect(a[0]).not.toBe(b[0]);
        a[0]!.name = "mutated";
        expect(b[0]!.name).not.toBe("mutated");
    });

    it("buildAgentModePrompt plan→build switch wins over empty trimmed body", () => {
        const outbound = buildAgentModePrompt("build", "   ", { previousMode: "plan" });
        expect(outbound).toContain("Plan mode constraints are lifted");
        expect(outbound.trim().endsWith("")).toBe(true);
        // plain build with whitespace collapses to empty content
        expect(buildAgentModePrompt("build", "   ")).toBe("");
        // compose without both workflow flags stays plain trimmed text
        expect(
            buildAgentModePrompt("compose", "  only text  ", {
                workflowEnabled: true,
                composeWorkflowEnabled: false,
            }),
        ).toBe("only text");
    });


    // wave-214 residual
    it("isPlanModeToolAllowed honors file_write/file_edit under plans and blocks escapes", () => {
        const ws = "C:/repo";
        expect(
            isPlanModeToolAllowed({
                toolName: "file_write",
                args: { file_path: ".pi/plans/step.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "file_edit",
                args: { path: "C:/repo/.pi/plans/step.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { file_path: ".pi/plans/../secrets.md" },
                workspacePath: ws,
            }),
        ).toBe(false);
        // product regex: `.pi/plans/` + non-empty relative + `.md` — nested segments allowed
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { file_path: ".pi/plans/nested/dir.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { file_path: ".pi/plans/.md" },
                workspacePath: ws,
            }),
        ).toBe(false); // `[^/].*` requires a non-empty segment after slash
        expect(
            isPlanModeToolAllowed({
                toolName: "fetch",
                args: { url: "https://x" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "web",
                args: {},
                workspacePath: ws,
            }),
        ).toBe(false);
    });

    it("isPlanModeToolAllowed read-only shell rejects subshell/backtick and allows whoami/dir", () => {
        const ws = "C:/repo";
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "whoami" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "dir" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "echo $(whoami)" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "echo `date`" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "ls && cat a" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "git log --oneline" },
                workspacePath: ws,
            }),
        ).toBe(true);
    });

    it("buildAgentModePrompt compose workflow only when both flags true", () => {
        const full = buildAgentModePrompt("compose", "ship multi step", {
            workflowEnabled: true,
            composeWorkflowEnabled: true,
        });
        expect(full).toContain("Compose workflow runtime is enabled");
        expect(full).toContain('operation="run"');
        expect(full.endsWith("ship multi step")).toBe(true);
        expect(
            buildAgentModePrompt("compose", "ship multi step", {
                workflowEnabled: false,
                composeWorkflowEnabled: true,
            }),
        ).toBe("ship multi step");
    });


    // wave-221 residual
    it("goalSlashCommands clones builtin goal entry without sharing reference", () => {
        const a = goalSlashCommands();
        const b = goalSlashCommands();
        expect(a).toHaveLength(1);
        expect(a[0].name).toBe("goal");
        expect(a[0].source).toBe("builtin");
        expect(a[0].requiresArgument).toBe(true);
        expect(a[0]).not.toBe(b[0]);
        a[0].description = "mutated";
        expect(b[0].description).not.toBe("mutated");
    });

    it("agentRegistry drops plan/compose when longHorizon disabled; keeps only build", () => {
        expect(agentRegistry({ longHorizonEnabled: false }).map((a) => a.id)).toEqual(["build"]);
        expect(
            agentRegistry({ longHorizonEnabled: true, planModeEnabled: false, composeModeEnabled: false }).map(
                (a) => a.id,
            ),
        ).toEqual(["build", "checkpoint-writer", "dream", "distill"]);
    });

    it("plan mode allows plan_write under .pi/plans and mkdir -p .pi/plans only", () => {
        const ws = "C:/ws";
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "feature.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "nested/idea" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { path: "src/app.ts" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "mkdir -p .pi/plans" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "mkdir -p src/out" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "git status" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "git commit -m x" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "network",
                args: {},
                workspacePath: ws,
            }),
        ).toBe(false);
    });

    it("buildAgentModePrompt trims text and skips BUILD_SWITCH when previousMode is compose", () => {
        expect(buildAgentModePrompt("build", "  spaced  ", { previousMode: "compose" })).toBe("spaced");
        expect(buildAgentModePrompt("plan", "  plan me  ")).toContain(PLAN_DIRECTIVE);
        expect(buildAgentModePrompt("plan", "  plan me  ").endsWith("plan me")).toBe(true);
    });

    // wave-251 residual
    it("normalizeAgentMode maps disabled modes to build; unknown values become build", () => {
        expect(normalizeAgentMode("plan", { planModeEnabled: false })).toBe("build");
        expect(normalizeAgentMode("compose", { composeModeEnabled: false })).toBe("build");
        expect(normalizeAgentMode("plan", { longHorizonEnabled: false })).toBe("build");
        expect(normalizeAgentMode("nope" as never)).toBe("build");
        expect(normalizeAgentMode(null)).toBe("build");
        expect(normalizeAgentMode("plan")).toBe("plan");
        expect(normalizeAgentMode("compose")).toBe("compose");
    });

    it("buildAgentModePrompt plan→build injects BUILD_SWITCH; longHorizon off returns trimmed only", () => {
        const switched = buildAgentModePrompt("build", "  execute plan  ", { previousMode: "plan" });
        expect(switched).toContain(BUILD_SWITCH);
        expect(switched).toContain("Plan mode constraints are lifted");
        expect(switched.endsWith("execute plan")).toBe(true);
        expect(buildAgentModePrompt("plan", "  x  ", { longHorizonEnabled: false })).toBe("x");
        expect(buildAgentModePrompt("plan", "  x  ", { planModeEnabled: false })).toBe("x");
        expect(buildAgentModePrompt("compose", "  c  ", {
            workflowEnabled: true,
            composeWorkflowEnabled: true,
        })).toContain("Compose workflow runtime is enabled");
    });

    // wave-264 residual
    it("agentRegistry drops plan/compose when flags off; SYSTEM_SUBAGENTS non-empty", () => {
        expect(SYSTEM_SUBAGENTS.length).toBeGreaterThan(0);
        const all = agentRegistry({});
        expect(all.map((a) => a.id)).toEqual(expect.arrayContaining(["build"]));
        const noPlan = agentRegistry({ planModeEnabled: false });
        expect(noPlan.map((a) => a.id)).not.toContain("plan");
        const noCompose = agentRegistry({ composeModeEnabled: false });
        expect(noCompose.map((a) => a.id)).not.toContain("compose");
    });

    it("goalSlashCommands returns stable goal commands; isPlanModeToolAllowed read-only ok", () => {
        const cmds = goalSlashCommands();
        expect(cmds.length).toBeGreaterThan(0);
        expect(cmds.every((c) => typeof c.name === "string" && c.name.length > 0)).toBe(true);
        const ws = "C:\\ws";
        expect(
            isPlanModeToolAllowed({
                toolName: "read",
                args: { path: "a.ts" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { path: "a.ts", content: "x" },
                workspacePath: ws,
            }),
        ).toBe(false);
    });


    // wave-275 residual
    it("SYSTEM_SUBAGENTS are subagent role; primary registry ids are build/plan/compose when flags on", () => {
        for (const entry of SYSTEM_SUBAGENTS) {
            expect(entry.role).toBe("subagent");
            expect(entry.mode).toBe("build");
            expect(entry.id.length).toBeGreaterThan(0);
        }
        const reg = agentRegistry({
            planModeEnabled: true,
            composeModeEnabled: true,
            longHorizonEnabled: true,
        });
        const primaryIds = reg.filter((a) => a.role === "primary").map((a) => a.id);
        expect(primaryIds).toEqual(expect.arrayContaining(["build", "plan", "compose"]));
        // subagents always included
        expect(reg.map((a) => a.id)).toEqual(
            expect.arrayContaining(["checkpoint-writer", "dream", "distill"]),
        );
    });

    it("isPlanModeToolAllowed allows read-only shell commands and denies write tools", () => {
        const ws = "C:\\workspace";
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "ls -la" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "pwd" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "edit",
                args: { path: "a.ts", old_string: "a", new_string: "b" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "apply_patch",
                args: {},
                workspacePath: ws,
            }),
        ).toBe(false);
    });

    // wave-286 residual
    it("longHorizon off collapses registry to build and normalize to build", () => {
        expect(agentRegistry({ longHorizonEnabled: false }).map((a) => a.id)).toEqual(["build"]);
        expect(normalizeAgentMode("plan", { longHorizonEnabled: false })).toBe("build");
        expect(normalizeAgentMode("compose", { longHorizonEnabled: false })).toBe("build");
        expect(buildAgentModePrompt("plan", "  hi  ", { longHorizonEnabled: false })).toBe("hi");
    });

    it("buildAgentModePrompt injects BUILD_SWITCH only on plan→build; plan gets directive", () => {
        const switched = buildAgentModePrompt("build", "do it", { previousMode: "plan" });
        expect(switched).toContain(BUILD_SWITCH);
        expect(switched).toContain("do it");
        expect(switched).toMatch(/Plan mode constraints are lifted/i);
        const plan = buildAgentModePrompt("plan", "think", { planModeEnabled: true });
        expect(plan).toContain(PLAN_DIRECTIVE);
        expect(plan).toContain("think");
        expect(buildAgentModePrompt("build", "plain", { previousMode: "build" })).toBe("plain");
    });





    // wave-311 residual
    it("isPlanModeToolAllowed plan_write and write only under .pi/plans md", () => {
        const ws = "C:/repo/ws-311";
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: "plan-a" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "plan_write",
                args: { filename: ".pi/plans/nested.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { path: ".pi/plans/ok.md", content: "x" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "write",
                args: { path: "src/a.ts", content: "x" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "apply_patch",
                args: { path: ".pi/plans/x.md" },
                workspacePath: ws,
            }),
        ).toBe(true);
    });

    it("isPlanModeToolAllowed mkdir only .pi/plans; git worktree list only; blocks and and mutating tools", () => {
        const ws = "C:/repo/ws-311b";
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "mkdir -p .pi/plans" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "mkdir src" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "git worktree list" },
                workspacePath: ws,
            }),
        ).toBe(true);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "git worktree add ../x" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "bash",
                args: { command: "ls && rm -rf x" },
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "network",
                args: {},
                workspacePath: ws,
            }),
        ).toBe(false);
        expect(
            isPlanModeToolAllowed({
                toolName: "READ",
                args: { path: "a.ts" },
                workspacePath: ws,
            }),
        ).toBe(true);
    });

    it("normalizeAgentMode exact enum only; agentRegistry toggles plan/compose independently", () => {
        expect(normalizeAgentMode("PLAN")).toBe("build");
        expect(normalizeAgentMode("Compose")).toBe("build");
        expect(normalizeAgentMode("plan")).toBe("plan");
        expect(normalizeAgentMode("compose")).toBe("compose");
        const noPlan = agentRegistry({ planModeEnabled: false, composeModeEnabled: true }).map((a) => a.id);
        expect(noPlan).toContain("compose");
        expect(noPlan).not.toContain("plan");
        expect(noPlan).toContain("build");
        const noCompose = agentRegistry({ planModeEnabled: true, composeModeEnabled: false }).map((a) => a.id);
        expect(noCompose).toContain("plan");
        expect(noCompose).not.toContain("compose");
    });
});
