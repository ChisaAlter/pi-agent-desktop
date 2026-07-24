import { describe, expect, it } from "vitest";
import { partition } from "./ipc";

describe("partition", () => {
  it("returns ok data for successful IPC payloads", () => {
    expect(partition({ id: "ws-1" })).toEqual({ ok: true, data: { id: "ws-1" } });
    expect(partition(null)).toEqual({ ok: true, data: null });
    expect(partition("ready")).toEqual({ ok: true, data: "ready" });
  });

  it("returns err for IpcError-shaped values", () => {
    const err = { code: "ipcErrors.x", fallback: "失败了" };
    expect(partition(err)).toEqual({ ok: false, err });
  });

  it("returns err when branded IpcError is present", () => {
    const err = {
      __brand: "IpcError" as const,
      code: "ipcErrors.y",
      fallback: "blocked",
    };
    expect(partition(err)).toEqual({ ok: false, err });
  });

  // wave-108 residual
  it("treats incomplete error-shaped objects as success data", () => {
    expect(partition({ code: "only-code" })).toEqual({ ok: true, data: { code: "only-code" } });
    expect(partition({ fallback: "only-fallback" })).toEqual({
      ok: true,
      data: { fallback: "only-fallback" },
    });
    expect(partition({ code: 1, fallback: "x" })).toEqual({
      ok: true,
      data: { code: 1, fallback: "x" },
    });
  });

  it("accepts branded IpcError even when code/fallback types are odd", () => {
    const err = { __brand: "IpcError" as const, code: 123, fallback: null };
    expect(partition(err as never)).toEqual({ ok: false, err });
  });

  // wave-126 residual
  it("treats primitives arrays and empty objects as success data", () => {
    expect(partition(true)).toEqual({ ok: true, data: true });
    expect(partition(0)).toEqual({ ok: true, data: 0 });
    expect(partition([])).toEqual({ ok: true, data: [] });
    expect(partition({})).toEqual({ ok: true, data: {} });
  });

  it("requires both code and fallback strings for non-branded IpcError shape", () => {
    const err = { code: "ipcErrors.z", fallback: "失败" };
    expect(partition(err)).toEqual({ ok: false, err });
    expect(partition({ code: "ipcErrors.z", fallback: 1 })).toEqual({
      ok: true,
      data: { code: "ipcErrors.z", fallback: 1 },
    });
  });

  // wave-131 residual
  it("treats null and undefined as success data", () => {
    expect(partition(null)).toEqual({ ok: true, data: null });
    expect(partition(undefined)).toEqual({ ok: true, data: undefined });
  });

  it("does not treat nested error objects as IpcError", () => {
    const nested = { error: { code: "x", fallback: "y" } };
    expect(partition(nested)).toEqual({ ok: true, data: nested });
  });

  // wave-146 residual
  it("accepts branded IpcError with optional params as err", () => {
    const err = {
      __brand: "IpcError" as const,
      code: "ipcErrors.z",
      fallback: "失败",
      params: { workspaceId: "w1", attempt: 2 },
    };
    expect(partition(err)).toEqual({ ok: false, err });
  });

  it("treats code+fallback with extra fields as err (legacy shape)", () => {
    const err = { code: "ipcErrors.x", fallback: "f", detail: "extra" };
    expect(partition(err)).toEqual({ ok: false, err });
  });

  it("treats empty-string code/fallback as err (product string check only)", () => {
    const err = { code: "", fallback: "" };
    expect(partition(err)).toEqual({ ok: false, err });
  });

  // wave-160 residual
  it("treats primitive success values including 0/false/empty-string as ok", () => {
    expect(partition(0)).toEqual({ ok: true, data: 0 });
    expect(partition(false)).toEqual({ ok: true, data: false });
    expect(partition("")).toEqual({ ok: true, data: "" });
    expect(partition([])).toEqual({ ok: true, data: [] });
  });

  it("rejects partial error-like objects missing code or fallback", () => {
    expect(partition({ code: "c" })).toEqual({ ok: true, data: { code: "c" } });
    expect(partition({ fallback: "f" })).toEqual({ ok: true, data: { fallback: "f" } });
    expect(partition({ code: "c", fallback: "f", __brand: "Other" })).toEqual({
      ok: false,
      err: { code: "c", fallback: "f", __brand: "Other" },
    });
  });

  // wave-174 residual
  it("brand-only IpcError is err even without code/fallback fields", () => {
    const err = { __brand: "IpcError" as const };
    expect(partition(err as never)).toEqual({ ok: false, err });
  });

  it("wrong brand without string code/fallback stays ok data", () => {
    expect(partition({ __brand: "Other" })).toEqual({ ok: true, data: { __brand: "Other" } });
    expect(partition({ __brand: "Other", code: 1, fallback: "f" })).toEqual({
      ok: true,
      data: { __brand: "Other", code: 1, fallback: "f" },
    });
  });

  it("unicode fallback legacy shape is still an error partition", () => {
    const err = { code: "ipcErrors.x", fallback: "敏感配置" };
    expect(partition(err)).toEqual({ ok: false, err });
  });

  // wave-182 residual
  it("null and undefined are success data (not IpcError objects)", () => {
    expect(partition(null as never)).toEqual({ ok: true, data: null });
    expect(partition(undefined as never)).toEqual({ ok: true, data: undefined });
  });

  it("arrays with string code+fallback are err; bare functions stay success data", () => {
    // product isIpcError: typeof object (arrays are objects) + string code/fallback → err
    const arr = Object.assign(["c", "f"], { code: "c", fallback: "f" });
    expect(partition(arr as never)).toEqual({ ok: false, err: arr });
    // functions are not typeof object
    const fn = Object.assign(() => undefined, { code: "c", fallback: "f" });
    expect(partition(fn as never)).toEqual({ ok: true, data: fn });
  });

  it("preserves full IpcError object reference including params", () => {
    const params = { path: "C:/x" };
    const err = { __brand: "IpcError" as const, code: "c", fallback: "f", params };
    const out = partition(err as never);
    expect(out).toEqual({ ok: false, err });
    if (!out.ok) {
      expect(out.err).toBe(err);
      expect(out.err.params).toBe(params);
    }
  });

  // wave-190 residual
  it("brand IpcError short-circuits even without code/fallback strings", () => {
    const bare = { __brand: "IpcError" as const };
    expect(partition(bare as never)).toEqual({ ok: false, err: bare });
  });

  it("success path returns same data reference for objects and primitives", () => {
    const obj = { ok: true, n: 1 };
    const out = partition(obj);
    expect(out).toEqual({ ok: true, data: obj });
    if (out.ok) expect(out.data).toBe(obj);
    expect(partition(0)).toEqual({ ok: true, data: 0 });
    expect(partition("")).toEqual({ ok: true, data: "" });
    expect(partition(false)).toEqual({ ok: true, data: false });
  });

  // wave-195 residual
  it("arrays and functions without IpcError brand are success data", () => {
    const arr = [1, 2];
    const outArr = partition(arr as never);
    expect(outArr).toEqual({ ok: true, data: arr });
    if (outArr.ok) expect(outArr.data).toBe(arr);

    const fn = () => 1;
    const outFn = partition(fn as never);
    expect(outFn.ok).toBe(true);
    if (outFn.ok) expect(outFn.data).toBe(fn);
  });

  it("legacy code+fallback strings are err even with wrong brand; brand alone needs IpcError", () => {
    // product isIpcError: brand short-circuit OR (string code + string fallback)
    const legacy = { __brand: "NotIpcError", code: "x", fallback: "y" };
    expect(partition(legacy as never)).toEqual({ ok: false, err: legacy });
    const wrongBrandOnly = { __brand: "NotIpcError" };
    expect(partition(wrongBrandOnly as never)).toEqual({ ok: true, data: wrongBrandOnly });
  });

  it("null and undefined are success data (not branded errors)", () => {
    expect(partition(null as never)).toEqual({ ok: true, data: null });
    expect(partition(undefined as never)).toEqual({ ok: true, data: undefined });
  });

  // wave-200 residual
  it("code without fallback is success; fallback without code is success", () => {
    const onlyCode = { code: "x" };
    const onlyFallback = { fallback: "y" };
    expect(partition(onlyCode as never)).toEqual({ ok: true, data: onlyCode });
    expect(partition(onlyFallback as never)).toEqual({ ok: true, data: onlyFallback });
  });

  it("non-string code or fallback with wrong brand is success data", () => {
    const bad = { __brand: "Other", code: 1, fallback: 2 };
    expect(partition(bad as never)).toEqual({ ok: true, data: bad });
    const okBrand = { __brand: "IpcError" as const, code: 1, fallback: 2 };
    expect(partition(okBrand as never)).toEqual({ ok: false, err: okBrand });
  });

  // wave-204 residual
  it("array and boolean success payloads pass through unchanged", () => {
    expect(partition([1, 2] as never)).toEqual({ ok: true, data: [1, 2] });
    expect(partition(false as never)).toEqual({ ok: true, data: false });
    expect(partition(true as never)).toEqual({ ok: true, data: true });
  });

  it("empty-string code+fallback is still an err branch", () => {
    const err = { code: "", fallback: "" };
    expect(partition(err as never)).toEqual({ ok: false, err });
  });

  // wave-210 residual
  it("zero and empty-string success payloads pass through; branded incomplete is err", () => {
    expect(partition(0 as never)).toEqual({ ok: true, data: 0 });
    expect(partition("" as never)).toEqual({ ok: true, data: "" });
    const brandedOnly = { __brand: "IpcError" as const };
    expect(partition(brandedOnly as never)).toEqual({ ok: false, err: brandedOnly });
  });

  it("object with string code+fallback is err even with extra fields", () => {
    const err = { code: "E", fallback: "msg", extra: 1, nested: { a: true } };
    expect(partition(err as never)).toEqual({ ok: false, err });
  });

  // wave-222 residual
  it("nested data objects succeed; branded nested IpcError inside data still succeeds", () => {
    const nested = {
      ok: true,
      payload: { __brand: "IpcError" as const, code: "inner", fallback: "nope" },
    };
    expect(partition(nested as never)).toEqual({ ok: true, data: nested });
  });

  it("undefined and NaN success payloads pass through; symbol is success", () => {
    expect(partition(undefined as never)).toEqual({ ok: true, data: undefined });
    expect(partition(Number.NaN as never)).toEqual({ ok: true, data: Number.NaN });
    const s = Symbol("x");
    expect(partition(s as never)).toEqual({ ok: true, data: s });
  });

  // wave-257 residual
  it("null is success; non-string code/fallback without brand is success", () => {
    expect(partition(null as never)).toEqual({ ok: true, data: null });
    expect(partition({ code: 1, fallback: "x" } as never)).toEqual({
      ok: true,
      data: { code: 1, fallback: "x" },
    });
    expect(partition({ code: "E", fallback: 2 } as never)).toEqual({
      ok: true,
      data: { code: "E", fallback: 2 },
    });
  });

  it("brand short-circuits even with non-string code; dual string code+fallback is err", () => {
    const branded = { __brand: "IpcError" as const, code: 9, fallback: null };
    expect(partition(branded as never)).toEqual({ ok: false, err: branded });
    const legacy = { code: "X", fallback: "y" };
    expect(partition(legacy as never)).toEqual({ ok: false, err: legacy });
  });

  // wave-268 residual
  it("partition ok for plain strings/numbers/arrays; err only for IpcError shapes", () => {
    expect(partition("ok" as never)).toEqual({ ok: true, data: "ok" });
    expect(partition(0 as never)).toEqual({ ok: true, data: 0 });
    expect(partition([] as never)).toEqual({ ok: true, data: [] });
    const err = { __brand: "IpcError" as const, code: "e", fallback: "f" };
    expect(partition(err as never)).toEqual({ ok: false, err });
  });

  it("legacy string code+fallback is err; brand alone is err", () => {
    expect(partition({ code: "c", fallback: "fb" } as never)).toEqual({
      ok: false,
      err: { code: "c", fallback: "fb" },
    });
    expect(partition({ __brand: "IpcError" } as never).ok).toBe(false);
  });
});


// wave-296 residual
describe("partition residual (wave-296)", () => {
  it("success path preserves object identity for plain data", () => {
    const data = { a: 1, nested: { b: 2 } };
    const result = partition(data);
    expect(result).toEqual({ ok: true, data });
    if (result.ok) expect(result.data).toBe(data);
  });

  it("params on IpcError are preserved on err branch", () => {
    const err = {
      __brand: "IpcError" as const,
      code: "desktop.x",
      fallback: "失败",
      params: { id: "1" },
    };
    expect(partition(err as never)).toEqual({ ok: false, err });
  });

  it("boolean false and empty object are success; only IpcError shapes fail", () => {
    expect(partition(false as never)).toEqual({ ok: true, data: false });
    expect(partition({} as never)).toEqual({ ok: true, data: {} });
    expect(partition({ code: "c" } as never).ok).toBe(true);
    expect(partition({ fallback: "f" } as never).ok).toBe(true);
  });
});

// wave-315 residual
describe("partition residual (wave-315)", () => {
  it("null/undefined/0/empty-string success; only isIpcError shapes fail", () => {
    expect(partition(null as never)).toEqual({ ok: true, data: null });
    expect(partition(undefined as never)).toEqual({ ok: true, data: undefined });
    expect(partition(0 as never)).toEqual({ ok: true, data: 0 });
    expect(partition("" as never)).toEqual({ ok: true, data: "" });
    expect(partition([] as never)).toEqual({ ok: true, data: [] });
    const branded = { __brand: "IpcError" as const, code: "x", fallback: "y" };
    expect(partition(branded as never)).toEqual({ ok: false, err: branded });
  });

  it("legacy shape without brand but string code+fallback is err; wrong types not err", () => {
    expect(partition({ code: "c", fallback: "f", extra: 1 } as never).ok).toBe(false);
    expect(partition({ code: 1, fallback: "f" } as never).ok).toBe(true);
    expect(partition({ code: "c", fallback: null } as never).ok).toBe(true);
    expect(partition({ __brand: "Other", code: "c", fallback: "f" } as never).ok).toBe(false);
  });
});
