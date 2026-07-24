import { beforeEach, describe, expect, it, vi } from "vitest";

const webContentsSend = vi.fn();

vi.mock("electron", () => ({
    BrowserWindow: class MockBrowserWindow {
        isDestroyed = () => false;
        webContents = { send: webContentsSend };
    },
}));

import {
    _pendingCount,
    clearAllPendingApprovals,
    requestApproval,
    resolveApprovalRequest,
    setWorkspaceWindow,
} from "../approval-bridge";
import { BrowserWindow } from "electron";

describe("clearAllPendingApprovals (E-004 window-close recovery)", () => {
    beforeEach(() => {
        clearAllPendingApprovals();
        webContentsSend.mockReset();
        vi.useRealTimers();
    });

    it("rejects every pending approval as false so agents do not hang on window close", async () => {
        const win = new BrowserWindow() as unknown as BrowserWindow;
        setWorkspaceWindow("ws-a", win);
        setWorkspaceWindow("ws-b", win);

        const p1 = requestApproval({
            method: "confirm",
            title: "run",
            message: "rm -rf /",
            workspaceId: "ws-a",
            timeoutMs: 60_000,
        });
        const p2 = requestApproval({
            method: "confirm",
            title: "write",
            message: "secret",
            workspaceId: "ws-b",
            timeoutMs: 60_000,
        });

        expect(_pendingCount()).toBe(2);

        clearAllPendingApprovals();

        await expect(p1).resolves.toBe(false);
        await expect(p2).resolves.toBe(false);
        expect(_pendingCount()).toBe(0);
    });

    it("is idempotent when called with an empty pending map", () => {
        expect(() => clearAllPendingApprovals()).not.toThrow();
        expect(_pendingCount()).toBe(0);
    });

    // wave-92 residual
    it("rejects immediately when no window is registered for the workspace", async () => {
        await expect(
            requestApproval({
                method: "confirm",
                title: "no-window",
                workspaceId: "ws-missing",
                timeoutMs: 60_000,
            }),
        ).resolves.toBe(false);
        expect(_pendingCount()).toBe(0);
        expect(webContentsSend).not.toHaveBeenCalled();
    });

    it("resolves a pending approval as true and drops the pending entry", async () => {
        const win = new BrowserWindow() as unknown as BrowserWindow;
        setWorkspaceWindow("ws-ok", win);
        const pending = requestApproval({
            method: "confirm",
            title: "ok",
            workspaceId: "ws-ok",
            timeoutMs: 60_000,
        });
        expect(_pendingCount()).toBe(1);
        expect(webContentsSend).toHaveBeenCalledWith(
            "approval:request",
            expect.objectContaining({
                method: "confirm",
                title: "ok",
                workspaceId: "ws-ok",
                requestId: expect.any(String),
            }),
        );
        const requestId = webContentsSend.mock.calls[0][1].requestId as string;
        resolveApprovalRequest(requestId, true);
        await expect(pending).resolves.toBe(true);
        expect(_pendingCount()).toBe(0);
    });

    it("times out to false when renderer never answers", async () => {
        vi.useFakeTimers();
        const win = new BrowserWindow() as unknown as BrowserWindow;
        setWorkspaceWindow("ws-timeout", win);
        const pending = requestApproval({
            method: "confirm",
            title: "slow",
            workspaceId: "ws-timeout",
            timeoutMs: 1_000,
        });
        expect(_pendingCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toBe(false);
        expect(_pendingCount()).toBe(0);
        vi.useRealTimers();
    });

    it("ignores resolve for unknown request ids", () => {
        expect(() => resolveApprovalRequest("missing-id", true)).not.toThrow();
        expect(_pendingCount()).toBe(0);
    });

    // wave-226 residual
    it("resolveApprovalRequest false rejects pending; double-resolve is ignored", async () => {
        const win = new BrowserWindow() as unknown as BrowserWindow;
        setWorkspaceWindow("ws-r", win);
        const pending = requestApproval({
            method: "confirm",
            title: "deny-me",
            workspaceId: "ws-r",
            timeoutMs: 60_000,
        });
        const requestId = webContentsSend.mock.calls.at(-1)?.[1].requestId as string;
        resolveApprovalRequest(requestId, false);
        await expect(pending).resolves.toBe(false);
        expect(_pendingCount()).toBe(0);
        expect(() => resolveApprovalRequest(requestId, true)).not.toThrow();
        expect(_pendingCount()).toBe(0);
    });

    it("select method still sends approval:request payload with method select", async () => {
        const win = new BrowserWindow() as unknown as BrowserWindow;
        setWorkspaceWindow("ws-sel", win);
        const pending = requestApproval({
            method: "select",
            title: "choose",
            message: "a or b",
            workspaceId: "ws-sel",
            timeoutMs: 60_000,
        });
        expect(webContentsSend).toHaveBeenCalledWith(
            "approval:request",
            expect.objectContaining({
                method: "select",
                title: "choose",
                message: "a or b",
                workspaceId: "ws-sel",
            }),
        );
        const requestId = webContentsSend.mock.calls.at(-1)?.[1].requestId as string;
        resolveApprovalRequest(requestId, true);
        await expect(pending).resolves.toBe(true);
    });

    it("clearAllPendingApprovals after resolve leaves map empty and does not throw", async () => {
        const win = new BrowserWindow() as unknown as BrowserWindow;
        setWorkspaceWindow("ws-c", win);
        const pending = requestApproval({
            method: "confirm",
            title: "x",
            workspaceId: "ws-c",
            timeoutMs: 60_000,
        });
        const requestId = webContentsSend.mock.calls.at(-1)?.[1].requestId as string;
        resolveApprovalRequest(requestId, true);
        await pending;
        clearAllPendingApprovals();
        expect(_pendingCount()).toBe(0);
    });
});
