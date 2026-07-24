import { describe, expect, it, vi } from "vitest";
import { createSubscriptionManager } from "./subscription-manager";

describe("createSubscriptionManager", () => {
  it("runs setup once and tracks subscription", () => {
    const manager = createSubscriptionManager();
    const setup = vi.fn(() => () => undefined);
    expect(manager.isSubscribed).toBe(false);
    manager.ensure(setup);
    manager.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(manager.isSubscribed).toBe(true);
  });

  it("accepts a single unsubscribe function from setup", () => {
    const manager = createSubscriptionManager();
    const unsub = vi.fn();
    manager.ensure(() => unsub);
    manager.cleanup();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(manager.isSubscribed).toBe(false);
  });

  it("accepts an array of unsubscribers and runs them on cleanup", () => {
    const manager = createSubscriptionManager();
    const a = vi.fn();
    const b = vi.fn();
    manager.ensure(() => [a, b]);
    manager.cleanup();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("allows re-subscribe after cleanup", () => {
    const manager = createSubscriptionManager();
    const first = vi.fn(() => () => undefined);
    const second = vi.fn(() => () => undefined);
    manager.ensure(first);
    manager.cleanup();
    manager.ensure(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(manager.isSubscribed).toBe(true);
  });

  it("handles setup with no return value", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => undefined);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
  });

  // wave-109 residual
  it("cleanup is idempotent when never subscribed", () => {
    const manager = createSubscriptionManager();
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
  });

  it("cleanup twice does not re-invoke unsubscribers", () => {
    const manager = createSubscriptionManager();
    const unsub = vi.fn();
    manager.ensure(() => unsub);
    manager.cleanup();
    manager.cleanup();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("accepts empty unsubscribe array", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => []);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
  });

  it("re-ensure after cleanup can collect a new array of unsubscribers", () => {
    const manager = createSubscriptionManager();
    const first = vi.fn();
    const secondA = vi.fn();
    const secondB = vi.fn();
    manager.ensure(() => first);
    manager.cleanup();
    expect(first).toHaveBeenCalledTimes(1);

    manager.ensure(() => [secondA, secondB]);
    manager.cleanup();
    expect(secondA).toHaveBeenCalledTimes(1);
    expect(secondB).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  // wave-119 residual
  it("invokes unsubscribers in reverse registration order", () => {
    const manager = createSubscriptionManager();
    const order: string[] = [];
    manager.ensure(() => [
      () => order.push("a"),
      () => order.push("b"),
      () => order.push("c"),
    ]);
    manager.cleanup();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("ignores non-function entries mixed into unsubscribe arrays", () => {
    const manager = createSubscriptionManager();
    const good = vi.fn();
    manager.ensure(() => [good, null as never, undefined as never]);
    expect(() => manager.cleanup()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("ensure after partial cleanup still requires full re-setup", () => {
    const manager = createSubscriptionManager();
    const first = vi.fn(() => () => undefined);
    const second = vi.fn(() => () => undefined);
    manager.ensure(first);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
    manager.ensure(second);
    expect(second).toHaveBeenCalledTimes(1);
    // ensure is still one-shot while subscribed
    manager.ensure(second);
    expect(second).toHaveBeenCalledTimes(1);
  });

  // wave-127 residual
  it("accepts void setup and empty cleanup without throwing", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => undefined);
    expect(manager.isSubscribed).toBe(true);
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
    expect(() => manager.cleanup()).not.toThrow();
  });

  it("does not re-run setup while still subscribed after ensure", () => {
    const manager = createSubscriptionManager();
    const setup = vi.fn(() => () => undefined);
    manager.ensure(setup);
    manager.ensure(setup);
    manager.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  // wave-135 residual
  it("runs multiple unsubscribers LIFO and clears isSubscribed before invoking them", () => {
    const manager = createSubscriptionManager();
    const order: string[] = [];
    manager.ensure(() => [
      () => order.push("a"),
      () => order.push("b"),
      () => order.push("c"),
    ]);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("optional-chains nullish array entries; truthy non-functions throw; single fn works", () => {
    const manager = createSubscriptionManager();
    const good = vi.fn();
    // null/undefined skipped by fn?.(); product does not type-guard strings
    manager.ensure(() => [null as never, undefined as never, good]);
    expect(() => manager.cleanup()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);

    const throws = createSubscriptionManager();
    throws.ensure(() => ["x" as never]);
    expect(() => throws.cleanup()).toThrow(/not a function|is not a function/i);

    const single = vi.fn();
    manager.ensure(() => single);
    manager.cleanup();
    expect(single).toHaveBeenCalledTimes(1);
  });

  // wave-150 residual
  it("ensure void setup still marks subscribed and cleanup is idempotent", () => {
    const manager = createSubscriptionManager();
    const setup = vi.fn(() => undefined);
    manager.ensure(setup);
    expect(manager.isSubscribed).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
  });

  it("re-ensure after cleanup runs setup again and replaces unsubscribers", () => {
    const manager = createSubscriptionManager();
    const first = vi.fn();
    const second = vi.fn();
    manager.ensure(() => first);
    manager.cleanup();
    expect(first).toHaveBeenCalledTimes(1);
    manager.ensure(() => second);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("empty array setup leaves subscribed true without unsubscribers", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => []);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
  });

  // wave-175 residual
  it("marks subscribed before setup runs so a throwing setup still blocks re-ensure", () => {
    const manager = createSubscriptionManager();
    const setup = vi.fn(() => {
      throw new Error("setup-fail");
    });
    expect(() => manager.ensure(setup)).toThrow("setup-fail");
    expect(manager.isSubscribed).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    // second ensure is skipped even though no unsubscribers were registered
    const second = vi.fn(() => () => undefined);
    manager.ensure(second);
    expect(second).not.toHaveBeenCalled();
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
    manager.ensure(second);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cleanup continues LIFO even when an earlier unsub throws (product: throw stops loop)", () => {
    const manager = createSubscriptionManager();
    const order: string[] = [];
    manager.ensure(() => [
      () => order.push("a"),
      () => {
        order.push("b");
        throw new Error("unsub-b");
      },
      () => order.push("c"),
    ]);
    // pop order: c, b(throw), a never runs because throw aborts cleanup
    expect(() => manager.cleanup()).toThrow("unsub-b");
    expect(order).toEqual(["c", "b"]);
    // subscribed already cleared before unsub invocations
    expect(manager.isSubscribed).toBe(false);
  });

  it("isSubscribed getter reflects live flag without snapshotting", () => {
    const manager = createSubscriptionManager();
    const view = manager.isSubscribed;
    expect(view).toBe(false);
    manager.ensure(() => () => undefined);
    expect(manager.isSubscribed).toBe(true);
    expect(view).toBe(false); // primitive snapshot, not a live binding
  });

  // wave-188 residual
  it("void setup marks subscribed and cleanup is no-op without unsubscribers", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => undefined);
    expect(manager.isSubscribed).toBe(true);
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
    // cleanup when never ensured
    const idle = createSubscriptionManager();
    expect(() => idle.cleanup()).not.toThrow();
    expect(idle.isSubscribed).toBe(false);
  });

  it("array setup registers multiple unsubscribers LIFO on cleanup", () => {
    const manager = createSubscriptionManager();
    const order: number[] = [];
    manager.ensure(() => [
      () => order.push(1),
      () => order.push(2),
      () => order.push(3),
    ]);
    manager.cleanup();
    expect(order).toEqual([3, 2, 1]);
    // re-ensure after cleanup works
    const once = vi.fn(() => () => undefined);
    manager.ensure(once);
    expect(once).toHaveBeenCalledTimes(1);
  });

  // wave-196 residual
  it("empty-array setup marks subscribed; cleanup leaves manager idle", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => []);
    expect(manager.isSubscribed).toBe(true);
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
  });

  it("cleanup clears subscribed before unsubscribers so ensure can re-run mid-cleanup only after full cleanup", () => {
    const manager = createSubscriptionManager();
    const seen: string[] = [];
    manager.ensure(() => () => {
      seen.push("unsub");
    });
    manager.cleanup();
    expect(seen).toEqual(["unsub"]);
    const setup = vi.fn(() => () => {
      seen.push("unsub2");
    });
    manager.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    manager.cleanup();
    expect(seen).toEqual(["unsub", "unsub2"]);
  });

  // wave-201 residual
  it("void setup still marks subscribed; second ensure is no-op", () => {
    const manager = createSubscriptionManager();
    const setup = vi.fn(() => undefined);
    manager.ensure(setup);
    manager.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
  });

  it("array setup collects multiple unsubscribers and runs them LIFO on cleanup", () => {
    const manager = createSubscriptionManager();
    const order: number[] = [];
    manager.ensure(() => [
      () => order.push(1),
      () => order.push(2),
    ]);
    manager.cleanup();
    // product pops from end → LIFO
    expect(order).toEqual([2, 1]);
  });

  it("cleanup is safe when never ensured", () => {
    const manager = createSubscriptionManager();
    expect(manager.isSubscribed).toBe(false);
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.isSubscribed).toBe(false);
  });

  // wave-203 residual
  it("nullish array entries are skipped via optional call; empty array still subscribes", () => {
    const manager = createSubscriptionManager();
    const order: string[] = [];
    manager.ensure(() => [
      null as never,
      () => order.push("a"),
      undefined as never,
      () => order.push("b"),
    ]);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(order).toEqual(["b", "a"]);
    expect(manager.isSubscribed).toBe(false);
  });

  it("double cleanup after ensure is idle and does not re-run unsubscribers", () => {
    const manager = createSubscriptionManager();
    const unsub = vi.fn();
    manager.ensure(() => unsub);
    manager.cleanup();
    manager.cleanup();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(manager.isSubscribed).toBe(false);
  });

  // wave-209 residual
  it("ensure is idempotent: second setup is never called while subscribed", () => {
    const manager = createSubscriptionManager();
    const first = vi.fn(() => vi.fn());
    const second = vi.fn(() => vi.fn());
    manager.ensure(first);
    manager.ensure(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(manager.isSubscribed).toBe(true);
  });

  it("void setup still marks subscribed; cleanup allows re-ensure", () => {
    const manager = createSubscriptionManager();
    manager.ensure(() => undefined);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
    const unsub = vi.fn();
    manager.ensure(() => unsub);
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(unsub).toHaveBeenCalledTimes(1);
  });


  // wave-214 residual
  it("independent managers do not share subscribed state or unsubscribers", () => {
    const a = createSubscriptionManager();
    const b = createSubscriptionManager();
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    a.ensure(() => unsubA);
    expect(a.isSubscribed).toBe(true);
    expect(b.isSubscribed).toBe(false);
    b.ensure(() => unsubB);
    a.cleanup();
    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(unsubB).not.toHaveBeenCalled();
    expect(a.isSubscribed).toBe(false);
    expect(b.isSubscribed).toBe(true);
    b.cleanup();
    expect(unsubB).toHaveBeenCalledTimes(1);
  });

  it("cleanup after throwing setup leaves manager idle for re-ensure", () => {
    const manager = createSubscriptionManager();
    expect(() =>
      manager.ensure(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(manager.isSubscribed).toBe(true);
    manager.cleanup();
    expect(manager.isSubscribed).toBe(false);
    const ok = vi.fn(() => () => undefined);
    manager.ensure(ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });


  // wave-221 residual
  it("ensure is idempotent; cleanup allows re-subscribe and runs all unsubs", () => {
    const mgr = createSubscriptionManager();
    const u1 = vi.fn();
    const u2 = vi.fn();
    const setup = vi.fn(() => [u1, u2]);
    mgr.ensure(setup);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    expect(mgr.isSubscribed).toBe(false);
    expect(u1).toHaveBeenCalledTimes(1);
    expect(u2).toHaveBeenCalledTimes(1);
    mgr.ensure(() => u1);
    expect(mgr.isSubscribed).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("ensure accepts void/single-fn setup without throwing", () => {
    const mgr = createSubscriptionManager();
    mgr.ensure(() => undefined);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    const fn = vi.fn();
    mgr.ensure(() => fn);
    mgr.cleanup();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // wave-246 residual
  it("empty unsubscriber array is fine; cleanup twice is safe; re-ensure after double cleanup", () => {
    const mgr = createSubscriptionManager();
    const setup = vi.fn(() => []);
    mgr.ensure(setup);
    expect(mgr.isSubscribed).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    mgr.cleanup();
    mgr.cleanup();
    expect(mgr.isSubscribed).toBe(false);
    const u = vi.fn();
    mgr.ensure(() => u);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    expect(u).toHaveBeenCalledTimes(1);
  });

  it("unsubscribers run LIFO; later ensure after cleanup does not re-run old setup", () => {
    const mgr = createSubscriptionManager();
    const order: number[] = [];
    const u1 = () => order.push(1);
    const u2 = () => order.push(2);
    const first = vi.fn(() => [u1, u2]);
    mgr.ensure(first);
    mgr.cleanup();
    expect(order).toEqual([2, 1]);
    expect(first).toHaveBeenCalledTimes(1);
    const second = vi.fn(() => () => order.push(3));
    mgr.ensure(second);
    mgr.cleanup();
    expect(second).toHaveBeenCalledTimes(1);
    expect(order).toEqual([2, 1, 3]);
  });
});

// wave-258 residual
describe("subscription-manager residual (wave-258)", () => {
  it("ensure ignores void setup; second ensure is no-op until cleanup", () => {
    const mgr = createSubscriptionManager();
    const setup = vi.fn(() => undefined);
    mgr.ensure(setup);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    expect(mgr.isSubscribed).toBe(false);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it("array unsubscribers can include non-functions without throwing on cleanup", () => {
    const mgr = createSubscriptionManager();
    const u = vi.fn();
    mgr.ensure(() => [u, undefined as never, null as never]);
    expect(() => mgr.cleanup()).not.toThrow();
    expect(u).toHaveBeenCalledTimes(1);
  });
});


// wave-270 residual
describe("subscription-manager residual (wave-270)", () => {
  it("cleanup before ensure is no-op; isSubscribed false", () => {
    const mgr = createSubscriptionManager();
    expect(mgr.isSubscribed).toBe(false);
    expect(() => mgr.cleanup()).not.toThrow();
    expect(mgr.isSubscribed).toBe(false);
  });

  it("array unsubscribers cleanup is LIFO; ensure again after cleanup re-runs setup", () => {
    const mgr = createSubscriptionManager();
    const order: number[] = [];
    const setup = vi.fn(() => [
      () => order.push(1),
      () => order.push(2),
      () => order.push(3),
    ]);
    mgr.ensure(setup);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    expect(order).toEqual([3, 2, 1]);
    expect(mgr.isSubscribed).toBe(false);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(2);
    mgr.cleanup();
    expect(order).toEqual([3, 2, 1, 3, 2, 1]);
  });
});


// wave-278 residual
describe("subscription-manager residual (wave-278)", () => {
  it("ensure is idempotent while subscribed; single setup call", () => {
    const mgr = createSubscriptionManager();
    const setup = vi.fn(() => () => {});
    mgr.ensure(setup);
    mgr.ensure(setup);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(mgr.isSubscribed).toBe(true);
  });

  it("void setup leaves no unsubscribers; cleanup still clears subscribed flag", () => {
    const mgr = createSubscriptionManager();
    mgr.ensure(() => undefined);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    expect(mgr.isSubscribed).toBe(false);
  });

  it("single function unsubscriber is called once on cleanup", () => {
    const mgr = createSubscriptionManager();
    const u = vi.fn();
    mgr.ensure(() => u);
    mgr.cleanup();
    expect(u).toHaveBeenCalledTimes(1);
    mgr.cleanup();
    expect(u).toHaveBeenCalledTimes(1);
  });
});



// wave-288 residual
describe("subscription-manager residual (wave-288)", () => {
  it("array unsubscribers LIFO on cleanup; re-ensure after cleanup re-runs setup", () => {
    const mgr = createSubscriptionManager();
    const order: number[] = [];
    const setup = vi.fn(() => [
      () => order.push(1),
      () => order.push(2),
      () => order.push(3),
    ]);
    mgr.ensure(setup);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    // product pops: 3,2,1
    expect(order).toEqual([3, 2, 1]);
    expect(mgr.isSubscribed).toBe(false);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(2);
    mgr.cleanup();
    expect(order).toEqual([3, 2, 1, 3, 2, 1]);
  });

  it("non-function non-array setup result is ignored; cleanup is no-op when never ensured", () => {
    const mgr = createSubscriptionManager();
    mgr.cleanup();
    expect(mgr.isSubscribed).toBe(false);
    // product: only function or Array are registered
    mgr.ensure(() => "not-a-fn" as never);
    expect(mgr.isSubscribed).toBe(true);
    expect(() => mgr.cleanup()).not.toThrow();
    expect(mgr.isSubscribed).toBe(false);
  });
});

// wave-315 residual
describe("subscription-manager residual (wave-315)", () => {
  it("ensure is idempotent; single function unsubscriber called once on cleanup", () => {
    const mgr = createSubscriptionManager();
    const unsub = vi.fn();
    const setup = vi.fn(() => unsub);
    mgr.ensure(setup);
    mgr.ensure(setup);
    mgr.ensure(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(mgr.isSubscribed).toBe(false);
  });

  it("void setup still marks subscribed; double cleanup is safe", () => {
    const mgr = createSubscriptionManager();
    mgr.ensure(() => undefined);
    expect(mgr.isSubscribed).toBe(true);
    mgr.cleanup();
    mgr.cleanup();
    expect(mgr.isSubscribed).toBe(false);
  });

  it("empty array of unsubscribers is fine; array with undefined entries skipped via optional call", () => {
    const mgr = createSubscriptionManager();
    const a = vi.fn();
    mgr.ensure(() => [a, undefined as never]);
    expect(() => mgr.cleanup()).not.toThrow();
    expect(a).toHaveBeenCalledTimes(1);
  });
});
