import type { ToolPermissions } from "@shared";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeToolPolicy } from "../runtime-policy";

const { originalExecutes } = vi.hoisted(() => ({
    originalExecutes: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => {
    const createDefinition = (name: string) => vi.fn(() => {
        const execute = vi.fn(async () => ({
            content: [{ type: "text", text: `${name}-result` }],
            details: { name },
        }));
        originalExecutes.set(name, execute);
        return {
            name,
            label: `${name} label`,
            description: `${name} description`,
            parameters: { type: "object", marker: name },
            renderCall: vi.fn(),
            renderResult: vi.fn(),
            execute,
        };
    });

    return {
        createReadToolDefinition: createDefinition("read"),
        createGrepToolDefinition: createDefinition("grep"),
        createFindToolDefinition: createDefinition("find"),
        createLsToolDefinition: createDefinition("ls"),
        createWriteToolDefinition: createDefinition("write"),
        createEditToolDefinition: createDefinition("edit"),
        createBashToolDefinition: createDefinition("bash"),
    };
});

import { createGuardedBuiltins, createRuntimePolicyController } from "../guarded-tools";

const allEnabled: ToolPermissions = {
    fileRead: true,
    fileWrite: true,
    shell: true,
    git: true,
    network: true,
    extensions: true,
};

function policy(overrides: Partial<ToolPermissions> = {}): RuntimeToolPolicy {
    return {
        mode: "build",
        permissions: { ...allEnabled, ...overrides },
        immutableDeniedTools: new Set(),
    };
}

async function execute(tool: ReturnType<typeof createGuardedBuiltins>[number], input: Record<string, unknown>) {
    return tool.execute("call-id", input as never, undefined, undefined, {} as never);
}

describe("createGuardedBuiltins", () => {
    let tempRoot: string;
    let workspace: string;
    let outside: string;

    beforeEach(async () => {
        originalExecutes.clear();
        tempRoot = await mkdtemp(join(tmpdir(), "pi-guarded-tools-"));
        workspace = join(tempRoot, "workspace");
        outside = join(tempRoot, "outside");
        await Promise.all([
            mkdir(workspace),
            mkdir(outside),
        ]);
    });

    afterEach(async () => {
        await rm(tempRoot, { recursive: true, force: true });
    });

    it("creates same-name overrides while preserving SDK metadata and results", async () => {
        await mkdir(join(workspace, "src"));
        await writeFile(join(workspace, "src", "index.ts"), "export {};\n");
        const tools = createGuardedBuiltins(workspace, () => policy());
        const read = tools.find((tool) => tool.name === "read");

        expect(tools.map((tool) => tool.name)).toEqual(["read", "grep", "find", "ls", "write", "edit", "bash"]);
        expect(read).toMatchObject({
            label: "read label",
            description: "read description",
            parameters: { type: "object", marker: "read" },
        });

        await expect(execute(read!, { path: "src/index.ts" })).resolves.toEqual({
            content: [{ type: "text", text: "read-result" }],
            details: { name: "read" },
        });
        expect(originalExecutes.get("read")).toHaveBeenCalledTimes(1);
    });

    it("captures a mutable policy getter and applies later updates", async () => {
        const controller = createRuntimePolicyController(policy());
        const read = createGuardedBuiltins(workspace, controller.getPolicy)
            .find((tool) => tool.name === "read")!;

        controller.setPolicy(policy({ fileRead: false }));

        await expect(execute(read, { path: "src/index.ts" })).rejects.toThrow(/read.*file read.*disabled/i);
        expect(originalExecutes.get("read")).not.toHaveBeenCalled();
    });

    it.each(["read", "grep", "find", "ls"])("denies %s when fileRead is disabled", async (name) => {
        const tool = createGuardedBuiltins(workspace, () => policy({ fileRead: false }))
            .find((candidate) => candidate.name === name)!;

        await expect(execute(tool, name === "read" ? { path: "file.ts" } : { path: "src" }))
            .rejects.toThrow(/file read.*disabled/i);
        expect(originalExecutes.get(name)).not.toHaveBeenCalled();
    });

    it.each(["write", "edit"])("denies %s when fileWrite is disabled", async (name) => {
        const tool = createGuardedBuiltins(workspace, () => policy({ fileWrite: false }))
            .find((candidate) => candidate.name === name)!;

        await expect(execute(tool, { path: "src/file.ts", content: "x", edits: [] }))
            .rejects.toThrow(/file write.*disabled/i);
        expect(originalExecutes.get(name)).not.toHaveBeenCalled();
    });

    it.each([
        ["read", "../outside.txt", /outside|工作区/i],
        ["write", ".env.local", /sensitive|敏感/i],
    ])("denies %s before execution for protected path %s", async (name, path, message) => {
        const tool = createGuardedBuiltins(workspace, () => policy())
            .find((candidate) => candidate.name === name)!;

        await expect(execute(tool, { path, content: "secret" })).rejects.toThrow(message);
        expect(originalExecutes.get(name)).not.toHaveBeenCalled();
    });

    it("denies reading an existing target through a workspace junction that points outside", async () => {
        await writeFile(join(outside, "public.txt"), "outside");
        await symlink(outside, join(workspace, "linked-directory"), process.platform === "win32" ? "junction" : "dir");
        const read = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "read")!;

        await expect(execute(read, { path: join("linked-directory", "public.txt") }))
            .rejects.toThrow(/outside|工作区/i);
        expect(originalExecutes.get("read")).not.toHaveBeenCalled();
    });

    it("denies a nonexistent write target beneath a workspace junction that points outside", async () => {
        await symlink(outside, join(workspace, "linked-directory"), process.platform === "win32" ? "junction" : "dir");
        const write = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "write")!;

        await expect(execute(write, {
            path: join("linked-directory", "new", "nested", "file.txt"),
            content: "secret",
        })).rejects.toThrow(/outside|工作区/i);
        expect(originalExecutes.get("write")).not.toHaveBeenCalled();
    });

    it("denies a harmlessly named directory junction to a protected credential directory", async () => {
        const credentialDirectory = join(workspace, ".ssh");
        await mkdir(credentialDirectory);
        await writeFile(join(credentialDirectory, "account.txt"), "credential");
        await symlink(
            credentialDirectory,
            join(workspace, "project-docs"),
            process.platform === "win32" ? "junction" : "dir",
        );
        const read = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "read")!;

        await expect(execute(read, { path: join("project-docs", "account.txt") }))
            .rejects.toThrow(/sensitive|敏感/i);
        expect(originalExecutes.get("read")).not.toHaveBeenCalled();
    });

    it("denies a harmlessly named file symlink to a protected credential target", async (context) => {
        const credentialPath = join(workspace, ".env.local");
        await writeFile(credentialPath, "TOKEN=secret\n");
        try {
            await symlink(credentialPath, join(workspace, "notes.txt"), "file");
        } catch (error) {
            if (isErrorCode(error, "EPERM")) {
                context.skip();
                return;
            }
            throw error;
        }
        const read = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "read")!;

        await expect(execute(read, { path: "notes.txt" })).rejects.toThrow(/sensitive|敏感/i);
        expect(originalExecutes.get("read")).not.toHaveBeenCalled();
    });

    it.each(["write", "edit"])("denies %s through a dangling link to a nonexistent outside target", async (name) => {
        const linkPath = join(workspace, "future-output.txt");
        let inputPath = "future-output.txt";
        try {
            await symlink(join(outside, "missing-output.txt"), linkPath, "file");
        } catch (error) {
            if (!isErrorCode(error, "EPERM")) throw error;

            await symlink(outside, linkPath, "junction");
            await rm(outside, { recursive: true, force: true });
            inputPath = join("future-output.txt", "missing-output.txt");
        }
        const tool = createGuardedBuiltins(workspace, () => policy())
            .find((candidate) => candidate.name === name)!;

        await expect(execute(tool, {
            path: inputPath,
            content: "outside",
            edits: [{ oldText: "before", newText: "after" }],
        })).rejects.toThrow(/outside|工作区/i);
        expect(originalExecutes.get(name)).not.toHaveBeenCalled();
    });

    it("denies bash before execution when runtime policy rejects the command", async () => {
        const bash = createGuardedBuiltins(workspace, () => policy({ shell: false }))
            .find((tool) => tool.name === "bash")!;

        await expect(execute(bash, { command: "pnpm test" })).rejects.toThrow(/shell commands are disabled/i);
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();
    });

    // wave-90 residual
    it("denies bash when Plan-mode immutableDeniedTools includes bash", async () => {
        const planPolicy: RuntimeToolPolicy = {
            mode: "plan",
            permissions: allEnabled,
            immutableDeniedTools: new Set(["bash", "shell", "write", "edit"]),
        };
        const bash = createGuardedBuiltins(workspace, () => planPolicy)
            .find((tool) => tool.name === "bash")!;

        await expect(execute(bash, { command: "echo ok" })).rejects.toThrow(/plan mode|disabled/i);
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();
    });

    it.each(["write", "edit"] as const)("denies %s when Plan-mode immutably denies mutation tools", async (name) => {
        const planPolicy: RuntimeToolPolicy = {
            mode: "plan",
            permissions: allEnabled,
            immutableDeniedTools: new Set(["bash", "shell", "write", "edit", "apply_patch", "multiedit"]),
        };
        const tool = createGuardedBuiltins(workspace, () => planPolicy)
            .find((candidate) => candidate.name === name)!;

        await expect(execute(tool, { path: "src/a.ts", content: "x", edits: [] }))
            .rejects.toThrow(new RegExp(`${name}.*disabled|plan mode`, "i"));
        expect(originalExecutes.get(name)).not.toHaveBeenCalled();
    });

    it("denies bash git segments when git permission is disabled", async () => {
        const bash = createGuardedBuiltins(workspace, () => policy({ git: false }))
            .find((tool) => tool.name === "bash")!;

        await expect(execute(bash, { command: "git status" })).rejects.toThrow(/git commands are disabled/i);
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();
    });

    it("allows bash non-git commands when only git is disabled", async () => {
        const bash = createGuardedBuiltins(workspace, () => policy({ git: false }))
            .find((tool) => tool.name === "bash")!;

        await expect(execute(bash, { command: "pnpm test" })).resolves.toMatchObject({
            details: { name: "bash" },
        });
        expect(originalExecutes.get("bash")).toHaveBeenCalledTimes(1);
    });

    it("allows path tools without a path property (no lexical check)", async () => {
        const grep = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "grep")!;

        await expect(execute(grep, { pattern: "foo" })).resolves.toMatchObject({
            details: { name: "grep" },
        });
        expect(originalExecutes.get("grep")).toHaveBeenCalledTimes(1);
    });

    it("denies absolute outside paths for write even when named harmlessly", async () => {
        const write = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "write")!;

        await expect(execute(write, {
            path: join(outside, "harmless.txt"),
            content: "x",
        })).rejects.toThrow(/outside|工作区/i);
        expect(originalExecutes.get("write")).not.toHaveBeenCalled();
    });

    // wave-117 residual
    it("allows path tools with non-string path property (no lexical check)", async () => {
        const read = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "read")!;

        await expect(execute(read, { path: 42 })).resolves.toMatchObject({
            details: { name: "read" },
        });
        expect(originalExecutes.get("read")).toHaveBeenCalledTimes(1);
    });

    it("allows path tools when params is null or a primitive", async () => {
        const ls = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "ls")!;

        await expect(execute(ls, null as never)).resolves.toMatchObject({
            details: { name: "ls" },
        });
        await expect(execute(ls, "not-an-object" as never)).resolves.toMatchObject({
            details: { name: "ls" },
        });
        expect(originalExecutes.get("ls")).toHaveBeenCalledTimes(2);
    });

    it("denies bash when command property is missing (empty command fails shell-off / empty check path)", async () => {
        const bash = createGuardedBuiltins(workspace, () => policy({ shell: false }))
            .find((tool) => tool.name === "bash")!;

        await expect(execute(bash, {})).rejects.toThrow(/shell commands are disabled|denied/i);
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();
    });

    it("allows bash when shell enabled and command is empty string", async () => {
        const bash = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "bash")!;

        await expect(execute(bash, { command: "" })).resolves.toMatchObject({
            details: { name: "bash" },
        });
        expect(originalExecutes.get("bash")).toHaveBeenCalledTimes(1);
    });

    it("denies read of bare sensitive basename under workspace (.ssh config style)", async () => {
        await mkdir(join(workspace, "keys"), { recursive: true });
        await writeFile(join(workspace, "keys", "id_rsa"), "x");
        const read = createGuardedBuiltins(workspace, () => policy())
            .find((tool) => tool.name === "read")!;

        await expect(execute(read, { path: join("keys", "id_rsa") })).rejects.toThrow(/sensitive|敏感/i);
        expect(originalExecutes.get("read")).not.toHaveBeenCalled();
    });

    it("createRuntimePolicyController returns the latest policy reference", () => {
        const first = policy();
        const controller = createRuntimePolicyController(first);
        expect(controller.getPolicy()).toBe(first);
        const next = policy({ network: false });
        controller.setPolicy(next);
        expect(controller.getPolicy()).toBe(next);
        expect(controller.getPolicy()).not.toBe(first);
    });

    // wave-168 residual
    it("createRuntimePolicyController setPolicy can restore previous policy object", () => {
        const a = policy({ network: true });
        const b = policy({ network: false });
        const controller = createRuntimePolicyController(a);
        controller.setPolicy(b);
        expect(controller.getPolicy()).toBe(b);
        expect(controller.getPolicy().permissions.network).toBe(false);
        controller.setPolicy(a);
        expect(controller.getPolicy()).toBe(a);
        expect(controller.getPolicy().permissions.network).toBe(true);
    });

    it("guarded builtins still include read/write/edit/bash tool names", () => {
        const tools = createGuardedBuiltins(workspace, () => policy());
        const names = tools.map((t) => t.name).sort();
        expect(names).toEqual(expect.arrayContaining(["bash", "edit", "read", "write"]));
    });

    // wave-253 residual
    it("denies write/edit of .env under workspace before original execute", async () => {
        const tools = createGuardedBuiltins(workspace, () => policy());
        const write = tools.find((tool) => tool.name === "write")!;
        const edit = tools.find((tool) => tool.name === "edit")!;
        await writeFile(join(workspace, ".env"), "K=1");
        await expect(execute(write, { path: ".env", content: "K=2" })).rejects.toThrow(/sensitive|敏感/i);
        await expect(execute(edit, { path: ".env", old_string: "K=1", new_string: "K=2" })).rejects.toThrow(
            /sensitive|敏感/i,
        );
        expect(originalExecutes.get("write")).not.toHaveBeenCalled();
        expect(originalExecutes.get("edit")).not.toHaveBeenCalled();
    });

    it("bash denied when shell permission off; allowed when on and command passes policy", async () => {
        const denied = createGuardedBuiltins(workspace, () => policy({ shell: false })).find(
            (tool) => tool.name === "bash",
        )!;
        await expect(execute(denied, { command: "echo hi" })).rejects.toThrow(/shell|bash|permission|策略|禁止/i);
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();

        const allowed = createGuardedBuiltins(workspace, () => policy({ shell: true })).find(
            (tool) => tool.name === "bash",
        )!;
        await execute(allowed, { command: "echo hi" });
        expect(originalExecutes.get("bash")).toHaveBeenCalledTimes(1);
    });

    // wave-265 residual
    it("createRuntimePolicyController get/set round-trips policy", () => {
        const first = policy({ shell: true });
        const ctrl = createRuntimePolicyController(first);
        expect(ctrl.getPolicy()).toBe(first);
        const second = policy({ shell: false });
        ctrl.setPolicy(second);
        expect(ctrl.getPolicy()).toBe(second);
        expect(ctrl.getPolicy().permissions.shell).toBe(false);
    });

    it("read denied when fileRead permission off; write denied when fileWrite off", async () => {
        const noRead = createGuardedBuiltins(workspace, () => policy({ fileRead: false })).find(
            (tool) => tool.name === "read",
        )!;
        await expect(execute(noRead, { path: "a.ts" })).rejects.toThrow(/file read|permission|read/i);
        expect(originalExecutes.get("read")).not.toHaveBeenCalled();

        const noWrite = createGuardedBuiltins(workspace, () => policy({ fileWrite: false })).find(
            (tool) => tool.name === "write",
        )!;
        await expect(execute(noWrite, { path: "a.ts", content: "x" })).rejects.toThrow(
            /file write|permission|write/i,
        );
        expect(originalExecutes.get("write")).not.toHaveBeenCalled();
    });


    // wave-275 residual
    it("plan mode immutable deny blocks write/bash before original execute", async () => {
        const planPolicy = {
            mode: "plan" as const,
            permissions: {
                fileRead: true,
                fileWrite: true,
                shell: true,
                git: true,
                network: true,
                extensions: true,
            },
            immutableDeniedTools: new Set(["bash", "shell", "write", "edit", "apply_patch", "multiedit"]),
        };
        const tools = createGuardedBuiltins(workspace, () => planPolicy);
        const write = tools.find((tool) => tool.name === "write")!;
        const bash = tools.find((tool) => tool.name === "bash")!;
        await expect(execute(write, { path: "a.ts", content: "x" })).rejects.toThrow(
            /disabled in plan mode|denied/i,
        );
        await expect(execute(bash, { command: "echo hi" })).rejects.toThrow(/disabled|denied|Plan mode/i);
        expect(originalExecutes.get("write")).not.toHaveBeenCalled();
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();
    });

    it("bash git-off policy denies git command; non-git still runs", async () => {
        const gitOff = createGuardedBuiltins(
            workspace,
            () => policy({ git: false }),
        ).find((tool) => tool.name === "bash")!;
        await expect(execute(gitOff, { command: "git status" })).rejects.toThrow(/git|disabled|denied/i);
        expect(originalExecutes.get("bash")).not.toHaveBeenCalled();
        await execute(gitOff, { command: "echo ok" });
        expect(originalExecutes.get("bash")).toHaveBeenCalledTimes(1);
    });

});

function isErrorCode(error: unknown, code: string): boolean {
    return error instanceof Error && Reflect.get(error, "code") === code;
}
