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
    it("replaces empty query right after @", () => {
        const m = findActiveMention("hi @", 4)!;
        expect(m).toEqual({ start: 3, query: "" });
        expect(resolveMention("hi @", m, "pkg/main.ts")).toBe("hi @pkg/main.ts");
    });
    it("replaces mid-token query without consuming trailing text", () => {
        const m = findActiveMention("see @au tail", 7)!;
        expect(m).toEqual({ start: 4, query: "au" });
        expect(resolveMention("see @au tail", m, "lib/auth.ts")).toBe("see @lib/auth.ts tail");
    });
});

describe("findActiveMention edges", () => {
    it("returns null when cursor is 0", () => {
        expect(findActiveMention("@file", 0)).toBeNull();
    });
    it("returns null when @ is only after the cursor", () => {
        expect(findActiveMention("hello @x", 5)).toBeNull();
    });
    it("allows path-like tokens with slash and dot", () => {
        expect(findActiveMention("@src/auth.ts", 12)).toEqual({
            start: 0,
            query: "src/auth.ts",
        });
    });
    it("rejects whitespace inside the token even with multiple @", () => {
        expect(findActiveMention("@a b @c", 4)).toBeNull();
        expect(findActiveMention("@a b @c", 7)).toEqual({ start: 5, query: "c" });
    });

    // wave-113 residual
    it("treats email-like text as a mention when @ is before the cursor", () => {
        // product semantics: any @ without whitespace until cursor is active
        // "ping user@example.com" → @ at index 9; cursor at end of host → query example.com
        expect(findActiveMention("ping user@example.com more", 21)).toEqual({
            start: 9,
            query: "example.com",
        });
    });

    it("returns null when cursor sits on the @ character itself", () => {
        // cursor=6 points at '@' in "hello @au" (indices 0..8), slice ends before @
        expect(findActiveMention("hello @au", 6)).toBeNull();
    });

    it("allows windows path tokens with backslash and unicode", () => {
        expect(findActiveMention("@docs\\说明.md", 11)).toEqual({
            start: 0,
            query: "docs\\说明.md",
        });
    });
});

describe("resolveMention residual", () => {
    // wave-113 residual
    it("replaces only the active token when multiple @ exist", () => {
        const text = "see @foo and @ba";
        const m = findActiveMention(text, text.length)!;
        expect(m).toEqual({ start: 13, query: "ba" });
        expect(resolveMention(text, m, "src/bar.ts")).toBe("see @foo and @src/bar.ts");
    });

    it("keeps trailing punctuation after the resolved path", () => {
        // "open @au." — indices: @=5, a=6, u=7, .=8; cursor after "au"
        const text = "open @au.";
        const m = findActiveMention(text, 8)!;
        expect(m).toEqual({ start: 5, query: "au" });
        expect(resolveMention(text, m, "lib/auth.ts")).toBe("open @lib/auth.ts.");
    });
});

// wave-127 residual
describe("mention-parser residual (wave-127)", () => {
    it("returns null for cursor 0 and for whitespace after @", () => {
        expect(findActiveMention("@file", 0)).toBeNull();
        expect(findActiveMention("hello @ file", 9)).toBeNull();
        expect(findActiveMention("no mention here", 5)).toBeNull();
    });

    it("resolveMention at start of string and empty query", () => {
        const m = findActiveMention("@", 1)!;
        expect(m).toEqual({ start: 0, query: "" });
        expect(resolveMention("@", m, "src/a.ts")).toBe("@src/a.ts");
        expect(resolveMention("x@y", { start: 1, query: "y" }, "z")).toBe("x@z");
    });
});

// wave-143 residual
describe("mention-parser residual (wave-143)", () => {
    it("treats tab/newline after @ as whitespace (no active mention)", () => {
        expect(findActiveMention("hi @\tfile", 5)).toBeNull();
        expect(findActiveMention("hi @\nfile", 5)).toBeNull();
        expect(findActiveMention("hi @\rfile", 5)).toBeNull();
    });

    it("supports CJK path tokens and resolve keeps surrounding text", () => {
        const text = "见 @文档/说明 结尾";
        // cursor after "文档" (indices: @ at 2)
        const m = findActiveMention("见 @文档", 5)!;
        expect(m).toEqual({ start: 2, query: "文档" });
        expect(resolveMention(text.replace("结尾", "").trimEnd() + " 结尾", m, "docs/说明.md")).toContain(
            "@docs/说明.md",
        );
        expect(resolveMention("前@中后", { start: 1, query: "中" }, "x/y.ts")).toBe("前@x/y.ts后");
    });

    it("uses the nearest @ before cursor when multiple exist", () => {
        // "@a @bb @ccc" indices: @=0 a=1 space=2 @=3 b=4 b=5 space=6 @=7 ...
        // cursor after first token (2) — still on first @query "a"
        expect(findActiveMention("@a @bb @ccc", 2)).toEqual({ start: 0, query: "a" });
        // cursor mid first space (3) hits second @ with empty query? product: lastIndexOf @
        // before cursor at 3 is index 0 still? before="@a " last @ is 0, between="a " has space → null
        expect(findActiveMention("@a @bb @ccc", 3)).toBeNull();
        // cursor after "bb" (6)
        expect(findActiveMention("@a @bb @ccc", 6)).toEqual({ start: 3, query: "bb" });
        expect(findActiveMention("@a @bb @ccc", 11)).toEqual({ start: 7, query: "ccc" });
    });

    it("resolveMention replaces only query span and keeps leading/trailing", () => {
        const text = "prefix @partial suffix";
        const m = findActiveMention(text, 15)!; // after "partial"
        expect(m).toEqual({ start: 7, query: "partial" });
        expect(resolveMention(text, m, "src/full.ts")).toBe("prefix @src/full.ts suffix");
    });
});

// wave-157 residual
describe("mention-parser residual (wave-157)", () => {
    it("returns null when cursor is 0 even if text starts with @", () => {
        expect(findActiveMention("@file", 0)).toBeNull();
        expect(findActiveMention("", 0)).toBeNull();
    });

    it("treats path separators and dots as valid query chars", () => {
        expect(findActiveMention("@src/utils/a.ts", 15)).toEqual({
            start: 0,
            query: "src/utils/a.ts",
        });
        expect(findActiveMention("see @foo-bar_baz", 16)).toEqual({
            start: 4,
            query: "foo-bar_baz",
        });
    });

    it("resolveMention with empty query inserts path at @ only", () => {
        const text = "hi @ there";
        // product: space after @ means no active mention for cursor after space
        expect(findActiveMention(text, 4)).toEqual({ start: 3, query: "" });
        expect(resolveMention(text, { start: 3, query: "" }, "x.ts")).toBe("hi @x.ts there");
    });

    it("resolveMention is pure and does not require match from findActiveMention", () => {
        // start points at the @; span is '@' + query length, so "a@b c" with start=1 query="b" → "a@Z c"
        expect(resolveMention("a@b c", { start: 1, query: "b" }, "Z")).toBe("a@Z c");
        // when start is not on '@', product still slices from start by 1+queryLen
        expect(resolveMention("abc", { start: 1, query: "b" }, "Z")).toBe("a@Z");
    });
});

// wave-180 residual
describe("mention-parser residual (wave-180)", () => {
    it("cursor past end of text still scans lastIndexOf @ on the slice", () => {
        // product uses text.slice(0, cursor); oversized cursor behaves like end
        expect(findActiveMention("@file", 99)).toEqual({ start: 0, query: "file" });
        expect(findActiveMention("no-at", 99)).toBeNull();
    });

    it("negative cursor uses slice(0, negative) product semantics", () => {
        // product: cursor===0 short-circuits null; cursor=-1 does not.
        // slice(0, -1) on "@x" yields "@" → active empty query at start 0.
        expect(findActiveMention("@x", -1)).toEqual({ start: 0, query: "" });
        expect(findActiveMention("a@x", -1)).toEqual({ start: 1, query: "" });
    });

    it("resolveMention with multi-byte CJK path preserves surrounding punctuation", () => {
        // "打开@说明!" code units: 打=0 开=1 @=2 说=3 明=4 !=5 → cursor after both CJK = 5
        const text = "打开@说明!";
        const m = findActiveMention(text, 5)!;
        expect(m).toEqual({ start: 2, query: "说明" });
        expect(resolveMention(text, m, "docs/说明.md")).toBe("打开@docs/说明.md!");
    });

    it("full-width space after @ is whitespace and disables mention", () => {
        // U+3000 ideographic space counts as \s in JS
        expect(findActiveMention("hi @　file", 6)).toBeNull();
    });
});

// wave-192 residual
describe("mention-parser residual (wave-192)", () => {
    it("cursor at 0 always returns null even when text starts with @", () => {
        expect(findActiveMention("@file", 0)).toBeNull();
        expect(findActiveMention("x@file", 0)).toBeNull();
    });

    it("active mention with empty query when cursor sits right after @", () => {
        expect(findActiveMention("@", 1)).toEqual({ start: 0, query: "" });
        expect(findActiveMention("say @", 5)).toEqual({ start: 4, query: "" });
    });

    it("resolveMention replaces only the active span and keeps trailing text", () => {
        // "see @old and more" → @ at 4; o=5 l=6 d=7; cursor after d = 8
        const text = "see @old and more";
        const match = findActiveMention(text, 8)!;
        expect(match).toEqual({ start: 4, query: "old" });
        expect(resolveMention(text, match, "src/new.ts")).toBe("see @src/new.ts and more");
    });

    it("whitespace inside query disables active mention", () => {
        // "@foo bar" → @=0 f=1 o=2 o=3 space=4; cursor 4 is still on token "foo"
        expect(findActiveMention("@foo bar", 4)).toEqual({ start: 0, query: "foo" });
        // cursor past space → between has whitespace
        expect(findActiveMention("@foo bar", 5)).toBeNull();
        expect(findActiveMention("@foo bar", 8)).toBeNull();
    });
});

// wave-199 residual
describe("mention-parser residual (wave-199)", () => {
    it("uses the nearest @ before cursor when multiple @ exist", () => {
        const text = "see @old then @ne";
        // cursor after "ne" → lastIndexOf @ is second mention
        expect(findActiveMention(text, text.length)).toEqual({ start: 14, query: "ne" });
        // cursor still inside first mention span
        expect(findActiveMention(text, 8)).toEqual({ start: 4, query: "old" });
    });

    it("resolveMention with empty query inserts path right after @", () => {
        const text = "open @ please";
        const match = findActiveMention(text, 6)!; // cursor right after @
        expect(match).toEqual({ start: 5, query: "" });
        expect(resolveMention(text, match, "src/a.ts")).toBe("open @src/a.ts please");
    });

    it("email-like token is treated as active mention until whitespace", () => {
        // product does not special-case email; @user.com is a single token
        expect(findActiveMention("mail @user.com", 14)).toEqual({ start: 5, query: "user.com" });
        expect(findActiveMention("mail user@host", 14)).toEqual({ start: 9, query: "host" });
    });

    it("resolveMention is a pure string splice and ignores filePath leading @", () => {
        const text = "@q";
        const match = { start: 0, query: "q" };
        expect(resolveMention(text, match, "@weird")).toBe("@@weird");
        expect(resolveMention(text, match, "plain")).toBe("@plain");
    });
});

// wave-204 residual
describe("mention-parser residual (wave-204)", () => {
    it("cursor 0 always null; cursor mid-token after @ keeps partial query", () => {
        expect(findActiveMention("@file", 0)).toBeNull();
        expect(findActiveMention("@file", 1)).toEqual({ start: 0, query: "" });
        expect(findActiveMention("@file", 3)).toEqual({ start: 0, query: "fi" });
        expect(findActiveMention("@file", 5)).toEqual({ start: 0, query: "file" });
    });

    it("path-like query tokens with slashes/dots stay active mentions", () => {
        expect(findActiveMention("see @src/utils/x", 16)).toEqual({
            start: 4,
            query: "src/utils/x",
        });
        expect(findActiveMention("@./rel", 6)).toEqual({ start: 0, query: "./rel" });
        expect(findActiveMention("@../up", 6)).toEqual({ start: 0, query: "../up" });
    });

    it("resolveMention preserves surrounding text and only replaces the active span", () => {
        const text = "prefix @partial suffix";
        const match = findActiveMention(text, 15)!; // after "partial"
        expect(match).toEqual({ start: 7, query: "partial" });
        expect(resolveMention(text, match, "src/full.ts")).toBe("prefix @src/full.ts suffix");
    });

    it("no @ before cursor returns null; cursor after @ activates empty then partial query", () => {
        const text = "hello @world";
        // @ is at index 6; slice(0,6) is "hello " → no @ yet
        expect(findActiveMention(text, 5)).toBeNull();
        expect(findActiveMention(text, 6)).toBeNull();
        // cursor right after @
        expect(findActiveMention(text, 7)).toEqual({ start: 6, query: "" });
        expect(findActiveMention(text, 12)).toEqual({ start: 6, query: "world" });
    });
});

// wave-211 residual
describe("mention-parser residual (wave-211)", () => {
    it("windows path and unicode tokens stay active; whitespace after @ kills match", () => {
        const win = "@C:\\Users\\a\\x.ts";
        expect(findActiveMention(win, win.length)).toEqual({
            start: 0,
            query: "C:\\Users\\a\\x.ts",
        });
        const zh = "见 @文档/说明";
        expect(findActiveMention(zh, zh.length)).toEqual({ start: 2, query: "文档/说明" });
        expect(findActiveMention("@ ", 2)).toBeNull();
        expect(findActiveMention("@\t", 2)).toBeNull();
    });

    it("resolveMention with empty query inserts path after @ only", () => {
        const text = "go @ now";
        // match as if cursor was right after @ at index 3 with empty query
        const match = { start: 3, query: "" };
        // "go @ now" indices: g0 o1 space2 @3 space4 n5...
        expect(resolveMention(text, match, "src/a.ts")).toBe("go @src/a.ts now");
        expect(resolveMention("@", { start: 0, query: "" }, "x")).toBe("@x");
    });
});

// wave-218 residual
describe("mention-parser residual (wave-218)", () => {
    it("cursor 0 / no @ null; space after first @ kills it; second @ and mid-token work", () => {
        expect(findActiveMention("hello", 0)).toBeNull();
        expect(findActiveMention("hello", 5)).toBeNull();
        // "@a @b" cursor at 3 -> before="@a " -> last @ is first, between has space -> null
        expect(findActiveMention("@a @b", 3)).toBeNull();
        // cursor at 5 -> last @ at 3, query "b"
        expect(findActiveMention("@a @b", 5)).toEqual({ start: 3, query: "b" });
        expect(findActiveMention("x@y", 3)).toEqual({ start: 1, query: "y" });
    });

    it("resolveMention replaces only the active match span; leaves surrounding text", () => {
        const text = "see @old and more";
        const match = findActiveMention(text, 8);
        expect(match).toEqual({ start: 4, query: "old" });
        expect(resolveMention(text, match!, "src/new.ts")).toBe("see @src/new.ts and more");
        expect(resolveMention("@q", { start: 0, query: "q" }, "path/with spaces.ts")).toBe(
            "@path/with spaces.ts",
        );
    });
});

// wave-238 residual
describe("mention-parser residual (wave-238)", () => {
    it("findActiveMention allows path-like tokens without whitespace", () => {
        expect(findActiveMention("see @src/foo.ts", 15)).toEqual({
            start: 4,
            query: "src/foo.ts",
        });
        expect(findActiveMention("see @src/foo.ts ", 16)).toBeNull(); // cursor after space
        expect(findActiveMention("@", 1)).toEqual({ start: 0, query: "" });
    });

    it("resolveMention preserves prefix/suffix and supports windows-style paths", () => {
        const text = "open @old end";
        const match = { start: 5, query: "old" };
        expect(resolveMention(text, match, "C:\\repo\\a.ts")).toBe("open @C:\\repo\\a.ts end");
        // start=1 on "@@x" replaces second @ + query "x" → "@@y"
        expect(resolveMention("@@x", { start: 1, query: "x" }, "y")).toBe("@@y");
    });

    it("cursor beyond length still uses slice(0,cursor) semantics via lastIndexOf", () => {
        // product uses text.slice(0, cursor); oversized cursor just uses full string
        expect(findActiveMention("@ab", 99)).toEqual({ start: 0, query: "ab" });
        expect(findActiveMention("no mention", 99)).toBeNull();
    });
});

// wave-255 residual
describe("mention-parser residual (wave-255)", () => {
    it("cursor 0 always null; whitespace after @ kills active mention", () => {
        expect(findActiveMention("@ab", 0)).toBeNull();
        expect(findActiveMention(" @ab", 1)).toBeNull();
        expect(findActiveMention("@a b", 3)).toBeNull(); // cursor in "a b" after space
        expect(findActiveMention("@a b", 2)).toEqual({ start: 0, query: "a" });
    });

    it("resolveMention replaces exact span length query+1; empty query becomes @path", () => {
        expect(resolveMention("@", { start: 0, query: "" }, "x.ts")).toBe("@x.ts");
        expect(resolveMention("pre @q post", { start: 4, query: "q" }, "file.ts")).toBe(
            "pre @file.ts post",
        );
        const long = "a".repeat(20);
        expect(resolveMention(`@${long}`, { start: 0, query: long }, "z")).toBe("@z");
    });
});


// wave-267 residual
describe("mention-parser residual (wave-267)", () => {
    it("last @ wins when multiple present before cursor", () => {
        expect(findActiveMention("@a @b", 5)).toEqual({ start: 3, query: "b" });
        expect(findActiveMention("@a @b", 2)).toEqual({ start: 0, query: "a" });
        expect(findActiveMention("x@y", 3)).toEqual({ start: 1, query: "y" });
    });

    it("resolveMention does not touch text after the match span", () => {
        expect(resolveMention("@old more", { start: 0, query: "old" }, "new.ts")).toBe("@new.ts more");
        expect(resolveMention("a@b c", { start: 1, query: "b" }, "p")).toBe("a@p c");
    });
});


// wave-280 residual
describe("mention-parser residual (wave-280)", () => {
  it("findActiveMention null when no @ before cursor; empty query after @ is active", () => {
    expect(findActiveMention("hello world", 5)).toBeNull();
    expect(findActiveMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(findActiveMention("pre@", 4)).toEqual({ start: 3, query: "" });
  });

  it("resolveMention inserts @path without requiring leading @ in path arg", () => {
    expect(resolveMention("@q", { start: 0, query: "q" }, "src/a.ts")).toBe("@src/a.ts");
    expect(resolveMention("x@q y", { start: 1, query: "q" }, "b")).toBe("x@b y");
    // path may itself contain @
    expect(resolveMention("@q", { start: 0, query: "q" }, "user@host")).toBe("@user@host");
  });
});



// wave-289 residual
describe("mention-parser residual (wave-289)", () => {
  it("cursor 0 always null; whitespace anywhere in token nulls active mention", () => {
    expect(findActiveMention("@x", 0)).toBeNull();
    expect(findActiveMention(" @x", 0)).toBeNull();
    expect(findActiveMention("@a b", 4)).toBeNull();
    expect(findActiveMention("@a\tb", 4)).toBeNull();
    expect(findActiveMention("@path/to", 8)).toEqual({ start: 0, query: "path/to" });
  });

  it("resolveMention replaces only match span; empty query becomes @path", () => {
    expect(resolveMention("@", { start: 0, query: "" }, "f.ts")).toBe("@f.ts");
    expect(resolveMention("pre@ mid", { start: 3, query: "" }, "x")).toBe("pre@x mid");
    const text = "see @old and more";
    const match = findActiveMention(text, 8);
    expect(match).toEqual({ start: 4, query: "old" });
    expect(resolveMention(text, match!, "new/file.ts")).toBe("see @new/file.ts and more");
  });
});


// wave-303 residual
describe("mention-parser residual (wave-303)", () => {
  it("findActiveMention uses last @ before cursor; whitespace in between nulls", () => {
    expect(findActiveMention("a@b@c", 5)).toEqual({ start: 3, query: "c" });
    expect(findActiveMention("a@b@c", 3)).toEqual({ start: 1, query: "b" });
    // cursor after "foo" (index 4) keeps active query; index 5 includes space → null
    expect(findActiveMention("@foo bar", 4)).toEqual({ start: 0, query: "foo" });
    expect(findActiveMention("@foo bar", 5)).toBeNull();
    expect(findActiveMention("@foo bar", 8)).toBeNull();
    expect(findActiveMention("x", 1)).toBeNull();
  });

  it("resolveMention rewrites from match.start through query length only", () => {
    const text = "ping @src/old.ts please";
    // "ping " (5) + "@" + "src/old.ts" (10) → cursor 16 at end of path token
    const match = findActiveMention(text, 16);
    expect(match).toEqual({ start: 5, query: "src/old.ts" });
    expect(resolveMention(text, match!, "docs/new.md")).toBe("ping @docs/new.md please");
    expect(resolveMention("@q", { start: 0, query: "q" }, "")).toBe("@");
  });



// wave-309 residual
describe("mention-parser residual (wave-309)", () => {
  it("findActiveMention cursor past end uses lastIndexOf on prefix only; empty query at @ alone", () => {
    expect(findActiveMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(findActiveMention("hello@", 6)).toEqual({ start: 5, query: "" });
    // cursor in middle of token
    expect(findActiveMention("@abcdef", 4)).toEqual({ start: 0, query: "abc" });
    // newline is whitespace → null
    expect(findActiveMention("@a" + String.fromCharCode(10) + "b", 4)).toBeNull();
    // no @ in before-cursor slice
    expect(findActiveMention("abc", 3)).toBeNull();
    // cursor 4 is on space after @b → between includes space → null
    expect(findActiveMention("a@b c@d", 4)).toBeNull();
    // cursor 3 ends at "b" → active
    expect(findActiveMention("a@b c@d", 3)).toEqual({ start: 1, query: "b" });
    // second @ at index 5
    expect(findActiveMention("a@b c@d", 7)).toEqual({ start: 5, query: "d" });
  });

  it("resolveMention concatenates prefix + @path + suffix after query; multi-byte path ok", () => {
    expect(resolveMention("x@y z", { start: 1, query: "y" }, "路径/文件.ts")).toBe("x@路径/文件.ts z");
    // match longer than remaining suffix still slices by computed end
    expect(resolveMention("@ab", { start: 0, query: "ab" }, "cd")).toBe("@cd");
    // filePath without leading @ — product always prefixes @
    expect(resolveMention("t@", { start: 1, query: "" }, "p")).toBe("t@p");
  });
});

});
