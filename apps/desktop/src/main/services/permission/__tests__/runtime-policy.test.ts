import type { ToolPermissions } from "@shared";
import { describe, expect, it } from "vitest";
import {
    checkBashCommand,
    filterActiveTools,
    resolveRuntimePolicy,
    resolveStoredToolPermissions,
} from "../runtime-policy";

const allEnabled: ToolPermissions = {
    fileRead: true,
    fileWrite: true,
    shell: true,
    git: true,
    network: true,
    extensions: true,
};

describe("runtime tool policy", () => {
    it("selects stored session permissions before workspace permissions", () => {
        const sessionPermissions = { ...allEnabled, shell: false };
        const workspacePermissions = { ...allEnabled, network: false };

        expect(resolveStoredToolPermissions({ sessionPermissions, workspacePermissions }))
            .toEqual(sessionPermissions);
    });

    it("falls back to stored workspace permissions", () => {
        const workspacePermissions = { ...allEnabled, extensions: false };

        expect(resolveStoredToolPermissions({ workspacePermissions })).toEqual(workspacePermissions);
    });

    it("uses the exact development defaults when no stored permissions exist", () => {
        expect(resolveStoredToolPermissions({})).toEqual({
            fileRead: true,
            fileWrite: true,
            shell: true,
            git: true,
            network: false,
            extensions: true,
        });
    });

    it.each(["session", "workspace"] as const)("clones selected stored %s permissions", (source) => {
        const permissions = { ...allEnabled };
        const resolved = resolveStoredToolPermissions({
            sessionPermissions: source === "session" ? permissions : undefined,
            workspacePermissions: source === "workspace" ? permissions : undefined,
        });

        resolved.shell = false;
        expect(permissions.shell).toBe(true);
        permissions.network = false;
        expect(resolved.network).toBe(true);
        expect(resolved).not.toBe(permissions);
    });

    it("lets session permissions override workspace defaults", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: allEnabled,
            sessionPermissions: { ...allEnabled, shell: false },
        });

        expect(policy.permissions.shell).toBe(false);
    });

    it.each([
        ["fileRead", ["read", "grep", "find", "ls", "glob", "list"], ["write", "bash", "websearch", "custom_tool"]],
        ["fileWrite", ["write", "edit", "apply_patch", "multiedit"], ["read", "bash", "websearch", "custom_tool"]],
        ["shell", ["bash", "shell"], ["read", "write", "websearch", "custom_tool"]],
        ["network", ["webfetch", "websearch", "fetch", "http", "custom_http_client"], ["read", "write", "bash", "custom_tool"]],
    ] as const)("removes tools disabled by %s", (permission, removed, retained) => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, [permission]: false },
        });
        const active = filterActiveTools([...removed, ...retained], policy);

        expect(active).toEqual(retained);
    });

    it("removes extension tools while retaining built-ins", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, extensions: false },
        });

        expect(filterActiveTools(["read", "grep", "find", "ls", "glob", "list", "write", "edit", "bash", "custom_tool"], policy))
            .toEqual(["read", "grep", "find", "ls", "glob", "list", "write", "edit", "bash"]);
    });

    it("applies all disabled categories together", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: {
                fileRead: false,
                fileWrite: false,
                shell: false,
                git: false,
                network: false,
                extensions: false,
            },
        });

        expect(filterActiveTools([
            "read",
            "write",
            "bash",
            "websearch",
            "custom_tool",
        ], policy)).toEqual([]);
    });

    it.each(["workspace", "session"] as const)("clones and freezes the selected %s permissions", (source) => {
        const permissions = { ...allEnabled };
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: source === "workspace" ? permissions : allEnabled,
            sessionPermissions: source === "session" ? permissions : undefined,
        });

        permissions.shell = false;

        expect(policy.permissions.shell).toBe(true);
        expect(policy.permissions).not.toBe(permissions);
        expect(Object.isFrozen(policy.permissions)).toBe(true);
    });

    it("returns an isolated immutable-denied set for each Plan policy", () => {
        const first = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
        const second = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });

        expect(first.immutableDeniedTools).not.toBe(second.immutableDeniedTools);
        (first.immutableDeniedTools as Set<string>).add("read");
        expect(second.immutableDeniedTools.has("read")).toBe(false);
    });

    it("returns an isolated denied set for each non-Plan policy", () => {
        const first = resolveRuntimePolicy({ mode: "build", workspacePermissions: allEnabled });
        const second = resolveRuntimePolicy({ mode: "build", workspacePermissions: allEnabled });

        expect(first.immutableDeniedTools).not.toBe(second.immutableDeniedTools);
    });
    it("makes Plan mode mutation denies immutable and preserves plan_write", () => {
        const policy = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });

        expect(filterActiveTools([
            "read",
            "bash",
            "shell",
            "write",
            "edit",
            "apply_patch",
            "multiedit",
            "plan_write",
        ], policy)).toEqual(["read", "plan_write"]);
    });

    it("preserves plan_write when extensions are disabled in Plan mode", () => {
        const policy = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: { ...allEnabled, extensions: false },
        });

        expect(filterActiveTools(["read", "custom_tool", "plan_write"], policy))
            .toEqual(["read", "plan_write"]);
    });

    it("denies all shell commands when shell is disabled", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false },
        });

        expect(checkBashCommand("pnpm test", policy)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });
    });

    it("keeps shell tools active when only Git permission is disabled", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });

        expect(filterActiveTools(["read", "bash", "shell", "write"], policy))
            .toEqual(["read", "bash", "shell", "write"]);
    });

    it.each(["git status", "git.exe diff", "git -C . log", "pnpm test && git status", "cmd /c git status", 'powershell -Command "git status"', 'pwsh -c "git status"'])("denies Git command %j when Git permission is disabled", (command) => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });

        expect(checkBashCommand(command, policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
    });

    it.each(["pnpm test", "echo harmless", "echo git status", "node --version"])("allows non-Git shell command %j when Git permission is disabled", (command) => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });

        expect(checkBashCommand(command, policy)).toEqual({ allowed: true });
    });

    // wave-90 residual
    it("denies shell in Plan mode with immutable Plan reason", () => {
        const policy = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
        expect(checkBashCommand("echo ok", policy)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
    });

    it.each([
        "GIT status",
        "  git status",
        "git",
        "& git push",
        "echo x; git status",
        "echo x || git status",
        "cmd.exe /c git status",
        "cmd /K git status",
        "powershell.exe -Command \"git status\"",
        "pwsh.exe -c \"git status\"",
    ])("denies additional Git segment form %j when Git is disabled", (command) => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand(command, policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
    });

    it.each([
        "echo 'git status'",
        "grep git package.json",
        "gitk",
        "mygit status",
        "gits",
        "",
        "   ",
    ])("allows non-Git lookalike or empty command %j when Git is disabled", (command) => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand(command, policy)).toEqual({ allowed: true });
    });

    it("does not treat plan_write as removable when only network is disabled", () => {
        const policy = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: { ...allEnabled, network: false },
        });
        expect(filterActiveTools(["plan_write", "websearch", "read"], policy))
            .toEqual(["plan_write", "read"]);
    });

    it("filters case-insensitive tool names", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false, fileWrite: false },
        });
        expect(filterActiveTools(["BASH", "Write", "READ", "  Grep  "], policy))
            .toEqual(["READ", "  Grep  "]);
    });

    // wave-114 residual
    it("denies shell with non-Plan reason when shell permission is off in build", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false },
        });
        expect(checkBashCommand("echo hi", policy)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });
    });

    it("clones stored permissions so callers cannot mutate the source object", () => {
        const sessionPermissions = { ...allEnabled, network: false };
        const resolved = resolveStoredToolPermissions({ sessionPermissions });
        expect(resolved).toEqual(sessionPermissions);
        expect(resolved).not.toBe(sessionPermissions);
        resolved.shell = false;
        expect(sessionPermissions.shell).toBe(true);
    });

    it("returns empty array when filtering an empty tool list", () => {
        const policy = resolveRuntimePolicy({ mode: "build", workspacePermissions: allEnabled });
        expect(filterActiveTools([], policy)).toEqual([]);
    });

    it("freezes runtime permissions snapshot", () => {
        const policy = resolveRuntimePolicy({ mode: "build", workspacePermissions: allEnabled });
        expect(Object.isFrozen(policy.permissions)).toBe(true);
        expect(() => {
            (policy.permissions as { shell: boolean }).shell = false;
        }).toThrow();
    });

    it("allows shell when git disabled and command has no git segment", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("pnpm -r test && echo done", policy)).toEqual({ allowed: true });
        expect(checkBashCommand("echo git is a word", policy)).toEqual({ allowed: true });
    });

    // wave-157 residual
    it("blocks git when git permission is off across &&, |, and ; segments", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("echo hi && git status", policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("git status | cat", policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("cd /tmp; git pull", policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("echo hi && pnpm test", policy)).toEqual({ allowed: true });
    });

    it("detects git.exe and cmd /c wrapped git when git disabled", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("git.exe status", policy).allowed).toBe(false);
        expect(checkBashCommand("cmd /c git status", policy).allowed).toBe(false);
        expect(checkBashCommand("cmd.exe /k git status", policy).allowed).toBe(false);
    });

    it("plan mode immutable deny uses Plan reason even if shell permission is on", () => {
        const policy = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: allEnabled,
        });
        expect(checkBashCommand("echo hi", policy)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
        expect(filterActiveTools(["bash", "write", "edit", "read", "plan_write"], policy)).toEqual([
            "read",
            "plan_write",
        ]);
    });

    it("sessionPermissions override workspacePermissions in resolveRuntimePolicy", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false },
            sessionPermissions: { ...allEnabled, shell: true, network: false },
        });
        expect(policy.permissions.shell).toBe(true);
        expect(policy.permissions.network).toBe(false);
        expect(checkBashCommand("echo hi", policy)).toEqual({ allowed: true });
        expect(filterActiveTools(["websearch", "bash"], policy)).toEqual(["bash"]);
    });

    // wave-184 residual
    it("detects powershell/pwsh -Command wrapped git when git is disabled", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand('powershell -Command "git status"', policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("pwsh.exe -c git status", policy).allowed).toBe(false);
        expect(checkBashCommand('powershell -Command "echo hi"', policy)).toEqual({ allowed: true });
    });

    it("compose/build modes have empty immutableDeniedTools; plan has the fixed deny set", () => {
        const compose = resolveRuntimePolicy({ mode: "compose" as never, workspacePermissions: allEnabled });
        const build = resolveRuntimePolicy({ mode: "build", workspacePermissions: allEnabled });
        const plan = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
        expect(compose.immutableDeniedTools.size).toBe(0);
        expect(build.immutableDeniedTools.size).toBe(0);
        expect([...plan.immutableDeniedTools].sort()).toEqual(
            ["apply_patch", "bash", "edit", "multiedit", "shell", "write"].sort(),
        );
    });

    it("extensions off still keeps plan_write in plan mode and core tools in build", () => {
        const plan = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: { ...allEnabled, extensions: false },
        });
        expect(filterActiveTools(["plan_write", "custom_plugin", "read", "bash"], plan)).toEqual([
            "plan_write",
            "read",
        ]);
        const build = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, extensions: false },
        });
        expect(filterActiveTools(["custom_plugin", "read", "bash"], build)).toEqual(["read", "bash"]);
    });

    it("shell permission off uses generic reason; plan mode reason wins over shell off", () => {
        const buildShellOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false },
        });
        expect(checkBashCommand("echo hi", buildShellOff)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });
        const planShellOff = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: { ...allEnabled, shell: false },
        });
        expect(checkBashCommand("echo hi", planShellOff)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
    });


    // wave-214 residual
    it("detects git after background ampersand and newline-separated segments", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("& git status", policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("echo hi\ngit push", policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("echo hi || git status", policy)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        // non-git after strip remains allowed
        expect(checkBashCommand("& echo hi", policy)).toEqual({ allowed: true });
    });

    it("filterActiveTools normalizes tool names before category/permission checks", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, fileWrite: false, network: false },
        });
        const active = filterActiveTools(
            ["READ", "Write", "BASH", "WebSearch", "custom_plugin"],
            policy,
        );
        // fileWrite off removes write; network off removes websearch; extensions still allow custom
        expect(active.map((t) => t.toLowerCase())).toEqual(
            expect.arrayContaining(["read", "bash", "custom_plugin"]),
        );
        expect(active.map((t) => t.toLowerCase())).not.toEqual(
            expect.arrayContaining(["write", "websearch"]),
        );
        expect(active.some((t) => t.toLowerCase() === "write")).toBe(false);
        expect(active.some((t) => t.toLowerCase() === "websearch")).toBe(false);
    });

    it("resolveRuntimePolicy freezes permissions and plan mode denies mutating tools", () => {
        const plan = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: allEnabled,
        });
        expect(Object.isFrozen(plan.permissions)).toBe(true);
        expect(plan.immutableDeniedTools.has("bash")).toBe(true);
        expect(plan.immutableDeniedTools.has("write")).toBe(true);
        const build = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: allEnabled,
        });
        expect(build.immutableDeniedTools.size).toBe(0);
        expect(Object.isFrozen(build.permissions)).toBe(true);
    });


    // wave-223 residual
    it("checkBashCommand denies git under cmd/powershell wrappers when git permission off", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("git status", policy).allowed).toBe(false);
        expect(checkBashCommand("cmd /c git status", policy).allowed).toBe(false);
        expect(checkBashCommand("cmd.exe /k git status", policy).allowed).toBe(false);
        expect(checkBashCommand('powershell -Command "git status"', policy).allowed).toBe(false);
        expect(checkBashCommand("pwsh -c git status", policy).allowed).toBe(false);
        expect(checkBashCommand("ls && echo hi", policy).allowed).toBe(true);
        // plan mode always denies shell regardless of permissions
        const plan = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
        expect(checkBashCommand("ls", plan)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
    });

    it("filterActiveTools drops shell/network/extensions and keeps mode-required plan tools", () => {
        const policy = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: {
                ...allEnabled,
                shell: false,
                network: false,
                extensions: false,
                fileWrite: false,
            },
        });
        const tools = [
            "read",
            "bash",
            "write",
            "websearch",
            "custom_plugin",
            "plan_write",
            "planenter",
        ];
        const active = filterActiveTools(tools, policy).map((t) => t.toLowerCase());
        expect(active).toContain("read");
        expect(active).not.toContain("bash");
        expect(active).not.toContain("write");
        expect(active).not.toContain("websearch");
        // plan_write is mode-required even when extensions off
        expect(active).toContain("plan_write");
    });

    it("resolveStoredToolPermissions prefers session over workspace and clones not required", () => {
        const sessionPermissions = { ...allEnabled, network: true };
        const workspacePermissions = { ...allEnabled, network: false };
        const got = resolveStoredToolPermissions({ sessionPermissions, workspacePermissions });
        expect(got).toEqual(sessionPermissions);
        expect(got).not.toBe(sessionPermissions); // spread clone
        expect(resolveStoredToolPermissions({ workspacePermissions: undefined as never })).toEqual({
            fileRead: true,
            fileWrite: true,
            shell: true,
            git: true,
            network: false,
            extensions: true,
        });
    });

    // wave-236 residual
    it("checkBashCommand allows git.exe bare and denies when shell off", () => {
        const withGit = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("git.exe status", withGit)).toEqual({
            allowed: false,
            reason: "Git commands are disabled",
        });
        expect(checkBashCommand("echo git status", withGit).allowed).toBe(true);

        const shellOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false },
        });
        expect(checkBashCommand("ls", shellOff)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });
    });

    it("checkBashCommand splits pipelines/newlines and still detects git segments", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("echo hi | git status", policy).allowed).toBe(false);
        expect(checkBashCommand("echo hi\ngit commit -m x", policy).allowed).toBe(false);
        expect(checkBashCommand("ls; git push", policy).allowed).toBe(false);
        expect(checkBashCommand("ls || true", policy).allowed).toBe(true);
    });

    it("filterActiveTools keeps fileRead when only network/shell disabled", () => {
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false, network: false },
        });
        const active = filterActiveTools(
            ["read", "grep", "bash", "websearch", "write", "custom_x"],
            policy,
        ).map((t) => t.toLowerCase());
        expect(active).toEqual(expect.arrayContaining(["read", "grep", "write", "custom_x"]));
        expect(active).not.toContain("bash");
        expect(active).not.toContain("websearch");
    });

    // wave-247 residual
    it("plan mode immutably denies shell/write family; sessionPermissions override workspace", () => {
        const plan = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: allEnabled,
        });
        for (const name of ["bash", "shell", "write", "edit", "apply_patch", "multiedit"]) {
            expect(plan.immutableDeniedTools.has(name)).toBe(true);
        }
        expect(checkBashCommand("ls", plan)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
        const sessionOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: allEnabled,
            sessionPermissions: { ...allEnabled, shell: false },
        });
        expect(sessionOff.permissions.shell).toBe(false);
        expect(checkBashCommand("ls", sessionOff).allowed).toBe(false);
    });

    it("filterActiveTools drops extension tools when extensions off; keeps plan_write in plan; git wrappers detected", () => {
        const policy = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: { ...allEnabled, extensions: false },
        });
        const active = filterActiveTools(
            ["read", "plan_write", "custom_ext", "bash", "write"],
            policy,
        ).map((t) => t.toLowerCase());
        expect(active).toContain("read");
        expect(active).toContain("plan_write");
        expect(active).not.toContain("custom_ext");
        expect(active).not.toContain("bash");
        expect(active).not.toContain("write");

        const gitOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        // product: cmd /c unquoted git is detected; quoted payload after /c is NOT unwrapped
        expect(checkBashCommand("cmd /c git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand('cmd /c "git status"', gitOff).allowed).toBe(true);
        // powershell strips surrounding quotes on -Command payload
        expect(checkBashCommand('powershell -Command "git status"', gitOff).allowed).toBe(false);
        expect(checkBashCommand("& git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("echo hi", gitOff).allowed).toBe(true);
    });

    // wave-264 residual
    it("compose mode mirrors build for shell; plan denies bash even if permissions allow", () => {
        const compose = resolveRuntimePolicy({
            mode: "compose",
            workspacePermissions: allEnabled,
        });
        expect(checkBashCommand("echo ok", compose).allowed).toBe(true);
        const plan = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: allEnabled,
        });
        expect(checkBashCommand("echo ok", plan).allowed).toBe(false);
        expect(plan.immutableDeniedTools.has("bash")).toBe(true);
    });

    it("resolveStoredToolPermissions prefers session over workspace when provided", () => {
        const resolved = resolveStoredToolPermissions({
            workspacePermissions: { ...allEnabled, shell: true },
            sessionPermissions: { ...allEnabled, shell: false },
        });
        expect(resolved.shell).toBe(false);
        const wsOnly = resolveStoredToolPermissions({
            workspacePermissions: { ...allEnabled, shell: true },
        });
        expect(wsOnly.shell).toBe(true);
    });


    // wave-274 residual
    it("plan immutable deny set is bash/shell/write/edit/apply_patch/multiedit; build is empty", () => {
        const plan = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
        expect([...plan.immutableDeniedTools].sort()).toEqual(
            ["apply_patch", "bash", "edit", "multiedit", "shell", "write"].sort(),
        );
        const build = resolveRuntimePolicy({ mode: "build", workspacePermissions: allEnabled });
        expect(build.immutableDeniedTools.size).toBe(0);
        const explore = resolveRuntimePolicy({ mode: "explore", workspacePermissions: allEnabled });
        expect(explore.immutableDeniedTools.size).toBe(0);
    });

    it("permissions object is frozen copy; mutating source after resolve does not leak", () => {
        const workspacePermissions = { ...allEnabled, shell: true };
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions,
            sessionPermissions: undefined,
        });
        expect(Object.isFrozen(policy.permissions)).toBe(true);
        expect(() => {
            (policy.permissions as { shell: boolean }).shell = false;
        }).toThrow();
        workspacePermissions.shell = false;
        expect(policy.permissions.shell).toBe(true);
    });

    it("checkBashCommand detects git.exe and pwsh -c; shell-off reason differs from plan", () => {
        const gitOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("git.exe status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("pwsh -Command git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("GIT status", gitOff).allowed).toBe(false);

        const shellOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false },
        });
        expect(checkBashCommand("ls", shellOff)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });
        const plan = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
        expect(checkBashCommand("ls", plan)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
    });



    // wave-287 residual
    it("filterActiveTools drops fileWrite/network categories; keeps fileRead; plan_write only in plan", () => {
        const writeOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, fileWrite: false, network: false },
        });
        const active = filterActiveTools(
            ["read", "write", "edit", "apply_patch", "multiedit", "webfetch", "websearch", "fetch", "http", "my_http_tool", "bash"],
            writeOff,
        );
        expect(active).toEqual(["read", "bash"]);
        expect(active).not.toContain("write");
        expect(active).not.toContain("webfetch");
        expect(active).not.toContain("my_http_tool");

        const plan = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: allEnabled,
        });
        // plan_write is mode-required even if extensions off
        const planActive = filterActiveTools(
            ["plan_write", "custom_ext", "read", "write"],
            resolveRuntimePolicy({
                mode: "plan",
                workspacePermissions: { ...allEnabled, extensions: false },
            }),
        );
        expect(planActive.map((t) => t.toLowerCase())).toEqual(["plan_write", "read"]);
        expect(plan.immutableDeniedTools.has("write")).toBe(true);
    });

    it("checkBashCommand splits &&/||/;/| and unwraps cmd /k; shell-off short-circuits before git", () => {
        const gitOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("echo a && git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("echo a || git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("echo a; git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("echo a | git status", gitOff).allowed).toBe(false);
        // product: cmd /k unwraps unquoted payload like /c
        expect(checkBashCommand("cmd /k git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("cmd.exe /C git status", gitOff).allowed).toBe(false);
        expect(checkBashCommand("echo hi", gitOff).allowed).toBe(true);

        const shellOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, shell: false, git: false },
        });
        // shell permission checked before git
        expect(checkBashCommand("git status", shellOff)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });

        const stored = resolveStoredToolPermissions({});
        // DEVELOPMENT defaults: network false, shell true
        expect(stored.network).toBe(false);
        expect(stored.shell).toBe(true);
        expect(stored).not.toBe(allEnabled);
    });


    // wave-298 residual
    it("plan mode immutableDeniedTools freezes shell and write family; checkBashCommand plan reason", () => {
        const plan = resolveRuntimePolicy({
            mode: "plan",
            workspacePermissions: allEnabled,
        });
        for (const name of ["bash", "shell", "write", "edit", "apply_patch", "multiedit"]) {
            expect(plan.immutableDeniedTools.has(name)).toBe(true);
        }
        expect(plan.immutableDeniedTools.has("read")).toBe(false);
        expect(checkBashCommand("ls", plan)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled in Plan mode",
        });
        const active = filterActiveTools(["bash", "write", "read", "grep"], plan);
        expect(active).toEqual(["read", "grep"]);
    });

    it("sessionPermissions override workspace; resolveStored prefers session", () => {
        const session = { ...allEnabled, shell: false, git: true };
        const policy = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: allEnabled,
            sessionPermissions: session,
        });
        expect(policy.permissions.shell).toBe(false);
        expect(checkBashCommand("echo hi", policy)).toEqual({
            allowed: false,
            reason: "Shell commands are disabled",
        });
        const stored = resolveStoredToolPermissions({
            sessionPermissions: session,
            workspacePermissions: allEnabled,
        });
        expect(stored.shell).toBe(false);
        expect(stored.git).toBe(true);
    });

    it("containsGitCommand detects powershell -Command and bare git.exe", () => {
        const gitOff = resolveRuntimePolicy({
            mode: "build",
            workspacePermissions: { ...allEnabled, git: false },
        });
        expect(checkBashCommand("git.exe status", gitOff).allowed).toBe(false);
        expect(checkBashCommand('powershell -Command "git status"', gitOff).allowed).toBe(false);
        expect(checkBashCommand('pwsh.exe -c "git status"', gitOff).allowed).toBe(false);
        expect(checkBashCommand("echo git is a word", gitOff).allowed).toBe(true);
        expect(checkBashCommand("gitignore", gitOff).allowed).toBe(true);
    });

});
