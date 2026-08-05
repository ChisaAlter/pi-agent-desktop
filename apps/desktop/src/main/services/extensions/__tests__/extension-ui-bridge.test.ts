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
    configureExtensionUiBridgePersistence,
    createExtensionUiBridge,
    resolveExtensionUiRequest,
    setDesktopPermissionMode,
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

    it("mirrors plan todo widgets into a plan-progress callback for task registry updates", () => {
        const onPlanProgress = vi.fn();
        const bridge = (createExtensionUiBridge as unknown as (
            workspaceId: string,
            scope?: { agentId?: string },
            observers?: {
                onPlanProgress?: (payload: {
                    workspaceId: string;
                    agentId?: string;
                    items: Array<{ id: string; text: string; status: string }>;
                }) => void;
            },
        ) => ReturnType<typeof createExtensionUiBridge>)("ws_1", { agentId: "agent_1" }, { onPlanProgress });

        bridge.setWidget("plan-todos", [
            "[ ] gather evidence",
            "[x] write summary",
            "⏸ wait for approval",
        ]);

        expect(onPlanProgress).toHaveBeenCalledWith({
            workspaceId: "ws_1",
            agentId: "agent_1",
            items: [
                { id: "plan_step_0", text: "gather evidence", status: "pending" },
                { id: "plan_step_1", text: "write summary", status: "completed" },
                { id: "plan_step_2", text: "⏸ wait for approval", status: "waiting" },
            ],
        });
        expect(webContentsSend).toHaveBeenCalledWith("plan:progress", expect.objectContaining({
            workspaceId: "ws_1",
            agentId: "agent_1",
        }));
    });

    // wave-107 residual
    it("resolves confirm requests via resolveExtensionUiRequest", async () => {
        const bridge = createExtensionUiBridge("ws_1");
        const promise = bridge.confirm("Permission required", "Allow shell?");
        expect(_pendingExtensionUiRequestCount()).toBe(1);
        const requestPayload = webContentsSend.mock.calls.find((c) => c[0] === "permission:request")?.[1] as {
            requestId: string;
        };
        expect(requestPayload.requestId).toBeTruthy();
        resolveExtensionUiRequest(requestPayload.requestId, true);
        await expect(promise).resolves.toBe(true);
        expect(_pendingExtensionUiRequestCount()).toBe(0);
    });

    it("times out select requests to undefined and auto-approves in always mode", async () => {
        const bridge = createExtensionUiBridge("ws_1");
        const timed = bridge.select("Pick one", ["alpha", "beta"]);
        expect(_pendingExtensionUiRequestCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(timed).resolves.toBeUndefined();
        expect(_pendingExtensionUiRequestCount()).toBe(0);

        setDesktopPermissionMode("always", "ws_1");
        await expect(bridge.select("Permission: allow shell?", ["yes", "no"])).resolves.toBe("yes");
        await expect(bridge.confirm("Permission", "Allow write?")).resolves.toBe(true);
        expect(_pendingExtensionUiRequestCount()).toBe(0);
        setDesktopPermissionMode("smart", "ws_1");
    });

    it("keeps the three permission decisions distinct across repeated requests", async () => {
        const bridge = createExtensionUiBridge("ws_1", { sessionId: "session_1" });
        const request = (): Promise<string | undefined> => bridge.select("Permission: run shell", ["yes", "no"]);
        const resolveLatest = (decision: "allow_once" | "allow_session" | "allow_always" | "deny_session") => {
            const payload = webContentsSend.mock.calls.filter((call) => call[0] === "permission:request").at(-1)?.[1] as { requestId: string };
            expect(payload?.requestId).toBeTruthy();
            resolveExtensionUiRequest(payload.requestId, { requestId: payload.requestId, decision });
        };

        const once = request();
        resolveLatest("allow_once");
        await expect(once).resolves.toBe("yes");
        expect(_pendingExtensionUiRequestCount()).toBe(0);

        const session = request();
        resolveLatest("allow_session");
        await expect(session).resolves.toBe("yes");
        await expect(request()).resolves.toBe("yes");
        expect(_pendingExtensionUiRequestCount()).toBe(0);

        setDesktopPermissionMode("smart", "ws_1");
        const denied = createExtensionUiBridge("ws_1", { sessionId: "session_denied" }).select("Permission: remove file", ["yes", "no"]);
        resolveLatest("deny_session");
        await expect(denied).resolves.toBe("no");
        await expect(createExtensionUiBridge("ws_1", { sessionId: "session_denied" }).select("Permission: remove file", ["yes", "no"])).resolves.toBe("no");
    });

    it("persists allow_always per workspace and does not leak it to another workspace", async () => {
        const modes = new Map<string, "always">();
        configureExtensionUiBridgePersistence({
            getWorkspacePermissionMode: (workspaceId) => modes.get(workspaceId),
            setWorkspacePermissionMode: (workspaceId, mode) => {
                if (mode === "always") modes.set(workspaceId, mode);
                else modes.delete(workspaceId);
            },
        });
        const first = createExtensionUiBridge("ws_persist", { sessionId: "session_1" }).select("Permission: write file", ["yes", "no"]);
        const payload = webContentsSend.mock.calls.filter((call) => call[0] === "permission:request").at(-1)?.[1] as { requestId: string };
        resolveExtensionUiRequest(payload.requestId, { requestId: payload.requestId, decision: "allow_always" });
        await expect(first).resolves.toBe("yes");
        await expect(createExtensionUiBridge("ws_persist", { sessionId: "session_2" }).select("Permission: write file", ["yes", "no"])).resolves.toBe("yes");
        const other = createExtensionUiBridge("ws_other", { sessionId: "session_3" }).select("Permission: write file", ["yes", "no"]);
        expect(_pendingExtensionUiRequestCount()).toBe(1);
        clearPendingExtensionUiRequests();
        await expect(other).resolves.toBeUndefined();
    });

    it("maps failed/running plan widget markers using product parse rules", () => {
        const onPlanProgress = vi.fn();
        const bridge = createExtensionUiBridge("ws_1", { agentId: "a1" }, { onPlanProgress });
        // Product: checkbox strip only removes leading [ xX~!]; emoji markers stay in text.
        // failed: ❌|failed|失败; running: ▶|running|进行中|in_progress; [!] alone is pending.
        bridge.setWidget("plan-todos", ["❌ explode", "failed: broke", "▶ running step", "[!] note"]);
        expect(onPlanProgress).toHaveBeenCalledWith({
            workspaceId: "ws_1",
            agentId: "a1",
            items: [
                { id: "plan_step_0", text: "❌ explode", status: "failed" },
                { id: "plan_step_1", text: "failed: broke", status: "failed" },
                { id: "plan_step_2", text: "▶ running step", status: "running" },
                { id: "plan_step_3", text: "note", status: "pending" },
            ],
        });
    });
});
