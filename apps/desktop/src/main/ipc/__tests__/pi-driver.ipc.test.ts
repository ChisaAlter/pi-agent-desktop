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
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

import { setupPiDriverIpc } from "../pi-driver.ipc";

type DriverStub = {
    detectSync: ReturnType<typeof vi.fn>;
    detect: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    uninstall: ReturnType<typeof vi.fn>;
    cancelOperation: ReturnType<typeof vi.fn>;
};

function createDriver(overrides: Partial<DriverStub> = {}): DriverStub {
    return {
        detectSync: vi.fn(() => ({
            installed: true,
            localVersion: "1.0.0",
            latestVersion: "1.0.0",
            updateAvailable: false,
            executablePath: "C:/pi/pi.cmd",
            installMethod: "managed",
            configExists: true,
            defaultProvider: null,
            defaultModel: null,
            managedRuntimePath: "C:/pi",
            runtimeSource: "managed",
            runtimeChannel: "stable",
            lastCheckedAt: Date.now(),
        })),
        detect: vi.fn(async () => ({ installed: true })),
        install: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
        cancelOperation: vi.fn(),
        ...overrides,
    };
}

describe("setupPiDriverIpc (B-004/B-005/B-006 IPC contracts)", () => {
    beforeEach(() => {
        handlers.clear();
    });

    it("returns driverNotInitialized when PiDriver is unavailable", async () => {
        setupPiDriverIpc(() => null);
        const result = await handlers.get("pi:install")!({});
        expect(result).toMatchObject({
            code: "ipcErrors.pi.driverNotInitialized",
        });
    });

    it("install success path re-detects status after driver.install (B-004)", async () => {
        const driver = createDriver();
        setupPiDriverIpc(() => driver as never);

        const result = await handlers.get("pi:install")!({});

        expect(driver.install).toHaveBeenCalledTimes(1);
        expect(driver.detectSync).toHaveBeenCalled();
        expect(result).toMatchObject({ installed: true, installMethod: "managed" });
    });

    it("install failure returns structured installFailed without throwing (B-004)", async () => {
        const driver = createDriver({
            install: vi.fn(async () => {
                throw new Error("npm EACCES");
            }),
        });
        setupPiDriverIpc(() => driver as never);

        const result = await handlers.get("pi:install")!({});

        expect(result).toMatchObject({
            code: "ipcErrors.pi.installFailed",
            fallback: expect.stringContaining("npm EACCES"),
        });
    });

    it("update failure returns structured updateFailed (B-005)", async () => {
        const driver = createDriver({
            update: vi.fn(async () => {
                throw new Error("network down");
            }),
        });
        setupPiDriverIpc(() => driver as never);

        const result = await handlers.get("pi:update")!({});

        expect(result).toMatchObject({
            code: "ipcErrors.pi.updateFailed",
            fallback: expect.stringContaining("network down"),
        });
        expect(driver.detectSync).not.toHaveBeenCalled();
    });

    it("uninstall success re-detects and cancel-operation is fire-and-forget (B-006)", async () => {
        const driver = createDriver({
            detectSync: vi.fn(() => ({
                installed: false,
                localVersion: null,
                latestVersion: null,
                updateAvailable: false,
                executablePath: null,
                installMethod: "unknown",
                configExists: false,
                defaultProvider: null,
                defaultModel: null,
                managedRuntimePath: null,
                runtimeSource: "none",
                runtimeChannel: "stable",
                lastCheckedAt: Date.now(),
            })),
        });
        setupPiDriverIpc(() => driver as never);

        const result = await handlers.get("pi:uninstall")!({});
        expect(driver.uninstall).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ installed: false, executablePath: null });

        await handlers.get("pi:cancel-operation")!({});
        expect(driver.cancelOperation).toHaveBeenCalledTimes(1);
    });

    // wave-100 residual
    it("status and refresh-status success paths call detectSync/detect", async () => {
        const driver = createDriver({
            detect: vi.fn(async () => ({ installed: true, localVersion: "2.0.0" })),
        });
        setupPiDriverIpc(() => driver as never);

        await expect(handlers.get("pi:status")!({})).resolves.toMatchObject({
            installed: true,
            installMethod: "managed",
        });
        expect(driver.detectSync).toHaveBeenCalled();

        await expect(handlers.get("pi:refresh-status")!({})).resolves.toMatchObject({
            installed: true,
            localVersion: "2.0.0",
        });
        expect(driver.detect).toHaveBeenCalledTimes(1);
    });

    it("status detectSync throw maps to detectFailed", async () => {
        const driver = createDriver({
            detectSync: vi.fn(() => {
                throw new Error("PATH broken");
            }),
        });
        setupPiDriverIpc(() => driver as never);
        await expect(handlers.get("pi:status")!({})).resolves.toMatchObject({
            code: "ipcErrors.pi.detectFailed",
            fallback: expect.stringContaining("PATH broken"),
        });
    });

    it("uninstall failure returns uninstallFailed without detectSync", async () => {
        const driver = createDriver({
            uninstall: vi.fn(async () => {
                throw new Error("busy");
            }),
        });
        setupPiDriverIpc(() => driver as never);
        driver.detectSync.mockClear();
        await expect(handlers.get("pi:uninstall")!({})).resolves.toMatchObject({
            code: "ipcErrors.pi.uninstallFailed",
            fallback: expect.stringContaining("busy"),
        });
        expect(driver.detectSync).not.toHaveBeenCalled();
    });

    it("null driver returns driverNotInitialized for status/update/uninstall", async () => {
        setupPiDriverIpc(() => null);
        for (const channel of ["pi:status", "pi:refresh-status", "pi:update", "pi:uninstall"]) {
            await expect(handlers.get(channel)!({})).resolves.toMatchObject({
                code: "ipcErrors.pi.driverNotInitialized",
            });
        }
        // cancel-operation remains a silent no-op with null driver
        await expect(handlers.get("pi:cancel-operation")!({})).resolves.toBeUndefined();
    });

    it("update success re-detects status after driver.update", async () => {
        const driver = createDriver();
        setupPiDriverIpc(() => driver as never);
        const result = await handlers.get("pi:update")!({});
        expect(driver.update).toHaveBeenCalledTimes(1);
        expect(driver.detectSync).toHaveBeenCalled();
        expect(result).toMatchObject({ installed: true });
    });
});
