/**
 * reconcile.ts — 同步磁盘 markdown 文件与 SQLite FTS5 索引.
 *
 * 借鉴 MiMo Code 的 reconcile 设计, 分两个方向:
 *   1. Prune — 删除索引中存在但磁盘上已不存在的条目
 *   2. Index — 对磁盘上每个 .md 文件, 比较 fingerprint (size-mtimeMs),
 *              若变化则重新读取 body 并 upsert 到索引
 *
 * ReconcileDatabase 是接口, 具体的 SQLite 实现 (fts-query.ts 那一层)
 * 由调用方注入 — 本模块只关心磁盘 ↔ 索引的同步逻辑, 不依赖 electron,
 * 也不直接依赖 better-sqlite3.
 *
 * 错误处理: 单个文件的 I/O 错误 (stat/readFile/upsert) 不应中断整个
 * reconcile 流程, 一律 catch + continue 并计入 `skipped`.
 */

import { stat, readFile } from "fs/promises";
import path from "path";
import { walkMemoryDir, parsePath, type MemoryLocator } from "./paths";

/** 索引中已存在的一条记录的最小描述, 供 reconcile 比对用. */
export interface IndexedMemoryEntry {
    /** 磁盘上的绝对路径 (与 walkMemoryDir 返回的格式一致). */
    path: string;
    /** "size-mtimeMs" 格式, 例如 "1234-1700000000000". */
    fingerprint: string;
}

/**
 * reconcile 引擎依赖的数据库接口. 具体实现 (后续的 SQLite FTS5 layer)
 * 必须实现这三个方法. 接口刻意保持窄, 方便单元测试用内存 mock 注入.
 */
export interface ReconcileDatabase {
    /** 加载所有已索引的 (path, fingerprint) 对. */
    loadIndexedPaths(): Promise<Map<string, string>>;
    /** Upsert 一条索引记录 (path 是 unique key). */
    upsertIndex(input: {
        path: string;
        scope: MemoryLocator["scope"];
        scopeId?: string;
        type: MemoryLocator["type"];
        body: string;
        fingerprint: string;
    }): Promise<void>;
    /** 按路径删除一条索引记录. */
    deleteIndex(path: string): Promise<void>;
}

/** reconcile 一次的统计结果. */
export interface ReconcileResult {
    /** 新增或更新的条目数 (fingerprint 变化或新文件). */
    indexed: number;
    /** 删除的条目数 (索引中有, 磁盘上已不存在). */
    pruned: number;
    /** 跳过的条目数 (fingerprint 未变, 或单文件 I/O 错误). */
    skipped: number;
}

/**
 * 路径归一化: resolve 后把 Windows 反斜杠换成正斜杠, 便于跨平台比较.
 *
 * 磁盘走 walkMemoryDir 得到的路径在 Windows 上是反斜杠, 而索引侧
 * 存的可能是任意一种 — 比较时统一归一化.
 */
function normalizePath(p: string): string {
    return path.resolve(p).replace(/\\/g, "/");
}

/**
 * 同步磁盘 markdown 文件与 SQLite FTS5 索引.
 *
 * 流程:
 * 1. walkMemoryDir(rootDir) 获取磁盘上所有 .md 文件路径
 * 2. db.loadIndexedPaths() 获取索引中所有 (path, fingerprint) 对
 * 3. Prune: 遍历 indexed, 任何不在 diskPaths 中的 → db.deleteIndex(path)
 * 4. Index: 对每个磁盘文件, 计算 fingerprint (size-mtimeMs)
 *    - 若与 indexed 中的 fingerprint 相同 → skip
 *    - 否则读取 body, db.upsertIndex(...)
 *
 * fingerprint = `${stat.size}-${stat.mtimeMs}` (与 MiMo Code 一致).
 */
export async function reconcileMemory(
    rootDir: string,
    db: ReconcileDatabase,
): Promise<ReconcileResult> {
    let indexed = 0;
    let pruned = 0;
    let skipped = 0;

    // 1. Walk 磁盘, 拿到所有 .md 文件. walkMemoryDir 是同步的, 但归一化
    //    是纯函数, 不需要 I/O.
    const diskFiles = walkMemoryDir(rootDir);
    const diskSet = new Set(diskFiles.map(normalizePath));

    // 2. 加载索引中已有的 (path, fingerprint). 索引侧的 path 可能用了
    //    不同的分隔符, 所以建一张 归一化path → {原始path, fingerprint}
    //    的表, 既能在比较时跨平台, 又能在 delete/upsert 时传回原始 path.
    const rawIndexed = await db.loadIndexedPaths();
    const indexedByNorm = new Map<string, { original: string; fingerprint: string }>();
    for (const [originalPath, fingerprint] of rawIndexed) {
        indexedByNorm.set(normalizePath(originalPath), { original: originalPath, fingerprint });
    }

    // 3. Prune — 索引中有但磁盘上没有的, 一律删除. 单条 deleteIndex
    //    抛错不中断流程, 计入 skipped 让调用方知道有残留.
    for (const [normPath, entry] of indexedByNorm) {
        if (!diskSet.has(normPath)) {
            try {
                await db.deleteIndex(entry.original);
                pruned++;
            } catch {
                skipped++;
            }
        }
    }

    // 4. Index — 对磁盘上每个 .md 文件, 计算 fingerprint, 与索引比对.
    for (const filePath of diskFiles) {
        // parsePath 需要同时知道 rootDir 和 filePath, 才能正确切出 scope/scopeId.
        const loc = parsePath(rootDir, filePath);
        if (!loc) {
            // 路径不在 memory 布局下 (例如 rootDir 之外的 stray file) — 跳过.
            skipped++;
            continue;
        }

        let st;
        try {
            st = await stat(filePath);
        } catch {
            skipped++;
            continue;
        }

        const fingerprint = `${st.size}-${st.mtimeMs}`;
        const normPath = normalizePath(filePath);
        const existing = indexedByNorm.get(normPath);
        if (existing && existing.fingerprint === fingerprint) {
            // fingerprint 未变 — 跳过, 省一次 readFile + upsert.
            skipped++;
            continue;
        }

        let body: string;
        try {
            body = (await readFile(filePath, "utf8")).trim();
        } catch {
            skipped++;
            continue;
        }

        try {
            await db.upsertIndex({
                path: filePath,
                scope: loc.scope,
                scopeId: loc.scopeId,
                type: loc.type,
                body,
                fingerprint,
            });
            indexed++;
        } catch {
            // upsert 失败 (例如 SQLite 写锁冲突) — 不中断, 计入 skipped.
            skipped++;
        }
    }

    return { indexed, pruned, skipped };
}
