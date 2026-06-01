// PtyManager tests (M4 Task M4-2)
// TDD 测 manager 的状态管理 (Pty 本身是 native module, 测不了 spawn, 所以 mock 掉)

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock node-pty with a fake
const fakePtys: any[] = [];
vi.mock("node-pty", () => ({
    spawn: vi.fn((cmd: string) => {
        const pty: any = {
            _id: fakePtys.length,
            _dataHandlers: [] as any[],
            _exitHandlers: [] as any[],
            onData: (cb: any) => pty._dataHandlers.push(cb),
            onExit: (cb: any) => pty._exitHandlers.push(cb),
            write: vi.fn(),
            resize: vi.fn(),
            kill: vi.fn(),
            _emit: (data: string) => pty._dataHandlers.forEach((h: any) => h(data)),
            _exit: (code: number) => pty._exitHandlers.forEach((h: any) => h({ exitCode: code })),
        };
        fakePtys.push(pty);
        return pty;
    }),
}));

import { PtyManager } from "../pty-manager";

describe("PtyManager", () => {
    let mgr: PtyManager;

    beforeEach(() => {
        mgr = new PtyManager();
        fakePtys.length = 0;
    });

    it("create returns entry and stores it", async () => {
        const entry = await mgr.create({ id: "p1" });
        expect(entry.id).toBe("p1");
        expect(mgr.has("p1")).toBe(true);
        expect(mgr.size()).toBe(1);
    });

    it("create throws on duplicate id", async () => {
        await mgr.create({ id: "p1" });
        await expect(mgr.create({ id: "p1" })).rejects.toThrow();
    });

    it("get returns entry by id", async () => {
        await mgr.create({ id: "p1" });
        expect(mgr.get("p1")?.id).toBe("p1");
        expect(mgr.get("nope")).toBeUndefined();
    });

    it("write calls pty.write", async () => {
        await mgr.create({ id: "p1" });
        mgr.write("p1", "ls\n");
        const fakePty = fakePtys[0];
        expect(fakePty.write).toHaveBeenCalledWith("ls\n");
    });

    it("resize calls pty.resize", async () => {
        await mgr.create({ id: "p1" });
        mgr.resize("p1", 100, 30);
        const fakePty = fakePtys[0];
        expect(fakePty.resize).toHaveBeenCalledWith(100, 30);
    });

    it("close removes entry and calls kill", async () => {
        await mgr.create({ id: "p1" });
        mgr.close("p1");
        expect(mgr.has("p1")).toBe(false);
        const fakePty = fakePtys[0];
        expect(fakePty.kill).toHaveBeenCalled();
    });

    it("close on missing id is no-op", () => {
        expect(() => mgr.close("nope")).not.toThrow();
    });

    it("closeAll removes all entries", async () => {
        await mgr.create({ id: "p1" });
        await mgr.create({ id: "p2" });
        mgr.closeAll();
        expect(mgr.size()).toBe(0);
    });

    it("emits output via onOutput listener", async () => {
        const listener = vi.fn();
        mgr.onOutput(listener);
        await mgr.create({ id: "p1" });
        fakePtys[0]._emit("hello");
        expect(listener).toHaveBeenCalledWith("p1", "hello");
    });

    it("emits exit and removes entry on pty exit", async () => {
        const exitListener = vi.fn();
        mgr.onExit(exitListener);
        await mgr.create({ id: "p1" });
        fakePtys[0]._exit(0);
        expect(exitListener).toHaveBeenCalledWith("p1", 0);
        expect(mgr.has("p1")).toBe(false);
    });

    it("generateId returns unique ids", () => {
        const a = mgr.generateId();
        const b = mgr.generateId();
        expect(a).not.toBe(b);
    });

    it("list returns entries sorted by createdAt", async () => {
        await mgr.create({ id: "p1" });
        await mgr.create({ id: "p2" });
        const list = mgr.list();
        expect(list.length).toBe(2);
        expect(list[0].id).toBe("p1");
        expect(list[1].id).toBe("p2");
    });
});
