import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyScore } from "./fuzzy-match";

describe("fuzzyScore / fuzzyMatch", () => {
  it("empty query scores as full match", () => {
    expect(fuzzyScore("anything", "")).toBe(1);
    expect(fuzzyMatch("anything", "")).toBe(true);
  });

  it("prefix substring scores 100", () => {
    expect(fuzzyScore("src/app.ts", "src")).toBe(100);
    expect(fuzzyMatch("src/app.ts", "src")).toBe(true);
  });

  it("segment-boundary substring scores 75", () => {
    expect(fuzzyScore("src/app.ts", "app")).toBe(75);
    expect(fuzzyScore("foo-bar.ts", "bar")).toBe(75);
    expect(fuzzyScore("foo\\bar.ts", "bar")).toBe(75);
  });

  it("mid-token substring scores 50", () => {
    expect(fuzzyScore("application.ts", "plica")).toBe(50);
  });

  it("ordered character match scores 25", () => {
    expect(fuzzyScore("src/components/ChatView.tsx", "scv")).toBe(25);
    expect(fuzzyMatch("src/components/ChatView.tsx", "scv")).toBe(true);
  });

  it("no match scores 0", () => {
    expect(fuzzyScore("readme.md", "xyz")).toBe(0);
    expect(fuzzyMatch("readme.md", "xyz")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("PlanMode.ts", "plan")).toBe(100);
    // "mode" is mid-token inside PlanMode → 50 (not segment boundary)
    expect(fuzzyScore("PlanMode.ts", "MODE")).toBe(50);
    expect(fuzzyScore("foo-Bar.ts", "BAR")).toBe(75);
  });

  // wave-108 residual
  it("does not treat underscore as a segment boundary", () => {
    expect(fuzzyScore("foo_bar.ts", "bar")).toBe(50);
    expect(fuzzyMatch("foo_bar.ts", "bar")).toBe(true);
  });

  it("scores empty text only for empty query", () => {
    expect(fuzzyScore("", "")).toBe(1);
    expect(fuzzyMatch("", "")).toBe(true);
    expect(fuzzyScore("", "a")).toBe(0);
    expect(fuzzyMatch("", "a")).toBe(false);
  });

  // wave-113 residual
  it("scores query equal to full text as prefix 100", () => {
    expect(fuzzyScore("App.tsx", "App.tsx")).toBe(100);
    expect(fuzzyScore("App.tsx", "app.tsx")).toBe(100);
  });

  it("prefers first substring occurrence for segment scoring", () => {
    // first "app" is mid-token in "wrapperapp"; product uses indexOf first hit only
    expect(fuzzyScore("wrapperapp/app.ts", "app")).toBe(50);
    expect(fuzzyScore("src/app/app.ts", "app")).toBe(75);
  });

  it("requires ordered characters for fuzzy 25 score", () => {
    expect(fuzzyScore("abc", "cba")).toBe(0);
    expect(fuzzyScore("alpha-beta", "ab")).toBe(25);
    expect(fuzzyMatch("alpha-beta", "ab")).toBe(true);
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

  // wave-140 residual
  it("scores CJK substring matches using the same segment-boundary rules", () => {
    expect(fuzzyScore("会话列表.tsx", "会话")).toBe(100);
    // '/' is a segment boundary → 75 (product: only / \\ - count)
    expect(fuzzyScore("组件/会话列表.tsx", "会话")).toBe(75);
    // hyphen remains a segment boundary even for CJK following text
    expect(fuzzyScore("app-会话.ts", "会话")).toBe(75);
    // mid-token CJK (no boundary before 列表)
    expect(fuzzyScore("组件会话列表.tsx", "列表")).toBe(50);
    expect(fuzzyMatch("组件/会话列表.tsx", "列表")).toBe(true);
  });

  it("prefers stronger substring score over ordered-character fallback", () => {
    // "app" is a segment → 75; ordered chars would also match but substring wins first
    expect(fuzzyScore("src/app.ts", "app")).toBe(75);
    // no substring but ordered chars still score 25
    expect(fuzzyScore("src/application.ts", "sat")).toBe(25);
    // missing ordered char → 0
    expect(fuzzyScore("src/application.ts", "sxz")).toBe(0);
  });

  it("treats longer-than-text queries as no match unless equal after lowercasing", () => {
    expect(fuzzyScore("ab", "abc")).toBe(0);
    expect(fuzzyMatch("ab", "abc")).toBe(false);
    expect(fuzzyScore("ABC", "abc")).toBe(100);
  });

  it("does not treat '.' as a segment boundary for path-like names", () => {
    // product boundaries are only / \\ - — '.' keeps mid-token 50
    expect(fuzzyScore(".config/.env.local", "env")).toBe(50);
    expect(fuzzyScore(".env.local", "env")).toBe(50);
    expect(fuzzyScore("foo-bar-baz", "bar")).toBe(75);
    expect(fuzzyScore("foo-bar-baz", "baz")).toBe(75);
    // after path separator is still segment 75
    expect(fuzzyScore("dir/env.local", "env")).toBe(75);
  });

  // wave-152 residual
  it("does not treat underscore or space as segment boundaries", () => {
    expect(fuzzyScore("foo_bar.ts", "bar")).toBe(50);
    expect(fuzzyScore("foo bar.ts", "bar")).toBe(50);
    expect(fuzzyScore("foo-bar.ts", "bar")).toBe(75);
    expect(fuzzyMatch("foo_bar.ts", "bar")).toBe(true);
  });

  it("empty query scores 1 (match) for any text including empty", () => {
    expect(fuzzyScore("anything", "")).toBe(1);
    expect(fuzzyScore("", "")).toBe(1);
    expect(fuzzyMatch("anything", "")).toBe(true);
    expect(fuzzyMatch("", "")).toBe(true);
  });

  it("ordered-character fallback is case-insensitive and requires full query coverage", () => {
    expect(fuzzyScore("UserLoginService", "ULS")).toBe(25);
    expect(fuzzyScore("UserLoginService", "uls")).toBe(25);
    // product: any forward subsequence matches; reverse-order U after S fails
    expect(fuzzyScore("UserLoginService", "SUL")).toBe(0);
    expect(fuzzyScore("UserLoginService", "xyz")).toBe(0);
    expect(fuzzyMatch("UserLoginService", "uls")).toBe(true);
  });

  // wave-158 residual
  it("prefix exact scores 100; CJK after slash is segment 75; mid-token 50", () => {
    expect(fuzzyScore("readme.md", "readme")).toBe(100);
    // "说明" starts after path separator → 75
    expect(fuzzyScore("文档/说明.md", "说明")).toBe(75);
    expect(fuzzyScore("文档/说明.md", "文档")).toBe(100);
    // mid-token CJK (no boundary before match)
    expect(fuzzyScore("项目说明文档", "说明")).toBe(50);
    expect(fuzzyMatch("文档/说明.md", "说明")).toBe(true);
  });

  it("backslash segment boundary scores 75 like forward slash", () => {
    expect(fuzzyScore("src\\utils\\a.ts", "utils")).toBe(75);
    expect(fuzzyScore("src\\utils\\a.ts", "a")).toBe(75);
    expect(fuzzyScore("src\\utils\\a.ts", "src")).toBe(100);
  });

  it("fuzzyMatch is true only when score > 0", () => {
    expect(fuzzyMatch("abc", "z")).toBe(false);
    expect(fuzzyMatch("abc", "a")).toBe(true);
    expect(fuzzyMatch("abc", "ac")).toBe(true); // ordered 25
    expect(fuzzyScore("abc", "ac")).toBe(25);
  });

  // wave-178 residual
  it("whitespace in query is significant (not trimmed) for exact/prefix scoring", () => {
    // product does not trim query — " a" will not match as prefix of "abc"
    expect(fuzzyScore("abc", " a")).toBe(0);
    expect(fuzzyMatch("abc", " a")).toBe(false);
    expect(fuzzyScore(" a", " a")).toBe(100);
  });

  it("unicode multi-codepoint queries score via ordered-char fallback when not contiguous", () => {
    expect(fuzzyScore("你好世界", "你世")).toBe(25);
    expect(fuzzyMatch("你好世界", "你世")).toBe(true);
    expect(fuzzyScore("你好世界", "世界")).toBe(50); // mid-token contiguous
  });

  it("query longer than text fails unless equal", () => {
    expect(fuzzyScore("ab", "abc")).toBe(0);
    expect(fuzzyScore("abc", "abc")).toBe(100);
    expect(fuzzyMatch("ab", "abc")).toBe(false);
  });

  // wave-189 residual (parity with main fuzzy wave-188)
  it("empty query scores 1; first indexOf wins; underscore is not segment boundary", () => {
    expect(fuzzyScore("", "")).toBe(1);
    expect(fuzzyScore("anything", "")).toBe(1);
    expect(fuzzyMatch("anything", "")).toBe(true);
    expect(fuzzyScore("wrapperapp/app.ts", "app")).toBe(50);
    expect(fuzzyScore("foo_bar", "bar")).toBe(50);
    expect(fuzzyScore("foo-bar", "bar")).toBe(75);
    expect(fuzzyScore("foo/bar", "bar")).toBe(75);
    expect(fuzzyScore("foo\\bar", "bar")).toBe(75);
  });

  // wave-203 residual (parity with main fuzzy wave-203)
  it("first mid-token indexOf wins over later hyphen segment", () => {
    expect(fuzzyScore("foobar-bar", "bar")).toBe(50);
    expect(fuzzyScore("-bar", "bar")).toBe(75);
    expect(fuzzyScore("x-bar", "bar")).toBe(75);
  });

  it("empty text only matches empty query; single-char prefix and mid-token", () => {
    expect(fuzzyScore("", "x")).toBe(0);
    expect(fuzzyMatch("", "x")).toBe(false);
    expect(fuzzyScore("a", "a")).toBe(100);
    expect(fuzzyScore("ab", "a")).toBe(100);
    expect(fuzzyScore("ba", "a")).toBe(50);
    expect(fuzzyScore("zx", "a")).toBe(0);
  });

  // wave-210 residual (parity main)
  it("case-insensitive full match and ordered camel initials score 25", () => {
    expect(fuzzyScore("FooBar", "foobar")).toBe(100);
    expect(fuzzyScore("FooBar", "FOOBAR")).toBe(100);
    expect(fuzzyScore("MyComponent.tsx", "mc")).toBe(25);
    expect(fuzzyMatch("MyComponent.tsx", "mc")).toBe(true);
    expect(fuzzyScore("MyComponent.tsx", "xyz")).toBe(0);
    expect(fuzzyScore("abc", "cba")).toBe(0);
    expect(fuzzyScore("path/to/file", "ptf")).toBe(25);
  });

  // wave-217 residual (parity main)
  it("segment boundary / \\ - score 75; space/underscore mid-token 50", () => {
    expect(fuzzyScore("src/app.ts", "app")).toBe(75);
    expect(fuzzyScore("src\\app.ts", "app")).toBe(75);
    expect(fuzzyScore("src-app.ts", "app")).toBe(75);
    expect(fuzzyScore("src app.ts", "app")).toBe(50);
    expect(fuzzyScore("src_app.ts", "app")).toBe(50);
  });

  it("ordered-char requires all query chars in order; missing char scores 0", () => {
    expect(fuzzyScore("abcdef", "ace")).toBe(25);
    expect(fuzzyScore("abcdef", "aec")).toBe(0);
    expect(fuzzyScore("abcdef", "ax")).toBe(0);
    expect(fuzzyMatch("abcdef", "ace")).toBe(true);
    expect(fuzzyMatch("abcdef", "aec")).toBe(false);
  });

  // wave-269 residual
  it("empty query scores 1 and matches; whitespace query is non-empty", () => {
    expect(fuzzyScore("anything", "")).toBe(1);
    expect(fuzzyMatch("anything", "")).toBe(true);
    expect(fuzzyScore("abc", " ")).toBe(0);
    expect(fuzzyMatch("abc", " ")).toBe(false);
  });

  it("prefix beats mid-token; ordered-char only when substring fails", () => {
    expect(fuzzyScore("readme.md", "read")).toBe(100);
    expect(fuzzyScore("my-readme.md", "read")).toBe(75);
    expect(fuzzyScore("myreadme.md", "read")).toBe(50);
    // no contiguous "rdm" substring → ordered char score 25
    expect(fuzzyScore("readme.md", "rdm")).toBe(25);
    expect(fuzzyMatch("readme.md", "rdm")).toBe(true);
  });


  // wave-278 residual
  it("parity with main: empty query 1; path segment 75; ordered 25", () => {
    expect(fuzzyScore("x", "")).toBe(1);
    expect(fuzzyScore("a/b/c.ts", "b")).toBe(75);
    expect(fuzzyScore("CamelCase", "cc")).toBe(25);
    expect(fuzzyMatch("CamelCase", "cc")).toBe(true);
  });

  it("substring mid-token is 50; prefix is 100", () => {
    expect(fuzzyScore("myfile.ts", "file")).toBe(50);
    expect(fuzzyScore("file.ts", "file")).toBe(100);
    expect(fuzzyMatch("myfile.ts", "file")).toBe(true);
  });

});


// wave-298 residual
describe("fuzzy-match residual (wave-298)", () => {
  it("score ladder: exact/prefix 100, path segment 75, substring 50, ordered 25, miss 0", () => {
    expect(fuzzyScore("alpha", "alpha")).toBe(100);
    expect(fuzzyScore("alpha", "alp")).toBe(100);
    expect(fuzzyScore("pkg/alpha.ts", "alpha")).toBe(75);
    expect(fuzzyScore("myalpha.ts", "alpha")).toBe(50);
    expect(fuzzyScore("axlxpxhxa", "alpha")).toBe(25);
    expect(fuzzyScore("alpha", "xyz")).toBe(0);
    expect(fuzzyMatch("alpha", "xyz")).toBe(false);
  });

  it("empty query matches with score 1; case-insensitive matching", () => {
    expect(fuzzyScore("Anything", "")).toBe(1);
    expect(fuzzyMatch("Anything", "")).toBe(true);
    expect(fuzzyScore("ReadMe.MD", "readme")).toBe(100);
    expect(fuzzyMatch("ReadMe.MD", "README")).toBe(true);
  });

  it("ordered-char requires monotonic positions; reversed query scores 0", () => {
    expect(fuzzyScore("abcdef", "ace")).toBe(25);
    expect(fuzzyScore("abcdef", "aec")).toBe(0);
    expect(fuzzyMatch("abcdef", "aec")).toBe(false);
  });
});

// wave-313 residual
describe("fuzzy-match residual (wave-313)", () => {
  it("boundary scores after / \ - only; underscore mid-string is 50 not 75", () => {
    expect(fuzzyScore("src/utils/foo.ts", "foo")).toBe(75);
    expect(fuzzyScore("src" + String.fromCharCode(92) + "utils" + String.fromCharCode(92) + "foo.ts", "foo")).toBe(75);
    expect(fuzzyScore("pre-foo-bar", "foo")).toBe(75);
    expect(fuzzyScore("pre_foo_bar", "foo")).toBe(50);
    expect(fuzzyScore("foosball", "foo")).toBe(100);
  });

  it("fuzzyMatch is score>0; ordered camel initials score 25", () => {
    expect(fuzzyMatch("HelloWorld", "hw")).toBe(true);
    expect(fuzzyScore("HelloWorld", "hw")).toBe(25);
    expect(fuzzyMatch("HelloWorld", "wh")).toBe(false);
    expect(fuzzyScore("HelloWorld", "wh")).toBe(0);
    expect(fuzzyMatch("abc", "")).toBe(true);
  });
});
