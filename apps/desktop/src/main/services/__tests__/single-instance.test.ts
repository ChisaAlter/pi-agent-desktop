import { describe, expect, it, vi } from "vitest";
import { registerSingleInstance } from "../single-instance";

type SecondInstanceListener = () => void;

function createFakeApp(lockAcquired: boolean) {
  let secondInstanceListener: SecondInstanceListener | null = null;
  return {
    requestSingleInstanceLock: vi.fn(() => lockAcquired),
    on: vi.fn((event: "second-instance", listener: SecondInstanceListener) => {
      if (event === "second-instance") secondInstanceListener = listener;
    }),
    quit: vi.fn(),
    exit: vi.fn(),
    emitSecondInstance() {
      secondInstanceListener?.();
    },
  };
}

describe("registerSingleInstance", () => {
  it("keeps the first instance and restores it when another launch is attempted", () => {
    const app = createFakeApp(true);
    const restoreExistingWindow = vi.fn();

    const isPrimaryInstance = registerSingleInstance(app, restoreExistingWindow);
    app.emitSecondInstance();

    expect(isPrimaryInstance).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(restoreExistingWindow).toHaveBeenCalledOnce();
  });

  it("quits a later instance immediately when the lock is already held", () => {
    const app = createFakeApp(false);
    const restoreExistingWindow = vi.fn();

    const isPrimaryInstance = registerSingleInstance(app, restoreExistingWindow);
    app.emitSecondInstance();

    expect(isPrimaryInstance).toBe(false);
    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
    expect(restoreExistingWindow).not.toHaveBeenCalled();
  });


  // wave-87 residual
  it("registers second-instance listener only for the primary instance", () => {
    const primary = createFakeApp(true);
    const secondary = createFakeApp(false);
    registerSingleInstance(primary, vi.fn());
    registerSingleInstance(secondary, vi.fn());
    expect(primary.on).toHaveBeenCalledWith("second-instance", expect.any(Function));
    expect(secondary.on).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledWith(0);
  });

  it("requests the single-instance lock exactly once per registration", () => {
    const app = createFakeApp(true);
    registerSingleInstance(app, vi.fn());
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  // wave-98 residual
  it("invokes restore on every second-instance event for primary", () => {
    const app = createFakeApp(true);
    const restoreExistingWindow = vi.fn();
    registerSingleInstance(app, restoreExistingWindow);
    app.emitSecondInstance();
    app.emitSecondInstance();
    app.emitSecondInstance();
    expect(restoreExistingWindow).toHaveBeenCalledTimes(3);
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("does not call quit for either primary or secondary paths", () => {
    const primary = createFakeApp(true);
    const secondary = createFakeApp(false);
    registerSingleInstance(primary, vi.fn());
    registerSingleInstance(secondary, vi.fn());
    expect(primary.quit).not.toHaveBeenCalled();
    expect(secondary.quit).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledWith(0);
  });

  // wave-123 residual
  it("returns boolean primary flag without invoking restore during registration", () => {
    const primary = createFakeApp(true);
    const secondary = createFakeApp(false);
    const restorePrimary = vi.fn();
    const restoreSecondary = vi.fn();
    expect(registerSingleInstance(primary, restorePrimary)).toBe(true);
    expect(registerSingleInstance(secondary, restoreSecondary)).toBe(false);
    expect(restorePrimary).not.toHaveBeenCalled();
    expect(restoreSecondary).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledTimes(1);
  });

  // wave-128 residual
  it("secondary exits before any second-instance emit can fire restore", () => {
    const secondary = createFakeApp(false);
    const restore = vi.fn();
    expect(registerSingleInstance(secondary, restore)).toBe(false);
    secondary.emitSecondInstance();
    expect(restore).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledWith(0);
    expect(secondary.on).not.toHaveBeenCalled();
  });

  it("primary can restore after secondary would have exited", () => {
    const primary = createFakeApp(true);
    const secondary = createFakeApp(false);
    const restore = vi.fn();
    registerSingleInstance(primary, restore);
    registerSingleInstance(secondary, vi.fn());
    primary.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(primary.exit).not.toHaveBeenCalled();
  });

  // wave-141 residual
  it("registers exactly one second-instance listener for primary", () => {
    const app = createFakeApp(true);
    registerSingleInstance(app, vi.fn());
    const secondInstanceCalls = app.on.mock.calls.filter((c) => c[0] === "second-instance");
    expect(secondInstanceCalls).toHaveLength(1);
    expect(typeof secondInstanceCalls[0]?.[1]).toBe("function");
  });

  it("propagates restore errors from second-instance without quitting primary", () => {
    const app = createFakeApp(true);
    const restore = vi.fn(() => {
      throw new Error("restore failed");
    });
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(() => app.emitSecondInstance()).toThrow("restore failed");
    expect(app.exit).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("secondary exit(0) happens before returning false", () => {
    const order: string[] = [];
    const secondary = {
      requestSingleInstanceLock: vi.fn(() => {
        order.push("lock");
        return false;
      }),
      on: vi.fn(() => {
        order.push("on");
      }),
      quit: vi.fn(() => {
        order.push("quit");
      }),
      exit: vi.fn(() => {
        order.push("exit");
      }),
      emitSecondInstance() {},
    };
    const result = registerSingleInstance(secondary, () => {
      order.push("restore");
    });
    expect(result).toBe(false);
    expect(order).toEqual(["lock", "exit"]);
  });

  // wave-172 residual
  it("primary registration order is lock then second-instance listener", () => {
    const order: string[] = [];
    const app = {
      requestSingleInstanceLock: vi.fn(() => {
        order.push("lock");
        return true;
      }),
      on: vi.fn((event: "second-instance", _listener: () => void) => {
        order.push(`on:${event}`);
      }),
      quit: vi.fn(),
      exit: vi.fn(),
      emitSecondInstance() {},
    };
    expect(registerSingleInstance(app, vi.fn())).toBe(true);
    expect(order).toEqual(["lock", "on:second-instance"]);
    expect(app.exit).not.toHaveBeenCalled();
  });

  // wave-175 residual
  it("double primary registration stacks second-instance listeners", () => {
    const app = createFakeApp(true);
    const restoreA = vi.fn();
    const restoreB = vi.fn();
    expect(registerSingleInstance(app, restoreA)).toBe(true);
    expect(registerSingleInstance(app, restoreB)).toBe(true);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(2);
    expect(app.on).toHaveBeenCalledTimes(2);
    app.emitSecondInstance();
    // createFakeApp keeps only the last listener — product would stack; fake models last-wins
    expect(restoreB).toHaveBeenCalledTimes(1);
    expect(restoreA).not.toHaveBeenCalled();
  });

  it("secondary path never touches restore even if restore would throw", () => {
    const secondary = createFakeApp(false);
    const restore = vi.fn(() => {
      throw new Error("should-not-run");
    });
    expect(registerSingleInstance(secondary, restore)).toBe(false);
    expect(() => secondary.emitSecondInstance()).not.toThrow();
    expect(restore).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledWith(0);
  });

  it("primary restore receives no arguments from second-instance event", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    registerSingleInstance(app, restore);
    app.emitSecondInstance();
    expect(restore).toHaveBeenCalledWith();
    expect(restore.mock.calls[0]).toEqual([]);
  });

  // wave-182 residual
  it("secondary path calls exit(0) and never quit", () => {
    const app = createFakeApp(false);
    expect(registerSingleInstance(app, vi.fn())).toBe(false);
    expect(app.exit).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.on).not.toHaveBeenCalled();
  });

  it("primary path registers exactly one second-instance listener per call", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.on).toHaveBeenCalledTimes(1);
    expect(app.on.mock.calls[0]?.[0]).toBe("second-instance");
    expect(app.exit).not.toHaveBeenCalled();
    app.emitSecondInstance();
    app.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(2);
  });

  // wave-193 residual
  it("primary returns true and never calls exit/quit", () => {
    const app = createFakeApp(true);
    expect(registerSingleInstance(app, vi.fn())).toBe(true);
    expect(app.exit).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  it("secondary returns false after exit(0) and lock was false", () => {
    const app = createFakeApp(false);
    expect(registerSingleInstance(app, vi.fn())).toBe(false);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.on).not.toHaveBeenCalled();
  });

  it("restore throwing on second-instance is not swallowed by register (fake forwards)", () => {
    const app = createFakeApp(true);
    const restore = vi.fn(() => {
      throw new Error("restore-fail");
    });
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(() => app.emitSecondInstance()).toThrow(/restore-fail/);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  // wave-200 residual
  it("secondary never attaches second-instance listener and does not call quit", () => {
    const app = createFakeApp(false);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(false);
    expect(app.on).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(restore).not.toHaveBeenCalled();
  });

  it("double register on primary last-wins in fake; both on() calls recorded", () => {
    // product Electron stacks listeners; createFakeApp models last-wins only
    const app = createFakeApp(true);
    const restoreA = vi.fn();
    const restoreB = vi.fn();
    expect(registerSingleInstance(app, restoreA)).toBe(true);
    expect(registerSingleInstance(app, restoreB)).toBe(true);
    expect(app.on).toHaveBeenCalledTimes(2);
    app.emitSecondInstance();
    expect(restoreA).not.toHaveBeenCalled();
    expect(restoreB).toHaveBeenCalledTimes(1);
  });

  // wave-205 residual
  it("primary registers second-instance with the exact restore function reference", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.on).toHaveBeenCalledWith("second-instance", restore);
    expect(app.exit).not.toHaveBeenCalled();
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  it("secondary exits with 0 before any on() and returns false synchronously", () => {
    const order: string[] = [];
    const app = createFakeApp(false);
    app.exit.mockImplementation(() => {
      order.push("exit");
    });
    app.on.mockImplementation(() => {
      order.push("on");
      return app;
    });
    const ok = registerSingleInstance(app, () => order.push("restore"));
    expect(ok).toBe(false);
    expect(order).toEqual(["exit"]);
  });

  it("primary can fire second-instance multiple times via fake emitter", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    registerSingleInstance(app, restore);
    app.emitSecondInstance();
    app.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(2);
  });

  // wave-212 residual
  it("secondary never registers listener and does not call restore", () => {
    const app = createFakeApp(false);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(false);
    expect(app.on).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(restore).not.toHaveBeenCalled();
  });

  it("primary requestSingleInstanceLock true then on second-instance once per emit", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.exit).not.toHaveBeenCalled();
    app.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  // wave-220 residual
  it("secondary never registers listener; primary does not call quit", () => {
    const secondary = createFakeApp(false);
    const restore = vi.fn();
    expect(registerSingleInstance(secondary, restore)).toBe(false);
    expect(secondary.on).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledWith(0);
    expect(secondary.quit).not.toHaveBeenCalled();
    secondary.emitSecondInstance();
    expect(restore).not.toHaveBeenCalled();

    const primary = createFakeApp(true);
    const restore2 = vi.fn();
    expect(registerSingleInstance(primary, restore2)).toBe(true);
    expect(primary.on).toHaveBeenCalledWith("second-instance", restore2);
    expect(primary.quit).not.toHaveBeenCalled();
    expect(primary.exit).not.toHaveBeenCalled();
  });

  // wave-248 residual
  it("primary registers restore before any second-instance; multiple emits invoke restore each time", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith("second-instance", restore);
    app.emitSecondInstance();
    app.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("secondary exit(0) only; lock false short-circuits without on or restore", () => {
    const app = createFakeApp(false);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(false);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.on).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  // wave-261 residual
  it("primary returns true and wires exact restore callback reference", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.on.mock.calls[0]?.[0]).toBe("second-instance");
    expect(app.on.mock.calls[0]?.[1]).toBe(restore);
  });

  it("secondary does not register listener even if restore is provided", () => {
    const app = createFakeApp(false);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(false);
    expect(app.on).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  // wave-283 residual
  it("primary never calls quit or exit; secondary never calls quit", () => {
    const primary = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(primary, restore)).toBe(true);
    expect(primary.quit).not.toHaveBeenCalled();
    expect(primary.exit).not.toHaveBeenCalled();
    primary.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(primary.quit).not.toHaveBeenCalled();

    const secondary = createFakeApp(false);
    expect(registerSingleInstance(secondary, vi.fn())).toBe(false);
    expect(secondary.quit).not.toHaveBeenCalled();
    expect(secondary.exit).toHaveBeenCalledWith(0);
  });

  it("registering twice on primary requests lock twice; fake app last-wins listener", () => {
    const app = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(2);
    expect(app.on).toHaveBeenCalledTimes(2);
    expect(app.on.mock.calls.every((c) => c[0] === "second-instance" && c[1] === restore)).toBe(true);
    app.emitSecondInstance();
    // createFakeApp keeps only the last listener (documented last-wins in earlier residual)
    expect(restore).toHaveBeenCalledTimes(1);
  });





  // wave-303 residual
  it("primary returns true and wires second-instance to restore; secondary exit(0)", () => {
    const primary = createFakeApp(true);
    const restore = vi.fn();
    expect(registerSingleInstance(primary, restore)).toBe(true);
    expect(primary.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(primary.on).toHaveBeenCalledWith("second-instance", restore);
    primary.emitSecondInstance();
    expect(restore).toHaveBeenCalledTimes(1);

    const secondary = createFakeApp(false);
    expect(registerSingleInstance(secondary, restore)).toBe(false);
    expect(secondary.exit).toHaveBeenCalledWith(0);
    expect(secondary.on).not.toHaveBeenCalled();
  });

  it("secondary does not call restore; primary does not exit/quit on register", () => {
    const restore = vi.fn();
    const secondary = createFakeApp(false);
    registerSingleInstance(secondary, restore);
    expect(restore).not.toHaveBeenCalled();
    expect(secondary.quit).not.toHaveBeenCalled();

    const primary = createFakeApp(true);
    registerSingleInstance(primary, restore);
    expect(primary.exit).not.toHaveBeenCalled();
    expect(primary.quit).not.toHaveBeenCalled();
  });



  // wave-314 residual
  it("registerSingleInstance: secondary exits 0 and returns false without second-instance listener", () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      on: vi.fn(),
      quit: vi.fn(),
      exit: vi.fn(),
    };
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(false);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.on).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("registerSingleInstance: primary registers second-instance restore and returns true", () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      on: vi.fn(),
      quit: vi.fn(),
      exit: vi.fn(),
    };
    const restore = vi.fn();
    expect(registerSingleInstance(app, restore)).toBe(true);
    expect(app.exit).not.toHaveBeenCalled();
    expect(app.on).toHaveBeenCalledWith("second-instance", restore);
    // invoke listener
    const handler = app.on.mock.calls[0][1] as () => void;
    handler();
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
