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
    it("ranks prefix substring above mid-string and path-segment", () => {
        expect(fuzzyScore("auth.ts", "auth")).toBe(100);
        expect(fuzzyScore("src/auth.ts", "auth")).toBe(75);
        expect(fuzzyScore("user-auth.ts", "auth")).toBe(75);
        expect(fuzzyScore("src\\auth.ts", "auth")).toBe(75);
        expect(fuzzyScore("reauth.ts", "auth")).toBe(50);
    });
    it("ranks substring above camelcase", () => {
        const a = fuzzyScore("userAuth.ts", "auth");
        const b = fuzzyScore("userAuth.ts", "ua");
        expect(a).toBeGreaterThanOrEqual(b);
        expect(b).toBe(25);
    });
    it("returns 0 for non-match", () => {
        expect(fuzzyScore("foo.ts", "bar")).toBe(0);
    });

    // wave-114 residual
    it("scores full-text equality as prefix 100 and empty text only for empty query", () => {
        expect(fuzzyScore("App.tsx", "App.tsx")).toBe(100);
        expect(fuzzyScore("App.tsx", "app.tsx")).toBe(100);
        expect(fuzzyScore("", "")).toBe(1);
        expect(fuzzyScore("", "a")).toBe(0);
        expect(fuzzyMatch("", "a")).toBe(false);
    });

    it("uses first indexOf hit for segment scoring and requires ordered chars for 25", () => {
        expect(fuzzyScore("wrapperapp/app.ts", "app")).toBe(50);
        expect(fuzzyScore("src/app/app.ts", "app")).toBe(75);
        expect(fuzzyScore("abc", "cba")).toBe(0);
        expect(fuzzyScore("alpha-beta", "ab")).toBe(25);
        expect(fuzzyMatch("foo_bar.ts", "bar")).toBe(true);
        expect(fuzzyScore("foo_bar.ts", "bar")).toBe(50);
    });

    // wave-126 residual
    it("scores mixed-case path separators and treats space as non-boundary mid-token", () => {
        expect(fuzzyScore("Src\\Auth\\Login.ts", "auth")).toBe(75);
        expect(fuzzyScore("Src/Auth/Login.ts", "AUTH")).toBe(75);
        expect(fuzzyScore("foo bar.ts", "bar")).toBe(50);
        expect(fuzzyMatch("foo bar.ts", "bar")).toBe(true);
    });

    it("returns 25 only when every query char appears in order", () => {
        expect(fuzzyScore("CommandPalette.tsx", "cp")).toBe(25);
        expect(fuzzyScore("CommandPalette.tsx", "cxp")).toBe(0);
        expect(fuzzyMatch("CommandPalette.tsx", "cpx")).toBe(true);
        expect(fuzzyScore("CommandPalette.tsx", "cpx")).toBe(25);
    });

    // wave-152 residual (keep main/utils in sync with renderer fuzzy residual)
    it("does not treat underscore as segment boundary; empty query scores 1", () => {
        expect(fuzzyScore("foo_bar.ts", "bar")).toBe(50);
        expect(fuzzyScore("foo-bar.ts", "bar")).toBe(75);
        expect(fuzzyScore("x", "")).toBe(1);
        expect(fuzzyMatch("x", "")).toBe(true);
        expect(fuzzyScore("UserLoginService", "ULS")).toBe(25);
        // reverse-order subsequence fails
        expect(fuzzyScore("UserLoginService", "SUL")).toBe(0);
        expect(fuzzyScore("UserLoginService", "xyz")).toBe(0);
    });

    // wave-159 residual (parity with renderer wave-158)
    it("prefix 100; CJK after slash 75; mid-token CJK 50; backslash segment 75", () => {
        expect(fuzzyScore("readme.md", "readme")).toBe(100);
        expect(fuzzyScore("文档/说明.md", "说明")).toBe(75);
        expect(fuzzyScore("文档/说明.md", "文档")).toBe(100);
        expect(fuzzyScore("项目说明文档", "说明")).toBe(50);
        expect(fuzzyScore("src\\utils\\a.ts", "utils")).toBe(75);
        expect(fuzzyMatch("abc", "ac")).toBe(true);
        expect(fuzzyScore("abc", "ac")).toBe(25);
        expect(fuzzyMatch("abc", "z")).toBe(false);
    });

    // wave-179 residual (parity with renderer wave-178)
    it("whitespace in query is significant (not trimmed) for exact/prefix scoring", () => {
        expect(fuzzyScore("abc", " a")).toBe(0);
        expect(fuzzyMatch("abc", " a")).toBe(false);
        expect(fuzzyScore(" a", " a")).toBe(100);
    });

    it("unicode multi-codepoint queries score ordered-char 25 or mid-token 50", () => {
        expect(fuzzyScore("你好世界", "你世")).toBe(25);
        expect(fuzzyMatch("你好世界", "你世")).toBe(true);
        expect(fuzzyScore("你好世界", "世界")).toBe(50);
    });

    it("query longer than text fails unless equal", () => {
        expect(fuzzyScore("ab", "abc")).toBe(0);
        expect(fuzzyScore("abc", "abc")).toBe(100);
        expect(fuzzyMatch("ab", "abc")).toBe(false);
    });

    // wave-188 residual
    it("empty query scores 1 on empty/non-empty text; fuzzyMatch follows >0", () => {
        expect(fuzzyScore("", "")).toBe(1);
        expect(fuzzyScore("anything", "")).toBe(1);
        expect(fuzzyMatch("anything", "")).toBe(true);
        expect(fuzzyMatch("", "")).toBe(true);
    });

    it("first indexOf wins for multi-occurrence; underscore is not a segment boundary", () => {
        // first "app" is mid-token in "wrapperapp", so 50 even if later path segment exists
        expect(fuzzyScore("wrapperapp/app.ts", "app")).toBe(50);
        expect(fuzzyScore("foo_bar", "bar")).toBe(50);
        expect(fuzzyScore("foo-bar", "bar")).toBe(75);
        expect(fuzzyScore("foo/bar", "bar")).toBe(75);
        expect(fuzzyScore("foo\\bar", "bar")).toBe(75);
    });

    // wave-196 residual
    it("case-insensitive substring scores equal to lowercase; ordered camel initials score 25", () => {
        expect(fuzzyScore("FooBar", "foobar")).toBe(100);
        expect(fuzzyScore("FooBar", "FOOBAR")).toBe(100);
        expect(fuzzyScore("MyComponent.tsx", "mc")).toBe(25);
        expect(fuzzyMatch("MyComponent.tsx", "mc")).toBe(true);
        expect(fuzzyScore("MyComponent.tsx", "xyz")).toBe(0);
    });

    it("ordered-char match fails when query chars are out of order", () => {
        expect(fuzzyScore("abc", "cba")).toBe(0);
        expect(fuzzyMatch("abc", "cba")).toBe(false);
        expect(fuzzyScore("path/to/file", "ptf")).toBe(25);
    });

    // wave-203 residual
    it("hyphen after mid-token does not upgrade earlier mid-token match to segment 75", () => {
        // first indexOf("bar") is at index 3 in "foobar-bar" (mid-token) → 50
        expect(fuzzyScore("foobar-bar", "bar")).toBe(50);
        expect(fuzzyScore("-bar", "bar")).toBe(75);
        expect(fuzzyScore("x-bar", "bar")).toBe(75);
        expect(fuzzyMatch("foobar-bar", "bar")).toBe(true);
    });

    it("empty text only matches empty query; single-char ordered and prefix paths", () => {
        expect(fuzzyScore("", "x")).toBe(0);
        expect(fuzzyMatch("", "x")).toBe(false);
        expect(fuzzyScore("a", "a")).toBe(100);
        expect(fuzzyScore("ab", "a")).toBe(100);
        expect(fuzzyScore("ba", "a")).toBe(50);
        expect(fuzzyScore("zx", "a")).toBe(0);
    });

    // wave-210 residual
    it("unicode ordered-char and longer-query fail unless equal", () => {
        expect(fuzzyScore("你好世界", "你世")).toBe(25);
        expect(fuzzyMatch("你好世界", "你世")).toBe(true);
        expect(fuzzyScore("你好世界", "世界")).toBe(50);
        expect(fuzzyScore("ab", "abc")).toBe(0);
        expect(fuzzyScore("abc", "abc")).toBe(100);
        expect(fuzzyMatch("ab", "abc")).toBe(false);
    });

    // wave-217 residual
    it("segment boundary scores 75 after / \\ - only; space/underscore stay mid-token 50", () => {
        expect(fuzzyScore("src/app.ts", "app")).toBe(75);
        expect(fuzzyScore("src\\app.ts", "app")).toBe(75);
        expect(fuzzyScore("src-app.ts", "app")).toBe(75);
        expect(fuzzyScore("src app.ts", "app")).toBe(50);
        expect(fuzzyScore("src_app.ts", "app")).toBe(50);
        expect(fuzzyMatch("src/app.ts", "app")).toBe(true);
    });

    it("ordered-char requires all query chars in order; missing char scores 0", () => {
        expect(fuzzyScore("abcdef", "ace")).toBe(25);
        expect(fuzzyScore("abcdef", "aec")).toBe(0);
        expect(fuzzyScore("abcdef", "ax")).toBe(0);
        expect(fuzzyMatch("abcdef", "ace")).toBe(true);
        expect(fuzzyMatch("abcdef", "aec")).toBe(false);
    });

    // wave-233 residual
    it("case-insensitive prefix beats path-segment and mid-token for same needle", () => {
        expect(fuzzyScore("Auth.ts", "auth")).toBe(100);
        expect(fuzzyScore("src/Auth.ts", "auth")).toBe(75);
        expect(fuzzyScore("reAuth.ts", "auth")).toBe(50);
        expect(fuzzyMatch("Auth.ts", "AUTH")).toBe(true);
    });

    it("empty query scores 1 for any text including empty; fuzzyMatch treats 1 as match", () => {
        expect(fuzzyScore("x", "")).toBe(1);
        expect(fuzzyScore("", "")).toBe(1);
        expect(fuzzyMatch("x", "")).toBe(true);
        expect(fuzzyMatch("", "")).toBe(true);
    });

    it("first indexOf wins: later path-segment does not upgrade mid-token hit", () => {
        // "auth" at index 2 in "xxauth/auth" is mid-token → 50 (not the later /auth)
        expect(fuzzyScore("xxauth/auth", "auth")).toBe(50);
        expect(fuzzyScore("x/auth", "auth")).toBe(75);
    });

            // wave-243 residual
    it("ordered-char path only when substring misses; score 25 vs 0", () => {
        expect(fuzzyScore("aXbYc", "ac")).toBe(25);
        expect(fuzzyMatch("aXbYc", "ac")).toBe(true);
        expect(fuzzyScore("aXbYc", "ca")).toBe(0);
        expect(fuzzyMatch("aXbYc", "ca")).toBe(false);
        expect(fuzzyScore("abc", "z")).toBe(0);
        expect(fuzzyMatch("abc", "z")).toBe(false);
    });

    it("hyphen and slash/backslash before match score 75; underscore does not", () => {
        expect(fuzzyScore("pre-fix", "fix")).toBe(75);
        expect(fuzzyScore("pre/fix", "fix")).toBe(75);
        expect(fuzzyScore("pre" + "\\" + "fix", "fix")).toBe(75);
        expect(fuzzyScore("pre_fix", "fix")).toBe(50);
        expect(fuzzyScore("prefix", "fix")).toBe(50);
    });

    // wave-254 residual
    it("prefix score 100 beats mid-path 75; ordered multi-char needs full query sequence", () => {
        expect(fuzzyScore("readme.md", "read")).toBe(100);
        expect(fuzzyScore("docs/readme.md", "read")).toBe(75);
        expect(fuzzyScore("docs/readme.md", "docs")).toBe(100);
        expect(fuzzyScore("abcdef", "adf")).toBe(25);
        expect(fuzzyScore("abcdef", "afd")).toBe(0);
        expect(fuzzyMatch("docs/readme.md", "rdm")).toBe(true);
        expect(fuzzyMatch("docs/readme.md", "mdr")).toBe(false);
    });

    it("unicode case folding follows toLowerCase; empty text with non-empty query is 0", () => {
        expect(fuzzyScore("İstanbul", "istanbul")).toBeGreaterThan(0);
        expect(fuzzyScore("", "x")).toBe(0);
        expect(fuzzyMatch("", "x")).toBe(false);
        expect(fuzzyScore("ABC", "abc")).toBe(100);
    });

    // wave-270 residual
    it("empty query scores 1; whitespace is non-empty miss unless present", () => {
        expect(fuzzyScore("anything", "")).toBe(1);
        expect(fuzzyMatch("anything", "")).toBe(true);
        expect(fuzzyScore("abc", " ")).toBe(0);
        expect(fuzzyScore("a b", " ")).toBe(50);
    });

    it("segment boundary after / \\ - is 75; first mid-token indexOf wins", () => {
        expect(fuzzyScore("src/app.ts", "app")).toBe(75);
        expect(fuzzyScore("src\\app.ts", "app")).toBe(75);
        expect(fuzzyScore("src-app.ts", "app")).toBe(75);
        expect(fuzzyScore("foobar-bar", "bar")).toBe(50);
        expect(fuzzyScore("path/to/file", "ptf")).toBe(25);
    });


    // wave-278 residual
    it("fuzzyMatch is score>0; full equality case-insensitive is 100", () => {
        expect(fuzzyMatch("Hello", "hello")).toBe(true);
        expect(fuzzyScore("Hello", "hello")).toBe(100);
        expect(fuzzyMatch("Hello", "xyz")).toBe(false);
        expect(fuzzyScore("Hello", "xyz")).toBe(0);
    });

    it("ordered char score 25 does not require contiguous; reverse order fails", () => {
        expect(fuzzyScore("src/utils/path.ts", "sup")).toBe(25);
        expect(fuzzyScore("src/utils/path.ts", "pus")).toBe(0);
        expect(fuzzyMatch("src/utils/path.ts", "sup")).toBe(true);
    });



    // wave-288 residual
    it("score priority: prefix 100 > boundary 75 > mid-substring 50 > ordered 25 > 0", () => {
        expect(fuzzyScore("readme.md", "read")).toBe(100);
        expect(fuzzyScore("docs/readme.md", "readme")).toBe(75);
        expect(fuzzyScore("myreadme.md", "readme")).toBe(50);
        expect(fuzzyScore("ReadMeDoc", "rmd")).toBe(25);
        expect(fuzzyScore("abc", "xyz")).toBe(0);
        // case-insensitive path boundary after \
        expect(fuzzyScore("C:\\Users\\demo\\App.tsx", "app")).toBe(75);
        // boundary only / \\ - not underscore
        expect(fuzzyScore("src_app.ts", "app")).toBe(50);
    });

    it("empty query scores 1 and matches; whitespace query only matches if present as substring", () => {
        expect(fuzzyScore("", "")).toBe(1);
        expect(fuzzyMatch("", "")).toBe(true);
        expect(fuzzyScore("x", "")).toBe(1);
        expect(fuzzyScore("ab c", " ")).toBe(50);
        expect(fuzzyScore("abc", " ")).toBe(0);
        expect(fuzzyMatch("abc", " ")).toBe(false);
    });

});
