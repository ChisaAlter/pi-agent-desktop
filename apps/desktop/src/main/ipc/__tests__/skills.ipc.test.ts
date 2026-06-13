import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { installSkillMock, uninstallSkillMock } = vi.hoisted(() => ({
    installSkillMock: vi.fn(),
    uninstallSkillMock: vi.fn(),
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
    },
}));

vi.mock("../../services/skills/skillhub-adapter", () => ({
    searchSkills: vi.fn(),
    listInstalled: vi.fn(async () => []),
    installSkill: installSkillMock,
    uninstallSkill: uninstallSkillMock,
    checkSkillhubInstalled: vi.fn(async () => true),
}));

import { setupSkillsIpc } from "../skills.ipc";

describe("setupSkillsIpc", () => {
    beforeEach(() => {
        handlers.clear();
        installSkillMock.mockReset();
        uninstallSkillMock.mockReset();
        setupSkillsIpc({
            getWorkspacePath: () => "C:/repo",
            getStateFile: () => "C:/repo/.pi-desktop/skills-state.json",
        });
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
});
