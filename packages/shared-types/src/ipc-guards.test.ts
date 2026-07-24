import { describe, expect, it } from "vitest";
import {
  SETTINGS_WINDOW_TABS,
  ipcError,
  isIpcError,
  isSettingsWindowTab,
} from "./index";

describe("isSettingsWindowTab", () => {
  it("accepts every SETTINGS_WINDOW_TABS entry", () => {
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
  });

  it("rejects unknown / non-string values", () => {
    expect(isSettingsWindowTab("models")).toBe(false);
    expect(isSettingsWindowTab("")).toBe(false);
    expect(isSettingsWindowTab(null)).toBe(false);
    expect(isSettingsWindowTab(1)).toBe(false);
    expect(isSettingsWindowTab(undefined)).toBe(false);
  });
});

describe("ipcError / isIpcError", () => {
  it("brands factory results and type-guards them", () => {
    const err = ipcError("code.x", "fallback", { a: 1 });
    expect(err).toEqual({
      __brand: "IpcError",
      code: "code.x",
      fallback: "fallback",
      params: { a: 1 },
    });
    expect(isIpcError(err)).toBe(true);
  });

  it("accepts legacy shape without brand and rejects incomplete objects", () => {
    expect(isIpcError({ code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "c" })).toBe(false);
    expect(isIpcError({ fallback: "f" })).toBe(false);
    expect(isIpcError("nope")).toBe(false);
    expect(isIpcError(null)).toBe(false);
  });

  // wave-91 residual
  it("omits params when not provided and keeps brand", () => {
    const err = ipcError("x", "中文");
    expect(err.params).toBeUndefined();
    expect(err.__brand).toBe("IpcError");
    expect(isIpcError(err)).toBe(true);
  });

  it("accepts brand-only IpcError and legacy shape when code+fallback strings exist", () => {
    // brand match short-circuits without requiring code/fallback fields
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    // wrong brand falls through to legacy shape: still true when code+fallback present
    expect(isIpcError({ __brand: "Other", code: "c", fallback: "f" })).toBe(true);
    // wrong brand without string code/fallback is rejected
    expect(isIpcError({ __brand: "Other", code: 1, fallback: "f" })).toBe(false);
    expect(isIpcError({ __brand: "Other" })).toBe(false);
  });
});

describe("SETTINGS_WINDOW_TABS residual", () => {
  it("includes the expected settings surface tabs", () => {
    expect(SETTINGS_WINDOW_TABS).toEqual([
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ]);
  });

  it("rejects near-miss tab ids", () => {
    expect(isSettingsWindowTab("Model")).toBe(false);
    expect(isSettingsWindowTab("long-horizon")).toBe(false);
    expect(isSettingsWindowTab("pi-agent")).toBe(false);
    expect(isSettingsWindowTab("settings")).toBe(false);
  });

  // wave-116 residual
  it("accepts every tab id exactly once with no duplicates", () => {
    expect(new Set(SETTINGS_WINDOW_TABS).size).toBe(SETTINGS_WINDOW_TABS.length);
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(typeof tab).toBe("string");
      expect(tab.length).toBeGreaterThan(0);
    }
  });
});

describe("ipcError residual", () => {
  // wave-116 residual
  it("preserves empty params object when explicitly provided", () => {
    const err = ipcError("code.empty", "fb", {});
    expect(err.params).toEqual({});
    expect(isIpcError(err)).toBe(true);
  });

  it("rejects arrays and functions as IpcError even if shaped", () => {
    expect(isIpcError(["code", "fallback"])).toBe(false);
    expect(isIpcError(() => ({ code: "c", fallback: "f" }))).toBe(false);
    expect(isIpcError(undefined)).toBe(false);
  });

  it("accepts primitive params payloads without mutating them", () => {
    const params = { count: 1, ok: true, label: "x" };
    const err = ipcError("c", "f", params);
    expect(err.params).toBe(params);
    expect(err.params).toEqual({ count: 1, ok: true, label: "x" });
  });

  // wave-142 residual
  it("legacy shape requires string code and fallback (empty strings still count)", () => {
    expect(isIpcError({ code: "", fallback: "" })).toBe(true);
    expect(isIpcError({ code: "c", fallback: 1 })).toBe(false);
    expect(isIpcError({ code: 1, fallback: "f" })).toBe(false);
    expect(isIpcError({ code: "c", fallback: null })).toBe(false);
  });

  it("ipcError keeps unicode fallbacks and params reference-stable", () => {
    const params = { path: "C:/中文/.env", count: 2, ok: true };
    const err = ipcError("ipcErrors.git.protectedPath", "敏感配置", params);
    expect(err.fallback).toBe("敏感配置");
    expect(err.params).toBe(params);
    expect(isIpcError(err)).toBe(true);
  });
});

describe("isSettingsWindowTab residual (wave-142)", () => {
  it("accepts only exact SETTINGS_WINDOW_TABS membership", () => {
    expect(SETTINGS_WINDOW_TABS).toHaveLength(10);
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
    expect(isSettingsWindowTab("model ")).toBe(false);
    expect(isSettingsWindowTab(" about")).toBe(false);
    expect(isSettingsWindowTab("MODEL")).toBe(false);
  });
});

// wave-173 residual
describe("ipc-guards residual (wave-173)", () => {
  it("isSettingsWindowTab rejects non-string objects and near-miss camelCase ids", () => {
    expect(isSettingsWindowTab({ tab: "model" })).toBe(false);
    expect(isSettingsWindowTab(["model"])).toBe(false);
    expect(isSettingsWindowTab("longHorizon ")).toBe(false);
    expect(isSettingsWindowTab("LongHorizon")).toBe(false);
    expect(isSettingsWindowTab("piAgent")).toBe(false);
    expect(isSettingsWindowTab("piagent")).toBe(true);
  });

  it("isIpcError accepts brand-only objects and rejects wrong primitive types", () => {
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    expect(isIpcError({ __brand: "IpcError", code: 1 })).toBe(true); // brand short-circuit
    expect(isIpcError(0)).toBe(false);
    expect(isIpcError(false)).toBe(false);
    expect(isIpcError(true)).toBe(false);
    expect(isIpcError(Symbol("IpcError"))).toBe(false);
  });

  it("ipcError keeps empty-string code/fallback and params reference-stable", () => {
    const params = { path: "C:/中文/a", ok: false, count: 0 };
    const err = ipcError("", "", params);
    expect(err).toEqual({
      __brand: "IpcError",
      code: "",
      fallback: "",
      params,
    });
    expect(err.params).toBe(params);
    expect(isIpcError(err)).toBe(true);
    expect(isIpcError({ code: "", fallback: "" })).toBe(true);
  });

  it("SETTINGS_WINDOW_TABS order is stable for settings window open routing", () => {
    expect([...SETTINGS_WINDOW_TABS]).toEqual([
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ]);
    // membership is exact string equality only
    expect(isSettingsWindowTab(SETTINGS_WINDOW_TABS[0])).toBe(true);
    expect(isSettingsWindowTab(String(SETTINGS_WINDOW_TABS[0]).toUpperCase())).toBe(false);
  });
});

// wave-180 residual
describe("ipc-guards residual (wave-180)", () => {
  it("isSettingsWindowTab accepts every SETTINGS_WINDOW_TABS entry exactly once each", () => {
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
    expect(new Set(SETTINGS_WINDOW_TABS).size).toBe(SETTINGS_WINDOW_TABS.length);
    expect(isSettingsWindowTab("models")).toBe(false);
    expect(isSettingsWindowTab("about ")).toBe(false);
    expect(isSettingsWindowTab(null)).toBe(false);
    expect(isSettingsWindowTab(undefined)).toBe(false);
  });

  it("ipcError without params sets params to undefined and is still IpcError", () => {
    // product always assigns params (may be undefined) — key is present
    const err = ipcError("ipcErrors.x", "fallback text");
    expect(err).toEqual({
      __brand: "IpcError",
      code: "ipcErrors.x",
      fallback: "fallback text",
      params: undefined,
    });
    expect(err.params).toBeUndefined();
    expect(isIpcError(err)).toBe(true);
  });

  it("legacy IpcError requires both code and fallback as strings", () => {
    expect(isIpcError({ code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "c", fallback: undefined })).toBe(false);
    expect(isIpcError({ code: undefined, fallback: "f" })).toBe(false);
    expect(isIpcError({ code: "c", fallback: 0 as never })).toBe(false);
  });
});

// wave-187 residual
describe("ipc-guards residual (wave-187)", () => {
  it("ipcError with params preserves params object reference and brand short-circuits isIpcError", () => {
    const params = { name: "x", count: 2 };
    const err = ipcError("ipcErrors.demo", "fb", params);
    expect(err.params).toBe(params);
    expect(isIpcError(err)).toBe(true);
    // brand short-circuit: even if code/fallback missing shape, brand wins
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    expect(isIpcError({ __brand: "Other" })).toBe(false);
  });

  it("isIpcError rejects primitives and arrays without brand", () => {
    expect(isIpcError(null)).toBe(false);
    expect(isIpcError(undefined)).toBe(false);
    expect(isIpcError("err")).toBe(false);
    expect(isIpcError(1)).toBe(false);
    expect(isIpcError([])).toBe(false);
    expect(isIpcError([{ code: "c", fallback: "f" }])).toBe(false);
  });

  it("isSettingsWindowTab rejects padded and empty strings", () => {
    expect(isSettingsWindowTab("")).toBe(false);
    expect(isSettingsWindowTab(" general")).toBe(false);
    expect(isSettingsWindowTab("general ")).toBe(false);
    expect(isSettingsWindowTab("General")).toBe(false);
  });
});

// wave-198 residual
describe("ipc-guards residual (wave-198)", () => {
  it("legacy code+fallback remains IpcError even with wrong brand", () => {
    expect(isIpcError({ __brand: "Other", code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ __brand: "Other", code: "c" })).toBe(false);
    expect(isIpcError({ __brand: "IpcError", code: 1 as never, fallback: 2 as never })).toBe(true);
  });

  it("SETTINGS_WINDOW_TABS includes model and about endpoints only once", () => {
    expect(SETTINGS_WINDOW_TABS[0]).toBe("model");
    expect(SETTINGS_WINDOW_TABS.at(-1)).toBe("about");
    expect(SETTINGS_WINDOW_TABS.filter((t) => t === "model")).toHaveLength(1);
    expect(isSettingsWindowTab("piagent")).toBe(true);
    expect(isSettingsWindowTab("longHorizon")).toBe(true);
    expect(isSettingsWindowTab("models")).toBe(false);
  });
});

// wave-201 residual
describe("ipc-guards residual (wave-201)", () => {
  it("ipcError attaches optional params and isIpcError accepts factory output", () => {
    const err = ipcError("code.x", "fallback", { n: 1, ok: true, s: "a" });
    expect(err).toEqual({
      __brand: "IpcError",
      code: "code.x",
      fallback: "fallback",
      params: { n: 1, ok: true, s: "a" },
    });
    expect(isIpcError(err)).toBe(true);
    expect(isIpcError(ipcError("c", "f"))).toBe(true);
  });

  it("SETTINGS_WINDOW_TABS is exact ordered set of ten tabs", () => {
    expect([...SETTINGS_WINDOW_TABS]).toEqual([
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ]);
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
    expect(isSettingsWindowTab("theme")).toBe(false);
    expect(isSettingsWindowTab(null)).toBe(false);
  });
});

// wave-204 residual
describe("ipc-guards residual (wave-204)", () => {
  it("isIpcError brand short-circuits; brandless needs string code+fallback", () => {
    expect(
      isIpcError({ code: "c", fallback: "f", extra: true, nested: { a: 1 } }),
    ).toBe(true);
    // product: __brand === "IpcError" wins even without code/fallback
    expect(isIpcError({ __brand: "IpcError", code: "c" })).toBe(true);
    expect(isIpcError({ __brand: "IpcError", fallback: "f" })).toBe(true);
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    // wrong brand still accepted via shape fallback when code+fallback are strings
    expect(isIpcError({ __brand: "Other", code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ __brand: "Other", code: 1, fallback: "f" })).toBe(false);
  });

  it("ipcError always materializes params key (undefined when omitted)", () => {
    // product returns { __brand, code, fallback, params } with params: undefined
    const err = ipcError("k", "msg");
    expect(err).toEqual({
      __brand: "IpcError",
      code: "k",
      fallback: "msg",
      params: undefined,
    });
    expect(err.params).toBeUndefined();
    const withParams = ipcError("k", "msg", { flag: false });
    expect(withParams.params).toEqual({ flag: false });
  });

  it("SETTINGS_WINDOW_TABS length and membership are stable for UI routing", () => {
    expect(SETTINGS_WINDOW_TABS).toHaveLength(10);
    expect(new Set(SETTINGS_WINDOW_TABS).size).toBe(10);
    expect(isSettingsWindowTab("appearance")).toBe(true);
    expect(isSettingsWindowTab("config")).toBe(true);
    expect(isSettingsWindowTab("shortcuts")).toBe(true);
    expect(isSettingsWindowTab("Appearance")).toBe(false);
    expect(isSettingsWindowTab(" about ")).toBe(false);
  });
});

// wave-210 residual
describe("ipc-guards residual (wave-210)", () => {
  it("isIpcError rejects null/array/string and accepts full ipcError() objects", () => {
    expect(isIpcError(null)).toBe(false);
    expect(isIpcError(undefined)).toBe(false);
    expect(isIpcError("err")).toBe(false);
    expect(isIpcError([])).toBe(false);
    const err = ipcError("E_TEST", "fallback text", { n: 1 });
    expect(isIpcError(err)).toBe(true);
    expect(err.code).toBe("E_TEST");
    expect(err.fallback).toBe("fallback text");
    expect(err.params).toEqual({ n: 1 });
  });

  it("SETTINGS_WINDOW_TABS first/last anchors remain model and about", () => {
    expect(SETTINGS_WINDOW_TABS[0]).toBe("model");
    expect(SETTINGS_WINDOW_TABS.at(-1)).toBe("about");
    expect(isSettingsWindowTab("model")).toBe(true);
    expect(isSettingsWindowTab("about")).toBe(true);
    expect(isSettingsWindowTab("")).toBe(false);
  });
});

// wave-218 residual
describe("ipc-guards residual (wave-218)", () => {
  it("isIpcError accepts brand-only objects and code+fallback legacy shape", () => {
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    expect(isIpcError({ code: "E", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "E" })).toBe(false);
    expect(isIpcError({ fallback: "f" })).toBe(false);
    expect(isIpcError({ __brand: "Other" })).toBe(false);
    const withParams = ipcError("E_X", "fb", { ok: true, n: 2 });
    expect(withParams.params).toEqual({ ok: true, n: 2 });
    expect(ipcError("E_Y", "only").params).toBeUndefined();
  });

  it("isSettingsWindowTab rejects unknown/case variants; SETTINGS_WINDOW_TABS is unique", () => {
    expect(isSettingsWindowTab("Model")).toBe(false);
    expect(isSettingsWindowTab("MODEL")).toBe(false);
    expect(isSettingsWindowTab(null)).toBe(false);
    expect(isSettingsWindowTab(0)).toBe(false);
    expect(new Set(SETTINGS_WINDOW_TABS).size).toBe(SETTINGS_WINDOW_TABS.length);
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
  });
});

// wave-242 residual
describe("ipc-guards residual (wave-242)", () => {
  it("SETTINGS_WINDOW_TABS order is stable model→about with fixed 10 tabs", () => {
    expect(SETTINGS_WINDOW_TABS).toEqual([
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ]);
    expect(SETTINGS_WINDOW_TABS).toHaveLength(10);
    expect(isSettingsWindowTab("piagent")).toBe(true);
    expect(isSettingsWindowTab("longHorizon")).toBe(true);
    expect(isSettingsWindowTab("shortcuts")).toBe(true);
    expect(isSettingsWindowTab("config")).toBe(true);
    expect(isSettingsWindowTab("usage ")).toBe(false);
    expect(isSettingsWindowTab("models")).toBe(false);
  });

  it("ipcError always brands; empty strings allowed; params optional/pass-through", () => {
    const bare = ipcError("", "");
    expect(bare).toEqual({ __brand: "IpcError", code: "", fallback: "", params: undefined });
    expect(isIpcError(bare)).toBe(true);
    const params = { a: 1, b: true, c: "x" } as const;
    const withP = ipcError("E", "f", params as never);
    expect(withP.params).toEqual(params);
    expect(withP.params).toBe(params);
    expect(isIpcError(0)).toBe(false);
    expect(isIpcError(false)).toBe(false);
    expect(isIpcError(Symbol("x"))).toBe(false);
  });
});

// wave-252 residual
describe("ipc-guards residual (wave-252)", () => {
  it("isSettingsWindowTab rejects whitespace, casing variants, and array-like values", () => {
    expect(isSettingsWindowTab(" model")).toBe(false);
    expect(isSettingsWindowTab("model\n")).toBe(false);
    expect(isSettingsWindowTab("ABOUT")).toBe(false);
    expect(isSettingsWindowTab(["model"] as never)).toBe(false);
    expect(isSettingsWindowTab({ tab: "model" } as never)).toBe(false);
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
  });

  it("isIpcError brand short-circuits; legacy requires string code+fallback", () => {
    expect(isIpcError(ipcError("x", "y"))).toBe(true);
    // product: __brand === "IpcError" is enough regardless of code type
    expect(isIpcError({ __brand: "IpcError", code: 1 as never, fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "c", fallback: "f", extra: 1 })).toBe(true);
    expect(isIpcError({ code: "c", fallback: 1 })).toBe(false);
    expect(isIpcError([])).toBe(false);
    expect(isIpcError(Promise.resolve(1))).toBe(false);
  });
});

// wave-263 residual
describe("ipc-guards residual (wave-263)", () => {
  it("SETTINGS_WINDOW_TABS is frozen membership of exactly 10 tabs", () => {
    expect(SETTINGS_WINDOW_TABS).toHaveLength(10);
    expect(SETTINGS_WINDOW_TABS[0]).toBe("model");
    expect(SETTINGS_WINDOW_TABS[SETTINGS_WINDOW_TABS.length - 1]).toBe("about");
    expect(isSettingsWindowTab("model")).toBe(true);
    expect(isSettingsWindowTab("about")).toBe(true);
    expect(isSettingsWindowTab("Model")).toBe(false);
    expect(isSettingsWindowTab("about ")).toBe(false);
  });

  it("ipcError brands and isIpcError accepts brand or string code+fallback only", () => {
    const err = ipcError("ipc.x", "失败", { n: 1 });
    expect(err.__brand).toBe("IpcError");
    expect(err.params).toEqual({ n: 1 });
    expect(isIpcError(err)).toBe(true);
    expect(isIpcError({ code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    expect(isIpcError({ code: 1, fallback: "f" })).toBe(false);
    expect(isIpcError(null)).toBe(false);
    expect(isIpcError("IpcError")).toBe(false);
  });
});


// wave-272 residual
describe("ipc-guards residual (wave-272)", () => {
  it("SETTINGS_WINDOW_TABS exact ordered membership for routing", () => {
    expect([...SETTINGS_WINDOW_TABS]).toEqual([
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ]);
    expect(isSettingsWindowTab("piagent")).toBe(true);
    expect(isSettingsWindowTab("config")).toBe(true);
    expect(isSettingsWindowTab("providers")).toBe(false);
  });

  it("ipcError optional params; isIpcError rejects partial legacy shapes", () => {
    const withParams = ipcError("c", "f", { a: 1 });
    const withoutParams = ipcError("c", "f");
    expect(withParams.params).toEqual({ a: 1 });
    expect(withoutParams.params).toBeUndefined();
    expect(isIpcError({ code: "c" })).toBe(false);
    expect(isIpcError({ fallback: "f" })).toBe(false);
    expect(isIpcError({ __brand: "Other" })).toBe(false);
  });
});


// wave-279 residual
describe("ipc-guards residual (wave-279)", () => {
  it("SETTINGS_WINDOW_TABS length 10 and isSettingsWindowTab rejects empty/unknown", () => {
    expect(SETTINGS_WINDOW_TABS).toHaveLength(10);
    expect(isSettingsWindowTab("")).toBe(false);
    expect(isSettingsWindowTab("git")).toBe(false);
    expect(isSettingsWindowTab("model")).toBe(true);
    expect(isSettingsWindowTab("longHorizon")).toBe(true);
  });

  it("isIpcError brand short-circuit wins even without code/fallback fields", () => {
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    expect(isIpcError({ __brand: "IpcError", code: 1 })).toBe(true);
    const full = ipcError("ipc.fail", "失败");
    expect(full.code).toBe("ipc.fail");
    expect(full.fallback).toBe("失败");
    expect(isIpcError(full)).toBe(true);
  });
});



// wave-288 residual
describe("ipc-guards residual (wave-288)", () => {
  it("SETTINGS_WINDOW_TABS order is product-stable; every entry isSettingsWindowTab true", () => {
    expect([...SETTINGS_WINDOW_TABS]).toEqual([
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ]);
    for (const tab of SETTINGS_WINDOW_TABS) {
      expect(isSettingsWindowTab(tab)).toBe(true);
    }
    expect(isSettingsWindowTab("Model")).toBe(false);
    expect(isSettingsWindowTab("providers")).toBe(false);
  });

  it("ipcError includes brand/code/fallback; isIpcError accepts brand-only and code+fallback shape", () => {
    const err = ipcError("desktop.fail", "失败", { retry: true });
    expect(err).toEqual({
      __brand: "IpcError",
      code: "desktop.fail",
      fallback: "失败",
      params: { retry: true },
    });
    expect(isIpcError(err)).toBe(true);
    expect(isIpcError({ __brand: "IpcError" })).toBe(true);
    expect(isIpcError({ code: "c", fallback: "f" })).toBe(true);
    expect(isIpcError({ code: "c", fallback: 1 })).toBe(false);
    expect(isIpcError(null)).toBe(false);
    expect(isIpcError("IpcError")).toBe(false);
  });
});

