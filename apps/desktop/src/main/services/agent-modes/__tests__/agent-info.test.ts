/**
 * Tests for AgentInfo + runtimePermission + getAgentInfo.
 *
 * Verifies the 4-layer permission model works as ported from MiMo Code:
 *  - Layer 1 (toolAllowlist) is not set for primary agents (all tools visible)
 *  - Layer 2 (permission): defaults + agent-specific merges correctly
 *  - Layer 3 (hardPermission): plan mode's edit:*:deny cannot be relaxed
 *  - Layer 4 (interactive): primary agents are interactive (default true)
 *
 * Plan mode invariant: writes to non-plan paths are blocked, writes to
 * .pi/plans/*.md and userData/plans/*.md are allowed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron's `app` — must be hoisted before any import that touches it.
const MOCK_USER_DATA = "C:/Users/test/AppData/Roaming/Pi-Desktop-test";

vi.mock("electron", () => ({
    app: {
        getPath: vi.fn((name: string) => {
            if (name === "userData") return MOCK_USER_DATA;
            if (name === "temp") return "C:/Users/test/AppData/Local/Temp";
            return MOCK_USER_DATA;
        }),
        isReady: vi.fn(() => true),
    },
}));

import { getAgentInfo, listEnabledAgents, runtimePermission, type AgentInfo } from "../agent-info";
import { evaluate } from "../../permission/evaluate";

describe("AgentInfo — primary modes", () => {
    describe("getAgentInfo", () => {
        it("returns build agent by default", () => {
            const agent = getAgentInfo("build");
            expect(agent).not.toBeNull();
            expect(agent!.name).toBe("build");
            expect(agent!.mode).toBe("primary");
            expect(agent!.interactive).toBe(true);
            expect(agent!.hardPermission).toBeUndefined();
        });

        it("returns plan agent with edit hardPermission when enabled", () => {
            const agent = getAgentInfo("plan", { planModeEnabled: true });
            expect(agent).not.toBeNull();
            expect(agent!.name).toBe("plan");
            expect(agent!.hardPermission).toBeDefined();
            expect(agent!.hardPermission!.length).toBeGreaterThan(0);
        });

        it("returns compose agent without hardPermission when enabled", () => {
            const agent = getAgentInfo("compose", { composeModeEnabled: true });
            expect(agent).not.toBeNull();
            expect(agent!.name).toBe("compose");
            expect(agent!.hardPermission).toBeUndefined();
        });

        it("returns null for plan when planModeEnabled is false", () => {
            expect(getAgentInfo("plan", { planModeEnabled: false })).toBeNull();
        });

        it("returns null for compose when composeModeEnabled is false", () => {
            expect(getAgentInfo("compose", { composeModeEnabled: false })).toBeNull();
        });

        it("returns null for plan/compose when longHorizon is disabled", () => {
            expect(getAgentInfo("plan", { longHorizonEnabled: false, planModeEnabled: true })).toBeNull();
            expect(getAgentInfo("compose", { longHorizonEnabled: false, composeModeEnabled: true })).toBeNull();
        });

        it("still returns build when longHorizon is disabled", () => {
            const agent = getAgentInfo("build", { longHorizonEnabled: false });
            expect(agent).not.toBeNull();
            expect(agent!.name).toBe("build");
        });
    });

    describe("listEnabledAgents", () => {
        it("lists all three agents when long horizon + all modes enabled", () => {
            const list = listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: true,
                composeModeEnabled: true,
            });
            expect(list.map((a) => a.name)).toEqual(["build", "plan", "compose"]);
        });

        it("lists only build when long horizon disabled", () => {
            const list = listEnabledAgents({ longHorizonEnabled: false });
            expect(list.map((a) => a.name)).toEqual(["build"]);
        });

        it("omits plan when planModeEnabled is false", () => {
            const list = listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: false,
                composeModeEnabled: true,
            });
            expect(list.map((a) => a.name)).toEqual(["build", "compose"]);
        });

        // wave-138 residual
        it("omits compose when composeModeEnabled is false", () => {
            const list = listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: true,
                composeModeEnabled: false,
            });
            expect(list.map((a) => a.name)).toEqual(["build", "plan"]);
        });

        it("defaults to all three agents when options are empty", () => {
            expect(listEnabledAgents().map((a) => a.name)).toEqual(["build", "plan", "compose"]);
        });
    });

    // wave-138 residual
    describe("getAgentInfo residual mode gates", () => {
        it("returns null for unknown mode string", () => {
            expect(getAgentInfo("chat" as never)).toBeNull();
        });

        it("plan mode null only when planModeEnabled is strictly false", () => {
            expect(getAgentInfo("plan", { planModeEnabled: undefined })).not.toBeNull();
            expect(getAgentInfo("plan", { planModeEnabled: false })).toBeNull();
        });

        it("compose mode null only when composeModeEnabled is strictly false", () => {
            expect(getAgentInfo("compose", { composeModeEnabled: undefined })).not.toBeNull();
            expect(getAgentInfo("compose", { composeModeEnabled: false })).toBeNull();
        });
    });
});

describe("runtimePermission — 3-way merge", () => {
    it("returns just agent.permission when no session rules provided", () => {
        const agent = getAgentInfo("build")!;
        const result = runtimePermission(agent);
        // Same length as agent.permission (no session, no hardPermission)
        expect(result.length).toBe(agent.permission.length);
    });

    it("appends session rules after agent.permission", () => {
        const agent = getAgentInfo("build")!;
        const sessionRules = [
            { permission: "edit", pattern: "*", action: "ask" as const },
        ];
        const result = runtimePermission(agent, sessionRules);
        // Session rule appended — last rule wins via findLast
        expect(result.length).toBe(agent.permission.length + sessionRules.length);
        // The last rule is the session rule
        const last = result[result.length - 1];
        expect(last.permission).toBe("edit");
        expect(last.action).toBe("ask");
    });

    it("appends hardPermission LAST so it wins over session approvals", () => {
        const agent = getAgentInfo("plan", { planModeEnabled: true })!;
        expect(agent.hardPermission).toBeDefined();

        // User "always" approved edit on src/foo.ts
        const sessionApproval = [
            { permission: "edit", pattern: "src/foo.ts", action: "allow" as const },
        ];
        const result = runtimePermission(agent, sessionApproval);

        // Evaluate: the hardPermission's `edit:*:deny` must out-rank the
        // session's `edit:src/foo.ts:allow` because hardPermission comes later.
        const action = evaluate("edit", "src/foo.ts", result).action;
        expect(action).toBe("deny");
    });
});

describe("plan mode — hardPermission invariant", () => {
    let planAgent: AgentInfo;

    beforeEach(() => {
        const a = getAgentInfo("plan", { planModeEnabled: true }, "C:/projects/myrepo");
        expect(a).not.toBeNull();
        planAgent = a!;
    });

    it("blocks edit on src/foo.ts (non-plan path)", () => {
        const rules = runtimePermission(planAgent, []);
        expect(evaluate("edit", "src/foo.ts", rules).action).toBe("deny");
    });

    it("blocks edit on absolute non-plan path", () => {
        const rules = runtimePermission(planAgent, []);
        expect(evaluate("edit", "C:/projects/myrepo/src/app.ts", rules).action).toBe("deny");
    });

    it("allows edit on relative .pi/plans/foo.md", () => {
        const rules = runtimePermission(planAgent, []);
        expect(evaluate("edit", ".pi/plans/foo.md", rules).action).toBe("allow");
    });

    it("allows edit on absolute userData/plans/foo.md", () => {
        const rules = runtimePermission(planAgent, []);
        expect(evaluate("edit", `${MOCK_USER_DATA}/plans/foo.md`, rules).action).toBe("allow");
    });

    it("cannot be relaxed by session approval on src/foo.ts", () => {
        // Even if user clicks "always allow edit on src/foo.ts", hardPermission
        // (appended AFTER session) wins via findLast.
        const sessionApproval = [
            { permission: "edit", pattern: "src/foo.ts", action: "allow" as const },
        ];
        const rules = runtimePermission(planAgent, sessionApproval);
        expect(evaluate("edit", "src/foo.ts", rules).action).toBe("deny");
    });

    it("still allows .pi/plans write even with session approval active", () => {
        const sessionApproval = [
            { permission: "edit", pattern: "src/foo.ts", action: "allow" as const },
        ];
        const rules = runtimePermission(planAgent, sessionApproval);
        expect(evaluate("edit", ".pi/plans/bar.md", rules).action).toBe("allow");
    });

    it("blocks bash high-risk pattern? no — bash is not in hardPermission (left to model discipline)", () => {
        // Plan mode's hardPermission deliberately scopes to `edit` only.
        // bash/change_directory/workflow are left to the model + prompt.
        const rules = runtimePermission(planAgent, []);
        // bash is governed by defaults (*:allow), not blocked by hardPermission
        // The actual runtime decision depends on the bash command's risk
        // classification (handled by classifier.ts), not the ruleset here.
        const bashRule = rules.find((r) => r.permission === "bash" && r.pattern === "*");
        // No explicit bash deny in plan mode's hardPermission
        expect(planAgent.hardPermission!.find((r) => r.permission === "bash")).toBeUndefined();
    });
});

describe("build mode — no hardPermission", () => {
    it("has no hardPermission", () => {
        const agent = getAgentInfo("build")!;
        expect(agent.hardPermission).toBeUndefined();
    });

    it("session approval can relax edit on src/foo.ts", () => {
        const agent = getAgentInfo("build")!;
        const sessionApproval = [
            { permission: "edit", pattern: "src/foo.ts", action: "allow" as const },
        ];
        const rules = runtimePermission(agent, sessionApproval);
        expect(evaluate("edit", "src/foo.ts", rules).action).toBe("allow");
    });

    it("question is allowed (primary agent override)", () => {
        const agent = getAgentInfo("build")!;
        const rules = runtimePermission(agent);
        expect(evaluate("question", "*", rules).action).toBe("allow");
    });
});

describe("compose mode — no hardPermission", () => {
    it("has no hardPermission", () => {
        const agent = getAgentInfo("compose", { composeModeEnabled: true })!;
        expect(agent.hardPermission).toBeUndefined();
    });

    it("question is allowed (primary agent override)", () => {
        const agent = getAgentInfo("compose", { composeModeEnabled: true })!;
        const rules = runtimePermission(agent);
        expect(evaluate("question", "*", rules).action).toBe("allow");
    });
});

describe("compose mode — worktree hardPermission (Task 11)", () => {
    // Compose worktree path under %TEMP%/pi-desktop-compose-worktrees/<repoSlug>-<repoHash>/wt-...
    // (matches the layout produced by extensions/compose-mode/git-worktree.ts)
    const composeWorktreePath = "C:/Users/test/AppData/Local/Temp/pi-desktop-compose-worktrees/myrepo-abc123def456/wt-run1234-tasklabel-X1Y2Z3";

    it("compose agent has hardPermission with worktree allow + external ask", () => {
        const agent = getAgentInfo(
            "compose",
            { composeModeEnabled: true },
            "C:/projects/myrepo",
            composeWorktreePath,
        );
        expect(agent).not.toBeNull();
        expect(agent!.hardPermission).toBeDefined();
        expect(agent!.hardPermission!.length).toBeGreaterThan(0);

        // Verify the ruleset contains external_directory rules: allow for
        // the worktree, ask for everything else.
        const externalRules = agent!.hardPermission!.filter((r) => r.permission === "external_directory");
        expect(externalRules.length).toBeGreaterThanOrEqual(2); // worktree allow + * ask (allow appears twice: dir + dir/*)

        const allowRules = externalRules.filter((r) => r.action === "allow");
        expect(allowRules.length).toBe(2); // <worktree> + <worktree>/*
        // Patterns use forward slashes (composeAgent normalises)
        expect(allowRules.some((r) => r.pattern === composeWorktreePath)).toBe(true);
        expect(allowRules.some((r) => r.pattern === `${composeWorktreePath}/*`)).toBe(true);

        const askRule = externalRules.find((r) => r.pattern === "*");
        expect(askRule).toBeDefined();
        expect(askRule!.action).toBe("ask");
    });

    it("compose agent blocks writes outside worktree", () => {
        const agent = getAgentInfo(
            "compose",
            { composeModeEnabled: true },
            "C:/projects/myrepo",
            composeWorktreePath,
        )!;
        const rules = runtimePermission(agent, []);

        // A write to a path outside both the workspace AND the worktree must
        // evaluate to "ask" (the user is prompted — compose must not silently
        // touch files outside the worktree).
        const outsidePath = "C:/some/random/dir/foo.ts";
        const action = evaluate("external_directory", outsidePath, rules).action;
        expect(action).toBe("ask");
    });

    it("compose agent allows writes inside worktree", () => {
        const agent = getAgentInfo(
            "compose",
            { composeModeEnabled: true },
            "C:/projects/myrepo",
            composeWorktreePath,
        )!;
        const rules = runtimePermission(agent, []);

        // Writes inside the worktree (both the dir itself and subpaths)
        // must evaluate to "allow".
        expect(evaluate("external_directory", composeWorktreePath, rules).action).toBe("allow");
        expect(
            evaluate("external_directory", `${composeWorktreePath}/src/app.ts`, rules).action,
        ).toBe("allow");
        expect(
            evaluate("external_directory", `${composeWorktreePath}/.pi/plans/foo.md`, rules).action,
        ).toBe("allow");
    });

    it("hardPermission cannot be relaxed by session approval", () => {
        const agent = getAgentInfo(
            "compose",
            { composeModeEnabled: true },
            "C:/projects/myrepo",
            composeWorktreePath,
        )!;
        // Even if the session "always allows" an external write to some
        // random path, hardPermission (appended AFTER session) wins via
        // findLast → "ask" cannot be downgraded by session approvals.
        const sessionApproval = [
            { permission: "external_directory", pattern: "C:/some/random/dir/foo.ts", action: "allow" as const },
        ];
        const rules = runtimePermission(agent, sessionApproval);
        expect(
            evaluate("external_directory", "C:/some/random/dir/foo.ts", rules).action,
        ).toBe("ask");
    });

    it("omitting worktreePath falls back to no hardPermission (legacy behavior)", () => {
        const agent = getAgentInfo("compose", { composeModeEnabled: true })!;
        expect(agent.hardPermission).toBeUndefined();
    });

    it("backslash worktree path is normalised to forward slashes in ruleset patterns", () => {
        const winPath = "C:\\Users\\test\\AppData\\Local\\Temp\\pi-desktop-compose-worktrees\\myrepo-abc\\wt-x-y";
        const agent = getAgentInfo(
            "compose",
            { composeModeEnabled: true },
            "C:/projects/myrepo",
            winPath,
        )!;
        expect(agent.hardPermission).toBeDefined();
        // Patterns stored with forward slashes so wildcard matching works
        const expected = winPath.replaceAll("\\", "/");
        const allowRules = agent.hardPermission!.filter(
            (r) => r.permission === "external_directory" && r.action === "allow",
        );
        expect(allowRules.some((r) => r.pattern === expected)).toBe(true);
        expect(allowRules.some((r) => r.pattern === `${expected}/*`)).toBe(true);
    });
});

describe("defaults layer (applied to all primary agents)", () => {
    it("doom_loop is ask (prevent runaway tool loops)", () => {
        const agent = getAgentInfo("build")!;
        const rules = runtimePermission(agent);
        expect(evaluate("doom_loop", "*", rules).action).toBe("ask");
    });

    it("question is deny in defaults (subagents inherit deny; primary agents override to allow)", () => {
        const agent = getAgentInfo("build")!;
        const rules = runtimePermission(agent);
        // build mode overrides to allow
        expect(evaluate("question", "*", rules).action).toBe("allow");
    });

    it("read on *.env is ask (prompt before reading .env files)", () => {
        const agent = getAgentInfo("build")!;
        const rules = runtimePermission(agent);
        expect(evaluate("read", ".env", rules).action).toBe("ask");
        expect(evaluate("read", "config.env", rules).action).toBe("ask");
    });

    it("read on *.env.example is allow (template, not secret)", () => {
        const agent = getAgentInfo("build")!;
        const rules = runtimePermission(agent);
        expect(evaluate("read", ".env.example", rules).action).toBe("allow");
    });

    it("external_directory is ask by default (block writes outside project/userData)", () => {
        const agent = getAgentInfo("build")!;
        const rules = runtimePermission(agent);
        expect(evaluate("external_directory", "/random/path", rules).action).toBe("ask");
    });
});

// wave-149 residual
describe("agent-info residual (wave-149)", () => {
    it("runtimePermission treats missing hardPermission as empty tail", () => {
        const agent = getAgentInfo("build")!;
        expect(agent.hardPermission).toBeUndefined();
        const session = [{ permission: "bash", pattern: "echo *", action: "deny" as const }];
        const rules = runtimePermission(agent, session);
        expect(rules.length).toBe(agent.permission.length + session.length);
        expect(evaluate("bash", "echo hi", rules).action).toBe("deny");
        expect(evaluate("bash", "ls", rules).action).not.toBe("deny");
    });

    it("listEnabledAgents omits plan and compose when both modes disabled", () => {
        const list = listEnabledAgents({
            longHorizonEnabled: true,
            planModeEnabled: false,
            composeModeEnabled: false,
        });
        expect(list.map((a) => a.name)).toEqual(["build"]);
        expect(list[0]?.hardPermission).toBeUndefined();
        expect(list[0]?.interactive).toBe(true);
    });

    it("plan agent without workspacePath still allows .pi/plans and blocks other edits", () => {
        const agent = getAgentInfo("plan", { planModeEnabled: true });
        expect(agent).not.toBeNull();
        const rules = runtimePermission(agent!);
        expect(evaluate("edit", ".pi/plans/solo.md", rules).action).toBe("allow");
        expect(evaluate("edit", "src/index.ts", rules).action).toBe("deny");
        expect(evaluate("edit", `${MOCK_USER_DATA}/plans/global.md`, rules).action).toBe("allow");
    });

    it("compose from listEnabledAgents never ships worktree hardPermission", () => {
        const list = listEnabledAgents({ composeModeEnabled: true, planModeEnabled: true });
        const compose = list.find((a) => a.name === "compose");
        expect(compose).toBeDefined();
        expect(compose!.hardPermission).toBeUndefined();
        expect(compose!.interactive).toBe(true);
        expect(compose!.mode).toBe("primary");
    });

    it("primary agents expose no toolAllowlist so all tools remain schema-visible", () => {
        for (const mode of ["build", "plan", "compose"] as const) {
            const agent = getAgentInfo(mode, { planModeEnabled: true, composeModeEnabled: true });
            expect(agent).not.toBeNull();
            expect(agent!.toolAllowlist).toBeUndefined();
            expect(agent!.interactive).toBe(true);
        }
    });
});

// wave-167 residual
describe("agent-info residual (wave-167)", () => {
    it("longHorizon disabled returns only build agent and null for other modes", () => {
        expect(getAgentInfo("build", { longHorizonEnabled: false })?.name).toBe("build");
        expect(getAgentInfo("plan", { longHorizonEnabled: false, planModeEnabled: true })).toBeNull();
        expect(getAgentInfo("compose", { longHorizonEnabled: false, composeModeEnabled: true })).toBeNull();
        expect(
            listEnabledAgents({
                longHorizonEnabled: false,
                planModeEnabled: true,
                composeModeEnabled: true,
            }).map((a) => a.name),
        ).toEqual(["build"]);
    });

    it("getAgentInfo rejects unknown mode and planMode/composeMode gates", () => {
        expect(getAgentInfo("unknown" as never)).toBeNull();
        expect(getAgentInfo("plan", { planModeEnabled: false })).toBeNull();
        expect(getAgentInfo("compose", { composeModeEnabled: false })).toBeNull();
        expect(getAgentInfo("plan", { planModeEnabled: true })?.name).toBe("plan");
        expect(getAgentInfo("compose", { composeModeEnabled: true })?.name).toBe("compose");
    });

    it("runtimePermission hardPermission wins over session allow for plan edit deny", () => {
        const agent = getAgentInfo("plan", { planModeEnabled: true });
        expect(agent).not.toBeNull();
        const session = [
            { permission: "edit", pattern: "*", action: "allow" as const },
            { permission: "edit", pattern: "src/*", action: "allow" as const },
        ];
        const rules = runtimePermission(agent!, session);
        // hardPermission is last merge tail — src edits remain deny
        expect(evaluate("edit", "src/app.ts", rules).action).toBe("deny");
        expect(evaluate("edit", ".pi/plans/x.md", rules).action).toBe("allow");
        expect(evaluate("question", "*", rules).action).toBe("allow");
    });

    it("listEnabledAgents includes plan and compose when both enabled", () => {
        const list = listEnabledAgents({
            longHorizonEnabled: true,
            planModeEnabled: true,
            composeModeEnabled: true,
        });
        expect(list.map((a) => a.name).sort()).toEqual(["build", "compose", "plan"].sort());
        for (const agent of list) {
            expect(agent.mode).toBe("primary");
            expect(agent.interactive).toBe(true);
        }
    });

    // wave-242 residual
    it("listEnabledAgents longHorizon false returns build only; defaults treat plan/compose as on", () => {
        expect(listEnabledAgents({ longHorizonEnabled: false }).map((a) => a.name)).toEqual([
            "build",
        ]);
        // omitted plan/compose flags default to enabled when longHorizon on
        expect(listEnabledAgents({ longHorizonEnabled: true }).map((a) => a.name)).toEqual([
            "build",
            "plan",
            "compose",
        ]);
        expect(
            listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: false,
                composeModeEnabled: true,
            }).map((a) => a.name),
        ).toEqual(["build", "compose"]);
        expect(
            listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: true,
                composeModeEnabled: false,
            }).map((a) => a.name),
        ).toEqual(["build", "plan"]);
    });

    it("runtimePermission without hardPermission is agent.permission + session only", () => {
        const build = getAgentInfo("build");
        expect(build).not.toBeNull();
        expect(build!.hardPermission).toBeUndefined();
        const session = [{ permission: "bash", pattern: "*", action: "deny" as const }];
        const rules = runtimePermission(build!, session);
        // last-match: session deny for bash should win over defaults allow if present
        expect(evaluate("bash", "ls", rules).action).toBe("deny");
        // non-session tools still evaluated
        expect(evaluate("read", "README.md", rules).action).not.toBe("deny");
    });

    it("getAgentInfo build always available even when plan/compose disabled", () => {
        const build = getAgentInfo("build", {
            longHorizonEnabled: false,
            planModeEnabled: false,
            composeModeEnabled: false,
        });
        expect(build?.name).toBe("build");
        expect(getAgentInfo("plan", { longHorizonEnabled: false })).toBeNull();
        expect(getAgentInfo("compose", { longHorizonEnabled: false })).toBeNull();
    });


    // wave-292 residual
    it("listEnabledAgents order is build, plan, compose when all enabled", () => {
        const names = listEnabledAgents({
            longHorizonEnabled: true,
            planModeEnabled: true,
            composeModeEnabled: true,
        }).map((a) => a.name);
        expect(names).toEqual(["build", "plan", "compose"]);
        expect(listEnabledAgents({}).map((a) => a.name)).toEqual(["build", "plan", "compose"]);
        expect(listEnabledAgents({ longHorizonEnabled: false }).map((a) => a.name)).toEqual([
            "build",
        ]);
    });

    it("getAgentInfo plan/compose null when LH off; build remains interactive primary", () => {
        expect(getAgentInfo("plan", { longHorizonEnabled: false })).toBeNull();
        expect(getAgentInfo("compose", { longHorizonEnabled: false })).toBeNull();
        const build = getAgentInfo("build", { longHorizonEnabled: false });
        expect(build?.name).toBe("build");
        expect(build?.mode).toBe("primary");
        expect(build?.interactive).toBe(true);
        expect(getAgentInfo("plan", { longHorizonEnabled: true, planModeEnabled: false })).toBeNull();
        expect(getAgentInfo("compose", { longHorizonEnabled: true, composeModeEnabled: false })).toBeNull();
        expect(getAgentInfo("plan", { longHorizonEnabled: true, planModeEnabled: true })?.name).toBe(
            "plan",
        );
    });


    // wave-299 residual
    it("listEnabledAgents omits plan/compose independently; build always first", () => {
        expect(
            listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: false,
                composeModeEnabled: true,
            }).map((a) => a.name),
        ).toEqual(["build", "compose"]);
        expect(
            listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: true,
                composeModeEnabled: false,
            }).map((a) => a.name),
        ).toEqual(["build", "plan"]);
        expect(
            listEnabledAgents({
                longHorizonEnabled: true,
                planModeEnabled: false,
                composeModeEnabled: false,
            }).map((a) => a.name),
        ).toEqual(["build"]);
    });

    it("runtimePermission merges agent then session then hardPermission last-wins", () => {
        const plan = getAgentInfo("plan", { longHorizonEnabled: true, planModeEnabled: true });
        expect(plan).not.toBeNull();
        const session = [
            { permission: "bash", pattern: "*", action: "allow" as const },
            { permission: "bash", pattern: "rm *", action: "deny" as const },
        ];
        const rules = runtimePermission(plan!, session);
        // hardPermission (if any) is last in merge(agent, session, hard)
        expect(Array.isArray(rules)).toBe(true);
        expect(evaluate("bash", "rm -rf x", rules).action).toBe("deny");
        expect(evaluate("bash", "ls", rules).action).toBe("allow");
    });

    it("getAgentInfo plan/compose names and interactive flags when enabled", () => {
        const plan = getAgentInfo("plan", { longHorizonEnabled: true, planModeEnabled: true });
        const compose = getAgentInfo("compose", {
            longHorizonEnabled: true,
            composeModeEnabled: true,
        });
        expect(plan?.name).toBe("plan");
        expect(plan?.mode).toBe("primary");
        expect(plan?.interactive).toBe(true);
        expect(compose?.name).toBe("compose");
        expect(compose?.mode).toBe("primary");
        expect(compose?.interactive).toBe(true);
        expect(compose?.description.toLowerCase()).toContain("compose");
    });




    // wave-309 residual
    describe("agent-info residual (wave-309)", () => {
        it("listEnabledAgents longHorizon off is build-only regardless of plan/compose flags", () => {
            expect(
                listEnabledAgents({
                    longHorizonEnabled: false,
                    planModeEnabled: true,
                    composeModeEnabled: true,
                }).map((a) => a.name),
            ).toEqual(["build"]);
        });

        it("getAgentInfo returns null for plan/compose when toggles disabled; build always available", () => {
            expect(
                getAgentInfo("plan", { longHorizonEnabled: true, planModeEnabled: false }),
            ).toBeNull();
            expect(
                getAgentInfo("compose", { longHorizonEnabled: true, composeModeEnabled: false }),
            ).toBeNull();
            const build = getAgentInfo("build", { longHorizonEnabled: false });
            expect(build?.name).toBe("build");
            expect(build?.mode).toBe("primary");
        });

        it("getAgentInfo unknown mode null; listEnabledAgents order build then plan then compose", () => {
            expect(getAgentInfo("explore" as never, { longHorizonEnabled: true })).toBeNull();
            expect(
                listEnabledAgents({
                    longHorizonEnabled: true,
                    planModeEnabled: true,
                    composeModeEnabled: true,
                }).map((a) => a.name),
            ).toEqual(["build", "plan", "compose"]);
        });
    });

});
