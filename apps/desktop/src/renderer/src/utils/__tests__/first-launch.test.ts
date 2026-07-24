// first-launch 工具测试
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { isFirstLaunch, markFirstLaunchDone, readBoolFlag, writeBoolFlag } from "../first-launch";

describe("first-launch utils", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("isFirstLaunch returns true on fresh storage", () => {
        expect(isFirstLaunch()).toBe(true);
    });

    it("markFirstLaunchDone flips the flag", () => {
        expect(isFirstLaunch()).toBe(true);
        markFirstLaunchDone();
        expect(isFirstLaunch()).toBe(false);
    });

    it("readBoolFlag handles missing key", () => {
        expect(readBoolFlag("nope", true)).toBe(true);
        expect(readBoolFlag("nope", false)).toBe(false);
    });

    it("writeBoolFlag / readBoolFlag roundtrip", () => {
        writeBoolFlag("foo", true);
        expect(readBoolFlag("foo", false)).toBe(true);
        writeBoolFlag("foo", false);
        expect(readBoolFlag("foo", true)).toBe(false);
    });

    it("readBoolFlag handles malformed value gracefully", () => {
        window.localStorage.setItem("bad", "garbage");
        // not "true" or "1" → fallback
        expect(readBoolFlag("bad", true)).toBe(true);
    });
});


// wave-227 residual
describe("first-launch residual (wave-227)", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("readBoolFlag treats true/1 as true and false/0 as false", () => {
        window.localStorage.setItem("k1", "true");
        window.localStorage.setItem("k2", "1");
        window.localStorage.setItem("k3", "false");
        window.localStorage.setItem("k4", "0");
        expect(readBoolFlag("k1", false)).toBe(true);
        expect(readBoolFlag("k2", false)).toBe(true);
        expect(readBoolFlag("k3", true)).toBe(false);
        expect(readBoolFlag("k4", true)).toBe(false);
    });

    it("writeBoolFlag stores literal true/false strings", () => {
        writeBoolFlag("w", true);
        expect(window.localStorage.getItem("w")).toBe("true");
        writeBoolFlag("w", false);
        expect(window.localStorage.getItem("w")).toBe("false");
    });

    it("isFirstLaunch is true until markFirstLaunchDone (idempotent)", () => {
        expect(isFirstLaunch()).toBe(true);
        markFirstLaunchDone();
        markFirstLaunchDone();
        expect(isFirstLaunch()).toBe(false);
        expect(readBoolFlag("pi-desktop:firstLaunchDone", false)).toBe(true);
    });
});

// wave-236 residual
describe("first-launch residual (wave-236)", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("unknown string values fall back; empty string falls back", () => {
        window.localStorage.setItem("u1", "TRUE");
        window.localStorage.setItem("u2", "yes");
        window.localStorage.setItem("u3", "");
        expect(readBoolFlag("u1", false)).toBe(false);
        expect(readBoolFlag("u1", true)).toBe(true);
        expect(readBoolFlag("u2", true)).toBe(true);
        expect(readBoolFlag("u3", false)).toBe(false);
    });

    it("writeBoolFlag false then read with true fallback returns false", () => {
        writeBoolFlag("done", false);
        expect(window.localStorage.getItem("done")).toBe("false");
        expect(readBoolFlag("done", true)).toBe(false);
    });

    it("isFirstLaunch true when storage missing; false after explicit key true/1", () => {
        expect(isFirstLaunch()).toBe(true);
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "1");
        expect(isFirstLaunch()).toBe(false);
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "0");
        expect(isFirstLaunch()).toBe(true);
    });
});

// wave-255 residual
describe("first-launch residual (wave-255)", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("readBoolFlag accepts only true/1 and false/0; other strings use fallback", () => {
        writeBoolFlag("k", true);
        expect(readBoolFlag("k", false)).toBe(true);
        writeBoolFlag("k", false);
        expect(readBoolFlag("k", true)).toBe(false);
        window.localStorage.setItem("k", "True");
        expect(readBoolFlag("k", false)).toBe(false);
        window.localStorage.setItem("k", "2");
        expect(readBoolFlag("k", true)).toBe(true);
        expect(readBoolFlag("missing", true)).toBe(true);
        expect(readBoolFlag("missing", false)).toBe(false);
    });

    it("markFirstLaunchDone is idempotent; isFirstLaunch flips once", () => {
        expect(isFirstLaunch()).toBe(true);
        markFirstLaunchDone();
        markFirstLaunchDone();
        expect(isFirstLaunch()).toBe(false);
        expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    });
});


// wave-267 residual
describe("first-launch residual (wave-267)", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("writeBoolFlag stores true/false strings only; read missing uses fallback", () => {
        writeBoolFlag("flag-a", true);
        expect(window.localStorage.getItem("flag-a")).toBe("true");
        writeBoolFlag("flag-a", false);
        expect(window.localStorage.getItem("flag-a")).toBe("false");
        expect(readBoolFlag("never-set", true)).toBe(true);
        expect(readBoolFlag("never-set", false)).toBe(false);
    });

    it("isFirstLaunch true until mark; key is pi-desktop:firstLaunchDone", () => {
        expect(isFirstLaunch()).toBe(true);
        expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBeNull();
        markFirstLaunchDone();
        expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
        expect(isFirstLaunch()).toBe(false);
    });
});



// wave-289 residual
describe("first-launch residual (wave-289)", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("readBoolFlag accepts true/1 and false/0; unknown raw falls back", () => {
        window.localStorage.setItem("k1", "1");
        window.localStorage.setItem("k0", "0");
        window.localStorage.setItem("kT", "true");
        window.localStorage.setItem("kF", "false");
        window.localStorage.setItem("kX", "yes");
        expect(readBoolFlag("k1", false)).toBe(true);
        expect(readBoolFlag("k0", true)).toBe(false);
        expect(readBoolFlag("kT", false)).toBe(true);
        expect(readBoolFlag("kF", true)).toBe(false);
        expect(readBoolFlag("kX", true)).toBe(true);
        expect(readBoolFlag("kX", false)).toBe(false);
    });

    it("writeBoolFlag overwrites prior value; markFirstLaunchDone uses product key", () => {
        writeBoolFlag("pi-desktop:firstLaunchDone", false);
        expect(isFirstLaunch()).toBe(true);
        markFirstLaunchDone();
        expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
        expect(isFirstLaunch()).toBe(false);
        writeBoolFlag("pi-desktop:firstLaunchDone", false);
        expect(isFirstLaunch()).toBe(true);
    });
});

// wave-310 residual
describe("first-launch residual (wave-310)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("isFirstLaunch true when key missing or false; false only when product key is true", () => {
    expect(isFirstLaunch()).toBe(true);
    writeBoolFlag("pi-desktop:firstLaunchDone", false);
    expect(isFirstLaunch()).toBe(true);
    writeBoolFlag("pi-desktop:firstLaunchDone", true);
    expect(isFirstLaunch()).toBe(false);
    markFirstLaunchDone();
    expect(isFirstLaunch()).toBe(false);
  });

  it("readBoolFlag: missing uses fallback; raw TRUE/FALSE/yes/2 fall back; write stores true/false only", () => {
    expect(readBoolFlag("missing", true)).toBe(true);
    expect(readBoolFlag("missing", false)).toBe(false);
    window.localStorage.setItem("kTRUE", "TRUE");
    window.localStorage.setItem("kFALSE", "FALSE");
    window.localStorage.setItem("kyes", "yes");
    window.localStorage.setItem("k2", "2");
    expect(readBoolFlag("kTRUE", false)).toBe(false);
    expect(readBoolFlag("kFALSE", true)).toBe(true);
    expect(readBoolFlag("kyes", true)).toBe(true);
    expect(readBoolFlag("k2", false)).toBe(false);
    writeBoolFlag("flag", true);
    expect(window.localStorage.getItem("flag")).toBe("true");
    writeBoolFlag("flag", false);
    expect(window.localStorage.getItem("flag")).toBe("false");
  });
});
