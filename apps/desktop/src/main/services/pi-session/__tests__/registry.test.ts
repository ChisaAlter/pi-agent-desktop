import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceRegistry } from "../registry";
import { createWorkspaceSession, resolveBundledDesktopExtensionPaths } from "../factory";

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
        vi.mocked(createWorkspaceSession).mockClear();
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

    it("dispose during in-flight creation does not resurrect a session", async () => {
        // 创建挂起期间执行 dispose → 创建完成后 session 必须被作废,
        // 不能重新注册到 entries (旧行为会复活一个绑定已删工作区的活会话)。
        let releaseCreate!: (value: unknown) => void;
        vi.mocked(createWorkspaceSession).mockImplementationOnce(
            () => new Promise((resolve) => { releaseCreate = resolve; }),
        );
        const getPromise = reg.get("ws_1", "C:/tmp/a");
        await vi.waitFor(() => expect(createWorkspaceSession).toHaveBeenCalledTimes(1));
        reg.dispose("ws_1");
        releaseCreate({
            workspaceId: "ws_1",
            session: { dispose: vi.fn(), subscribe },
            dispose: vi.fn(),
            setModel,
        });

        await expect(getPromise).rejects.toThrow(/disposed/);
        expect(reg.has("ws_1")).toBe(false);
        expect(reg.size()).toBe(0);

        // 被删除后重新打开: dispose 标记应被清除, 可正常重建。
        const ws = await reg.get("ws_1", "C:/tmp/a");
        expect(ws.workspaceId).toBe("ws_1");
        expect(reg.has("ws_1")).toBe(true);
    });

    it("drops forwarded events after the session is disposed", async () => {
        // dispose 与订阅并发 (订阅回调已注册后才 dispose): 后续事件不得再
        // 转发给 renderer — 否则已删除工作区的事件会继续冒泡。
        const send = vi.fn();
        const pendingEdits = { autoApprove: false } as any;
        await reg.get("ws_1", "C:/tmp/a", pendingEdits, send);
        const subscribedCallback = subscribe.mock.calls[0]?.[0];
        expect(subscribedCallback).toBeTypeOf("function");

        reg.dispose("ws_1");
        await subscribedCallback({ type: "agent_end" });
        await subscribedCallback({ type: "text_delta", delta: "stale" });

        expect(send).not.toHaveBeenCalled();
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

        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

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

    it("does not let automatic retry events postpone the watchdog", async () => {
        const send = vi.fn();
        const pendingEdits = { autoApprove: false } as any;
        await reg.get("ws_1", "C:/tmp/a", pendingEdits, send);
        const subscribed = subscribe.mock.calls[0]?.[0];
        expect(subscribed).toBeTypeOf("function");

        await subscribed({ type: "agent_start" });
        await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
        await subscribed({ type: "auto_retry_start" });
        await vi.advanceTimersByTimeAsync(60 * 1000);

        expect(send).toHaveBeenCalledWith(
            "pi:event",
            "ws_1",
            expect.objectContaining({ type: "extension_error" }),
        );
    });
});
