// 共享的串行 mutation 队列（read-modify-write 锁）。
//
// 背景: `main/index.ts` 的 `setWorkspacePlanMode` 与 `ipc/workspace.ipc.ts` 的
// CRUD/选择 handler 各自维护了一份 `workspaceMutationChain`, 两份独立 Promise
// tail → 并发 plan-mode 切换 + workspace CRUD 会以 last-write-wins 方式互相
// 覆盖 electron-store 的 `workspaces` 数组, 表现为「点了开关又弹回」。
//
// 解决方案: 抽出单一 `createMutationQueue()`, 在 store 拥有者处创建一次,
// 通过依赖注入共享给所有 workspace 写入方, 锁范围仅覆盖 `get/set` 的 RMW。
//
// 设计参考 `ipc/skills.ipc.ts` 的 `withSkillsLock`: 即使某次 mutate 抛错,
// 队列 tail 仍以 resolved 状态继续推进, 一次失败不会卡死后续写入。

export interface MutationQueue {
    /**
     * 在串行队列里执行一次 read-modify-write。`fn` 返回新数组（或同形状值），
     * 由调用方负责实际写入底层存储；锁只保证同一队列上的 mutate 顺序执行。
     *
     * 返回 `fn` 的返回值；若 `fn` 抛错，错误透传给调用方，队列本身继续可用。
     */
    run<T>(fn: () => T | Promise<T>): Promise<T>;
}

export function createMutationQueue(): MutationQueue {
    let tail: Promise<unknown> = Promise.resolve();

    return {
        run<T>(fn: () => T | Promise<T>): Promise<T> {
            // 先挂到 tail 上拿顺序，再把 tail 替换成「无论成功失败都 resolved」
            // 的续命 Promise, 避免一次 reject 卡死整条队列。
            const result: Promise<T> = tail.then(fn, fn) as unknown as Promise<T>;
            tail = result.then(
                () => undefined,
                () => undefined,
            );
            return result;
        },
    };
}

/**
 * 面向键值 store 的便利封装: 在共享队列里读取 `key`, 交给 `fn` 计算新值,
 * 再写回。锁范围仅覆盖 get + set, 不包后续重 IO（例如 session recreate）,
 * 避免把外部慢操作串行化导致 UX 卡顿。
 */
export interface KeyedStore<K extends string | number | symbol, V> {
    get(key: K): V;
    set(key: K, value: V): void;
}

export function createKeyedMutator<K extends string | number | symbol, V>(
    queue: MutationQueue,
    store: KeyedStore<K, V>,
    key: K,
): (fn: (current: V) => V) => Promise<V> {
    return (fn) =>
        queue.run(() => {
            const next = fn(store.get(key));
            store.set(key, next);
            return next;
        });
}