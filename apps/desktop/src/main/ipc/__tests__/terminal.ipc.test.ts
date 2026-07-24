import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();
const {
    createMock,
    generateIdMock,
    hasMock,
    writeMock,
    resizeMock,
    closeMock,
    listMock,
    onOutputMock,
    onExitMock,
} = vi.hoisted(() => ({
    createMock: vi.fn(),
    generateIdMock: vi.fn(() => "pty_generated"),
    hasMock: vi.fn(() => false),
    writeMock: vi.fn(),
    resizeMock: vi.fn(),
    closeMock: vi.fn(),
    listMock: vi.fn(() => [] as Array<{ id: string; cwd: string; title?: string }>),
    onOutputMock: vi.fn(),
    onExitMock: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => [
            {
                isDestroyed: () => false,
                webContents: { send: webContentsSend },
            },
        ]),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock("../../services/shell/pty-manager", () => ({
    ptyManager: {
        onOutput: onOutputMock,
        onExit: onExitMock,
        create: createMock,
        generateId: generateIdMock,
        has: hasMock,
        write: writeMock,
        resize: resizeMock,
        close: closeMock,
        list: listMock,
    },
}));

import { setupTerminalIpc } from "../terminal.ipc";

describe("setupTerminalIpc", () => {
    beforeEach(() => {
        handlers.clear();
        webContentsSend.mockClear();
        createMock.mockReset();
        writeMock.mockReset();
        resizeMock.mockReset();
        closeMock.mockReset();
        listMock.mockReset();
        listMock.mockReturnValue([]);
        onOutputMock.mockClear();
        onExitMock.mockClear();
        generateIdMock.mockClear();
        hasMock.mockReset();
        hasMock.mockReturnValue(false);
        setupTerminalIpc();
    });

    it("creates a terminal with validated cwd and dimensions", async () => {
        createMock.mockResolvedValueOnce({ id: "pty_1", cwd: "C:/repo" });

        const handler = handlers.get("terminal:create")!;
        const result = await handler({}, { id: "pty_1", cwd: "C:/repo", cols: 100, rows: 30 });

        expect(result).toEqual({ id: "pty_1", reused: false });
        expect(createMock).toHaveBeenCalledWith({
            id: "pty_1",
            cwd: "C:/repo",
            cols: 100,
            rows: 30,
        });
    });

    it("forwards terminal output and exit with the preload payload contract", () => {
        const outputListener = onOutputMock.mock.calls[0][0] as (id: string, data: string) => void;
        const exitListener = onExitMock.mock.calls[0][0] as (id: string, code: number | null) => void;

        outputListener("pty_1", "hello");
        exitListener("pty_1", 0);

        expect(webContentsSend).toHaveBeenCalledWith("terminal:output", { id: "pty_1", data: "hello" });
        expect(webContentsSend).toHaveBeenCalledWith("terminal:exit", { id: "pty_1", code: 0 });
    });

    it("forwards ANSI / Chinese / multi-line output without mutation (H-002)", () => {
        const outputListener = onOutputMock.mock.calls[0][0] as (id: string, data: string) => void;
        const ansiChinese = "\u001b[32m通过\u001b[0m\r\n第二行\n";
        outputListener("pty_zh", ansiChinese);
        expect(webContentsSend).toHaveBeenCalledWith("terminal:output", {
            id: "pty_zh",
            data: ansiChinese,
        });
    });

    it("forwards exit once with null code when shell dies without status (H-004)", () => {
        const exitListener = onExitMock.mock.calls[0][0] as (id: string, code: number | null) => void;
        exitListener("pty_dead", null);
        expect(webContentsSend).toHaveBeenCalledWith("terminal:exit", { id: "pty_dead", code: null });
    });

    it("blocks protected cwd before creating a terminal", async () => {
        const handler = handlers.get("terminal:create")!;
        const result = await handler({}, { id: "secret", cwd: "C:/repo/.ssh", cols: 80, rows: 24 });

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
        expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects invalid terminal dimensions", async () => {
        const handler = handlers.get("terminal:create")!;
        const result = await handler({}, { id: "tiny", cwd: "C:/repo", cols: 4, rows: 1 });

        expect(result).toMatchObject({
            code: "ipcErrors.terminal.createInvalid",
        });
        expect(createMock).not.toHaveBeenCalled();
    });

    it("reuses an existing terminal id without recreating the pty", async () => {
        hasMock.mockReturnValueOnce(true);

        const handler = handlers.get("terminal:create")!;
        const result = await handler({}, { id: "pty_1", cwd: "C:/repo", cols: 80, rows: 24 });

        expect(result).toEqual({ id: "pty_1", reused: true });
        expect(createMock).not.toHaveBeenCalled();
    });

    it("returns an IPC error for invalid terminal input args", () => {
        const handler = handlers.get("terminal:input")!;
        const result = handler({}, "", "ls\n");

        expect(result).toMatchObject({
            code: "ipcErrors.terminal.inputInvalid",
        });
        expect(writeMock).not.toHaveBeenCalled();
    });

    it("returns an IPC error when terminal input cannot be written", () => {
        writeMock.mockImplementationOnce(() => {
            throw new Error("pty is closed");
        });

        const handler = handlers.get("terminal:input")!;
        const result = handler({}, "pty_1", "pnpm test\n");

        expect(result).toMatchObject({
            code: "ipcErrors.terminal.inputFailed",
            fallback: "发送终端输入失败: pty is closed",
        });
    });

    it("returns an IPC error for invalid resize args", () => {
        const handler = handlers.get("terminal:resize")!;
        const result = handler({}, "pty_1", 2, 1);

        expect(result).toMatchObject({
            code: "ipcErrors.terminal.resizeInvalid",
        });
        expect(resizeMock).not.toHaveBeenCalled();
    });

    it("returns an IPC error when terminal resize cannot be applied", () => {
        resizeMock.mockImplementationOnce(() => {
            throw new Error("pty is closed");
        });

        const handler = handlers.get("terminal:resize")!;
        const result = handler({}, "pty_1", 100, 30);

        expect(result).toMatchObject({
            code: "ipcErrors.terminal.resizeFailed",
            fallback: "调整终端尺寸失败: pty is closed",
        });
    });

    // wave-102 residual
    it("writes valid terminal input and resizes successfully", () => {
        expect(handlers.get("terminal:input")!({}, "pty_1", "pnpm test\n")).toBeUndefined();
        expect(writeMock).toHaveBeenCalledWith("pty_1", "pnpm test\n");

        expect(handlers.get("terminal:resize")!({}, "pty_1", 120, 40)).toBeUndefined();
        expect(resizeMock).toHaveBeenCalledWith("pty_1", 120, 40);
    });

    it("closes terminals and lists open sessions", () => {
        listMock.mockReturnValueOnce([
            { id: "pty_1", cwd: "C:/repo", title: "repo" },
            { id: "pty_2", cwd: "C:/other" },
        ]);
        expect(handlers.get("terminal:close")!({}, "pty_1")).toBeUndefined();
        expect(closeMock).toHaveBeenCalledWith("pty_1");
        expect(handlers.get("terminal:list")!({})).toEqual([
            { id: "pty_1", cwd: "C:/repo", title: "repo" },
            { id: "pty_2", cwd: "C:/other", title: undefined },
        ]);
    });
});
