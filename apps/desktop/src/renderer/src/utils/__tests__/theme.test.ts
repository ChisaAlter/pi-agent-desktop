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
} from "../theme";

function stubMatchMedia(matches: boolean, listeners?: Array<(event: MediaQueryListEvent) => void>): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_type: string, handler: EventListenerOrEventListenerObject) => {
        if (typeof handler === "function") listeners?.push(handler as (event: MediaQueryListEvent) => void);
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe("theme utilities", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves explicit light/dark and system preference", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");

    stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");

    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("applies data-theme for light and dark (contrast surfaces)", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("reads stored theme and falls back to system", () => {
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
    window.localStorage.setItem("pi-desktop-theme", "bogus");
    expect(getInitialTheme()).toBe("system");
  });

  it("clamps font sizes used for readable body/editor text", () => {
    expect(normalizeFontSize(8)).toBe(12);
    expect(normalizeFontSize(40)).toBe(20);
    expect(normalizeFontSize("not-a-number")).toBe(14);
    expect(getEditorFontSize(14)).toBe(13);
  });

  it("writes CSS font tokens when applyFontSize runs", () => {
    const applied = applyFontSize(16);
    expect(applied).toBe(16);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("15px");
  });

  it("watches prefers-color-scheme changes for system theme", () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    stubMatchMedia(false, listeners);

    const callback = vi.fn();
    const unwatch = watchSystemTheme(callback);
    listeners[0]?.({ matches: true } as MediaQueryListEvent);
    expect(callback).toHaveBeenCalledWith("dark");
    unwatch();
  });

  it("keeps light and dark token surfaces distinct for contrast", () => {
    // Product uses data-theme attribute; CSS variables switch in globals.css.
    applyTheme("light");
    const light = document.documentElement.getAttribute("data-theme");
    applyTheme("dark");
    const dark = document.documentElement.getAttribute("data-theme");
    expect(light).toBe("light");
    expect(dark).toBe("dark");
    expect(light).not.toBe(dark);
  });

  // wave-161 residual
  it("resolveTheme maps system via matchMedia and leaves light/dark as-is", () => {
    stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("applyFontSize writes ladder tokens and clamps mono/diff floors", () => {
    const applied = applyFontSize(12);
    expect(applied).toBe(12);
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("10px");
    expect(document.documentElement.style.getPropertyValue("--font-size-sm")).toBe("11px");
    expect(document.documentElement.style.getPropertyValue("--font-size-lg")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("11px");
    // getDiffFontSize floors at 10
    expect(document.documentElement.style.getPropertyValue("--font-size-mono-small")).toBe("10px");
  });

  it("normalizeFontSize rounds and clamps; getEditorFontSize floors at 11", () => {
    expect(normalizeFontSize(12.6)).toBe(13);
    expect(normalizeFontSize("18")).toBe(18);
    expect(normalizeFontSize(NaN)).toBe(14);
    expect(getEditorFontSize(12)).toBe(11);
    expect(getEditorFontSize(20)).toBe(19);
  });

  // wave-172 residual
  it("getDiffFontSize floors at 10 and tracks normalizeFontSize-3", () => {
    expect(getDiffFontSize(12)).toBe(10);
    expect(getDiffFontSize(14)).toBe(11);
    expect(getDiffFontSize(20)).toBe(17);
    expect(getDiffFontSize("bad")).toBe(11); // default 14-3
  });

  it("getInitialFontSize reads localStorage and falls back on throw/missing", () => {
    expect(getInitialFontSize()).toBe(14);
    window.localStorage.setItem("pi-desktop-font-size", "18");
    expect(getInitialFontSize()).toBe(18);
    window.localStorage.setItem("pi-desktop-font-size", "999");
    expect(getInitialFontSize()).toBe(20);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(getInitialFontSize()).toBe(14);
    spy.mockRestore();
  });

  it("applyTheme('system') writes resolved data-theme from matchMedia", () => {
    stubMatchMedia(true);
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    stubMatchMedia(false);
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  // wave-180 residual
  it("normalizeFontSize clamps float extremes and rejects Infinity", () => {
    expect(normalizeFontSize(11.2)).toBe(12); // round then clamp min
    expect(normalizeFontSize(20.4)).toBe(20);
    expect(normalizeFontSize(Number.POSITIVE_INFINITY)).toBe(14);
    expect(normalizeFontSize(Number.NEGATIVE_INFINITY)).toBe(14);
    expect(normalizeFontSize("12.9")).toBe(12); // parseInt truncates
  });

  it("applyFontSize max clamp writes mono/diff floors and large ladder steps", () => {
    const n = applyFontSize(99);
    expect(n).toBe(20);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("20px");
    expect(style.getPropertyValue("--font-size-xl")).toBe("26px");
    expect(style.getPropertyValue("--font-size-2xl")).toBe("30px");
    expect(style.getPropertyValue("--font-size-mono")).toBe("19px");
    expect(style.getPropertyValue("--font-size-mono-small")).toBe("17px");
    expect(style.getPropertyValue("--line-height-mono")).toBe(`${Math.round(19 * 1.55)}px`);
  });

  it("getInitialTheme accepts only light/dark/system tokens", () => {
    window.localStorage.setItem("pi-desktop-theme", "Light");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
    window.localStorage.setItem("pi-desktop-theme", "system");
    expect(getInitialTheme()).toBe("system");
  });

  // wave-190 residual
  it("getEditorFontSize and getDiffFontSize floors relative to clamped body size", () => {
    // min body 12 → editor 11, diff 10
    expect(getEditorFontSize(1)).toBe(11);
    expect(getDiffFontSize(1)).toBe(10);
    // body 14 → editor 13, diff 11
    expect(getEditorFontSize(14)).toBe(13);
    expect(getDiffFontSize(14)).toBe(11);
    // max body 20 → editor 19, diff 17
    expect(getEditorFontSize(99)).toBe(19);
    expect(getDiffFontSize(99)).toBe(17);
  });

  it("resolveTheme returns light/dark for explicit tokens without matchMedia", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  // wave-233 residual
  it("normalizeFontSize round-then-clamp and string parseInt truncates", () => {
    expect(normalizeFontSize(12.4)).toBe(12);
    expect(normalizeFontSize(12.5)).toBe(13);
    expect(normalizeFontSize("19.9")).toBe(19);
    expect(normalizeFontSize("")).toBe(14);
    expect(normalizeFontSize(null)).toBe(14);
    expect(normalizeFontSize(undefined)).toBe(14);
  });

  it("applyFontSize mid ladder writes body/base/md/lg and mono from editor size", () => {
    const n = applyFontSize(15);
    expect(n).toBe(15);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("15px");
    expect(style.getPropertyValue("--font-size-base")).toBe("14px");
    expect(style.getPropertyValue("--font-size-md")).toBe("15px");
    expect(style.getPropertyValue("--font-size-lg")).toBe("17px");
    expect(style.getPropertyValue("--font-size-mono")).toBe("14px");
    expect(style.getPropertyValue("--font-size-mono-small")).toBe("12px");
    expect(style.getPropertyValue("--line-height-mono")).toBe(`${Math.round(14 * 1.55)}px`);
  });

  it("getInitialTheme missing/empty falls back to system; empty font uses default", () => {
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-font-size", "");
    expect(getInitialFontSize()).toBe(14);
  });

  // wave-244 residual
  it("getEditorFontSize and getDiffFontSize floor at 11 and 10 after normalize", () => {
    expect(getEditorFontSize(12)).toBe(11);
    expect(getEditorFontSize(11)).toBe(11); // normalize clamps 11→12 then -1 → 11
    expect(getEditorFontSize(20)).toBe(19);
    expect(getDiffFontSize(12)).toBe(10); // normalize 12 → 12-3=9 → floor 10
    expect(getDiffFontSize(15)).toBe(12);
    expect(getDiffFontSize(20)).toBe(17);
  });

  it("getInitialTheme accepts only light/dark/system; garbage falls back to system", () => {
    window.localStorage.setItem("pi-desktop-theme", "light");
    expect(getInitialTheme()).toBe("light");
    window.localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
    window.localStorage.setItem("pi-desktop-theme", "system");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "auto");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "LIGHT");
    expect(getInitialTheme()).toBe("system");
  });

  // wave-255 residual
  it("normalizeFontSize clamps 12–20 and rounds; non-finite falls to 14", () => {
    expect(normalizeFontSize(11)).toBe(12);
    expect(normalizeFontSize(21)).toBe(20);
    expect(normalizeFontSize(15.4)).toBe(15);
    expect(normalizeFontSize(15.6)).toBe(16);
    expect(normalizeFontSize("18")).toBe(18);
    expect(normalizeFontSize("nope")).toBe(14);
    expect(normalizeFontSize(Number.NaN)).toBe(14);
    expect(normalizeFontSize(Number.POSITIVE_INFINITY)).toBe(14);
  });

  it("applyFontSize sets CSS vars and returns normalized size", () => {
    const normalized = applyFontSize(16);
    expect(normalized).toBe(16);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(style.getPropertyValue("--font-size-mono")).toBe(`${getEditorFontSize(16)}px`);
    expect(style.getPropertyValue("--font-size-mono-small")).toBe(`${getDiffFontSize(16)}px`);
    expect(style.getPropertyValue("--font-size-xs")).toBe("13px");
    expect(style.getPropertyValue("--font-size-xl")).toBe("22px");
  });

  // wave-266 residual
  it("getEditorFontSize is body-1 floor 11; getDiffFontSize is body-3 floor 10", () => {
    // product: Math.max(11, normalize-1) and Math.max(10, normalize-3)
    expect(getEditorFontSize(12)).toBe(11);
    expect(getEditorFontSize(14)).toBe(13);
    expect(getDiffFontSize(12)).toBe(10);
    expect(getDiffFontSize(14)).toBe(11);
    expect(getEditorFontSize(20)).toBe(19);
    expect(getDiffFontSize(20)).toBe(17);
  });

  it("applyFontSize clamps via normalize before CSS assignment", () => {
    const n = applyFontSize(100);
    expect(n).toBe(20);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("20px");
    const low = applyFontSize(1);
    expect(low).toBe(12);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("12px");
  });

  // wave-277 residual
  it("normalizeFontSize clamps 12-20; non-finite and non-numeric become 14", () => {
    expect(normalizeFontSize(12)).toBe(12);
    expect(normalizeFontSize(20)).toBe(20);
    expect(normalizeFontSize(11.9)).toBe(12);
    expect(normalizeFontSize(20.1)).toBe(20);
    expect(normalizeFontSize(undefined as never)).toBe(14);
    expect(normalizeFontSize(null as never)).toBe(14);
  });

  it("getEditorFontSize/getDiffFontSize floors hold at body minimum 12", () => {
    expect(getEditorFontSize(12)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10);
    // even if body is floor 12, mono floors don't go below 11/10
    expect(getEditorFontSize(12)).toBeGreaterThanOrEqual(11);
    expect(getDiffFontSize(12)).toBeGreaterThanOrEqual(10);
  });

  // wave-286 residual
  it("resolveTheme system uses matchMedia; light/dark passthrough; applyTheme sets data-theme", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    expect(resolveTheme("system")).toBe("dark");
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
    expect(resolveTheme("system")).toBe("light");
    window.matchMedia = original;
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("applyFontSize sets mono/body CSS vars from normalized size; string inputs parse", () => {
    const n = applyFontSize("16");
    expect(n).toBe(16);
    expect(document.documentElement.style.getPropertyValue("--font-size-body")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--font-size-mono-small")).toBe("13px");
    expect(normalizeFontSize("not-a-number")).toBe(14);
    expect(getInitialTheme()).toMatch(/^(light|dark|system)$/);
  });





  // wave-310 residual
  it("applyFontSize body=14 sets full scale chain including mono line-height", () => {
    const n = applyFontSize(14);
    expect(n).toBe(14);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-size-body")).toBe("14px");
    expect(style.getPropertyValue("--font-size-xs")).toBe("11px"); // max(10,14-3)
    expect(style.getPropertyValue("--font-size-sm")).toBe("12px"); // max(11,14-2)
    expect(style.getPropertyValue("--font-size-base")).toBe("13px"); // max(12,14-1)
    expect(style.getPropertyValue("--font-size-md")).toBe("14px");
    expect(style.getPropertyValue("--font-size-lg")).toBe("16px");
    expect(style.getPropertyValue("--font-size-xl")).toBe("20px");
    expect(style.getPropertyValue("--font-size-2xl")).toBe("24px");
    expect(style.getPropertyValue("--font-size-mono")).toBe("13px");
    expect(style.getPropertyValue("--font-size-mono-small")).toBe("11px");
    // Math.round(getEditorFontSize(14)*1.55) = Math.round(13*1.55)=20
    expect(style.getPropertyValue("--line-height-mono")).toBe("20px");
  });

  it("getInitialFontSize reads localStorage key; invalid/missing normalize to 14", () => {
    window.localStorage.removeItem("pi-desktop-font-size");
    expect(getInitialFontSize()).toBe(14);
    window.localStorage.setItem("pi-desktop-font-size", "18");
    expect(getInitialFontSize()).toBe(18);
    window.localStorage.setItem("pi-desktop-font-size", "999");
    expect(getInitialFontSize()).toBe(20);
    window.localStorage.setItem("pi-desktop-font-size", "nope");
    expect(getInitialFontSize()).toBe(14);
    window.localStorage.removeItem("pi-desktop-font-size");
  });

  it("getInitialTheme accepts light|dark|system only; getEditor/Diff floors at body min", () => {
    window.localStorage.setItem("pi-desktop-theme", "dark");
    expect(getInitialTheme()).toBe("dark");
    window.localStorage.setItem("pi-desktop-theme", "light");
    expect(getInitialTheme()).toBe("light");
    window.localStorage.setItem("pi-desktop-theme", "system");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.setItem("pi-desktop-theme", "nope");
    expect(getInitialTheme()).toBe("system");
    window.localStorage.removeItem("pi-desktop-theme");
    expect(getInitialTheme()).toBe("system");
    // body floor 12 -> editor 11 / diff 10; body 13 -> diff still 10
    expect(getEditorFontSize(12)).toBe(11);
    expect(getDiffFontSize(12)).toBe(10);
    expect(getDiffFontSize(13)).toBe(10);
    expect(getEditorFontSize(13)).toBe(12);
  });
});
