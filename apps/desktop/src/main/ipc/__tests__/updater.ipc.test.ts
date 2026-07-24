import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

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

import { setupUpdaterIpc } from "../updater.ipc";

describe("setupUpdaterIpc", () => {
    beforeEach(() => {
        handlers.clear();
    });

    it("exposes updater state and actions through IPC", async () => {
        const service = {
            getState: vi.fn(() => ({ phase: "idle", currentVersion: "0.1.0", latestVersion: null, updateAvailable: false })),
            checkForUpdates: vi.fn(async () => ({ phase: "checking" })),
            downloadUpdate: vi.fn(async () => ({ phase: "downloading" })),
            installUpdate: vi.fn(async () => ({ phase: "downloaded" })),
        };

        setupUpdaterIpc(service as never);

        expect(await handlers.get("updater:get-state")?.({})).toMatchObject({ phase: "idle" });
        expect(await handlers.get("updater:check")?.({})).toMatchObject({ phase: "checking" });
        expect(await handlers.get("updater:download")?.({})).toMatchObject({ phase: "downloading" });
        expect(await handlers.get("updater:install")?.({})).toMatchObject({ phase: "downloaded" });
    });

    // wave-99 residual
    it("wraps check/download/install failures as branded IpcError", async () => {
        const service = {
            getState: vi.fn(() => ({ phase: "idle" })),
            checkForUpdates: vi.fn(async () => {
                throw new Error("network down");
            }),
            downloadUpdate: vi.fn(async () => {
                throw new Error("disk full");
            }),
            installUpdate: vi.fn(async () => {
                throw new Error("signature mismatch");
            }),
        };
        setupUpdaterIpc(service as never);

        await expect(handlers.get("updater:check")?.({})).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.updater.checkFailed",
            fallback: expect.stringContaining("network down"),
        });
        await expect(handlers.get("updater:download")?.({})).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.updater.downloadFailed",
            fallback: expect.stringContaining("disk full"),
        });
        await expect(handlers.get("updater:install")?.({})).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.updater.installFailed",
            fallback: expect.stringContaining("signature mismatch"),
        });
    });

    it("registers all four updater channels", () => {
        setupUpdaterIpc({
            getState: vi.fn(),
            checkForUpdates: vi.fn(),
            downloadUpdate: vi.fn(),
            installUpdate: vi.fn(),
        } as never);
        for (const channel of ["updater:get-state", "updater:check", "updater:download", "updater:install"]) {
            expect(handlers.has(channel)).toBe(true);
        }
    });

    // wave-104 residual
    it("propagates get-state throws without IpcError wrapping", () => {
        setupUpdaterIpc({
            getState: vi.fn(() => {
                throw new Error("state unavailable");
            }),
            checkForUpdates: vi.fn(),
            downloadUpdate: vi.fn(),
            installUpdate: vi.fn(),
        } as never);
        expect(() => handlers.get("updater:get-state")?.({})).toThrow("state unavailable");
    });

    it("returns successful check/download/install states without wrapping", async () => {
        const service = {
            getState: vi.fn(() => ({ phase: "idle" })),
            checkForUpdates: vi.fn(async () => ({ phase: "not-available", updateAvailable: false })),
            downloadUpdate: vi.fn(async () => ({ phase: "idle", updateAvailable: false })),
            installUpdate: vi.fn(async () => ({ phase: "idle" })),
        };
        setupUpdaterIpc(service as never);
        await expect(handlers.get("updater:check")?.({})).resolves.toMatchObject({ phase: "not-available" });
        await expect(handlers.get("updater:download")?.({})).resolves.toMatchObject({ phase: "idle" });
        await expect(handlers.get("updater:install")?.({})).resolves.toMatchObject({ phase: "idle" });
        expect(service.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(service.downloadUpdate).toHaveBeenCalledTimes(1);
        expect(service.installUpdate).toHaveBeenCalledTimes(1);
    });
});
