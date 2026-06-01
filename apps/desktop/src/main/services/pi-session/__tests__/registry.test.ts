import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkspaceRegistry } from "../registry";

vi.mock("../factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: any) => ({
        workspaceId: opts.workspaceId,
        session: { dispose: vi.fn() },
        dispose: vi.fn(),
    })),
}));

describe("WorkspaceRegistry", () => {
    let reg: WorkspaceRegistry;

    beforeEach(() => {
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
