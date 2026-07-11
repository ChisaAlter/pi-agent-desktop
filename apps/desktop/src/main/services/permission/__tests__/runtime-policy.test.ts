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
});
