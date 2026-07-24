import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { openPathMock, openExternalMock, showItemInFolderMock } = vi.hoisted(() => ({
    openPathMock: vi.fn(),
    openExternalMock: vi.fn(),
    showItemInFolderMock: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
    shell: {
        openPath: openPathMock,
        openExternal: openExternalMock,
        showItemInFolder: showItemInFolderMock,
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));
import { setupProjectShellIpc } from "../project-shell.ipc";

describe("setupProjectShellIpc", () => {
    beforeEach(() => {
        handlers.clear();
        openPathMock.mockReset();
        openExternalMock.mockReset();
        showItemInFolderMock.mockReset();
        setupProjectShellIpc();
    });

    it("blocks protected legacy project detection paths", async () => {
        const handler = handlers.get("project:detect")!;
        const result = await handler({}, "C:/repo/.ssh");

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
    });

    it("blocks protected legacy project file tree paths", async () => {
        const handler = handlers.get("project:file-tree")!;
        const result = await handler({}, "C:/repo/.env.local", 2);

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
    });

    it("opens ordinary paths through Electron shell", async () => {
        openPathMock.mockResolvedValueOnce("");

        const handler = handlers.get("shell:open-path")!;
        const result = await handler({}, "C:/repo/src/app.ts");

        expect(result).toBe("");
        expect(openPathMock).toHaveBeenCalledWith("C:/repo/src/app.ts");
    });

    it("returns an IPC error when Electron shell cannot open a path", async () => {
        openPathMock.mockResolvedValueOnce("No application is associated with the specified file");

        const handler = handlers.get("shell:open-path")!;
        const result = await handler({}, "C:/repo/archive.unknown");

        expect(result).toMatchObject({
            code: "ipcErrors.shell.openPathFailed",
            fallback: "打开路径失败: No application is associated with the specified file",
            params: { path: "C:/repo/archive.unknown" },
        });
        expect(openPathMock).toHaveBeenCalledWith("C:/repo/archive.unknown");
    });

    it("does not open protected paths through Electron shell", async () => {
        const handler = handlers.get("shell:open-path")!;
        const result = await handler({}, "C:/repo/.env");

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
        expect(openPathMock).not.toHaveBeenCalled();
    });

    it("blocks sensitive key/db material even without workspacePath", async () => {
        const openHandler = handlers.get("shell:open-path")!;
        const revealHandler = handlers.get("shell:reveal-path")!;

        for (const path of [
            "C:/Users/public/Downloads/server.pem",
            "C:/Users/public/Downloads/app.key",
            "C:/Users/public/Downloads/sessions.sqlite",
            "C:/Users/public/Downloads/state.db",
            "C:/Users/public/Downloads/github-token.json",
        ]) {
            const openResult = await openHandler({}, path);
            expect(openResult).toMatchObject({ code: "ipcErrors.files.protectedPath" });
            const revealResult = await revealHandler({}, path);
            expect(revealResult).toMatchObject({ code: "ipcErrors.files.protectedPath" });
        }

        expect(openPathMock).not.toHaveBeenCalled();
        expect(showItemInFolderMock).not.toHaveBeenCalled();
    });

    it("opens https URLs through Electron shell external browser", async () => {
        openExternalMock.mockResolvedValueOnce(undefined);

        const handler = handlers.get("shell:open-path")!;
        const result = await handler({}, "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest");

        expect(result).toBe("");
        expect(openExternalMock).toHaveBeenCalledWith("https://github.com/ChisaAlter/pi-agent-desktop/releases/latest");
        expect(openPathMock).not.toHaveBeenCalled();
    });

    it("does not reveal protected paths through Electron shell", async () => {
        const handler = handlers.get("shell:reveal-path")!;
        const result = await handler({}, "C:/repo/.ssh/id_ed25519");

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
        expect(showItemInFolderMock).not.toHaveBeenCalled();
    });

    it("reveals ordinary paths through Electron shell", async () => {
        const handler = handlers.get("shell:reveal-path")!;
        const result = await handler({}, "C:/repo/src/app.ts");

        expect(result).toBeUndefined();
        expect(showItemInFolderMock).toHaveBeenCalledWith("C:/repo/src/app.ts");
    });

    // wave-102 residual
    it("rejects empty project:detect paths", async () => {
        const result = await handlers.get("project:detect")!({}, "");
        expect(result).toMatchObject({ code: "ipcErrors.project.detectInvalid" });
    });

    it("rejects oversized project:file-tree maxDepth", async () => {
        const result = await handlers.get("project:file-tree")!({}, "C:/repo", 99);
        expect(result).toMatchObject({ code: "ipcErrors.project.fileTreeInvalid" });
    });

    it("blocks non-http URL schemes on shell:open-path", async () => {
        for (const target of [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "data:text/html,hi",
            "ms-msdt:something",
        ]) {
            const result = await handlers.get("shell:open-path")!({}, target);
            expect(result, target).toMatchObject({ code: "ipcErrors.shell.invalidScheme" });
        }
        expect(openPathMock).not.toHaveBeenCalled();
        expect(openExternalMock).not.toHaveBeenCalled();
    });

    it("still opens Windows drive paths with a colon", async () => {
        openPathMock.mockResolvedValueOnce("");
        const result = await handlers.get("shell:open-path")!({}, "C:/repo/readme.txt");
        expect(result).toBe("");
        expect(openPathMock).toHaveBeenCalledWith("C:/repo/readme.txt");
    });
});
