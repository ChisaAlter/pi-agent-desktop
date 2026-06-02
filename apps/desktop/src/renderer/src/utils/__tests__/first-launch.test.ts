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
