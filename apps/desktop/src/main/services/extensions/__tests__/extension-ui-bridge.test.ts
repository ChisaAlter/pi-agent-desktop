import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webContentsSend = vi.fn();

vi.mock("electron", () => ({
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
        warn: vi.fn(),
    },
}));

import {
    _pendingExtensionUiRequestCount,
    clearPendingExtensionUiRequests,
    createExtensionUiBridge,
} from "../extension-ui-bridge";

describe("createExtensionUiBridge pending requests", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        webContentsSend.mockClear();
        clearPendingExtensionUiRequests();
    });

    afterEach(() => {
        clearPendingExtensionUiRequests();
        vi.useRealTimers();
    });

    it("times out confirm requests to false", async () => {
        const bridge = createExtensionUiBridge("ws_1");
        const promise = bridge.confirm("Permission required", "Allow shell?");

        expect(_pendingExtensionUiRequestCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(60_000);

        await expect(promise).resolves.toBe(false);
        expect(_pendingExtensionUiRequestCount()).toBe(0);
    });

    it("clears pending input requests to undefined", async () => {
        const bridge = createExtensionUiBridge("ws_1");
        const promise = bridge.input("Need value", "type here");

        expect(_pendingExtensionUiRequestCount()).toBe(1);
        clearPendingExtensionUiRequests();

        await expect(promise).resolves.toBeUndefined();
        expect(_pendingExtensionUiRequestCount()).toBe(0);
    });
});
