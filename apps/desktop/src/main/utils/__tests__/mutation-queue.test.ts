import { describe, expect, it } from "vitest";
import { createKeyedMutator, createMutationQueue } from "../mutation-queue";

describe("createMutationQueue", () => {
  it("runs tasks serially in submission order", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const slow = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
      return 1;
    });
    const fast = queue.run(async () => {
      order.push(2);
      return 2;
    });
    await expect(Promise.all([slow, fast])).resolves.toEqual([1, 2]);
    expect(order).toEqual([1, 2]);
  });

  it("propagates errors without blocking later runs", async () => {
    const queue = createMutationQueue();
    const failed = queue.run(() => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(queue.run(() => "ok")).resolves.toBe("ok");
  });
});

describe("createKeyedMutator", () => {
  it("read-modify-writes a key under the shared queue", async () => {
    const store = new Map<string, number>([["n", 0]]);
    const queue = createMutationQueue();
    const mutate = createKeyedMutator(queue, store, "n");
    const a = mutate((n) => n + 1);
    const b = mutate((n) => n + 2);
    await expect(Promise.all([a, b])).resolves.toEqual([1, 3]);
    expect(store.get("n")).toBe(3);
  });

  // wave-106 residual
  it("serializes different keys on the same queue without interleaving writes", async () => {
    const store = new Map<string, number>([
      ["a", 0],
      ["b", 0],
    ]);
    const queue = createMutationQueue();
    const mutateA = createKeyedMutator(queue, store, "a");
    const mutateB = createKeyedMutator(queue, store, "b");
    const order: string[] = [];
    await Promise.all([
      mutateA((n) => {
        order.push("a-start");
        return n + 1;
      }),
      mutateB((n) => {
        order.push("b-start");
        return n + 10;
      }),
      mutateA((n) => {
        order.push("a-end");
        return n + 1;
      }),
    ]);
    expect(store.get("a")).toBe(2);
    expect(store.get("b")).toBe(10);
    expect(order).toEqual(["a-start", "b-start", "a-end"]);
  });
});

describe("createMutationQueue residual", () => {
  // wave-106 residual
  it("keeps submission order across three concurrent async tasks", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const tasks = [0, 1, 2].map((i) =>
      queue.run(async () => {
        await new Promise((r) => setTimeout(r, 15 - i * 5));
        order.push(i);
        return i;
      }),
    );
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2]);
    expect(order).toEqual([0, 1, 2]);
  });

  // wave-124 residual
  it("continues after an async rejection mid-queue and surfaces the error", async () => {
    const queue = createMutationQueue();
    const order: string[] = [];
    const first = queue.run(async () => {
      order.push("first");
      return "first";
    });
    const middle = queue.run(async () => {
      order.push("middle");
      throw new Error("mid-fail");
    });
    const last = queue.run(async () => {
      order.push("last");
      return "last";
    });
    await expect(first).resolves.toBe("first");
    await expect(middle).rejects.toThrow("mid-fail");
    await expect(last).resolves.toBe("last");
    expect(order).toEqual(["first", "middle", "last"]);
  });

  it("propagates keyed mutator errors without corrupting later key writes", async () => {
    const store = new Map<string, number>([["n", 1]]);
    const queue = createMutationQueue();
    const mutate = createKeyedMutator(queue, store, "n");
    await expect(
      mutate(() => {
        throw new Error("rmw-fail");
      }),
    ).rejects.toThrow("rmw-fail");
    expect(store.get("n")).toBe(1);
    await expect(mutate((n) => n + 4)).resolves.toBe(5);
    expect(store.get("n")).toBe(5);
  });

  // wave-128 residual
  it("runs sync tasks in order and returns their values", async () => {
    const queue = createMutationQueue();
    const a = queue.run(() => "a");
    const b = queue.run(() => "b");
    const c = queue.run(() => "c");
    await expect(Promise.all([a, b, c])).resolves.toEqual(["a", "b", "c"]);
  });

  it("keyed mutator serializes concurrent increments for one key", async () => {
    const store = new Map<string, number>([["n", 0]]);
    const queue = createMutationQueue();
    const mutate = createKeyedMutator(queue, store, "n");
    await Promise.all([
      mutate((n) => n + 1),
      mutate((n) => n + 1),
      mutate((n) => n + 1),
    ]);
    expect(store.get("n")).toBe(3);
  });

  // wave-139 residual — long soak serial stress + multi-key isolation
  it("long-soak serializes 50 async tasks without reordering", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const tasks = Array.from({ length: 50 }, (_, i) =>
      queue.run(async () => {
        await Promise.resolve();
        order.push(i);
        return i;
      }),
    );
    const results = await Promise.all(tasks);
    expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(order).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("interleaved rejects still leave queue healthy after soak", async () => {
    const queue = createMutationQueue();
    const outcomes: Array<"ok" | "err"> = [];
    const tasks: Array<Promise<void>> = [];
    for (let i = 0; i < 20; i += 1) {
      if (i % 3 === 0) {
        tasks.push(
          queue.run(async () => {
            throw new Error(`fail-${i}`);
          }).then(
            () => {
              outcomes.push("ok");
            },
            () => {
              outcomes.push("err");
            },
          ),
        );
      } else {
        tasks.push(
          queue.run(async () => {
            outcomes.push("ok");
          }),
        );
      }
    }
    await Promise.all(tasks);
    expect(outcomes.filter((o) => o === "err")).toHaveLength(7);
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(13);
    await expect(queue.run(async () => "alive")).resolves.toBe("alive");
  });

  it("keyed mutators on different keys share queue order but not values", async () => {
    const store = new Map<string, number>([
      ["a", 0],
      ["b", 100],
    ]);
    const queue = createMutationQueue();
    const mutA = createKeyedMutator(queue, store, "a");
    const mutB = createKeyedMutator(queue, store, "b");
    await Promise.all([
      mutA((n) => n + 1),
      mutB((n) => n + 1),
      mutA((n) => n + 2),
      mutB((n) => n + 3),
    ]);
    expect(store.get("a")).toBe(3);
    expect(store.get("b")).toBe(104);
  });

  // wave-144 residual
  it("empty queue run resolves immediately and chains afterward", async () => {
    const queue = createMutationQueue();
    await expect(queue.run(async () => 42)).resolves.toBe(42);
    await expect(queue.run(() => "sync")).resolves.toBe("sync");
  });

  it("tail.rejects path still runs next fn (then(fn, fn))", async () => {
    const queue = createMutationQueue();
    const order: string[] = [];
    const fail = queue.run(async () => {
      order.push("fail");
      throw new Error("seed-fail");
    });
    const next = queue.run(async () => {
      order.push("next");
      return "ok";
    });
    await expect(fail).rejects.toThrow("seed-fail");
    await expect(next).resolves.toBe("ok");
    expect(order).toEqual(["fail", "next"]);
  });

  it("keyed mutator returns value written for pre-seeded keys after serial runs", async () => {
    const store = new Map<string, number>([["seed", 10]]);
    const queue = createMutationQueue();
    const mutate = createKeyedMutator(queue, store, "seed");
    await expect(mutate((n) => n * 2)).resolves.toBe(20);
    await expect(mutate((n) => n + 1)).resolves.toBe(21);
    expect(store.get("seed")).toBe(21);
  });

  // wave-154 residual
  it("propagates sync throws and keeps later sync tasks ordered", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const first = queue.run(() => {
      order.push(1);
      throw new Error("sync-boom");
    });
    const second = queue.run(() => {
      order.push(2);
      return "ok";
    });
    await expect(first).rejects.toThrow("sync-boom");
    await expect(second).resolves.toBe("ok");
    expect(order).toEqual([1, 2]);
  });

  it("keyed mutator throw leaves store unchanged for that run", async () => {
    const store = new Map<string, number>([["k", 5]]);
    const queue = createMutationQueue();
    const mutate = createKeyedMutator(queue, store, "k");
    await expect(
      mutate(() => {
        throw new Error("no-write");
      }),
    ).rejects.toThrow("no-write");
    expect(store.get("k")).toBe(5);
    await expect(mutate((n) => n + 1)).resolves.toBe(6);
    expect(store.get("k")).toBe(6);
  });

  it("many concurrent empty runs still resolve in order-stable fashion", async () => {
    const queue = createMutationQueue();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => queue.run(async () => i)),
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  // wave-162 residual
  it("async rejection still advances the queue for the next run", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const first = queue.run(async () => {
      order.push(1);
      throw new Error("async-boom");
    });
    const second = queue.run(async () => {
      order.push(2);
      return "ok";
    });
    await expect(first).rejects.toThrow("async-boom");
    await expect(second).resolves.toBe("ok");
    expect(order).toEqual([1, 2]);
  });

  it("keyed mutators on shared queue serialize across keys", async () => {
    const store = new Map<string, number>([
      ["a", 0],
      ["b", 0],
    ]);
    const queue = createMutationQueue();
    const mutateA = createKeyedMutator(queue, store, "a");
    const mutateB = createKeyedMutator(queue, store, "b");
    await Promise.all([
      mutateA((n) => n + 1),
      mutateB((n) => n + 10),
      mutateA((n) => n + 1),
    ]);
    expect(store.get("a")).toBe(2);
    expect(store.get("b")).toBe(10);
  });

  it("run returns the mutator result including undefined/null/0", async () => {
    const queue = createMutationQueue();
    await expect(queue.run(() => undefined)).resolves.toBeUndefined();
    await expect(queue.run(async () => null)).resolves.toBeNull();
    await expect(queue.run(() => 0)).resolves.toBe(0);
  });

  // wave-179 residual
  it("keyed mutator seeds missing Map keys via first write", async () => {
    const store = new Map<string, number>();
    const queue = createMutationQueue();
    const mutate = createKeyedMutator(queue, store, "missing");
    // Map.get returns undefined for missing key; product passes current through
    await expect(
      mutate((n) => (typeof n === "number" ? n + 1 : 1)),
    ).resolves.toBe(1);
    expect(store.get("missing")).toBe(1);
    await expect(mutate((n) => n + 2)).resolves.toBe(3);
    expect(store.get("missing")).toBe(3);
  });

  it("double rejection then success keeps queue alive", async () => {
    const queue = createMutationQueue();
    const a = queue.run(async () => {
      throw new Error("a");
    });
    const b = queue.run(async () => {
      throw new Error("b");
    });
    const c = queue.run(async () => "ok");
    await expect(a).rejects.toThrow("a");
    await expect(b).rejects.toThrow("b");
    await expect(c).resolves.toBe("ok");
    await expect(queue.run(() => 7)).resolves.toBe(7);
  });

  it("does not re-enter nested run while outer awaits it (product queues after tail)", async () => {
    // Product: nested queue.run scheduled inside an in-flight run is chained after
    // the current run's promise. Awaiting that nested promise from inside the outer
    // run deadlocks. Callers must not nest-await the same queue.
    const queue = createMutationQueue();
    const order: string[] = [];
    let nestedStarted = false;
    const outer = queue.run(async () => {
      order.push("outer");
      // schedule nested but do not await it inside the outer critical section
      void queue
        .run(async () => {
          nestedStarted = true;
          order.push("nested");
          return "nested";
        })
        .catch(() => undefined);
      return "outer-done";
    });
    await expect(outer).resolves.toBe("outer-done");
    // flush microtasks so nested can run after outer completes
    await Promise.resolve();
    await Promise.resolve();
    expect(nestedStarted).toBe(true);
    expect(order).toEqual(["outer", "nested"]);
    await expect(queue.run(() => "alive")).resolves.toBe("alive");
  });

  // wave-190 residual
  it("serializes three concurrent runs in submission order", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const p1 = queue.run(async () => {
      await Promise.resolve();
      order.push(1);
      return 1;
    });
    const p2 = queue.run(async () => {
      order.push(2);
      return 2;
    });
    const p3 = queue.run(async () => {
      order.push(3);
      return 3;
    });
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("keyed mutator shares one queue across two keys without cross-key state", async () => {
    const store = new Map<string, number>([
      ["a", 0],
      ["b", 10],
    ]);
    const queue = createMutationQueue();
    const mutA = createKeyedMutator(queue, store, "a");
    const mutB = createKeyedMutator(queue, store, "b");
    await expect(mutA((n) => n + 1)).resolves.toBe(1);
    await expect(mutB((n) => n + 1)).resolves.toBe(11);
    expect(store.get("a")).toBe(1);
    expect(store.get("b")).toBe(11);
  });

  // wave-195 residual
  it("sync throw rejects caller but advances queue for next run", async () => {
    const queue = createMutationQueue();
    await expect(
      queue.run(() => {
        throw new Error("sync-fail");
      }),
    ).rejects.toThrow(/sync-fail/);
    await expect(queue.run(() => "after")).resolves.toBe("after");
  });

  it("async reject rejects caller but advances queue for next run", async () => {
    const queue = createMutationQueue();
    await expect(
      queue.run(async () => {
        throw new Error("async-fail");
      }),
    ).rejects.toThrow(/async-fail/);
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });

  it("keyed mutator applies transform and returns next value", async () => {
    const store = new Map<string, string>([["k", "a"]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "k");
    await expect(mut((v) => `${v}b`)).resolves.toBe("ab");
    expect(store.get("k")).toBe("ab");
    await expect(mut((v) => `${v}c`)).resolves.toBe("abc");
  });

  // wave-199 residual
  it("serializes concurrent run() calls in enqueue order", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const p1 = queue.run(async () => {
      order.push(1);
      await firstGate;
      order.push(2);
      return "a";
    });
    const p2 = queue.run(async () => {
      order.push(3);
      return "b";
    });

    // second must wait until first resolves fully
    await Promise.resolve();
    expect(order).toEqual([1]);
    releaseFirst();
    await expect(Promise.all([p1, p2])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("keyed mutator throw leaves store unchanged and still advances queue", async () => {
    const store = new Map<string, number>([["n", 1]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "n");
    await expect(
      mut(() => {
        throw new Error("nope");
      }),
    ).rejects.toThrow(/nope/);
    expect(store.get("n")).toBe(1);
    await expect(mut((v) => v + 1)).resolves.toBe(2);
    expect(store.get("n")).toBe(2);
  });

  it("run returns resolved value for sync and async producers", async () => {
    const queue = createMutationQueue();
    await expect(queue.run(() => 7)).resolves.toBe(7);
    await expect(queue.run(async () => 8)).resolves.toBe(8);
  });

  // wave-204 residual
  it("failed run does not poison subsequent run; both see sequential order", async () => {
    const queue = createMutationQueue();
    const order: string[] = [];
    const p1 = queue.run(async () => {
      order.push("a");
      throw new Error("first-fail");
    });
    const p2 = queue.run(async () => {
      order.push("b");
      return 42;
    });
    await expect(p1).rejects.toThrow(/first-fail/);
    await expect(p2).resolves.toBe(42);
    expect(order).toEqual(["a", "b"]);
  });

  it("keyed mutator applies identity and multi-step transforms in order", async () => {
    const store = new Map<string, number>([["counter", 0]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "counter");
    const results = await Promise.all([
      mut((v) => v + 1),
      mut((v) => v + 10),
      mut((v) => v * 2),
    ]);
    expect(results).toEqual([1, 11, 22]);
    expect(store.get("counter")).toBe(22);
  });

  it("createMutationQueue instances are independent", async () => {
    const q1 = createMutationQueue();
    const q2 = createMutationQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a: string[] = [];
    const pBlocked = q1.run(async () => {
      a.push("q1-start");
      await gate;
      a.push("q1-end");
    });
    await Promise.resolve();
    await q2.run(async () => {
      a.push("q2");
    });
    // q2 must not wait on q1
    expect(a).toEqual(["q1-start", "q2"]);
    release();
    await pBlocked;
    expect(a).toEqual(["q1-start", "q2", "q1-end"]);
  });


  // wave-216 residual
  it("run returns complex object identity from async producer", async () => {
    const queue = createMutationQueue();
    const obj = { a: 1, b: [2] };
    await expect(queue.run(async () => obj)).resolves.toBe(obj);
  });

  it("keyed mutator can replace value with undefined when store allows it", async () => {
    const store = new Map<string, number | undefined>([["k", 1]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "k");
    await expect(mut(() => undefined)).resolves.toBeUndefined();
    expect(store.get("k")).toBeUndefined();
    await expect(mut((v) => (v ?? 0) + 3)).resolves.toBe(3);
    expect(store.get("k")).toBe(3);
  });

  it("sequential await and concurrent enqueue agree on final keyed value", async () => {
    const store = new Map<string, number>([["n", 0]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "n");
    await mut((n) => n + 1);
    await mut((n) => n + 1);
    await Promise.all([mut((n) => n + 1), mut((n) => n + 1), mut((n) => n + 1)]);
    expect(store.get("n")).toBe(5);
  });

  // wave-235 residual
  it("keyed mutator passes undefined current for missing key and writes first value", async () => {
    const store = new Map<string, string>();
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "fresh");
    await expect(
      mut((current) => {
        expect(current).toBeUndefined();
        return "seeded";
      }),
    ).resolves.toBe("seeded");
    expect(store.get("fresh")).toBe("seeded");
  });

  it("queue run after mixed settle order still serializes new work", async () => {
    const queue = createMutationQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = queue.run(async () => {
      order.push("blocked-start");
      await gate;
      order.push("blocked-end");
      return 1;
    });
    const waiting = queue.run(async () => {
      order.push("waiting");
      return 2;
    });
    await Promise.resolve();
    expect(order).toEqual(["blocked-start"]);
    release();
    await expect(Promise.all([blocked, waiting])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["blocked-start", "blocked-end", "waiting"]);
    await expect(queue.run(() => "post")).resolves.toBe("post");
  });
});

// wave-258 residual
describe("mutation-queue residual (wave-258)", () => {
  it("async reject still advances tail; later run succeeds", async () => {
    const queue = createMutationQueue();
    const failed = queue.run(async () => {
      throw new Error("async-boom");
    });
    await expect(failed).rejects.toThrow("async-boom");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });

  it("keyed mutator serializes three concurrent increments without lost updates", async () => {
    const store = new Map<string, number>([["n", 10]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "n");
    const results = await Promise.all([
      mut((n) => n + 1),
      mut((n) => n + 1),
      mut((n) => n + 1),
    ]);
    expect(results).toEqual([11, 12, 13]);
    expect(store.get("n")).toBe(13);
  });
});


// wave-270 residual
describe("mutation-queue residual (wave-270)", () => {
  it("sync throw rejects caller but does not block subsequent run", async () => {
    const queue = createMutationQueue();
    await expect(
      queue.run(() => {
        throw new Error("sync-boom");
      }),
    ).rejects.toThrow("sync-boom");
    await expect(queue.run(() => 42)).resolves.toBe(42);
  });

  it("keyed mutator does not write when mapper throws; later mutator still applies", async () => {
    const store = new Map<string, number>([["n", 5]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "n");
    await expect(
      mut(() => {
        throw new Error("map-fail");
      }),
    ).rejects.toThrow("map-fail");
    expect(store.get("n")).toBe(5);
    await expect(mut((n) => n + 2)).resolves.toBe(7);
    expect(store.get("n")).toBe(7);
  });

  it("run preserves return values across mixed sync and async jobs", async () => {
    const queue = createMutationQueue();
    const a = queue.run(() => "sync");
    const b = queue.run(async () => {
      await Promise.resolve();
      return "async";
    });
    const c = queue.run(() => 3);
    await expect(Promise.all([a, b, c])).resolves.toEqual(["sync", "async", 3]);
  });
});


// wave-278 residual
describe("mutation-queue residual (wave-278)", () => {
  it("async reject advances queue; later job still runs", async () => {
    const queue = createMutationQueue();
    await expect(
      queue.run(async () => {
        await Promise.resolve();
        throw new Error("async-boom");
      }),
    ).rejects.toThrow("async-boom");
    await expect(queue.run(async () => "ok")).resolves.toBe("ok");
  });

  it("serializes concurrent keyed mutators with sync mappers", async () => {
    const store = new Map<string, number>([["n", 0]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "n");
    const results = await Promise.all([
      mut((n) => n + 1),
      mut((n) => n + 1),
      mut((n) => n + 1),
      mut((n) => n + 1),
      mut((n) => n + 1),
    ]);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(store.get("n")).toBe(5);
  });
});



// wave-288 residual
describe("mutation-queue residual (wave-288)", () => {
  it("sync throw still advances tail; subsequent run receives no rejection leak", async () => {
    const queue = createMutationQueue();
    const failed = queue.run(() => {
      throw new Error("sync-fail");
    });
    await expect(failed).rejects.toThrow("sync-fail");
    await expect(queue.run(() => "recovered")).resolves.toBe("recovered");
    // two failures in a row then success
    await expect(queue.run(() => { throw new Error("again"); })).rejects.toThrow("again");
    await expect(queue.run(async () => "ok2")).resolves.toBe("ok2");
  });

  it("keyed mutator writes via set; independent keys do not share values", async () => {
    const store = new Map<string, number>([["a", 10], ["b", 20]]);
    const queue = createMutationQueue();
    const mutA = createKeyedMutator(queue, store, "a");
    const mutB = createKeyedMutator(queue, store, "b");
    const [ra, rb] = await Promise.all([
      mutA((n) => n + 1),
      mutB((n) => n + 5),
    ]);
    expect(ra).toBe(11);
    expect(rb).toBe(25);
    expect(store.get("a")).toBe(11);
    expect(store.get("b")).toBe(25);
    // mapper returning same reference is still written
    await mutA((n) => n);
    expect(store.get("a")).toBe(11);
  });
});

// wave-313 residual
describe("mutation-queue residual (wave-313)", () => {
  it("serializes overlapping async runs; preserves order of completion values", async () => {
    const queue = createMutationQueue();
    const order: number[] = [];
    const slow = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return "a";
    });
    const fast = queue.run(async () => {
      order.push(2);
      return "b";
    });
    await expect(Promise.all([slow, fast])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual([1, 2]);
  });

  it("createKeyedMutator applies fn to current get; concurrent mutators on same key serialize", async () => {
    const store = new Map<string, string>([["k", ""]]);
    const queue = createMutationQueue();
    const mut = createKeyedMutator(queue, store, "k");
    await Promise.all([
      mut((s) => s + "x"),
      mut((s) => s + "y"),
      mut((s) => s + "z"),
    ]);
    expect(store.get("k")).toBe("xyz");
  });

  it("rejected run does not poison later runs; return value of last success", async () => {
    const queue = createMutationQueue();
    await expect(queue.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(queue.run(() => 42)).resolves.toBe(42);
    await expect(queue.run(async () => "done")).resolves.toBe("done");
  });
});
