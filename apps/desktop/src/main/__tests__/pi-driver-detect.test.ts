import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, execSyncMock, execFileSyncMock, spawnSyncMock } = vi.hoisted(() => ({
    existsSyncMock: vi.fn(() => false),
    execSyncMock: vi.fn(() => {
        throw new Error("not found");
    }),
    execFileSyncMock: vi.fn(() => {
        throw new Error("not found");
    }),
    spawnSyncMock: vi.fn(() => ({ status: 1, stdout: "", stderr: "" })),
}));

vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return {
        ...actual,
        existsSync: existsSyncMock,
        readFileSync: vi.fn(() => {
            throw new Error("missing");
        }),
        readdirSync: vi.fn(() => []),
        renameSync: vi.fn(),
        rmSync: vi.fn(),
    };
});

vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    return {
        ...actual,
        execSync: execSyncMock,
        execFileSync: execFileSyncMock,
        spawnSync: spawnSyncMock,
        spawn: vi.fn(),
    };
});

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { PiDriver } from "../pi-driver";

describe("PiDriver detectSync when Pi CLI is missing (B-002)", () => {
    beforeEach(() => {
        existsSyncMock.mockReset();
        existsSyncMock.mockReturnValue(false);
        execSyncMock.mockReset();
        execSyncMock.mockImplementation(() => {
            throw new Error("not found");
        });
        execFileSyncMock.mockReset();
        execFileSyncMock.mockImplementation(() => {
            throw new Error("not found");
        });
        spawnSyncMock.mockReset();
        spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "" });
    });

    it("reports installed=false with actionable empty fields when PATH/common/managed miss", () => {
        const driver = new PiDriver();
        const status = driver.detectSync();

        expect(status.installed).toBe(false);
        expect(status.executablePath).toBeNull();
        expect(status.localVersion).toBeNull();
        expect(status.runtimeSource === "none" || status.runtimeSource === undefined || status.runtimeSource === "global").toBe(true);
        expect(status.installMethod === "unknown" || typeof status.installMethod === "string").toBe(true);
        // UI consumers rely on installed flag, not throw
        expect(status).toMatchObject({
            installed: false,
            updateAvailable: false,
        });
    });

    it("does not throw when which/where and npm prefix probes fail", () => {
        execSyncMock.mockImplementation(() => {
            throw new Error("where failed");
        });
        execFileSyncMock.mockImplementation(() => {
            throw new Error("npm failed");
        });
        const driver = new PiDriver();
        expect(() => driver.detectSync()).not.toThrow();
        expect(driver.detectSync().installed).toBe(false);
    });

    // wave-231 residual
    it("repeated detectSync stays installed=false without mutating executablePath", () => {
        const driver = new PiDriver();
        const a = driver.detectSync();
        const b = driver.detectSync();
        expect(a.installed).toBe(false);
        expect(b.installed).toBe(false);
        expect(a.executablePath).toBeNull();
        expect(b.executablePath).toBeNull();
        expect(a.updateAvailable).toBe(false);
        expect(b.updateAvailable).toBe(false);
    });


  // wave-303 residual
  it("detectSync missing CLI: installed false, null path/version, updateAvailable false", () => {
    const driver = new PiDriver();
    const status = driver.detectSync();
    expect(status.installed).toBe(false);
    expect(status.executablePath).toBeNull();
    expect(status.localVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  it("detectSync is idempotent when all probes throw/miss", () => {
    const driver = new PiDriver();
    const first = driver.detectSync();
    const second = driver.detectSync();
    expect(first).toMatchObject({ installed: false, executablePath: null, updateAvailable: false });
    expect(second).toMatchObject({ installed: false, executablePath: null, updateAvailable: false });
  });

});
