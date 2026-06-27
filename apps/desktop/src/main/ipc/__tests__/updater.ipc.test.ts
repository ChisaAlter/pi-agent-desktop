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
});
