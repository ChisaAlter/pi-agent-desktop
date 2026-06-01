import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyScore } from "../fuzzy-match";

describe("fuzzyMatch", () => {
    it("returns true for substring matches", () => {
        expect(fuzzyMatch("auth/login.ts", "auth")).toBe(true);
        expect(fuzzyMatch("src/foo/bar.ts", "bar")).toBe(true);
    });
    it("returns true for camelcase / path-segment matches (u/l -> userLogin)", () => {
        expect(fuzzyMatch("userLoginService.ts", "uls")).toBe(true);
    });
    it("returns false for non-matches", () => {
        expect(fuzzyMatch("foo.ts", "bar")).toBe(false);
    });
    it("empty query matches anything", () => {
        expect(fuzzyMatch("anything", "")).toBe(true);
    });
});

describe("fuzzyScore", () => {
    it("ranks exact matches highest", () => {
        const a = fuzzyScore("auth.ts", "auth");
        const b = fuzzyScore("user-auth.ts", "auth");
        expect(a).toBeGreaterThan(b);
    });
    it("ranks substring above camelcase", () => {
        const a = fuzzyScore("userAuth.ts", "auth");
        const b = fuzzyScore("userAuth.ts", "ua");
        expect(a).toBeGreaterThanOrEqual(b);
    });
    it("returns 0 for non-match", () => {
        expect(fuzzyScore("foo.ts", "bar")).toBe(0);
    });
});
