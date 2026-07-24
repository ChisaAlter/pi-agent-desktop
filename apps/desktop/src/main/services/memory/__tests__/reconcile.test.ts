/**
 * reconcile.ts 单元测试.
 *
 * 用一个内存 MockDb 实现 ReconcileDatabase, 在 mkdtempSync 临时目录里
 * 摆放 .md 文件来覆盖 prune / index / skip / I/O 错误 4 条主路径.
 *
 * 路径布局 (与 paths.ts 一致):
 *   <root>/global/MEMORY.md
 *   <root>/projects/<id>/MEMORY.md
 *   <root>/sessions/<sid>/checkpoint.md
 *
 * 测试中 rootDir 始终是 memory 根目录 (即 <userData>/memory 那一层),
 * 不是它的父目录 — 这跟 paths.ts 的 parsePath 约定一致.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
    reconcileMemory,
    type ReconcileDatabase,
    type ReconcileResult,
} from "../reconcile";

/** upsertIndex 调用入参 — 测试用, 字段比接口略宽 (scope/type 用 string 方便断言). */
interface UpsertCall {
    path: string;
    scope: string;
    scopeId?: string;
    type: string;
    body: string;
    fingerprint: string;
}

/**
 * 内存版 ReconcileDatabase. 把 upsert/delete 的副作用落到一个 Map 上,
 * 这样第二次 reconcile 时 loadIndexedPaths 能读到上一次的结果, 完整
 * 模拟 "磁盘 ↔ 索引" 的双向同步.
 *
 * upsertImpl 钩子用来在 I/O 错误场景下让 upsertIndex 抛错.
 */
class MockDb implements ReconcileDatabase {
    private indexed = new Map<
        string,
        { fingerprint: string; scope: string; scopeId?: string; type: string; body: string }
    >();
    readonly upsertCalls: UpsertCall[] = [];
    readonly deleteCalls: string[] = [];
    upsertImpl?: (input: UpsertCall) => void | Promise<void>;

    async loadIndexedPaths(): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        for (const [p, entry] of this.indexed) {
            out.set(p, entry.fingerprint);
        }
        return out;
    }

    async upsertIndex(input: UpsertCall): Promise<void> {
        // 先记账再调用 impl — 即使 impl 抛错, upsertCalls 也要留下调用记录,
        // 这样 I/O 错误场景的断言才能验证 "试过一次但失败了".
        this.upsertCalls.push(input);
        if (this.upsertImpl) await this.upsertImpl(input);
        this.indexed.set(input.path, {
            fingerprint: input.fingerprint,
            scope: input.scope,
            scopeId: input.scopeId,
            type: input.type,
            body: input.body,
        });
    }

    async deleteIndex(path: string): Promise<void> {
        this.deleteCalls.push(path);
        this.indexed.delete(path);
    }
}

describe("reconcileMemory", () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const d of dirs.splice(0)) {
            rmSync(d, { recursive: true, force: true });
        }
    });

    /** 创建一个临时 memory 根目录 (本身尚不存在, walkMemoryDir 会返回 []). */
    function makeMemoryRoot(): string {
        const tmp = mkdtempSync(join(tmpdir(), "memory-test-"));
        dirs.push(tmp);
        return join(tmp, "memory");
    }

    /** 在 <root>/<rel> 下创建一个 .md 文件, 自动创建中间目录. */
    function writeFile(root: string, rel: string, content: string): string {
        const file = join(root, rel);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
        return file;
    }

    /** 把路径里的反斜杠换成正斜杠, 方便跨平台断言. */
    function toForward(p: string): string {
        return p.replace(/\\/g, "/");
    }

    // ---------------------------------------------------------------
    // 1. 空目录 + 空索引 → {0,0,0}
    // ---------------------------------------------------------------
    it("1. 空目录 + 空索引 → {indexed:0, pruned:0, skipped:0}", async () => {
        const root = makeMemoryRoot();
        const db = new MockDb();
        const r = await reconcileMemory(root, db);
        expect(r).toEqual<ReconcileResult>({ indexed: 0, pruned: 0, skipped: 0 });
        expect(db.upsertCalls).toHaveLength(0);
        expect(db.deleteCalls).toHaveLength(0);
    });

    // ---------------------------------------------------------------
    // 2. 新文件 → indexed=1
    // ---------------------------------------------------------------
    it("2. 新文件 → indexed=1, pruned=0, skipped=0", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "hello world");
        const db = new MockDb();
        const r = await reconcileMemory(root, db);
        expect(r).toEqual<ReconcileResult>({ indexed: 1, pruned: 0, skipped: 0 });
        expect(db.upsertCalls).toHaveLength(1);
    });

    // ---------------------------------------------------------------
    // 3. 未变文件 → 第二次 reconcile 同一文件 skipped=1
    // ---------------------------------------------------------------
    it("3. 未变文件 → 第二次 skipped=1", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "stable content");
        const db = new MockDb();

        const r1 = await reconcileMemory(root, db);
        expect(r1.indexed).toBe(1);

        // 第二次 — fingerprint 应该完全相同, 命中 skip 分支
        const r2 = await reconcileMemory(root, db);
        expect(r2).toEqual<ReconcileResult>({ indexed: 0, pruned: 0, skipped: 1 });
        // 第二次没新增 upsert 调用
        expect(db.upsertCalls).toHaveLength(1);
    });

    // ---------------------------------------------------------------
    // 4. 修改文件 (mtime 变化) → indexed=1
    // ---------------------------------------------------------------
    it("4. 修改文件 (mtime 变化) → indexed=1, skipped=0", async () => {
        const root = makeMemoryRoot();
        const file = writeFile(root, "global/MEMORY.md", "v1");
        const db = new MockDb();

        await reconcileMemory(root, db);
        expect(db.upsertCalls).toHaveLength(1);
        const firstFp = db.upsertCalls[0]!.fingerprint;

        // 改内容 (注意 "v1" 与 "v2" 都是 2 字节, size 不变, 必须靠 mtime 触发)
        writeFileSync(file, "v2");
        // utimesSync 强制 mtime 跳到 100 秒之后, 避开 mtime 分辨率问题
        const future = Date.now() / 1000 + 100;
        utimesSync(file, future, future);

        const r2 = await reconcileMemory(root, db);
        expect(r2).toEqual<ReconcileResult>({ indexed: 1, pruned: 0, skipped: 0 });
        expect(db.upsertCalls).toHaveLength(2);
        expect(db.upsertCalls[1]!.fingerprint).not.toBe(firstFp);
    });

    // ---------------------------------------------------------------
    // 5. 删除文件 → pruned=1
    // ---------------------------------------------------------------
    it("5. 删除磁盘文件 → pruned=1, indexed=0, skipped=0", async () => {
        const root = makeMemoryRoot();
        const file = writeFile(root, "global/MEMORY.md", "to be removed");
        const db = new MockDb();

        await reconcileMemory(root, db);
        expect(db.upsertCalls).toHaveLength(1);

        rmSync(file);
        const r2 = await reconcileMemory(root, db);
        expect(r2).toEqual<ReconcileResult>({ indexed: 0, pruned: 1, skipped: 0 });
        expect(db.deleteCalls).toHaveLength(1);
    });

    // ---------------------------------------------------------------
    // 6. 混合: 1 新增 + 1 删除 + 1 未变
    // ---------------------------------------------------------------
    it("6. 混合: 1 新增 + 1 删除 + 1 未变 → {indexed:1, pruned:1, skipped:1}", async () => {
        const root = makeMemoryRoot();
        const unchanged = writeFile(root, "global/MEMORY.md", "stable");
        const toDelete = writeFile(root, "projects/p1/MEMORY.md", "going away");
        const db = new MockDb();

        await reconcileMemory(root, db);
        expect(db.upsertCalls).toHaveLength(2);

        // 删一个, 加一个 — unchanged 不动
        rmSync(toDelete);
        writeFile(root, "sessions/s1/checkpoint.md", "fresh session");

        const r2 = await reconcileMemory(root, db);
        expect(r2).toEqual<ReconcileResult>({ indexed: 1, pruned: 1, skipped: 1 });
        // unchanged 的文件 path 不该出现在第二次的 upsertCalls 里
        const secondUpsertPaths = db.upsertCalls.slice(2).map((c) => toForward(c.path));
        expect(secondUpsertPaths).not.toContain(toForward(unchanged));
    });

    // ---------------------------------------------------------------
    // 7. I/O 错误 (upsertIndex 抛错) → 不中断, 计入 skipped
    // ---------------------------------------------------------------
    it("7. I/O 错误 → 不中断, 计入 skipped", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "won't be indexed");
        const db = new MockDb();
        db.upsertImpl = () => {
            throw new Error("simulated SQLite write failure");
        };

        const r = await reconcileMemory(root, db);
        expect(r).toEqual<ReconcileResult>({ indexed: 0, pruned: 0, skipped: 1 });
        // upsertImpl 抛了, 但调用本身记下来了
        expect(db.upsertCalls).toHaveLength(1);
    });

    // ---------------------------------------------------------------
    // 8. 嵌套目录: projects/<id>/MEMORY.md, sessions/<sid>/checkpoint.md
    // ---------------------------------------------------------------
    it("8. 嵌套目录 → 同时 index 多 scope 文件", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "projects/proj1/MEMORY.md", "p1 mem");
        writeFile(root, "sessions/sess1/checkpoint.md", "s1 ckpt");

        const db = new MockDb();
        const r = await reconcileMemory(root, db);
        expect(r).toEqual<ReconcileResult>({ indexed: 2, pruned: 0, skipped: 0 });
        expect(db.upsertCalls).toHaveLength(2);
    });

    // ---------------------------------------------------------------
    // 9. 非 .md 文件: walkMemoryDir 已过滤, 不会进到 index 分支
    // ---------------------------------------------------------------
    it("9. 非 .md 文件 (.txt, .json) 不被索引", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "md content");
        // 同目录下摆几个非 .md 文件
        const txtFile = join(root, "global", "notes.txt");
        const jsonFile = join(root, "global", "data.json");
        writeFileSync(txtFile, "txt content");
        writeFileSync(jsonFile, "{}");

        const db = new MockDb();
        const r = await reconcileMemory(root, db);
        expect(r).toEqual<ReconcileResult>({ indexed: 1, pruned: 0, skipped: 0 });

        const upsertedPaths = db.upsertCalls.map((c) => toForward(c.path));
        expect(upsertedPaths).not.toContain(toForward(txtFile));
        expect(upsertedPaths).not.toContain(toForward(jsonFile));
    });

    // ---------------------------------------------------------------
    // 10. scope/type 解析: 验证 upsertIndex 收到正确的 scope/scopeId/type
    // ---------------------------------------------------------------
    it("10. scope/type 解析正确", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "global mem");
        writeFile(root, "projects/proj1/MEMORY.md", "proj mem");
        writeFile(root, "sessions/sess1/checkpoint.md", "sess ckpt");

        const db = new MockDb();
        await reconcileMemory(root, db);

        const findBySuffix = (suffix: string): UpsertCall => {
            const hit = db.upsertCalls.find((c) => toForward(c.path).endsWith(suffix));
            if (!hit) throw new Error(`no upsert call ends with ${suffix}`);
            return hit;
        };

        const g = findBySuffix("/global/MEMORY.md");
        expect(g.scope).toBe("global");
        expect(g.scopeId).toBeUndefined();
        expect(g.type).toBe("memory");
        expect(g.body).toBe("global mem");
        // fingerprint = "size-mtimeMs"; mtimeMs 在 Windows 上可能是浮点数
        // (例如 1783185837416.3203), 所以小数部分是可选的.
        expect(g.fingerprint).toMatch(/^\d+-\d+(\.\d+)?$/);

        const p = findBySuffix("/projects/proj1/MEMORY.md");
        expect(p.scope).toBe("projects");
        expect(p.scopeId).toBe("proj1");
        expect(p.type).toBe("memory");

        const s = findBySuffix("/sessions/sess1/checkpoint.md");
        expect(s.scope).toBe("sessions");
        expect(s.scopeId).toBe("sess1");
        expect(s.type).toBe("checkpoint");
    });

    // wave-169 residual
    it("11. empty root returns zeros without db side effects", async () => {
        const root = makeMemoryRoot();
        mkdirSync(root, { recursive: true });
        const db = new MockDb();
        const r = await reconcileMemory(root, db);
        expect(r).toEqual<ReconcileResult>({ indexed: 0, pruned: 0, skipped: 0 });
        expect(db.upsertCalls).toHaveLength(0);
        expect(db.deleteCalls).toHaveLength(0);
    });

    it("12. second reconcile with unchanged fingerprint skips re-index", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "stable body");
        const db = new MockDb();
        const first = await reconcileMemory(root, db);
        expect(first.indexed).toBe(1);
        const second = await reconcileMemory(root, db);
        expect(second.indexed).toBe(0);
        expect(second.skipped).toBe(1);
        expect(second.pruned).toBe(0);
        expect(db.upsertCalls).toHaveLength(1);
    });

    it("13. upsert failure counts as skipped without aborting batch", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/ok.md", "ok");
        writeFile(root, "global/bad.md", "bad");
        const db = new MockDb();
        db.upsertImpl = (input) => {
            if (toForward(input.path).endsWith("/bad.md")) {
                throw new Error("upsert boom");
            }
        };
        const r = await reconcileMemory(root, db);
        expect(r.indexed + r.skipped).toBe(2);
        expect(r.skipped).toBeGreaterThanOrEqual(1);
        expect(r.indexed).toBeGreaterThanOrEqual(1);
        expect(db.upsertCalls.some((c) => toForward(c.path).endsWith("/ok.md"))).toBe(true);
    });

    // wave-227 residual
    it("14. deleteIndex failure counts as skipped without raising", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/MEMORY.md", "keep");
        const db = new MockDb();
        await db.upsertIndex({
            path: join(root, "global", "orphan.md"),
            scope: "global",
            type: "free",
            body: "gone",
            fingerprint: "1-1",
        });
        const originalDelete = db.deleteIndex.bind(db);
        db.deleteIndex = async (path: string) => {
            if (toForward(path).endsWith("/orphan.md")) {
                throw new Error("delete boom");
            }
            return originalDelete(path);
        };
        const r = await reconcileMemory(root, db);
        expect(r.pruned).toBe(0);
        expect(r.skipped).toBeGreaterThanOrEqual(1);
        expect(r.indexed).toBeGreaterThanOrEqual(1);
    });

    it("15. size change alone reindexes even when mtime forced equal after write", async () => {
        const root = makeMemoryRoot();
        const rel = "global/MEMORY.md";
        writeFile(root, rel, "short");
        const db = new MockDb();
        const first = await reconcileMemory(root, db);
        expect(first.indexed).toBe(1);
        const abs = join(root, "global", "MEMORY.md");
        const st0 = require("fs").statSync(abs);
        writeFile(root, rel, "short-but-longer-body");
        utimesSync(abs, st0.atime, st0.mtime);
        const second = await reconcileMemory(root, db);
        expect(second.indexed).toBe(1);
        expect(second.skipped).toBe(0);
        expect(db.upsertCalls.at(-1)?.body).toBe("short-but-longer-body");
    });

    it("16. upsert body is trimmed of surrounding whitespace", async () => {
        const root = makeMemoryRoot();
        writeFile(root, "global/notes.md", "  \n  padded body  \n  ");
        const db = new MockDb();
        const r = await reconcileMemory(root, db);
        expect(r.indexed).toBe(1);
        expect(db.upsertCalls[0].body).toBe("padded body");
        expect(db.upsertCalls[0].type).toBe("notes");
        expect(db.upsertCalls[0].scope).toBe("global");
    });
});
