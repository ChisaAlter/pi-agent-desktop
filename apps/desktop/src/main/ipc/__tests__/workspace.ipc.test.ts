import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError } from "@shared";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
    dialog: {
        showOpenDialog: vi.fn(),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { setupWorkspaceIpc } from "../workspace.ipc";

interface WorkspaceRecord {
    id: string;
    name: string;
    path: string;
    createdAt: number;
    lastActiveAt?: number;
}

function makeStore(seed: WorkspaceRecord[]) {
    const raw = [...seed];
    return {
        get(_key: "workspaces") {
            return raw;
        },
        set(_key: "workspaces", value: WorkspaceRecord[]) {
            raw.length = 0;
            raw.push(...value);
        },
        raw,
    };
}

describe("workspace:select", () => {
    beforeEach(() => {
        handlers.clear();
    });

    it("updates the persisted workspace lastActiveAt for the selected path", async () => {
        const previousActiveAt = Date.now() - 60_000;
        const store = makeStore([
            {
                id: "ws-1",
                name: "repo",
                path: "C:/repo",
                createdAt: previousActiveAt - 1000,
                lastActiveAt: previousActiveAt,
            },
        ]);
        setupWorkspaceIpc({
            store,
            getMainWindow: () => null,
        });

        const handler = handlers.get("workspace:select");
        expect(handler).toBeTruthy();

        const result = await handler?.({}, "C:/repo");

        expect(result).toBeUndefined();
        expect(store.raw[0]?.lastActiveAt).toBeTypeOf("number");
        expect((store.raw[0]?.lastActiveAt ?? 0)).toBeGreaterThan(previousActiveAt);
    });

    it("returns an IPC error when selecting a path that is not registered", async () => {
        const store = makeStore([
            {
                id: "ws-1",
                name: "repo",
                path: "C:/repo",
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            },
        ]);
        setupWorkspaceIpc({
            store,
            getMainWindow: () => null,
        });

        const handler = handlers.get("workspace:select");
        expect(handler).toBeTruthy();

        const result = await handler?.({}, "C:/missing");

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.workspace.selectFailed");
        }
    });
});
