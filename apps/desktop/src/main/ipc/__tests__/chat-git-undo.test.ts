// Security tests for the git:undo IPC handler (path traversal + accidental deletion guards).
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { execFileSyncMock, rmSyncMock } = vi.hoisted(() => ({
    execFileSyncMock: vi.fn(),
    rmSyncMock: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn(),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => []),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock("child_process", () => ({
    execFileSync: execFileSyncMock,
}));

vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return {
        ...actual,
        rmSync: rmSyncMock,
    };
});

import { setupChatIpc } from "../chat.ipc";

function setup() {
    setupChatIpc({
        registry: { get: vi.fn(), has: vi.fn() } as any,
        getWorkspace: () => undefined,
        getDefaultWorkspace: () => undefined,
        pendingEdits: { autoApprove: false } as any,
    });
}

describe("git:undo security guards", () => {
    beforeEach(() => {
        handlers.clear();
        execFileSyncMock.mockReset();
        rmSyncMock.mockReset();
    });

    it("rejects path traversal attempts like ../etc/passwd without running git or deleting files", async () => {
        setup();

        const handler = handlers.get("git:undo");
        const result = (await handler?.({}, "C:/repo", "../etc/passwd")) as {
            code?: string;
        } | undefined;

        expect(result).toMatchObject({ code: expect.stringContaining("ipcErrors.") });
        expect(execFileSyncMock).not.toHaveBeenCalled();
        expect(rmSyncMock).not.toHaveBeenCalled();
    });

    it("refuses to delete a tracked/modified file when git status reports ' M file.txt'", async () => {
        // git checkout throws -> fallback branch runs -> git status returns modified marker.
        execFileSyncMock.mockImplementationOnce(() => {
            throw new Error("checkout failed");
        });
        execFileSyncMock.mockReturnValueOnce(" M file.txt\n");

        setup();

        const handler = handlers.get("git:undo");
        const result = (await handler?.({}, "C:/repo", "file.txt")) as {
            code?: string;
        } | undefined;

        expect(result).toMatchObject({ code: "ipcErrors.chat.gitUndoNotUntracked" });
        expect(rmSyncMock).not.toHaveBeenCalled();
    });

    it("deletes an untracked file when git status reports '?? new.txt'", async () => {
        execFileSyncMock.mockImplementationOnce(() => {
            throw new Error("not tracked");
        });
        execFileSyncMock.mockReturnValueOnce("?? new.txt\n");

        setup();

        const handler = handlers.get("git:undo");
        const result = await handler?.({}, "C:/repo", "new.txt");

        expect(result).toBeUndefined();
        expect(rmSyncMock).toHaveBeenCalledWith(
            expect.stringMatching(/[\\/]repo[\\/]new\.txt$/),
            { force: true },
        );
    });
});
