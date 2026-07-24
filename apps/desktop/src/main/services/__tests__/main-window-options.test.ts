import { describe, expect, it } from "vitest";
import { resolveMainWindowChromeOptions, resolveMainWindowPerformancePreferences } from "../main-window-options";

describe("resolveMainWindowChromeOptions", () => {
  it("keeps the frameless Windows window opaque to avoid transparent-window composition stalls", () => {
    expect(resolveMainWindowChromeOptions("win32")).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
  });

  it("keeps the main renderer responsive while the window is occluded", () => {
    expect(resolveMainWindowPerformancePreferences()).toEqual({
      backgroundThrottling: false,
    });
  });

  it("preserves native macOS traffic lights without enabling transparency", () => {
    expect(resolveMainWindowChromeOptions("darwin")).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: true,
      titleBarStyle: "hiddenInset",
    });
  });

  it("uses the frameless opaque chrome for non-darwin platforms", () => {
    for (const platform of ["linux", "freebsd", "openbsd"] as const) {
      expect(resolveMainWindowChromeOptions(platform)).toEqual({
        backgroundColor: "#f4f4f4",
        transparent: false,
        frame: false,
      });
    }
  });

  // wave-98 residual
  it("never enables transparent chrome on any platform", () => {
    for (const platform of ["win32", "darwin", "linux", "aix", "sunos"] as const) {
      expect(resolveMainWindowChromeOptions(platform).transparent).toBe(false);
      expect(resolveMainWindowChromeOptions(platform).backgroundColor).toBe("#f4f4f4");
    }
  });

  it("only sets titleBarStyle on darwin", () => {
    expect(resolveMainWindowChromeOptions("darwin")).toHaveProperty("titleBarStyle", "hiddenInset");
    expect(resolveMainWindowChromeOptions("win32")).not.toHaveProperty("titleBarStyle");
    expect(resolveMainWindowChromeOptions("linux")).not.toHaveProperty("titleBarStyle");
  });

  it("keeps backgroundThrottling disabled for long-running agent UIs", () => {
    const prefs = resolveMainWindowPerformancePreferences();
    expect(prefs).toEqual({ backgroundThrottling: false });
    expect(Object.keys(prefs)).toEqual(["backgroundThrottling"]);
  });

  // wave-123 residual
  it("uses frame true only on darwin and false elsewhere", () => {
    expect(resolveMainWindowChromeOptions("darwin").frame).toBe(true);
    expect(resolveMainWindowChromeOptions("win32").frame).toBe(false);
    expect(resolveMainWindowChromeOptions("linux").frame).toBe(false);
    expect(resolveMainWindowChromeOptions("android" as NodeJS.Platform).frame).toBe(false);
  });

  // wave-134 residual
  it("returns a new performance prefs object each call without mutating prior result", () => {
    const a = resolveMainWindowPerformancePreferences();
    const b = resolveMainWindowPerformancePreferences();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    (a as { backgroundThrottling: boolean }).backgroundThrottling = true;
    expect(resolveMainWindowPerformancePreferences().backgroundThrottling).toBe(false);
  });

  it("chrome options keys are stable: darwin has titleBarStyle, others do not", () => {
    const darwinKeys = Object.keys(resolveMainWindowChromeOptions("darwin")).sort();
    const winKeys = Object.keys(resolveMainWindowChromeOptions("win32")).sort();
    expect(darwinKeys).toEqual(["backgroundColor", "frame", "titleBarStyle", "transparent"]);
    expect(winKeys).toEqual(["backgroundColor", "frame", "transparent"]);
  });

  // wave-152 residual
  it("returns independent chrome option objects that share the same opaque surface values", () => {
    const a = resolveMainWindowChromeOptions("win32");
    const b = resolveMainWindowChromeOptions("linux");
    expect(a).not.toBe(b);
    expect(a.backgroundColor).toBe("#f4f4f4");
    expect(b.backgroundColor).toBe("#f4f4f4");
    expect(a.transparent).toBe(false);
    expect(b.transparent).toBe(false);
    (a as { backgroundColor: string }).backgroundColor = "#000000";
    expect(resolveMainWindowChromeOptions("win32").backgroundColor).toBe("#f4f4f4");
  });

  it("darwin titleBarStyle is hiddenInset and never present on win32/linux", () => {
    expect(resolveMainWindowChromeOptions("darwin").titleBarStyle).toBe("hiddenInset");
    expect("titleBarStyle" in resolveMainWindowChromeOptions("win32")).toBe(false);
    expect("titleBarStyle" in resolveMainWindowChromeOptions("linux")).toBe(false);
  });

  // wave-174 residual
  it("treats unknown platforms like non-darwin (frameless opaque)", () => {
    for (const platform of ["android", "cygwin", "netbsd", "haiku"] as NodeJS.Platform[]) {
      expect(resolveMainWindowChromeOptions(platform)).toEqual({
        backgroundColor: "#f4f4f4",
        transparent: false,
        frame: false,
      });
      expect("titleBarStyle" in resolveMainWindowChromeOptions(platform)).toBe(false);
    }
  });

  it("performance prefs only expose backgroundThrottling=false", () => {
    const prefs = resolveMainWindowPerformancePreferences();
    expect(Object.keys(prefs)).toEqual(["backgroundThrottling"]);
    expect(prefs.backgroundThrottling).toBe(false);
  });

  it("darwin chrome is independent of non-darwin objects (mutation isolation)", () => {
    const darwin = resolveMainWindowChromeOptions("darwin");
    const win = resolveMainWindowChromeOptions("win32");
    expect(darwin).not.toBe(win);
    (darwin as { frame: boolean }).frame = false;
    expect(resolveMainWindowChromeOptions("darwin").frame).toBe(true);
    expect(resolveMainWindowChromeOptions("win32").frame).toBe(false);
  });

  // wave-184 residual
  it("win32 and linux share the same chrome shape and values", () => {
    expect(resolveMainWindowChromeOptions("win32")).toEqual(resolveMainWindowChromeOptions("linux"));
    expect(resolveMainWindowChromeOptions("win32")).not.toBe(resolveMainWindowChromeOptions("linux"));
  });

  it("darwin always pairs frame true with titleBarStyle hiddenInset", () => {
    const darwin = resolveMainWindowChromeOptions("darwin");
    expect(darwin.frame).toBe(true);
    expect(darwin.titleBarStyle).toBe("hiddenInset");
    expect(darwin.transparent).toBe(false);
    expect(darwin.backgroundColor).toBe("#f4f4f4");
  });

  it("performance prefs object is not frozen (caller can mutate local copy only)", () => {
    const prefs = resolveMainWindowPerformancePreferences();
    expect(Object.isFrozen(prefs)).toBe(false);
    (prefs as { backgroundThrottling: boolean }).backgroundThrottling = true;
    expect(resolveMainWindowPerformancePreferences().backgroundThrottling).toBe(false);
  });

  // wave-200 residual
  it("empty-string and case-variant platform tokens are non-darwin frameless", () => {
    for (const platform of ["", "Darwin", "WIN32", "macOS"] as NodeJS.Platform[]) {
      expect(resolveMainWindowChromeOptions(platform)).toEqual({
        backgroundColor: "#f4f4f4",
        transparent: false,
        frame: false,
      });
    }
  });

  it("darwin is the only platform with four chrome keys including titleBarStyle", () => {
    const platforms = ["win32", "linux", "darwin", "freebsd"] as const;
    for (const platform of platforms) {
      const keys = Object.keys(resolveMainWindowChromeOptions(platform)).sort();
      if (platform === "darwin") {
        expect(keys).toEqual(["backgroundColor", "frame", "titleBarStyle", "transparent"]);
      } else {
        expect(keys).toEqual(["backgroundColor", "frame", "transparent"]);
      }
    }
  });

  // wave-205 residual
  it("win32 and linux share frameless opaque chrome and never set titleBarStyle", () => {
    for (const platform of ["win32", "linux"] as const) {
      const chrome = resolveMainWindowChromeOptions(platform);
      expect(chrome).toEqual({
        backgroundColor: "#f4f4f4",
        transparent: false,
        frame: false,
      });
      expect("titleBarStyle" in chrome).toBe(false);
    }
  });

  it("darwin keeps hiddenInset frame true and same opaque surface color", () => {
    const chrome = resolveMainWindowChromeOptions("darwin");
    expect(chrome.frame).toBe(true);
    expect(chrome.titleBarStyle).toBe("hiddenInset");
    expect(chrome.backgroundColor).toBe("#f4f4f4");
    expect(chrome.transparent).toBe(false);
  });

  it("performance prefs only expose backgroundThrottling false", () => {
    const prefs = resolveMainWindowPerformancePreferences();
    expect(Object.keys(prefs)).toEqual(["backgroundThrottling"]);
    expect(prefs.backgroundThrottling).toBe(false);
  });

  // wave-213 residual
  it("unknown platforms fall through to frameless chrome like win32", () => {
    expect(resolveMainWindowChromeOptions("freebsd" as never)).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    expect(resolveMainWindowChromeOptions("aix" as never)).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    // fresh object each call
    expect(resolveMainWindowChromeOptions("win32")).not.toBe(
      resolveMainWindowChromeOptions("win32"),
    );
    expect(resolveMainWindowPerformancePreferences()).not.toBe(
      resolveMainWindowPerformancePreferences(),
    );
  });

  // wave-219 residual
  it("darwin uses frame true + hiddenInset; win32/linux frameless; performance prefs stable shape", () => {
    expect(resolveMainWindowChromeOptions("darwin")).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: true,
      titleBarStyle: "hiddenInset",
    });
    expect(resolveMainWindowChromeOptions("win32")).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    expect(resolveMainWindowChromeOptions("linux")).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    expect(resolveMainWindowPerformancePreferences()).toEqual({
      backgroundThrottling: false,
    });
  });

  // wave-235 residual
  it("non-darwin platforms never include titleBarStyle; darwin never frame false", () => {
    for (const platform of ["win32", "linux", "freebsd", "openbsd", "aix"] as const) {
      const chrome = resolveMainWindowChromeOptions(platform);
      expect(chrome).toEqual({
        backgroundColor: "#f4f4f4",
        transparent: false,
        frame: false,
      });
      expect("titleBarStyle" in chrome).toBe(false);
    }
    const mac = resolveMainWindowChromeOptions("darwin");
    expect(mac.frame).toBe(true);
    expect(mac.titleBarStyle).toBe("hiddenInset");
    expect(mac.transparent).toBe(false);
  });

  it("performance prefs only disable backgroundThrottling and return fresh objects", () => {
    const a = resolveMainWindowPerformancePreferences();
    const b = resolveMainWindowPerformancePreferences();
    expect(a).toEqual({ backgroundThrottling: false });
    expect(b).toEqual({ backgroundThrottling: false });
    expect(a).not.toBe(b);
    expect(Object.keys(a)).toEqual(["backgroundThrottling"]);
  });

  // wave-248 residual
  it("chrome options are fresh objects per call; opaque surface shared fields stable", () => {
    const a = resolveMainWindowChromeOptions("win32");
    const b = resolveMainWindowChromeOptions("win32");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    const macA = resolveMainWindowChromeOptions("darwin");
    const macB = resolveMainWindowChromeOptions("darwin");
    expect(macA).not.toBe(macB);
    expect(macA.backgroundColor).toBe("#f4f4f4");
    expect(macA.transparent).toBe(false);
  });

  it("unknown platform treated as frameless non-darwin; performance prefs independent of platform", () => {
    expect(resolveMainWindowChromeOptions("sunos" as never)).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    expect(resolveMainWindowPerformancePreferences().backgroundThrottling).toBe(false);
  });

  // wave-261 residual
  it("darwin gets frame true + hiddenInset; win32/linux frameless", () => {
    const darwin = resolveMainWindowChromeOptions("darwin");
    expect(darwin.frame).toBe(true);
    expect(darwin.titleBarStyle).toBe("hiddenInset");
    expect(darwin.transparent).toBe(false);
    expect(resolveMainWindowChromeOptions("win32").frame).toBe(false);
    expect(resolveMainWindowChromeOptions("linux").frame).toBe(false);
    expect(resolveMainWindowChromeOptions("linux").titleBarStyle).toBeUndefined();
  });

  it("performance prefs only backgroundThrottling false and new object each call", () => {
    const a = resolveMainWindowPerformancePreferences();
    const b = resolveMainWindowPerformancePreferences();
    expect(a).toEqual({ backgroundThrottling: false });
    expect(a).not.toBe(b);
  });

  // wave-282 residual
  it("win32/linux omit titleBarStyle; darwin includes hiddenInset; opaque keys stable", () => {
    const win = resolveMainWindowChromeOptions("win32");
    expect(win).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    expect("titleBarStyle" in win).toBe(false);

    const linux = resolveMainWindowChromeOptions("linux");
    expect(linux).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: false,
    });
    expect(linux.titleBarStyle).toBeUndefined();

    const darwin = resolveMainWindowChromeOptions("darwin");
    expect(darwin).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: true,
      titleBarStyle: "hiddenInset",
    });
    expect(Object.keys(darwin).sort()).toEqual(
      ["backgroundColor", "frame", "titleBarStyle", "transparent"].sort(),
    );
  });

  it("performance preferences only backgroundThrottling:false and independent of chrome", () => {
    const prefs = resolveMainWindowPerformancePreferences();
    expect(Object.keys(prefs)).toEqual(["backgroundThrottling"]);
    expect(prefs.backgroundThrottling).toBe(false);
    const chrome = resolveMainWindowChromeOptions("win32");
    expect(chrome).not.toHaveProperty("backgroundThrottling");
  });





  // wave-302 residual
  it("opaque surface #f4f4f4 + transparent false on all platforms; frame only true on darwin", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const chrome = resolveMainWindowChromeOptions(platform);
      expect(chrome.backgroundColor).toBe("#f4f4f4");
      expect(chrome.transparent).toBe(false);
      expect(chrome.frame).toBe(platform === "darwin");
    }
    expect(resolveMainWindowChromeOptions("darwin").titleBarStyle).toBe("hiddenInset");
    expect(resolveMainWindowChromeOptions("win32")).not.toHaveProperty("titleBarStyle");
  });

  it("performance prefs only backgroundThrottling false; independent new object each call", () => {
    const a = resolveMainWindowPerformancePreferences();
    const b = resolveMainWindowPerformancePreferences();
    expect(a).toEqual({ backgroundThrottling: false });
    expect(a).not.toBe(b);
    expect(Object.keys(a)).toEqual(["backgroundThrottling"]);
  });


  // wave-318 residual
  it("darwin only sets hiddenInset titleBarStyle; non-darwin frame false without titleBarStyle", () => {
    const darwin = resolveMainWindowChromeOptions("darwin");
    expect(darwin).toEqual({
      backgroundColor: "#f4f4f4",
      transparent: false,
      frame: true,
      titleBarStyle: "hiddenInset",
    });
    for (const platform of ["win32", "linux", "freebsd"] as NodeJS.Platform[]) {
      const chrome = resolveMainWindowChromeOptions(platform);
      expect(chrome.frame).toBe(false);
      expect(chrome).not.toHaveProperty("titleBarStyle");
      expect(chrome.backgroundColor).toBe("#f4f4f4");
      expect(chrome.transparent).toBe(false);
    }
  });

  it("chrome and performance helpers return fresh plain objects each call", () => {
    const c1 = resolveMainWindowChromeOptions("win32");
    const c2 = resolveMainWindowChromeOptions("win32");
    expect(c1).toEqual(c2);
    expect(c1).not.toBe(c2);
    const p1 = resolveMainWindowPerformancePreferences();
    const p2 = resolveMainWindowPerformancePreferences();
    expect(p1).toEqual({ backgroundThrottling: false });
    expect(p1).not.toBe(p2);
  });

});
