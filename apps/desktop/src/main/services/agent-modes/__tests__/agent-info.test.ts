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
