import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkspaceRegistry } from "../registry";

const subscribe = vi.fn();

vi.mock("../factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: any) => ({
        workspaceId: opts.workspaceId,
        session: { dispose: vi.fn(), subscribe },
        dispose: vi.fn(),
    })),
}));

describe("WorkspaceRegistry", () => {
    let reg: WorkspaceRegistry;

    beforeEach(() => {
        subscribe.mockReset();
        reg = new WorkspaceRegistry();
    });

    it("creates a session on first get", async () => {
        const ws = await reg.get("ws_1", "C:/tmp/a");
        expect(ws.workspaceId).toBe("ws_1");
    });

    it("reuses existing session on second get", async () => {
        const a = await reg.get("ws_1", "C:/tmp/a");
        const b = await reg.get("ws_1", "C:/tmp/a");
        expect(a).toBe(b);
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
