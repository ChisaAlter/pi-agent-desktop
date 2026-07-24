import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
            listeners.set(channel, listener);
        }),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

import { getWorkbenchContext, setupWorkbenchIpc } from "../workbench.ipc";

describe("setupWorkbenchIpc (F-011)", () => {
    beforeEach(() => {
        listeners.clear();
        setupWorkbenchIpc();
    });

    it("stores active file path per workspace", () => {
        const listener = listeners.get("workbench:set-active-file")!;
        listener({}, "ws_1", "C:/repo/src/app.ts");
        expect(getWorkbenchContext("ws_1")).toBe("C:/repo/src/app.ts");
    });

    it("clears active file when path is null", () => {
        const listener = listeners.get("workbench:set-active-file")!;
        listener({}, "ws_1", "C:/repo/src/app.ts");
        listener({}, "ws_1", null);
        expect(getWorkbenchContext("ws_1")).toBeNull();
    });

    it("rejects empty workspaceId via schema", () => {
        const listener = listeners.get("workbench:set-active-file")!;
        expect(() => listener({}, "", "C:/repo/a.ts")).toThrow();
        expect(getWorkbenchContext("")).toBeNull();
    });

    it("rejects empty filePath string (null is allowed)", () => {
        const listener = listeners.get("workbench:set-active-file")!;
        expect(() => listener({}, "ws_1", "")).toThrow();
    });

    // wave-99 residual
    it("isolates active files across workspaces", () => {
        const listener = listeners.get("workbench:set-active-file")!;
        listener({}, "ws_a", "C:/a/file.ts");
        listener({}, "ws_b", "C:/b/file.ts");
        expect(getWorkbenchContext("ws_a")).toBe("C:/a/file.ts");
        expect(getWorkbenchContext("ws_b")).toBe("C:/b/file.ts");
        listener({}, "ws_a", null);
        expect(getWorkbenchContext("ws_a")).toBeNull();
        expect(getWorkbenchContext("ws_b")).toBe("C:/b/file.ts");
    });

    it("overwrites previous active file for the same workspace", () => {
        const listener = listeners.get("workbench:set-active-file")!;
        listener({}, "ws_1", "C:/repo/old.ts");
        listener({}, "ws_1", "C:/repo/new.ts");
        expect(getWorkbenchContext("ws_1")).toBe("C:/repo/new.ts");
    });

    it("returns null for unknown workspaces", () => {
        expect(getWorkbenchContext("never-set")).toBeNull();
    });
});
