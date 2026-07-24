// Renderer logger 测试 (v1.0.10 H3 修复)
// 覆盖: 走 window.piAPI.log / piAPI 缺失降级 console / Error 序列化 / level 白名单

import { describe, it, expect, beforeEach, vi } from "vitest";
import { logger } from "../logger";

interface MockWindow {
    piAPI?: { log: ReturnType<typeof vi.fn> };
    consoleError?: ReturnType<typeof vi.spyOn>;
    consoleWarn?: ReturnType<typeof vi.spyOn>;
    consoleInfo?: ReturnType<typeof vi.spyOn>;
    consoleDebug?: ReturnType<typeof vi.spyOn>;
}

beforeEach(() => {
    (globalThis as { window: MockWindow }).window = {};
});

describe("logger: 走 window.piAPI.log", () => {
    it("error 调用 piAPI.log('error', msg, [extra])", () => {
        const log = vi.fn();
        (globalThis as { window: MockWindow }).window = { piAPI: { log } };
        logger.error("boom", new Error("EACCES"), { path: "/x" });
        expect(log).toHaveBeenCalledOnce();
        const [level, msg, extra] = log.mock.calls[0];
        expect(level).toBe("error");
        expect(msg).toBe("boom");
        // extra 是序列化后的字符串数组
        expect(Array.isArray(extra)).toBe(true);
        expect(extra[0]).toContain("EACCES"); // Error stack/message
        expect(extra[1]).toContain("/x");     // object 走 JSON.stringify
    });

    it("warn / info / debug 各自走对应 level", () => {
        const log = vi.fn();
        (globalThis as { window: MockWindow }).window = { piAPI: { log } };
        logger.warn("w");
        logger.info("i");
        logger.debug("d");
        expect(log.mock.calls.map((c) => c[0])).toEqual(["warn", "info", "debug"]);
    });

    it("Error 实例 → 包含 message + stack 的字符串", () => {
        const log = vi.fn();
        (globalThis as { window: MockWindow }).window = { piAPI: { log } };
        logger.error("fail", new Error("disk full"));
        const extra = log.mock.calls[0][2] as string[];
        expect(extra[0]).toContain("disk full");
    });
});

describe("logger: piAPI 缺失时降级 console", () => {
    it("没有 window.piAPI → 调 console.error", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        logger.error("degraded");
        expect(spy).toHaveBeenCalledWith("degraded");
        spy.mockRestore();
    });

    it("piAPI.log 自身抛 → 降级 console (不挂业务)", () => {
        (globalThis as { window: MockWindow }).window = {
            piAPI: { log: vi.fn(() => { throw new Error("bridge dead"); }) },
        };
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        logger.error("x");
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

// wave-110 residual
describe("logger: arg stringify residual", () => {
  it("stringifies number/boolean primitives and circular objects safely", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    logger.info("mix", 42, false, circular);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("42");
    expect(extra[1]).toBe("false");
    // circular JSON.stringify throws → String(a) fallback
    expect(typeof extra[2]).toBe("string");
    expect(extra[2].length).toBeGreaterThan(0);
  });

  it("debug falls back to console.debug when piAPI missing", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("dbg", "x");
    expect(spy).toHaveBeenCalledWith("dbg", "x");
    spy.mockRestore();
  });
});

// wave-124 residual
describe("logger residual (wave-124)", () => {
  it("stringifies null, arrays, and plain objects; undefined becomes JSON undefined slot", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.warn("args", null, undefined, [1, "a"], { k: 1 });
    const extra = log.mock.calls[0][2] as Array<string | undefined>;
    // product: JSON.stringify(null)="null"; JSON.stringify(undefined)=undefined (not String)
    expect(extra[0]).toBe("null");
    expect(extra[1]).toBeUndefined();
    expect(extra[2]).toBe("[1,\"a\"]");
    expect(extra[3]).toBe("{\"k\":1}");
  });

  it("warn/info fall back to matching console methods when piAPI is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.warn("w-msg", 1);
    logger.info("i-msg", 2);
    expect(warn).toHaveBeenCalledWith("w-msg", 1);
    expect(info).toHaveBeenCalledWith("i-msg", 2);
    warn.mockRestore();
    info.mockRestore();
  });

  it("passes empty extra array when no args are provided", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.debug("only-msg");
    expect(log).toHaveBeenCalledWith("debug", "only-msg", []);
  });
});

// wave-145 residual
describe("logger residual (wave-145)", () => {
  it("stringifies Error without stack as message only", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const err = new Error("nostack");
    Object.defineProperty(err, "stack", { value: undefined });
    logger.error("e", err);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("nostack");
  });

  it("stringifies plain string args without wrapping", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.info("m", "plain", "two");
    expect(log.mock.calls[0][2]).toEqual(["plain", "two"]);
  });

  it("falls back to console when piAPI.log is not a function", () => {
    (globalThis as { window: MockWindow }).window = {
      piAPI: { log: "not-a-fn" as never },
    };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("w");
    expect(spy).toHaveBeenCalledWith("w");
    spy.mockRestore();
  });
});

// wave-159 residual
describe("logger residual (wave-159)", () => {
  it("stringifies number/boolean and circular objects via String fallback", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    logger.debug("d", 42, true, circular);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("42");
    expect(extra[1]).toBe("true");
    expect(extra[2]).toBe("[object Object]");
  });

  it("falls back to console when piAPI.log throws", () => {
    (globalThis as { window: MockWindow }).window = {
      piAPI: {
        log: () => {
          throw new Error("bridge-down");
        },
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("boom", "x");
    expect(spy).toHaveBeenCalledWith("boom", "x");
    spy.mockRestore();
  });

  it("JSON-stringifies plain objects and arrays", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.info("i", { a: 1 }, [2, 3]);
    expect(log.mock.calls[0][2]).toEqual(['{"a":1}', "[2,3]"]);
  });
});

// wave-171 residual
describe("logger residual (wave-171)", () => {
  it("keeps empty string args and multi-arg Error + object order", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.error("e", "", new Error("z"), { ok: true });
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("");
    expect(extra[1]).toContain("z");
    expect(extra[2]).toBe('{"ok":true}');
  });

  it("falls back to console.debug when piAPI is absent for debug level", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("only-debug");
    expect(spy).toHaveBeenCalledWith("only-debug");
    spy.mockRestore();
  });
});

// wave-177 residual
describe("logger residual (wave-177)", () => {
  it("stringifies bigint/undefined/null and falls back when JSON.stringify throws", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    logger.info("i", 1n as never, undefined, null, circular);
    const extra = log.mock.calls[0][2] as string[];
    // bigint: JSON.stringify throws → String(a)
    expect(extra[0]).toBe("1");
    expect(extra[1]).toBe(undefined as never); // JSON.stringify(undefined) returns undefined (not string)
    // product: JSON.stringify(undefined) is undefined, then returned as-is from map
    // re-check product: try JSON.stringify(undefined) → undefined (not catch)
    expect(extra).toEqual(expect.arrayContaining(["1"]));
    expect(extra.some((x) => x === "null" || x === null)).toBe(true);
    expect(extra.some((x) => typeof x === "string" && (x.includes("[object Object]") || x.includes("self")))).toBe(true);
  });

  it("falls back to console when piAPI.log throws", () => {
    const log = vi.fn(() => {
      throw new Error("bridge-down");
    });
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => logger.warn("w", "x")).not.toThrow();
    expect(spy).toHaveBeenCalledWith("w", "x");
    spy.mockRestore();
  });

  it("ignores non-function piAPI.log and uses console", () => {
    (globalThis as { window: MockWindow }).window = { piAPI: { log: "nope" as never } };
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });
});

// wave-187 residual
describe("logger residual (wave-187)", () => {
  it("stringifies Error without stack to message only and Error with stack includes both", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const withStack = new Error("boom");
    const noStack = new Error("nostack");
    Object.defineProperty(noStack, "stack", { value: undefined });
    logger.error("e", withStack, noStack);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toContain("boom");
    expect(extra[0]).toContain("Error");
    expect(extra[1]).toBe("nostack");
  });

  it("passes empty extra array when no args", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.debug("only-msg");
    expect(log).toHaveBeenCalledWith("debug", "only-msg", []);
  });

  it("maps debug to console.debug on fallback", () => {
    (globalThis as { window: MockWindow }).window = {};
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("d", 1);
    expect(spy).toHaveBeenCalledWith("d", 1);
    spy.mockRestore();
  });
});

// wave-196 residual
describe("logger residual (wave-196)", () => {
  it("stringifies circular objects via String fallback and preserves null/boolean", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    logger.info("c", circular, null, true);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toMatch(/\[object Object\]|circular|self/i);
    expect(extra[1]).toBe("null");
    expect(extra[2]).toBe("true");
  });

  it("falls back to console.error when window is undefined-like without piAPI", () => {
    (globalThis as { window: MockWindow }).window = {};
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("e", "x");
    expect(spy).toHaveBeenCalledWith("e", "x");
    spy.mockRestore();
  });
});

// wave-201 residual
describe("logger residual (wave-201)", () => {
  it("serializes Error with stack and dispatches level as first piAPI.log arg", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const err = new Error("boom");
    logger.warn("w", err, { a: 1 });
    expect(log).toHaveBeenCalledWith("warn", "w", expect.any(Array));
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toContain("boom");
    expect(extra[1]).toBe(JSON.stringify({ a: 1 }));
  });

  it("falls back to console when piAPI.log throws", () => {
    const log = vi.fn(() => {
      throw new Error("bridge-down");
    });
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("i", "x");
    expect(spy).toHaveBeenCalledWith("i", "x");
    spy.mockRestore();
  });

  it("debug level uses console.debug when piAPI missing", () => {
    (globalThis as { window: MockWindow }).window = {};
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("d", 1);
    expect(spy).toHaveBeenCalledWith("d", 1);
    spy.mockRestore();
  });
});

// wave-205 residual
describe("logger residual (wave-205)", () => {
  it("stringifies boolean/number args and passes level to piAPI.log", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.info("m", true, 0, false);
    expect(log).toHaveBeenCalledWith("info", "m", ["true", "0", "false"]);
  });

  it("falls back to String(a) when JSON.stringify throws on circular", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    logger.error("c", circular);
    expect(log).toHaveBeenCalledWith("error", "c", [expect.any(String)]);
    const extra = log.mock.calls[0][2] as string[];
    // product catch → String(a) which for objects is [object Object]
    expect(extra[0]).toMatch(/\[object Object\]|self/);
  });

  it("non-function piAPI.log falls back to console without throwing", () => {
    (globalThis as { window: MockWindow }).window = {
      piAPI: { log: "not-a-function" as never },
    };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => logger.warn("w", "x")).not.toThrow();
    expect(spy).toHaveBeenCalledWith("w", "x");
    spy.mockRestore();
  });

  it("Error without stack uses message only", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const err = new Error("nostack");
    Object.defineProperty(err, "stack", { value: undefined });
    logger.error("e", err);
    expect(log).toHaveBeenCalledWith("error", "e", ["nostack"]);
  });
});

// wave-211 residual
describe("logger residual (wave-211)", () => {
  it("piAPI.log throw falls back to console without rethrowing", () => {
    const log = vi.fn(() => {
      throw new Error("bridge dead");
    });
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logger.error("e", "x")).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("e", "x");
    spy.mockRestore();
  });

  it("null/undefined args stringify via JSON; empty arg list still dispatches", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.info("m", null, undefined);
    // product: null → JSON "null"; undefined → JSON.stringify(undefined) keeps undefined in the array
    expect(log.mock.calls[0]).toEqual(["info", "m", ["null", undefined]]);
    logger.warn("solo");
    expect(log).toHaveBeenCalledWith("warn", "solo", []);
  });
});

// wave-218 residual
describe("logger residual (wave-218)", () => {
  it("debug level uses console.debug when bridge missing; non-function piAPI.log falls back", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("dmsg", 1);
    expect(spy).toHaveBeenCalledWith("dmsg", 1);
    spy.mockRestore();

    (globalThis as { window: MockWindow }).window = {
      piAPI: { log: "not-a-function" as never },
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("e2");
    expect(errSpy).toHaveBeenCalledWith("e2");
    errSpy.mockRestore();
  });

  it("Error without stack stringifies message only; arrays stringify via JSON", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const err = new Error("msg-only");
    err.stack = undefined;
    logger.error("e", err, [1, "a"]);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("msg-only");
    expect(extra[1]).toBe(JSON.stringify([1, "a"]));
  });
});

// wave-238 residual
describe("logger residual (wave-238)", () => {
  it("stringifies boolean/number args and circular objects via String fallback", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    logger.info("i", true, 0, circular);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("true");
    expect(extra[1]).toBe("0");
    expect(extra[2]).toBe(String(circular));
  });

  it("piAPI.log throw falls back to console for each level", () => {
    (globalThis as { window: MockWindow }).window = {
      piAPI: {
        log: () => {
          throw new Error("bridge-down");
        },
      },
    };
    const spies = {
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(spies.error).toHaveBeenCalledWith("e");
    expect(spies.warn).toHaveBeenCalledWith("w");
    expect(spies.info).toHaveBeenCalledWith("i");
    expect(spies.debug).toHaveBeenCalledWith("d");
    for (const s of Object.values(spies)) s.mockRestore();
  });

  it("Error with stack is included in stringified args", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const err = new Error("boom");
    err.stack = "Error: boom\n    at x";
    logger.error("e", err);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toContain("boom");
    expect(extra[0]).toContain("at x");
  });
});

// wave-257 residual
describe("logger residual (wave-257)", () => {
  it("passes level and stringified primitives/objects to piAPI.log", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.info("msg", 1, true, { a: 2 }, null);
    expect(log).toHaveBeenCalledWith("info", "msg", ["1", "true", '{"a":2}', "null"]);
  });

  it("falls back to console when piAPI missing; Error without stack uses message only", () => {
    (globalThis as { window: MockWindow }).window = {};
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("plain");
    expect(info).toHaveBeenCalledWith("plain");
    info.mockRestore();

    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const err = new Error("no-stack");
    delete (err as { stack?: string }).stack;
    logger.error("e", err);
    const extra = log.mock.calls[0][2] as string[];
    expect(extra[0]).toBe("no-stack");
  });
});


// wave-268 residual
describe("logger residual (wave-268)", () => {
  it("dispatches warn/debug levels to piAPI.log with stringified extras", () => {
    const log = vi.fn();
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    logger.warn("w", { k: 1 });
    logger.debug("d", "x");
    expect(log).toHaveBeenCalledWith("warn", "w", ['{"k":1}']);
    expect(log).toHaveBeenCalledWith("debug", "d", ["x"]);
  });

  it("falls back to console.warn when piAPI.log throws", () => {
    const log = vi.fn(() => {
      throw new Error("bridge down");
    });
    (globalThis as { window: MockWindow }).window = { piAPI: { log } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("still");
    expect(warn).toHaveBeenCalledWith("still");
    warn.mockRestore();
  });
});
