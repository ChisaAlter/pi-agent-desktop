// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFontSize,
  applyTheme,
  getDiffFontSize,
  getEditorFontSize,
  getInitialFontSize,
  getInitialTheme,
  normalizeFontSize,
  resolveTheme,
  watchSystemTheme,
} from "./theme";

describe("theme utils", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveTheme maps system via matchMedia", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("applyTheme sets data-theme attribute", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("normalizeFontSize clamps and defaults invalid values", () => {
    expect(normalizeFontSize(14)).toBe(14);
    expect(normalizeFontSize(8)).toBe(12);
    expect(normalizeFontSize(40)).toBe(20);
    expect(normalizeFontSize("16")).toBe(16);
    expect(normalizeFontSize("nope")).toBe(14);
    expect(normalizeFontSize(undefined)).toBe(14);
  });

  it("getEditorFontSize and getDiffFontSize derive from normalized body size", () => {
    expect(getEditorFontSize(14)).toBe(13);
    expect(getDiffFontSize(14)).toBe(11);
    expect(getEditorFontSize(12)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10);
  });

  it("applyFontSize writes CSS custom properties", () => {
    const normalized = applyFontSize(16);
    expect(normalized).toBe(16);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono-small")).toBe("13px");
  });

  it("getInitialFontSize / getInitialTheme read localStorage", () => {
    localStorage.setItem("pi-desktop-font-size", "18");
    localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialFontSize()).toBe(18);
    expect(getInitialTheme()).toBe("dark");
    localStorage.setItem("pi-desktop-theme", "invalid");
    expect(getInitialTheme()).toBe("system");
  });

  it("watchSystemTheme subscribes and unsubscribes", () => {
    const add = vi.fn();
    const remove = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: add,
        removeEventListener: remove,
      }),
    });
    const cb = vi.fn();
    const unsub = watchSystemTheme(cb);
    expect(add).toHaveBeenCalledWith("change", expect.any(Function));
    const handler = add.mock.calls[0]?.[1] as (e: MediaQueryListEvent) => void;
    handler({ matches: true } as MediaQueryListEvent);
    expect(cb).toHaveBeenCalledWith("dark");
    unsub();
    expect(remove).toHaveBeenCalledWith("change", handler);
  });

  // wave-112 residual
  it("resolveTheme defaults to light when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    expect(resolveTheme("system")).toBe("light");
  });

  it("normalizeFontSize rounds numbers and parseInt-truncates strings", () => {
    expect(normalizeFontSize(15.4)).toBe(15);
    expect(normalizeFontSize(15.6)).toBe(16);
    // non-number path uses parseInt(..., 10) → truncates, does not round
    expect(normalizeFontSize("12.9")).toBe(12);
    expect(normalizeFontSize(Number.NaN)).toBe(14);
  });

  it("applyFontSize writes derived scale tokens for xs/sm/lg/xl/2xl", () => {
    applyFontSize(14);
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("11px");
    expect(document.documentElement.style.getPropertyValue("--font-size-sm")).toBe("12px");
    expect(document.documentElement.style.getPropertyValue("--font-size-lg")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--font-size-xl")).toBe("20px");
    expect(document.documentElement.style.getPropertyValue("--font-size-2xl")).toBe("24px");
    expect(document.documentElement.style.getPropertyValue("--line-height-mono")).toBe(
      `${Math.round(13 * 1.55)}px`,
    );
  });

  it("getInitialFontSize falls back when localStorage throws", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        clear: () => undefined,
      },
    });
    expect(getInitialFontSize()).toBe(14);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: original,
    });
  });

  it("watchSystemTheme is a no-op when matchMedia is missing", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    const unsub = watchSystemTheme(vi.fn());
    expect(() => unsub()).not.toThrow();
  });

  // wave-118 residual
  it("normalizeFontSize clamps to 12..20 and defaults non-numeric", () => {
    expect(normalizeFontSize(11)).toBe(12);
    expect(normalizeFontSize(21)).toBe(20);
    expect(normalizeFontSize(12)).toBe(12);
    expect(normalizeFontSize(20)).toBe(20);
    expect(normalizeFontSize("nope")).toBe(14);
    expect(normalizeFontSize(null)).toBe(14);
  });

  it("getEditorFontSize and getDiffFontSize respect floors after clamp", () => {
    // normalize 12 → editor max(11,11)=11, diff max(10,9)=10
    expect(getEditorFontSize(12)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10);
    // normalize 20 → editor 19, diff 17
    expect(getEditorFontSize(20)).toBe(19);
    expect(getDiffFontSize(20)).toBe(17);
    // below min clamps first
    expect(getEditorFontSize(8)).toBe(11);
    expect(getDiffFontSize(8)).toBe(10);
  });

  it("applyFontSize mono tokens use editor/diff sizes", () => {
    applyFontSize(16);
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono-small")).toBe("13px");
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--font-size-base")).toBe("15px");
  });

  it("getInitialTheme returns system for unknown stored values", () => {
    window.localStorage.setItem("pi-desktop-theme", "sepia");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
  });

  // wave-127 residual
  it("getInitialTheme accepts light and system stored values", () => {
    window.localStorage.setItem("pi-desktop-theme", "light");
    expect(getInitialTheme()).toBe("light");
    window.localStorage.setItem("pi-desktop-theme", "system");
    expect(getInitialTheme()).toBe("system");
    expect(getInitialTheme()).toBe("system");
  });

  it("getInitialFontSize normalizes stored out-of-range values", () => {
    window.localStorage.setItem("pi-desktop-font-size", "9");
    expect(getInitialFontSize()).toBe(12);
    window.localStorage.setItem("pi-desktop-font-size", "48");
    expect(getInitialFontSize()).toBe(20);
    window.localStorage.setItem("pi-desktop-font-size", "14.9");
    // parseInt path → 14
    expect(getInitialFontSize()).toBe(14);
  });

  it("applyTheme resolves system to dark when matchMedia matches", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // wave-135 residual
  it("normalizeFontSize defaults non-finite and clamps rounded values", () => {
    expect(normalizeFontSize(Number.NaN)).toBe(14);
    expect(normalizeFontSize(undefined)).toBe(14);
    expect(normalizeFontSize("nope")).toBe(14);
    expect(normalizeFontSize(12.4)).toBe(12);
    expect(normalizeFontSize(12.5)).toBe(13);
    expect(normalizeFontSize(20)).toBe(20);
    expect(normalizeFontSize(21)).toBe(20);
  });

  it("getEditorFontSize/getDiffFontSize respect floors after normalize", () => {
    expect(getEditorFontSize(12)).toBe(11);
    expect(getEditorFontSize(11)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10);
    expect(getDiffFontSize(20)).toBe(17);
  });

  it("applyFontSize returns normalized size and sets mono vars", () => {
    const n = applyFontSize(18);
    expect(n).toBe(18);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("17px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono-small")).toBe("15px");
  });

  it("resolveTheme passthrough for light/dark and system via matchMedia false → light", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("system")).toBe("light");
  });

  // wave-149 residual
  it("getInitialFontSize falls back to default when localStorage throws", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("quota");
    };
    try {
      expect(getInitialFontSize()).toBe(14);
    } finally {
      window.localStorage.getItem = original;
    }
  });

  it("applyFontSize at min clamp writes full CSS token ladder", () => {
    const n = applyFontSize(8);
    expect(n).toBe(12);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("12px");
    expect(style.getPropertyValue("--font-size-xs")).toBe("10px");
    expect(style.getPropertyValue("--font-size-sm")).toBe("11px");
    expect(style.getPropertyValue("--font-size-base")).toBe("12px");
    expect(style.getPropertyValue("--font-size-md")).toBe("12px");
    expect(style.getPropertyValue("--font-size-lg")).toBe("14px");
    expect(style.getPropertyValue("--font-size-xl")).toBe("18px");
    expect(style.getPropertyValue("--font-size-2xl")).toBe("22px");
    expect(style.getPropertyValue("--font-size-mono")).toBe("11px");
    expect(style.getPropertyValue("--font-size-mono-small")).toBe("10px");
    expect(style.getPropertyValue("--line-height-mono")).toBe(`${Math.round(11 * 1.55)}px`);
  });

  it("watchSystemTheme is a no-op when matchMedia is missing", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    const callback = vi.fn();
    const unwatch = watchSystemTheme(callback);
    expect(typeof unwatch).toBe("function");
    expect(() => unwatch()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
    // resolveTheme(system) falls back to light without matchMedia
    expect(resolveTheme("system")).toBe("light");
  });

  it("getInitialTheme rejects empty/null-ish stored values as system", () => {
    window.localStorage.setItem("pi-desktop-theme", "");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.removeItem("pi-desktop-theme");
    expect(getInitialTheme()).toBe("system");
  });

  // wave-197 residual
  it("applyTheme light/dark ignore matchMedia; getInitialTheme accepts only exact tokens", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    window.localStorage.setItem("pi-desktop-theme", "Light");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
  });

  it("normalizeFontSize rounds then clamps; getEditor/getDiff floors hold at max body", () => {
    expect(normalizeFontSize(19.4)).toBe(19);
    expect(normalizeFontSize(19.5)).toBe(20);
    expect(getEditorFontSize(20)).toBe(19);
    expect(getDiffFontSize(20)).toBe(17);
    expect(getEditorFontSize(Number.NaN)).toBe(13); // default 14 - 1, floored at 11
    expect(getDiffFontSize(Number.NaN)).toBe(11); // default 14 - 3, floored at 10
  });

  // wave-203 residual
  it("getInitialTheme accepts system token; string font sizes parse then clamp", () => {
    window.localStorage.setItem("pi-desktop-theme", "system");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "light");
    expect(getInitialTheme()).toBe("light");
    expect(normalizeFontSize("12")).toBe(12);
    expect(normalizeFontSize("20")).toBe(20);
    expect(normalizeFontSize("11")).toBe(12);
    expect(normalizeFontSize("21")).toBe(20);
    // product: Number.parseInt on strings truncates before clamp/round
    expect(normalizeFontSize("14.6")).toBe(14);
    expect(normalizeFontSize("nope")).toBe(14);
  });

  it("applyTheme system follows matchMedia; applyFontSize returns clamped body size", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(applyFontSize(100)).toBe(20);
    expect(applyFontSize(-5)).toBe(12);
  });

  // wave-209 residual
  it("resolveTheme light/dark pass-through; getInitialTheme defaults system on garbage", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    window.localStorage.setItem("pi-desktop-theme", "sepia");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.removeItem("pi-desktop-theme");
    expect(getInitialTheme()).toBe("system");
  });

  it("getEditorFontSize/getDiffFontSize floors relative to normalized body size", () => {
    expect(getEditorFontSize(14)).toBe(13);
    expect(getDiffFontSize(14)).toBe(11);
    expect(getEditorFontSize(12)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10); // max(10, 12-3)=10
    expect(getDiffFontSize(11)).toBe(10); // normalize 11→12 then -3 → 9 floored 10
    expect(applyFontSize(14)).toBe(14);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("13px");
  });


  // wave-214 residual
  it("normalizeFontSize rounds numbers and clamps; non-finite falls back to 14", () => {
    expect(normalizeFontSize(13.4)).toBe(13);
    expect(normalizeFontSize(13.6)).toBe(14);
    expect(normalizeFontSize(Number.NaN)).toBe(14);
    expect(normalizeFontSize(Number.POSITIVE_INFINITY)).toBe(14);
    expect(normalizeFontSize(null)).toBe(14);
    expect(normalizeFontSize(undefined)).toBe(14);
  });

  it("applyFontSize sets cascade tokens relative to body size", () => {
    expect(applyFontSize(16)).toBe(16);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(style.getPropertyValue("--font-size-xs")).toBe("13px"); // max(10, 16-3)
    expect(style.getPropertyValue("--font-size-sm")).toBe("14px");
    expect(style.getPropertyValue("--font-size-base")).toBe("15px");
    expect(style.getPropertyValue("--font-size-md")).toBe("16px");
    expect(style.getPropertyValue("--font-size-lg")).toBe("18px");
    expect(style.getPropertyValue("--font-size-xl")).toBe("22px");
    expect(style.getPropertyValue("--font-size-2xl")).toBe("26px");
    expect(style.getPropertyValue("--font-size-mono")).toBe("15px"); // getEditorFontSize 16-1
    expect(style.getPropertyValue("--font-size-mono-small")).toBe("13px"); // getDiffFontSize 16-3
    expect(style.getPropertyValue("--line-height-mono")).toBe(`${Math.round(15 * 1.55)}px`);
  });

  it("watchSystemTheme invokes callback on change and unsubscribes cleanly", () => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mq = {
      matches: false,
      addEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners.add(handler);
      },
      removeEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners.delete(handler);
      },
    };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue(mq),
    });
    const cb = vi.fn();
    const unsub = watchSystemTheme(cb);
    expect(listeners.size).toBe(1);
    for (const handler of listeners) {
      handler({ matches: true } as MediaQueryListEvent);
      handler({ matches: false } as MediaQueryListEvent);
    }
    expect(cb).toHaveBeenNthCalledWith(1, "dark");
    expect(cb).toHaveBeenNthCalledWith(2, "light");
    unsub();
    expect(listeners.size).toBe(0);
  });


  // wave-221 residual
  it("normalizeFontSize rounds and clamps; non-finite falls back to 14", () => {
    expect(normalizeFontSize(12.4)).toBe(12);
    expect(normalizeFontSize(12.6)).toBe(13);
    expect(normalizeFontSize(NaN)).toBe(14);
    expect(normalizeFontSize(Infinity)).toBe(14);
    expect(normalizeFontSize(null)).toBe(14);
    expect(normalizeFontSize(undefined)).toBe(14);
    expect(normalizeFontSize("")).toBe(14);
    expect(normalizeFontSize("abc")).toBe(14);
    expect(getEditorFontSize(12)).toBe(11); // max(11, 12-1)
    expect(getDiffFontSize(12)).toBe(10); // max(10, 12-3)
    expect(getEditorFontSize(11)).toBe(11); // clamp to 12 then -1 = 11
    expect(getDiffFontSize(11)).toBe(10);
  });

  it("getInitialTheme rejects invalid stored values; getInitialFontSize normalizes storage", () => {
    localStorage.setItem("pi-desktop-theme", "blue");
    expect(getInitialTheme()).toBe("system");
    localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
    localStorage.setItem("pi-desktop-font-size", "99");
    expect(getInitialFontSize()).toBe(20);
    localStorage.setItem("pi-desktop-font-size", "7");
    expect(getInitialFontSize()).toBe(12);
    localStorage.setItem("pi-desktop-font-size", "not-a-number");
    expect(getInitialFontSize()).toBe(14);
  });

  it("resolveTheme falls back to light when matchMedia missing", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    expect(resolveTheme("system")).toBe("light");
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });


  // wave-290 residual
  it("applyFontSize sets CSS vars and returns normalized size; mono uses editor/diff floors", () => {
    const n = applyFontSize(16);
    expect(n).toBe(16);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(style.getPropertyValue("--font-size-xs")).toBe("13px");
    expect(style.getPropertyValue("--font-size-sm")).toBe("14px");
    expect(style.getPropertyValue("--font-size-base")).toBe("15px");
    expect(style.getPropertyValue("--font-size-md")).toBe("16px");
    expect(style.getPropertyValue("--font-size-lg")).toBe("18px");
    expect(style.getPropertyValue("--font-size-xl")).toBe("22px");
    expect(style.getPropertyValue("--font-size-2xl")).toBe("26px");
    expect(style.getPropertyValue("--font-size-mono")).toBe("15px"); // max(11, 16-1)
    expect(style.getPropertyValue("--font-size-mono-small")).toBe("13px"); // max(10, 16-3)
    expect(style.getPropertyValue("--line-height-mono")).toBe(`${Math.round(15 * 1.55)}px`);
  });

  it("applyTheme sets data-theme; resolveTheme light/dark passthrough; system uses matchMedia", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({
        matches: q.includes("dark"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    expect(resolveTheme("system")).toBe("dark");
  });


  // wave-297 residual
  it("normalizeFontSize clamps to [12,20] and defaults non-finite to 14", () => {
    expect(normalizeFontSize(16)).toBe(16);
    expect(normalizeFontSize(1)).toBe(12);
    expect(normalizeFontSize(100)).toBe(20);
    expect(normalizeFontSize("16")).toBe(16);
    expect(normalizeFontSize(undefined)).toBe(14);
    expect(normalizeFontSize(Number.NaN)).toBe(14);
    expect(normalizeFontSize(12.6)).toBe(13); // Math.round then clamp
  });

  it("getEditorFontSize and getDiffFontSize use mono floors after normalize", () => {
    // editor max(11, n-1); diff max(10, n-3)
    expect(getEditorFontSize(16)).toBe(15);
    expect(getDiffFontSize(16)).toBe(13);
    // normalize(10) → 12 → editor 11, diff 9→10 floor
    expect(getEditorFontSize(10)).toBe(11);
    expect(getDiffFontSize(10)).toBe(10);
    expect(getEditorFontSize(12)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10);
  });

  it("resolveTheme system follows matchMedia; light/dark passthrough", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    expect(resolveTheme("system")).toBe("light");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

});
