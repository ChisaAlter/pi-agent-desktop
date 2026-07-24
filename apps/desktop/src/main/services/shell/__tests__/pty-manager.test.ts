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

    it("write throws when the terminal is missing or closed", () => {
        expect(() => mgr.write("missing", "ls\n")).toThrow('Pty "missing" does not exist');
    });

    it("write rethrows pty write errors", async () => {
        await mgr.create({ id: "p1" });
        fakePtys[0].write.mockImplementationOnce(() => {
            throw new Error("pty write failed");
        });

        expect(() => mgr.write("p1", "ls\n")).toThrow("pty write failed");
    });

    it("resize calls pty.resize", async () => {
        await mgr.create({ id: "p1" });
        mgr.resize("p1", 100, 30);
        const fakePty = fakePtys[0];
        expect(fakePty.resize).toHaveBeenCalledWith(100, 30);
    });

    it("resize throws when the terminal is missing", () => {
        expect(() => mgr.resize("missing", 100, 30)).toThrow('Pty "missing" does not exist');
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

    it("closeAll kills every live pty (A-008 quit process-tree contract)", async () => {
        await mgr.create({ id: "p1" });
        await mgr.create({ id: "p2" });
        await mgr.create({ id: "p3" });
        expect(mgr.size()).toBe(3);

        mgr.closeAll();

        expect(mgr.size()).toBe(0);
        expect(fakePtys[0].kill).toHaveBeenCalledTimes(1);
        expect(fakePtys[1].kill).toHaveBeenCalledTimes(1);
        expect(fakePtys[2].kill).toHaveBeenCalledTimes(1);
        expect(mgr.list()).toEqual([]);
    });

    it("closeAll continues when one pty.kill throws (quit must not hang)", async () => {
        await mgr.create({ id: "p1" });
        await mgr.create({ id: "p2" });
        fakePtys[0].kill.mockImplementationOnce(() => {
            throw new Error("kill failed");
        });

        expect(() => mgr.closeAll()).not.toThrow();
        expect(mgr.size()).toBe(0);
        expect(fakePtys[0].kill).toHaveBeenCalled();
        expect(fakePtys[1].kill).toHaveBeenCalled();
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

    // wave-92 residual
    it("size tracks open ptys", async () => {
        expect(mgr.size()).toBe(0);
        await mgr.create({ id: "p1" });
        await mgr.create({ id: "p2" });
        expect(mgr.size()).toBe(2);
        mgr.close("p1");
        expect(mgr.size()).toBe(1);
    });

    it("get returns entry metadata after create", async () => {
        const entry = await mgr.create({ id: "meta", cwd: "C:/tmp/ws", cols: 120, rows: 40 });
        expect(entry.cwd).toBe("C:/tmp/ws");
        expect(mgr.get("meta")?.title).toBe("meta");
        expect(mgr.get("missing")).toBeUndefined();
    });

    it("onOutput unsubscribe stops further delivery", async () => {
        const listener = vi.fn();
        const off = mgr.onOutput(listener);
        await mgr.create({ id: "p1" });
        fakePtys[0]._emit("a");
        expect(listener).toHaveBeenCalledWith("p1", "a");
        off();
        fakePtys[0]._emit("b");
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("onExit unsubscribe stops further delivery", async () => {
        const listener = vi.fn();
        const off = mgr.onExit(listener);
        await mgr.create({ id: "p1" });
        off();
        fakePtys[0]._exit(1);
        expect(listener).not.toHaveBeenCalled();
        expect(mgr.has("p1")).toBe(false);
    });

    it("generateId includes counter suffix uniqueness under same clock", () => {
        const ids = new Set(Array.from({ length: 20 }, () => mgr.generateId()));
        expect(ids.size).toBe(20);
    });
});
