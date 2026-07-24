import { describe, expect, it, vi } from "vitest";
import { isIpcError, translateIpcError } from "./IpcError";

describe("translateIpcError", () => {
  it("re-exports isIpcError brand detection", () => {
    expect(isIpcError({ __brand: "IpcError", code: "e", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "e", fallback: "f" })).toBe(true);
    expect(isIpcError(null)).toBe(false);
  });

  it("returns translated text when t resolves a non-key value", () => {
    const t = vi.fn((key: string) => (key === "err.network" ? "网络错误" : key));
    expect(
      translateIpcError({ __brand: "IpcError", code: "err.network", fallback: "network" }, t),
    ).toBe("网络错误");
    expect(t).toHaveBeenCalledWith("err.network", {});
  });

  it("falls back when the translation key is missing", () => {
    const t = (key: string) => key;
    expect(
      translateIpcError(
        { __brand: "IpcError", code: "missing.key", fallback: "中文兜底", params: { a: 1 } },
        t,
      ),
    ).toBe("中文兜底");
  });

  it("falls back when t throws", () => {
    const t = () => {
      throw new Error("i18n broken");
    };
    expect(
      translateIpcError({ __brand: "IpcError", code: "x", fallback: "safe" }, t),
    ).toBe("safe");
  });

  // wave-227 residual
  it("passes params object through to t when present", () => {
    const t = vi.fn((key: string, options?: Record<string, unknown>) => {
      if (key === "err.withParams" && options?.name === "Ayase") return "你好 Ayase";
      return key;
    });
    expect(
      translateIpcError(
        { __brand: "IpcError", code: "err.withParams", fallback: "fb", params: { name: "Ayase" } },
        t,
      ),
    ).toBe("你好 Ayase");
    expect(t).toHaveBeenCalledWith("err.withParams", { name: "Ayase" });
  });

  it("uses empty params object when params is undefined", () => {
    const t = vi.fn((_key: string, options?: Record<string, unknown>) => {
      expect(options).toEqual({});
      return "ok";
    });
    expect(
      translateIpcError({ __brand: "IpcError", code: "err.x", fallback: "fb" }, t),
    ).toBe("ok");
  });

  it("legacy shape without __brand still translates via isIpcError", () => {
    const legacy = { code: "err.legacy", fallback: "legacy-fb" };
    expect(isIpcError(legacy)).toBe(true);
    const t = (key: string) => (key === "err.legacy" ? "LEGACY" : key);
    expect(translateIpcError(legacy as never, t)).toBe("LEGACY");
  });


  // wave-293 residual
  it("returns fallback when t echoes key (missing i18n entry)", () => {
    const t = (key: string) => key;
    expect(
      translateIpcError(
        { __brand: "IpcError", code: "errors.missing", fallback: "中文兜底" },
        t,
      ),
    ).toBe("中文兜底");
  });

  it("returns translated string when t succeeds; catch path uses fallback", () => {
    const tOk = (key: string, opts?: Record<string, unknown>) =>
      key === "err.ok" ? `OK:${String(opts?.n ?? "")}` : key;
    expect(
      translateIpcError(
        { __brand: "IpcError", code: "err.ok", fallback: "fb", params: { n: 3 } },
        tOk,
      ),
    ).toBe("OK:3");
    const tThrow = () => {
      throw new Error("boom");
    };
    expect(
      translateIpcError({ __brand: "IpcError", code: "err.x", fallback: "safe" }, tThrow),
    ).toBe("safe");
    expect(isIpcError({ code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "c" })).toBe(false);
  });



  // wave-301 residual
  it("translateIpcError uses empty object when params nullish; passes through object params", () => {
    const t = vi.fn((key: string, options?: Record<string, unknown>) => {
      if (key === "err.x" && options && Object.keys(options).length === 0) return "EMPTY";
      if (key === "err.y" && options?.id === 7) return "ID7";
      return key;
    });
    expect(
      translateIpcError({ __brand: "IpcError", code: "err.x", fallback: "fb" }, t),
    ).toBe("EMPTY");
    expect(t).toHaveBeenCalledWith("err.x", {});
    expect(
      translateIpcError(
        { __brand: "IpcError", code: "err.y", fallback: "fb", params: { id: 7 } },
        t,
      ),
    ).toBe("ID7");
  });

  it("isIpcError requires code+fallback strings; translate falls back when t echoes code", () => {
    expect(isIpcError({ code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "c", fallback: 1 })).toBe(false);
    expect(isIpcError({ code: "c" })).toBe(false);
    expect(isIpcError(undefined)).toBe(false);
    const t = (key: string) => key;
    expect(
      translateIpcError({ __brand: "IpcError", code: "missing", fallback: "兜底" }, t),
    ).toBe("兜底");
  });




  // wave-308 residual
  it("translateIpcError wave-308: missing params treated as {}; t return equal to code uses fallback", () => {
    const calls: unknown[] = [];
    const t = (key: string, options?: Record<string, unknown>) => {
      calls.push([key, options]);
      return key === "err.hit" ? "HIT" : key;
    };
    expect(
      translateIpcError({ __brand: "IpcError", code: "err.hit", fallback: "fb", params: undefined }, t),
    ).toBe("HIT");
    expect(calls[0]).toEqual(["err.hit", {}]);
    expect(
      translateIpcError({ __brand: "IpcError", code: "err.miss", fallback: "兜底中文" }, t),
    ).toBe("兜底中文");
  });

  it("isIpcError wave-308 rejects non-objects and partial shapes", () => {
    expect(isIpcError(null)).toBe(false);
    expect(isIpcError("x")).toBe(false);
    expect(isIpcError({ code: "c", fallback: "f", extra: 1 })).toBe(true);
    expect(isIpcError({ code: "", fallback: "" })).toBe(true);
  });

});
