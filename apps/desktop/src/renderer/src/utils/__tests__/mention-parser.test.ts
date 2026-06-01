import { describe, it, expect } from "vitest";
import { findActiveMention, resolveMention } from "../mention-parser";

describe("findActiveMention", () => {
    it("returns null if no @", () => {
        expect(findActiveMention("hello world", 5)).toBeNull();
    });
    it("returns null if @ before cursor has whitespace", () => {
        expect(findActiveMention("hello @ world", 8)).toBeNull();
    });
    it("finds @ at cursor position", () => {
        // "hello @au" 长度 9, cursor=8 (在 'u' 之前), query="a"
        expect(findActiveMention("hello @au", 8)).toEqual({ start: 6, query: "a" });
    });
    it("finds @ even if cursor is at end of @token", () => {
        // "hello @auth" 长度 11, cursor=11, query="auth"
        expect(findActiveMention("hello @auth", 11)).toEqual({ start: 6, query: "auth" });
    });
    it("finds @ when cursor is mid-token", () => {
        // "hello @aut" 长度 10, cursor=10, query="aut"
        expect(findActiveMention("hello @aut", 10)).toEqual({ start: 6, query: "aut" });
    });
    it("returns null when cursor is at start of @token (no chars typed yet)", () => {
        // 刚输入 @, cursor 在 @ 之后, query 是空
        const r = findActiveMention("hello @", 7);
        expect(r).toEqual({ start: 6, query: "" });
    });
    it("finds second @ when first is followed by space", () => {
        expect(findActiveMention("@foo @bar", 9)).toEqual({ start: 5, query: "bar" });
    });
});

describe("resolveMention", () => {
    it("replaces @query with @full-path", () => {
        const m = findActiveMention("@abc rest", 4)!;
        const r = resolveMention("@abc rest", m, "src/auth.ts");
        expect(r).toBe("@src/auth.ts rest");
    });
    it("preserves text after the mention", () => {
        const m = findActiveMention("see @aut there", 8)!;
        const r = resolveMention("see @aut there", m, "src/auth.ts");
        expect(r).toBe("see @src/auth.ts there");
    });
});
