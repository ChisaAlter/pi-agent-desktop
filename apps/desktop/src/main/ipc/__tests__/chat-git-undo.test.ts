// Security tests for the git:undo IPC handler (path traversal + accidental deletion guards).
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { execFileMock, rmMock } = vi.hoisted(() => ({
    execFileMock: vi.fn(),
    rmMock: vi.fn(),
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
    execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rm: rmMock,
}));

import { setupChatIpc } from "../chat.ipc";

function setup() {
    setupChatIpc({
        registry: { get: vi.fn(), has: vi.fn() } as any,
        getWorkspace: () => undefined,
        getDefaultWorkspace: () => undefined,
        pendingEdits: { autoApprove: false } as any,
    });
}

// execFile supports both callback style (file, args, opts, cb) and promise
// style (file, args, opts) — the handler under test uses the promise form.
function execFileSuccess(stdout = ""): void {
    execFileMock.mockImplementationOnce((_f: unknown, _a: unknown, _o: unknown, cb?: (err: Error | null, out: string) => void) => {
        const result = { stdout, stderr: "" };
        if (typeof cb === "function") {
            cb(null, stdout, "");
            return;
        }
        return Promise.resolve(result);
    });
}

function execFileError(message: string): void {
    execFileMock.mockImplementationOnce((_f: unknown, _a: unknown, _o: unknown, cb?: (err: Error | null, out: string) => void) => {
        if (typeof cb === "function") {
            cb(new Error(message), "");
            return;
        }
        return Promise.reject(new Error(message));
    });
}

describe("git:undo security guards", () => {
    beforeEach(() => {
        handlers.clear();
        execFileMock.mockReset();
        rmMock.mockReset();
    });

    it("rejects path traversal attempts like ../etc/passwd without running git or deleting files", async () => {
        setup();

        const handler = handlers.get("git:undo");
        const result = (await handler?.({}, "C:/repo", "../etc/passwd")) as {
            code?: string;
        } | undefined;

        expect(result).toMatchObject({ code: expect.stringContaining("ipcErrors.") });
        expect(execFileMock).not.toHaveBeenCalled();
        expect(rmMock).not.toHaveBeenCalled();
    });

    it("refuses to delete a tracked/modified file when git status reports ' M file.txt'", async () => {
        // git checkout throws -> fallback branch runs -> git status returns modified marker.
        execFileError("checkout failed");
        execFileSuccess(" M file.txt\n");

        setup();

        const handler = handlers.get("git:undo");
        const result = (await handler?.({}, "C:/repo", "file.txt")) as {
            code?: string;
        } | undefined;

        expect(result).toMatchObject({ code: "ipcErrors.chat.gitUndoNotUntracked" });
        expect(rmMock).not.toHaveBeenCalled();
    });

    it("deletes an untracked file when git status reports '?? new.txt'", async () => {
        execFileError("not tracked");
        execFileSuccess("?? new.txt\n");
        rmMock.mockResolvedValue(undefined);

        setup();

        const handler = handlers.get("git:undo");
        const result = await handler?.({}, "C:/repo", "new.txt");

        expect(result).toBeUndefined();
        expect(rmMock).toHaveBeenCalledWith(
            expect.stringMatching(/[\\/]repo[\\/]new\.txt$/),
            { force: true },
        );
    });

    // wave-100 residual
    it("rejects empty filePath as gitUndoInvalid", async () => {
        setup();
        const result = await handlers.get("git:undo")?.({}, "C:/repo", "");
        expect(result).toMatchObject({ code: "ipcErrors.chat.gitUndoInvalid" });
        expect(execFileMock).not.toHaveBeenCalled();
        expect(rmMock).not.toHaveBeenCalled();
    });

    it("deletes nested untracked files when status is ??", async () => {
        execFileError("not tracked");
        execFileSuccess("?? src/deep/new.txt\n");
        rmMock.mockResolvedValue(undefined);
        setup();
        const result = await handlers.get("git:undo")?.({}, "C:/repo", "src/deep/new.txt");
        expect(result).toBeUndefined();
        expect(rmMock).toHaveBeenCalledWith(
            expect.stringMatching(/[\\/]repo[\\/]src[\\/]deep[\\/]new\.txt$/),
            { force: true },
        );
    });

    it("returns gitUndoFailed when status and delete both fail", async () => {
        execFileError("checkout failed");
        execFileError("status unavailable");
        setup();
        const result = await handlers.get("git:undo")?.({}, "C:/repo", "orphan.txt");
        expect(result).toMatchObject({
            code: "ipcErrors.chat.gitUndoFailed",
            fallback: expect.stringContaining("status unavailable"),
        });
        expect(rmMock).not.toHaveBeenCalled();
    });

    it("succeeds via git checkout without rm for tracked files", async () => {
        execFileSuccess("");
        setup();
        const result = await handlers.get("git:undo")?.({}, "C:/repo", "src/app.ts");
        expect(result).toBeUndefined();
        // execFile 以回调形式调用: (file, args, options, callback)。
        const call = execFileMock.mock.calls[0];
        expect(call?.[0]).toBe("git");
        expect(call?.[1]).toEqual(["checkout", "--", "src/app.ts"]);
        expect(call?.[2]).toEqual(expect.objectContaining({
            cwd: expect.stringMatching(/[\\/]repo$/),
            timeout: 10_000,
        }));
        expect(rmMock).not.toHaveBeenCalled();
    });
});
