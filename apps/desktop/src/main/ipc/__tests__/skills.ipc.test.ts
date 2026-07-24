import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const {
    installSkillMock,
    uninstallSkillMock,
    searchSkillsMock,
    listInstalledMock,
    checkSkillhubInstalledMock,
} = vi.hoisted(() => ({
    installSkillMock: vi.fn(),
    uninstallSkillMock: vi.fn(),
    searchSkillsMock: vi.fn(),
    listInstalledMock: vi.fn(async () => [] as string[]),
    checkSkillhubInstalledMock: vi.fn(async () => true),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock("../../services/skills/skillhub-adapter", () => ({
    searchSkills: searchSkillsMock,
    listInstalled: listInstalledMock,
    installSkill: installSkillMock,
    uninstallSkill: uninstallSkillMock,
    checkSkillhubInstalled: checkSkillhubInstalledMock,
}));

import { setupSkillsIpc } from "../skills.ipc";

describe("setupSkillsIpc", () => {
    let stateDir: string;
    let stateFile: string;

    beforeEach(() => {
        handlers.clear();
        installSkillMock.mockReset();
        uninstallSkillMock.mockReset();
        searchSkillsMock.mockReset();
        listInstalledMock.mockReset();
        listInstalledMock.mockResolvedValue([]);
        checkSkillhubInstalledMock.mockReset();
        checkSkillhubInstalledMock.mockResolvedValue(true);
        stateDir = mkdtempSync(join(tmpdir(), "skills-ipc-"));
        stateFile = join(stateDir, "skills-state.json");
        setupSkillsIpc({
            getWorkspacePath: () => "C:/repo",
            getStateFile: () => stateFile,
        });
    });

    afterEach(() => {
        rmSync(stateDir, { recursive: true, force: true });
    });

    it("rejects invalid install slugs before invoking skillhub", async () => {
        const handler = handlers.get("skills:install")!;

        const result = await handler({}, "../escape");

        expect(result).toMatchObject({
            code: "ipcErrors.skills.invalidSlug",
        });
        expect(installSkillMock).not.toHaveBeenCalled();
    });

    it("installs valid slugs in the selected workspace", async () => {
        installSkillMock.mockResolvedValueOnce(undefined);
        const handler = handlers.get("skills:install")!;

        const result = await handler({}, "hello-world");

        expect(result).toEqual({ success: true });
        expect(installSkillMock).toHaveBeenCalledWith("hello-world", "C:/repo");
    });

    it("returns structured searchFailed when marketplace network errors (J-002)", async () => {
        searchSkillsMock.mockRejectedValueOnce(new Error("ENOTFOUND registry"));
        const handler = handlers.get("skills:search")!;
        const result = await handler({}, "hello");
        expect(result).toMatchObject({
            code: "ipcErrors.skills.searchFailed",
            fallback: expect.stringContaining("ENOTFOUND"),
        });
    });

    it("returns structured installFailed when skillhub install rejects (J-003)", async () => {
        installSkillMock.mockRejectedValueOnce(new Error("network 503"));
        const handler = handlers.get("skills:install")!;
        const result = await handler({}, "hello-world");
        expect(result).toMatchObject({
            code: "ipcErrors.skills.installFailed",
            fallback: expect.stringContaining("network 503"),
        });
    });

    describe("skills:toggle (J-004)", () => {
        it("rejects invalid slugs before touching state", async () => {
            const handler = handlers.get("skills:toggle")!;
            const result = await handler({}, "../escape", false);
            expect(result).toMatchObject({ code: "ipcErrors.skills.invalidSlug" });
        });

        it("disables a skill by appending its slug once", async () => {
            const handler = handlers.get("skills:toggle")!;
            expect(await handler({}, "hello-world", false)).toEqual({ success: true });
            expect(await handler({}, "hello-world", false)).toEqual({ success: true });

            const state = JSON.parse(readFileSync(stateFile, "utf8")) as { disabled: string[] };
            expect(state.disabled).toEqual(["hello-world"]);
        });

        it("re-enables a skill by removing it from disabled", async () => {
            writeFileSync(stateFile, JSON.stringify({ version: 1, disabled: ["hello-world", "other"] }), "utf8");
            const handler = handlers.get("skills:toggle")!;
            expect(await handler({}, "hello-world", true)).toEqual({ success: true });

            const state = JSON.parse(readFileSync(stateFile, "utf8")) as { disabled: string[] };
            expect(state.disabled).toEqual(["other"]);
        });

        it("serializes concurrent toggles without dropping updates", async () => {
            const handler = handlers.get("skills:toggle")!;
            await Promise.all([
                handler({}, "a", false),
                handler({}, "b", false),
                handler({}, "c", false),
            ]);
            const state = JSON.parse(readFileSync(stateFile, "utf8")) as { disabled: string[] };
            expect(state.disabled.sort()).toEqual(["a", "b", "c"]);
        });
    });

    // wave-102 residual
    it("reports skillhub availability via skills:check", async () => {
        checkSkillhubInstalledMock.mockResolvedValueOnce(false);
        await expect(handlers.get("skills:check")!({})).resolves.toBe(false);
        checkSkillhubInstalledMock.mockRejectedValueOnce(new Error("spawn failed"));
        await expect(handlers.get("skills:check")!({})).resolves.toBe(false);
    });

    it("maps installed skills with enabled flags from state", async () => {
        writeFileSync(stateFile, JSON.stringify({ version: 1, disabled: ["off-skill"] }), "utf8");
        listInstalledMock.mockResolvedValueOnce(["on-skill", "off-skill"]);
        const result = await handlers.get("skills:installed")!({});
        expect(result).toEqual([
            { slug: "on-skill", enabled: true },
            { slug: "off-skill", enabled: false },
        ]);
    });

    it("rejects invalid uninstall slugs and no-workspace installs", async () => {
        handlers.clear();
        setupSkillsIpc({
            getWorkspacePath: () => "",
            getStateFile: () => stateFile,
        });
        const noWs = await handlers.get("skills:install")!({}, "hello-world");
        expect(noWs).toMatchObject({ code: "ipcErrors.skills.noWorkspace" });

        handlers.clear();
        setupSkillsIpc({
            getWorkspacePath: () => "C:/repo",
            getStateFile: () => stateFile,
        });
        const bad = await handlers.get("skills:uninstall")!({}, "../escape");
        expect(bad).toMatchObject({ code: "ipcErrors.skills.invalidSlug" });
        expect(uninstallSkillMock).not.toHaveBeenCalled();
    });

    it("uninstalls valid slugs and surfaces uninstallFailed", async () => {
        uninstallSkillMock.mockResolvedValueOnce(undefined);
        expect(await handlers.get("skills:uninstall")!({}, "hello-world")).toEqual({ success: true });
        expect(uninstallSkillMock).toHaveBeenCalledWith("hello-world", "C:/repo");

        uninstallSkillMock.mockRejectedValueOnce(new Error("busy"));
        const failed = await handlers.get("skills:uninstall")!({}, "hello-world");
        expect(failed).toMatchObject({
            code: "ipcErrors.skills.uninstallFailed",
            fallback: expect.stringContaining("busy"),
        });
    });

    it("rejects unsafe or invalid github-import URLs before git clone", async () => {
        const handler = handlers.get("skills:github-import")!;
        for (const url of [
            "file:///C:/secret",
            "javascript:alert(1)",
            "http://169.254.169.254/latest/meta-data",
            "not-a-url",
        ]) {
            const result = await handler({}, url);
            expect(result).toMatchObject({ code: "ipcErrors.skills.invalidUrl" });
        }
    });

    it("writes SKILL.md under the workspace skills directory", async () => {
        const workspace = mkdtempSync(join(tmpdir(), "skills-write-"));
        handlers.clear();
        setupSkillsIpc({
            getWorkspacePath: () => workspace,
            getStateFile: () => stateFile,
        });
        const result = await handlers.get("skills:write-skill")!({}, "Hello World!", "# skill\n");
        expect(result).toMatchObject({
            success: true,
            slug: "helloworld",
            path: expect.stringContaining(join(".agents", "skills", "helloworld", "SKILL.md")),
        });
        expect(readFileSync((result as { path: string }).path, "utf8")).toBe("# skill\n");
        rmSync(workspace, { recursive: true, force: true });
    });

    it("rejects blank write-skill names", async () => {
        const result = await handlers.get("skills:write-skill")!({}, "!!!", "x");
        expect(result).toMatchObject({ code: "ipcErrors.skills.writeSkillFailed" });
    });
});
