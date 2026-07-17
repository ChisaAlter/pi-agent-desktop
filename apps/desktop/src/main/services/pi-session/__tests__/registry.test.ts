import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceRegistry } from "../registry";
import { resolveBundledDesktopExtensionPaths } from "../factory";

const subscribe = vi.fn();
const setModel = vi.fn(async () => true);

vi.mock("../factory", () => ({
    resolveBundledDesktopExtensionPaths: vi.fn(() => []),
    createWorkspaceSession: vi.fn(async (opts: any) => ({
        workspaceId: opts.workspaceId,
        session: { dispose: vi.fn(), subscribe },
        dispose: vi.fn(),
        setModel,
    })),
}));

describe("WorkspaceRegistry", () => {
    let reg: WorkspaceRegistry;

    beforeEach(() => {
        subscribe.mockReset();
        setModel.mockClear();
        vi.mocked(resolveBundledDesktopExtensionPaths).mockClear();
        reg = new WorkspaceRegistry();
    });

    it("creates a session on first get", async () => {
        const ws = await reg.get("ws_1", "C:/tmp/a");
        expect(ws.workspaceId).toBe("ws_1");
    });

    it("omits generated UI when the setting is disabled", async () => {
        await reg.get("ws_1", "C:/tmp/a", undefined, undefined, undefined, false);

        expect(resolveBundledDesktopExtensionPaths).toHaveBeenCalledWith({
            generatedUiEnabled: false,
        });
    });

    it("reuses existing session on second get", async () => {
        const a = await reg.get("ws_1", "C:/tmp/a");
        const b = await reg.get("ws_1", "C:/tmp/a");
        expect(a).toBe(b);
    });

    it("switches all live workspace sessions in place", async () => {
        await reg.get("ws_1", "C:/tmp/a");
        await reg.get("ws_2", "C:/tmp/b");

        await reg.setModelForAll("mimo", "mimo-v2.5");

        expect(setModel).toHaveBeenCalledTimes(2);
        expect(setModel).toHaveBeenNthCalledWith(1, "mimo", "mimo-v2.5");
        expect(setModel).toHaveBeenNthCalledWith(2, "mimo", "mimo-v2.5");
    });

    it("invokes the latest onTurnEnd hook for sessions subscribed before hook registration", async () => {
        const send = vi.fn();
        const pendingEdits = { autoApprove: false } as any;
        await reg.get("ws_1", "C:/tmp/a", pendingEdits, send);
        const subscribedCallback = subscribe.mock.calls[0]?.[0];
        expect(subscribedCallback).toBeTypeOf("function");

        const firstHook = vi.fn();
        const secondHook = vi.fn();
        reg.setOnTurnEnd(firstHook);
        await subscribedCallback({ type: "turn_end" });
        reg.setOnTurnEnd(secondHook);
        await subscribedCallback({ type: "turn_end" });
        reg.setOnTurnEnd(undefined);
        await subscribedCallback({ type: "turn_end" });

        expect(firstHook).toHaveBeenCalledTimes(1);
        expect(secondHook).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", { type: "turn_end" });
    });

    it("dispose removes session", async () => {
        await reg.get("ws_1", "C:/tmp/a");
        reg.dispose("ws_1");
        expect(reg.has("ws_1")).toBe(false);
    });

    it("disposeAll on shutdown", async () => {
        await reg.get("ws_1", "C:/tmp/a");
        await reg.get("ws_2", "C:/tmp/b");
        reg.disposeAll();
        expect(reg.size()).toBe(0);
    });

    it("dispose on missing key is a no-op", () => {
        expect(() => reg.dispose("nonexistent")).not.toThrow();
    });
});

// ── Watchdog (5 分钟卡死检测) ───────────────────────────────────────────
// armWatchdog 在 agent_start / message_start 触发, disarmWatchdog 在
// agent_end / turn_end / extension_error 触发. 超过 WATCHDOG_MS (5 min)
// 无任何事件 → 合成 extension_error 通知 renderer 翻转状态.
describe("WorkspaceRegistry watchdog", () => {
    let reg: WorkspaceRegistry;

    beforeEach(() => {
        subscribe.mockReset();
        reg = new WorkspaceRegistry();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("fires extension_error when no events arrive within 5 minutes", async () => {
        const send = vi.fn();
        const pendingEdits = { autoApprove: false } as any;
        await reg.get("ws_1", "C:/tmp/a", pendingEdits, send);
        const subscribed = subscribe.mock.calls[0]?.[0];
        expect(subscribed).toBeTypeOf("function");

        // agent_start arms the watchdog (5 min timeout)
        await subscribed({ type: "agent_start" });

        // The watchdog callback checks `idle > WATCHDOG_MS`. With fake timers,
        // advancing exactly WATCHDOG_MS makes Date.now() == lastActivity +
        // WATCHDOG_MS, so `idle > WATCHDOG_MS` is false (off-by-one). To make
        // the check pass, we bump the system clock past the deadline BEFORE
        // firing the timer, so Date.now() inside the callback is clearly past
        // the 5-minute mark.
        const armTime = Date.now();
        vi.setSystemTime(armTime + 5 * 60 * 1000 + 100);
        await vi.runAllTimersAsync();

        const errorCall = send.mock.calls.find(
            ([channel, , payload]) =>
                channel === "pi:event" &&
                (payload as { type?: string })?.type === "extension_error",
        );
        expect(errorCall).toBeDefined();
        if (errorCall) {
            const [, workspaceId, payload] = errorCall;
            expect(workspaceId).toBe("ws_1");
            expect((payload as { message?: string }).message).toContain("会话运行超时");
        }
    });

    it("disarms watchdog on agent_end and does not fire extension_error", async () => {
        const send = vi.fn();
        const pendingEdits = { autoApprove: false } as any;
        await reg.get("ws_1", "C:/tmp/a", pendingEdits, send);
        const subscribed = subscribe.mock.calls[0]?.[0];
        expect(subscribed).toBeTypeOf("function");

        // agent_start arms the watchdog
        await subscribed({ type: "agent_start" });

        // Advance 3 minutes (still within the 5-minute window)
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

        // agent_end disarms the watchdog
        await subscribed({ type: "agent_end" });

        // Advance another 3 minutes (would have exceeded 5 min from arm
        // time, but the watchdog was disarmed)
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

        const errorCall = send.mock.calls.find(
            ([channel, , payload]) =>
                channel === "pi:event" &&
                (payload as { type?: string })?.type === "extension_error",
        );
        expect(errorCall).toBeUndefined();
    });
});
