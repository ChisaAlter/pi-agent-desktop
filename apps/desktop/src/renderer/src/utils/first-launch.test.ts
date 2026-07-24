// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  isFirstLaunch,
  markFirstLaunchDone,
  readBoolFlag,
  writeBoolFlag,
} from "./first-launch";

function createLocalStorageMock(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("first-launch flags", () => {
  beforeEach(() => {
    const localStorage = createLocalStorageMock();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
  });

  it("readBoolFlag returns fallback for missing/unknown values", () => {
    expect(readBoolFlag("missing", true)).toBe(true);
    expect(readBoolFlag("missing", false)).toBe(false);
    window.localStorage.setItem("k", "maybe");
    expect(readBoolFlag("k", false)).toBe(false);
  });

  it("readBoolFlag accepts true/1 and false/0", () => {
    window.localStorage.setItem("t1", "true");
    window.localStorage.setItem("t2", "1");
    window.localStorage.setItem("f1", "false");
    window.localStorage.setItem("f2", "0");
    expect(readBoolFlag("t1", false)).toBe(true);
    expect(readBoolFlag("t2", false)).toBe(true);
    expect(readBoolFlag("f1", true)).toBe(false);
    expect(readBoolFlag("f2", true)).toBe(false);
  });

  it("writeBoolFlag persists string true/false", () => {
    writeBoolFlag("flag", true);
    expect(window.localStorage.getItem("flag")).toBe("true");
    writeBoolFlag("flag", false);
    expect(window.localStorage.getItem("flag")).toBe("false");
  });

  it("isFirstLaunch is true until markFirstLaunchDone", () => {
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
  });

  it("swallows localStorage write failures", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    expect(() => writeBoolFlag("x", true)).not.toThrow();
    expect(readBoolFlag("x", true)).toBe(true);
  });

  it("falls back when localStorage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    expect(readBoolFlag("x", true)).toBe(true);
    expect(() => writeBoolFlag("x", false)).not.toThrow();
    expect(isFirstLaunch()).toBe(true);
  });

  // wave-109 residual
  it("treats empty string and TRUE/YES as unknown → fallback", () => {
    window.localStorage.setItem("empty", "");
    window.localStorage.setItem("upper", "TRUE");
    window.localStorage.setItem("yes", "yes");
    expect(readBoolFlag("empty", true)).toBe(true);
    expect(readBoolFlag("empty", false)).toBe(false);
    expect(readBoolFlag("upper", false)).toBe(false);
    expect(readBoolFlag("yes", true)).toBe(true);
  });

  it("isFirstLaunch respects pre-seeded storage key", () => {
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "1");
    expect(isFirstLaunch()).toBe(false);
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "0");
    expect(isFirstLaunch()).toBe(true);
  });

  // wave-119 residual
  it("markFirstLaunchDone writes exact storage key as true", () => {
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(isFirstLaunch()).toBe(false);
  });

  it("overwrites previous first-launch value when marked again", () => {
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "0");
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(isFirstLaunch()).toBe(false);
  });

  it("readBoolFlag is case-sensitive for true/false tokens", () => {
    window.localStorage.setItem("mixed", "True");
    window.localStorage.setItem("falsey", "FALSE");
    expect(readBoolFlag("mixed", false)).toBe(false);
    expect(readBoolFlag("falsey", true)).toBe(true);
  });

  // wave-127 residual
  it("writeBoolFlag false then true round-trips and keeps other keys", () => {
    window.localStorage.setItem("other", "keep");
    writeBoolFlag("flag", false);
    expect(window.localStorage.getItem("flag")).toBe("false");
    writeBoolFlag("flag", true);
    expect(window.localStorage.getItem("flag")).toBe("true");
    expect(window.localStorage.getItem("other")).toBe("keep");
  });

  it("isFirstLaunch is true when storage key is missing even after unrelated writes", () => {
    writeBoolFlag("unrelated", true);
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBeNull();
    expect(isFirstLaunch()).toBe(true);
  });

  // wave-135 residual
  it("readBoolFlag treats 1/0 as true/false and unknown as fallback", () => {
    window.localStorage.setItem("n1", "1");
    window.localStorage.setItem("n0", "0");
    window.localStorage.setItem("maybe", "yes");
    expect(readBoolFlag("n1", false)).toBe(true);
    expect(readBoolFlag("n0", true)).toBe(false);
    expect(readBoolFlag("maybe", true)).toBe(true);
    expect(readBoolFlag("maybe", false)).toBe(false);
    expect(readBoolFlag("missing", true)).toBe(true);
  });

  it("read/writeBoolFlag fall back safely when localStorage throws", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    try {
      expect(readBoolFlag("x", true)).toBe(true);
      expect(readBoolFlag("x", false)).toBe(false);
      expect(() => writeBoolFlag("x", true)).not.toThrow();
      expect(() => markFirstLaunchDone()).not.toThrow();
      expect(isFirstLaunch()).toBe(true);
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  // wave-145 residual
  it("markFirstLaunchDone is idempotent and flips isFirstLaunch", () => {
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(isFirstLaunch()).toBe(false);
    expect(readBoolFlag("pi-desktop:firstLaunchDone", false)).toBe(true);
  });

  it("empty string storage values fall back rather than truthy-coercing", () => {
    window.localStorage.setItem("empty", "");
    expect(readBoolFlag("empty", true)).toBe(true);
    expect(readBoolFlag("empty", false)).toBe(false);
  });

  // wave-154 residual
  it("accepts 1/0 string flags and rejects other truthy-looking strings", () => {
    window.localStorage.setItem("one", "1");
    window.localStorage.setItem("zero", "0");
    window.localStorage.setItem("yes", "yes");
    window.localStorage.setItem("TRUE", "TRUE");
    expect(readBoolFlag("one", false)).toBe(true);
    expect(readBoolFlag("zero", true)).toBe(false);
    // unknown / case-mismatched values fall back
    expect(readBoolFlag("yes", false)).toBe(false);
    expect(readBoolFlag("yes", true)).toBe(true);
    expect(readBoolFlag("TRUE", false)).toBe(false);
  });

  it("writeBoolFlag stores canonical true/false strings only", () => {
    writeBoolFlag("flag-a", true);
    writeBoolFlag("flag-b", false);
    expect(window.localStorage.getItem("flag-a")).toBe("true");
    expect(window.localStorage.getItem("flag-b")).toBe("false");
    expect(readBoolFlag("flag-a", false)).toBe(true);
    expect(readBoolFlag("flag-b", true)).toBe(false);
  });

  it("missing key uses fallback without writing", () => {
    expect(window.localStorage.getItem("missing-key")).toBeNull();
    expect(readBoolFlag("missing-key", true)).toBe(true);
    expect(readBoolFlag("missing-key", false)).toBe(false);
    expect(window.localStorage.getItem("missing-key")).toBeNull();
  });

  // wave-175 residual
  it("rejects whitespace-padded true/false/1/0 tokens as unknown", () => {
    window.localStorage.setItem("pad-t", " true");
    window.localStorage.setItem("pad-f", "false ");
    window.localStorage.setItem("pad-1", " 1");
    window.localStorage.setItem("pad-0", "0\n");
    expect(readBoolFlag("pad-t", false)).toBe(false);
    expect(readBoolFlag("pad-f", true)).toBe(true);
    expect(readBoolFlag("pad-1", false)).toBe(false);
    expect(readBoolFlag("pad-0", true)).toBe(true);
  });

  it("markFirstLaunchDone only touches the dedicated key", () => {
    writeBoolFlag("other-flag", false);
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(window.localStorage.getItem("other-flag")).toBe("false");
    expect(isFirstLaunch()).toBe(false);
  });

  it("numeric-looking strings beyond 0/1 fall back", () => {
    window.localStorage.setItem("two", "2");
    window.localStorage.setItem("neg", "-1");
    window.localStorage.setItem("nullish", "null");
    expect(readBoolFlag("two", true)).toBe(true);
    expect(readBoolFlag("two", false)).toBe(false);
    expect(readBoolFlag("neg", true)).toBe(true);
    expect(readBoolFlag("nullish", false)).toBe(false);
  });

  // wave-182 residual
  it("writeBoolFlag round-trips exact true/false tokens only", () => {
    writeBoolFlag("flag-a", true);
    writeBoolFlag("flag-b", false);
    expect(window.localStorage.getItem("flag-a")).toBe("true");
    expect(window.localStorage.getItem("flag-b")).toBe("false");
    expect(readBoolFlag("flag-a", false)).toBe(true);
    expect(readBoolFlag("flag-b", true)).toBe(false);
  });

  it("isFirstLaunch is true until markFirstLaunchDone, then stays false", () => {
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
  });

  it("TRUE/FALSE uppercase tokens fall back (exact match only)", () => {
    window.localStorage.setItem("up-t", "TRUE");
    window.localStorage.setItem("up-f", "FALSE");
    expect(readBoolFlag("up-t", false)).toBe(false);
    expect(readBoolFlag("up-f", true)).toBe(true);
  });

  // wave-190 residual
  it("missing key returns fallback; empty string falls back", () => {
    expect(readBoolFlag("never-set", true)).toBe(true);
    expect(readBoolFlag("never-set", false)).toBe(false);
    window.localStorage.setItem("empty", "");
    expect(readBoolFlag("empty", true)).toBe(true);
    expect(readBoolFlag("empty", false)).toBe(false);
  });

  it("writeBoolFlag overwrites prior values and markFirstLaunchDone is idempotent", () => {
    writeBoolFlag("toggle", true);
    expect(window.localStorage.getItem("toggle")).toBe("true");
    writeBoolFlag("toggle", false);
    expect(window.localStorage.getItem("toggle")).toBe("false");
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
  });

  // wave-195 residual
  it("accepts '1'/'0' as true/false and unknown tokens fall back", () => {
    window.localStorage.setItem("n1", "1");
    window.localStorage.setItem("n0", "0");
    window.localStorage.setItem("yes", "yes");
    expect(readBoolFlag("n1", false)).toBe(true);
    expect(readBoolFlag("n0", true)).toBe(false);
    expect(readBoolFlag("yes", true)).toBe(true);
    expect(readBoolFlag("yes", false)).toBe(false);
  });

  it("isFirstLaunch is true until mark, and false after only when key is true", () => {
    expect(isFirstLaunch()).toBe(true);
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "false");
    // product: first launch when flag is not truthy → still first launch
    expect(isFirstLaunch()).toBe(true);
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "1");
    expect(isFirstLaunch()).toBe(false);
  });

  it("writeBoolFlag writes literal true/false strings only", () => {
    writeBoolFlag("w", true);
    expect(window.localStorage.getItem("w")).toBe("true");
    writeBoolFlag("w", false);
    expect(window.localStorage.getItem("w")).toBe("false");
  });

  // wave-203 residual
  it("TRUE/FALSE/yes/no tokens fall back; only exact true/1 and false/0 accepted", () => {
    window.localStorage.setItem("T", "TRUE");
    window.localStorage.setItem("F", "FALSE");
    window.localStorage.setItem("yes", "yes");
    window.localStorage.setItem("no", "no");
    expect(readBoolFlag("T", false)).toBe(false);
    expect(readBoolFlag("T", true)).toBe(true);
    expect(readBoolFlag("F", true)).toBe(true);
    expect(readBoolFlag("yes", false)).toBe(false);
    expect(readBoolFlag("no", true)).toBe(true);
  });

  it("markFirstLaunchDone after false key upgrades to true and isFirstLaunch becomes false", () => {
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "false");
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(isFirstLaunch()).toBe(false);
  });

  // wave-209 residual
  it("readBoolFlag missing key returns fallback; exact 1/0 tokens accepted", () => {
    window.localStorage.removeItem("flag-a");
    expect(readBoolFlag("flag-a", true)).toBe(true);
    expect(readBoolFlag("flag-a", false)).toBe(false);
    window.localStorage.setItem("flag-a", "1");
    expect(readBoolFlag("flag-a", false)).toBe(true);
    window.localStorage.setItem("flag-a", "0");
    expect(readBoolFlag("flag-a", true)).toBe(false);
  });

  it("isFirstLaunch true when key absent; markFirstLaunchDone is idempotent", () => {
    window.localStorage.removeItem("pi-desktop:firstLaunchDone");
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(isFirstLaunch()).toBe(false);
  });


  // wave-214 residual
  it("readBoolFlag returns fallback when localStorage.getItem throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("quota");
        },
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    expect(readBoolFlag("any", true)).toBe(true);
    expect(readBoolFlag("any", false)).toBe(false);
    expect(isFirstLaunch()).toBe(true); // fallback false → !false
  });

  it("writeBoolFlag swallows setItem throws; markFirstLaunchDone stays silent", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("deny");
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    expect(() => writeBoolFlag("k", true)).not.toThrow();
    expect(() => markFirstLaunchDone()).not.toThrow();
    expect(isFirstLaunch()).toBe(true);
  });

  it("empty string and whitespace tokens fall back; only exact true/1 false/0 accepted", () => {
    window.localStorage.setItem("e", "");
    window.localStorage.setItem("sp", " ");
    window.localStorage.setItem("t", "true");
    expect(readBoolFlag("e", true)).toBe(true);
    expect(readBoolFlag("sp", false)).toBe(false);
    expect(readBoolFlag("t", false)).toBe(true);
  });


  // wave-220 residual
  it("isFirstLaunch true until markFirstLaunchDone; writeBoolFlag false clears done", () => {
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
    writeBoolFlag("pi-desktop:firstLaunchDone", false);
    expect(isFirstLaunch()).toBe(true);
  });

  it("readBoolFlag accepts 1/0; rejects yes/YES/True and uses fallback", () => {
    window.localStorage.setItem("k1", "1");
    window.localStorage.setItem("k0", "0");
    window.localStorage.setItem("ky", "yes");
    window.localStorage.setItem("kT", "True");
    expect(readBoolFlag("k1", false)).toBe(true);
    expect(readBoolFlag("k0", true)).toBe(false);
    expect(readBoolFlag("ky", true)).toBe(true);
    expect(readBoolFlag("kT", false)).toBe(false);
  });

  // wave-280 residual
  it("writeBoolFlag stores true/false strings; missing key uses fallback for isFirstLaunch", () => {
    writeBoolFlag("custom-flag", true);
    expect(window.localStorage.getItem("custom-flag")).toBe("true");
    writeBoolFlag("custom-flag", false);
    expect(window.localStorage.getItem("custom-flag")).toBe("false");
    window.localStorage.removeItem("pi-desktop:firstLaunchDone");
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    expect(isFirstLaunch()).toBe(false);
  });

  it("readBoolFlag returns fallback when localStorage throws on getItem", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    expect(readBoolFlag("any", true)).toBe(true);
    expect(readBoolFlag("any", false)).toBe(false);
    Object.defineProperty(window, "localStorage", { configurable: true, value: original });
  });


  // wave-299 residual
  it("readBoolFlag unknown raw values fall back; true/false strings only for write", () => {
    window.localStorage.setItem("k-yes", "yes");
    window.localStorage.setItem("k-empty", "");
    expect(readBoolFlag("k-yes", true)).toBe(true);
    expect(readBoolFlag("k-yes", false)).toBe(false);
    expect(readBoolFlag("k-empty", true)).toBe(true);
    expect(readBoolFlag("missing-key", false)).toBe(false);
    writeBoolFlag("k-out", true);
    expect(window.localStorage.getItem("k-out")).toBe("true");
    writeBoolFlag("k-out", false);
    expect(window.localStorage.getItem("k-out")).toBe("false");
  });

  it("markFirstLaunchDone is idempotent; isFirstLaunch flips once", () => {
    window.localStorage.removeItem("pi-desktop:firstLaunchDone");
    expect(isFirstLaunch()).toBe(true);
    markFirstLaunchDone();
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
    expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
  });

  it("writeBoolFlag swallows setItem throws without throwing", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    expect(() => writeBoolFlag("x", true)).not.toThrow();
    expect(() => markFirstLaunchDone()).not.toThrow();
    Object.defineProperty(window, "localStorage", { configurable: true, value: original });
  });

});
