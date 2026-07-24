import { describe, expect, it } from "vitest";
import { wildcardMatch } from "../wildcard";

describe("wildcardMatch", () => {
  it("matches exact strings", () => {
    expect(wildcardMatch("read", "read")).toBe(true);
    expect(wildcardMatch("write", "read")).toBe(false);
  });

  it("supports * and ? wildcards", () => {
    expect(wildcardMatch(".env", "*.env")).toBe(true);
    expect(wildcardMatch("local.env", "*.env")).toBe(true);
    expect(wildcardMatch("a", "?")).toBe(true);
    expect(wildcardMatch("ab", "?")).toBe(false);
  });

  it("treats trailing ' *' as optional args", () => {
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("ls -la", "ls *")).toBe(true);
    expect(wildcardMatch("lsof", "ls *")).toBe(false);
  });

  it("normalizes backslashes and is case-insensitive on win32", () => {
    expect(wildcardMatch("C:\\Users\\x", "c:/users/x")).toBe(true);
    expect(wildcardMatch("Foo", "foo")).toBe(true);
  });


  // wave-89 residual
  it("matches empty string only against empty or full-wildcard patterns", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("", "a")).toBe(false);
    expect(wildcardMatch("a", "")).toBe(false);
  });

  it("escapes regex metacharacters in patterns", () => {
    expect(wildcardMatch("a+b", "a+b")).toBe(true);
    expect(wildcardMatch("a+b", "a.+b")).toBe(false); // + is literal after escape; . is ?
    expect(wildcardMatch("file.txt", "file.txt")).toBe(true);
    expect(wildcardMatch("fileXtxt", "file.txt")).toBe(false);
  });

  it("lets * span path segments (dotall), matching nested paths", () => {
    expect(wildcardMatch("src/app/main.ts", "src/*/main.ts")).toBe(true);
    // with /s flag, .* spans '/', so deeper nests still match a single *
    expect(wildcardMatch("src/app/util/main.ts", "src/*/main.ts")).toBe(true);
    expect(wildcardMatch("other/app/main.ts", "src/*/main.ts")).toBe(false);
  });

  it("trailing space-star does not match different command prefixes", () => {
    expect(wildcardMatch("git status", "git *")).toBe(true);
    expect(wildcardMatch("gitignore", "git *")).toBe(false);
    expect(wildcardMatch("git", "git *")).toBe(true);
  });

  // wave-112 residual
  it("supports leading and multi-star patterns", () => {
    expect(wildcardMatch("src/app.ts", "*app.ts")).toBe(true);
    expect(wildcardMatch("src/app.ts", "src/*")).toBe(true);
    expect(wildcardMatch("a/b/c", "*/*/*")).toBe(true);
    expect(wildcardMatch("a/b", "*/*/*")).toBe(false);
  });

  it("supports mixed ? and * patterns", () => {
    expect(wildcardMatch("a1b", "a?b")).toBe(true);
    expect(wildcardMatch("ab", "a?b")).toBe(false);
    expect(wildcardMatch("file12.txt", "file??.txt")).toBe(true);
    expect(wildcardMatch("file1.txt", "file??.txt")).toBe(false);
  });

  it("normalizes mixed separators in both subject and pattern", () => {
    expect(wildcardMatch("C:/Users\\demo\\x", "c:/users/demo/x")).toBe(true);
    expect(wildcardMatch("src\\pkg\\main.ts", "src/*/main.ts")).toBe(true);
  });

  // wave-121 residual
  it("treats multiple spaces before trailing * as literal (only single space-star is optional)", () => {
    // product only rewrites patterns ending with " .*" after escape (space + *)
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("ls", "ls  *")).toBe(false);
    expect(wildcardMatch("ls  -la", "ls  *")).toBe(true);
  });

  it("matches character classes only as literals after escape", () => {
    expect(wildcardMatch("a[b]", "a[b]")).toBe(true);
    expect(wildcardMatch("ab", "a[b]")).toBe(false);
    expect(wildcardMatch("a{1}", "a{1}")).toBe(true);
  });

  it("anchors full-string match so partial subjects fail", () => {
    expect(wildcardMatch("prefix-read", "read")).toBe(false);
    expect(wildcardMatch("read-suffix", "read")).toBe(false);
    expect(wildcardMatch("read", "read")).toBe(true);
  });

  it("supports consecutive wildcards", () => {
    expect(wildcardMatch("abcdef", "a*c*f")).toBe(true);
    expect(wildcardMatch("ab", "a**b")).toBe(true);
    expect(wildcardMatch("axyb", "a??b")).toBe(true);
  });

  // wave-131 residual
  it("treats empty string subject as non-match for non-empty pattern", () => {
    expect(wildcardMatch("", "a")).toBe(false);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("x", "")).toBe(false);
  });

  it("optional trailing args only for single space-star suffix", () => {
    expect(wildcardMatch("git", "git *")).toBe(true);
    expect(wildcardMatch("git status", "git *")).toBe(true);
    expect(wildcardMatch("git", "git*")).toBe(true);
    expect(wildcardMatch("gita", "git *")).toBe(false);
  });

  it("case sensitivity follows platform", () => {
    const match = wildcardMatch("Read.Me", "read.me");
    if (process.platform === "win32") {
      expect(match).toBe(true);
    } else {
      expect(match).toBe(false);
    }
  });

  // wave-150 residual
  it("normalizes mixed separators on both subject and pattern", () => {
    expect(wildcardMatch("C:\\repo\\src\\a.ts", "C:/repo/src/*.ts")).toBe(true);
    expect(wildcardMatch("C:/repo/src/a.ts", "C:\\repo\\src\\*.ts")).toBe(true);
    expect(wildcardMatch("C:\\repo\\src\\b.js", "C:/repo/src/*.ts")).toBe(false);
  });

  it("escapes braces and pipes so they are literal, not regex groups", () => {
    expect(wildcardMatch("a{b}c", "a{b}c")).toBe(true);
    expect(wildcardMatch("abc", "a{b}c")).toBe(false);
    expect(wildcardMatch("a|b", "a|b")).toBe(true);
    expect(wildcardMatch("a", "a|b")).toBe(false);
  });

  it("single-char ? is one char including slash (dotall flags)", () => {
    // product: ? → . with /s so slash is matched; length still exact
    expect(wildcardMatch("a/b", "a?b")).toBe(true);
    expect(wildcardMatch("aXb", "a?b")).toBe(true);
    expect(wildcardMatch("ab", "a?b")).toBe(false);
    expect(wildcardMatch("axyb", "a?b")).toBe(false);
  });

  // wave-155 residual
  it("escapes regex metacharacters so they are literal", () => {
    expect(wildcardMatch("a+b", "a+b")).toBe(true);
    expect(wildcardMatch("ab", "a+b")).toBe(false);
    expect(wildcardMatch("a.b", "a.b")).toBe(true);
    expect(wildcardMatch("axb", "a.b")).toBe(false);
    expect(wildcardMatch("a(b)", "a(b)")).toBe(true);
    expect(wildcardMatch("a[b]", "a[b]")).toBe(true);
  });

  it("matches multi-segment * and requires full-string match", () => {
    expect(wildcardMatch("src/foo/bar.ts", "src/**/*.ts")).toBe(true); // * → .* so ** is .* .*
    expect(wildcardMatch("src/foo/bar.ts", "src/*.ts")).toBe(true); // * spans /
    expect(wildcardMatch("src/foo/bar.ts", "src/foo/bar.tsx")).toBe(false);
    expect(wildcardMatch("prefix-src/foo", "src/*")).toBe(false);
  });

  it("optional trailing space-star does not apply without space before *", () => {
    expect(wildcardMatch("ls", "ls*")).toBe(true);
    expect(wildcardMatch("lsx", "ls*")).toBe(true);
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("lsx", "ls *")).toBe(false);
  });

  // wave-161 residual
  it("normalizes backslashes and is case-insensitive on win32", () => {
    expect(wildcardMatch("C:\\Users\\docs\\a.ts", "c:/users/docs/*")).toBe(true);
    expect(wildcardMatch("Src/Auth.ts", "src/*.ts")).toBe(true);
    expect(wildcardMatch("SRC\\FOO", "src/*")).toBe(true);
  });

  it("empty pattern and empty string require exact empty match", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("a", "")).toBe(false);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("", "?")).toBe(false);
  });

  it("trailing space-star optional args match bare command and one arg group", () => {
    expect(wildcardMatch("git status", "git *")).toBe(true);
    expect(wildcardMatch("git", "git *")).toBe(true);
    expect(wildcardMatch("git", "git*")).toBe(true);
    expect(wildcardMatch("gita", "git *")).toBe(false);
  });

  // wave-183 residual
  it("matches CJK and multi-byte unicode under * and ?", () => {
    expect(wildcardMatch("说明.md", "*.md")).toBe(true);
    expect(wildcardMatch("路径/中文.ts", "路径/*")).toBe(true);
    expect(wildcardMatch("文", "?")).toBe(true);
    expect(wildcardMatch("文件", "?")).toBe(false);
    expect(wildcardMatch("文件", "??")).toBe(true);
  });

  it("escapes $ ^ and braces as literals; * still expands after escape pass", () => {
    expect(wildcardMatch("$HOME", "$HOME")).toBe(true);
    expect(wildcardMatch("HOME", "$HOME")).toBe(false);
    expect(wildcardMatch("a{b}", "a{b}")).toBe(true);
    expect(wildcardMatch("^start", "^start")).toBe(true);
    expect(wildcardMatch("foo$bar", "foo$bar")).toBe(true);
  });

  it("nullish str skips normalize and still matches *; null pattern throws on replace", () => {
    // product: if (str) only normalizes truthy strings; null is falsey so skip replaceAll
    expect(wildcardMatch(null as never, "*")).toBe(true);
    expect(wildcardMatch(undefined as never, "*")).toBe(true);
    // pattern falsy skips normalize then calls pattern.replace → TypeError
    expect(() => wildcardMatch("a", null as never)).toThrow();
    expect(() => wildcardMatch("a", undefined as never)).toThrow();
  });


  // wave-216 residual
  it("matches multi-line subjects with /s and anchors full string", () => {
    expect(wildcardMatch("a\nb", "a*b")).toBe(true);
    expect(wildcardMatch("a\nb\nc", "a*c")).toBe(true);
    expect(wildcardMatch("prefix\na\nb", "a*b")).toBe(false);
  });

  it("optional trailing space-star does not match extra leading spaces on subject", () => {
    expect(wildcardMatch("  ls", "ls *")).toBe(false);
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("ls   -la", "ls *")).toBe(true);
  });

  it("literal dots in pattern do not act as regex wildcards after escape", () => {
    expect(wildcardMatch("file.txt", "file.txt")).toBe(true);
    expect(wildcardMatch("fileXtxt", "file.txt")).toBe(false);
    expect(wildcardMatch("file.txt.bak", "file.txt")).toBe(false);
    expect(wildcardMatch("file.txt.bak", "file.txt*")).toBe(true);
  });


  // wave-223 residual
  it("question mark is single char; star spans empty; windows path slash normalize both sides", () => {
    expect(wildcardMatch("abc", "a?c")).toBe(true);
    expect(wildcardMatch("ac", "a?c")).toBe(false);
    expect(wildcardMatch("abbc", "a*c")).toBe(true);
    expect(wildcardMatch("ac", "a*c")).toBe(true);
    expect(wildcardMatch("C:/Users/x/y", "C:\\Users\\x\\y")).toBe(true);
    expect(wildcardMatch("C:\\Users\\x\\y", "C:/Users/x/y")).toBe(true);
  });

  it("regex specials in subject do not gain meaning; pattern specials are escaped", () => {
    expect(wildcardMatch("a(b)", "a(b)")).toBe(true);
    expect(wildcardMatch("a(b)", "a.*")).toBe(false); // . is literal after escape of .
    expect(wildcardMatch("aXb", "a?b")).toBe(true);
    expect(wildcardMatch("a.b", "a.b")).toBe(true);
    expect(wildcardMatch("aXb", "a.b")).toBe(false);
  });

  it("permission-style tool patterns with optional args", () => {
    expect(wildcardMatch("bash", "bash *")).toBe(true);
    expect(wildcardMatch("bash -lc ls", "bash *")).toBe(true);
    expect(wildcardMatch("bashx", "bash *")).toBe(false);
    expect(wildcardMatch("read", "re?d")).toBe(true);
  });

  // wave-234 residual
  it("empty string subject/pattern and full-string star", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("x", "")).toBe(false);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("anything", "*")).toBe(true);
    expect(wildcardMatch("", "a*")).toBe(false);
  });

  it("trailing space-star only makes optional when pattern ends with ' *' after escape", () => {
    // product: escaped endsWith(" .*") from original " *"
    expect(wildcardMatch("cmd", "cmd *")).toBe(true);
    expect(wildcardMatch("cmd", "cmd*")).toBe(true); // * is greedy, still matches
    expect(wildcardMatch("cmdx", "cmd *")).toBe(false);
    expect(wildcardMatch("cmd x", "cmd *")).toBe(true);
  });

  it("case-insensitive on win32 for mixed drive and filename patterns", () => {
    expect(wildcardMatch("C:/FOO/bar.ENV", "c:/foo/*.env")).toBe(true);
    expect(wildcardMatch("c:\\foo\\Bar.env", "C:/foo/*.ENV")).toBe(true);
    expect(wildcardMatch("readme", "READ*")).toBe(true);
  });

      // wave-243 residual
  it("normalizes backslashes in both subject and pattern before match", () => {
    expect(wildcardMatch("C:" + "\\" + "Users" + "\\" + "x" + "\\" + "a.ts", "C:/Users/*/a.ts")).toBe(true);
    expect(wildcardMatch("C:/Users/x/a.ts", "C:" + "\\" + "Users" + "\\" + "*" + "\\" + "a.ts")).toBe(true);
    expect(wildcardMatch("a" + "\\" + "b" + "\\" + "c", "a/b/c")).toBe(true);
  });

  it("? is single char; * is greedy; escaped regex metachar in pattern is literal", () => {
    expect(wildcardMatch("abc", "a?c")).toBe(true);
    expect(wildcardMatch("ac", "a?c")).toBe(false);
    expect(wildcardMatch("a+b", "a+b")).toBe(true);
    expect(wildcardMatch("ab", "a+b")).toBe(false);
    expect(wildcardMatch("file.txt", "*.txt")).toBe(true);
    expect(wildcardMatch("file.txt.bak", "*.txt")).toBe(false);
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("ls -la", "ls *")).toBe(true);
    expect(wildcardMatch("lsa", "ls *")).toBe(false);
  });

  // wave-252 residual
  it("regex metacharacters in subject are literal; anchors are full-string only", () => {
    expect(wildcardMatch("a.b", "a.b")).toBe(true);
    expect(wildcardMatch("axb", "a.b")).toBe(false);
    expect(wildcardMatch("a(b)", "a(b)")).toBe(true);
    expect(wildcardMatch("prefix-a.b", "a.b")).toBe(false);
    expect(wildcardMatch("a.b-suffix", "a.b")).toBe(false);
    expect(wildcardMatch("a$b", "a$b")).toBe(true);
    expect(wildcardMatch("a^b", "a^b")).toBe(true);
  });

  it("multi-star path globs are greedy (dotall); optional trailing args with extra spaces", () => {
    // product: * → .* with /s, so a single * spans path segments
    expect(wildcardMatch("src/a/b.ts", "src/*/*.ts")).toBe(true);
    expect(wildcardMatch("src/a/b/c.ts", "src/*/*.ts")).toBe(true);
    expect(wildcardMatch("src/a/b.ts", "src/*/b.ts")).toBe(true);
    expect(wildcardMatch("other/a/b.ts", "src/*/*.ts")).toBe(false);
    expect(wildcardMatch("npm  run  build", "npm *")).toBe(true);
    expect(wildcardMatch("npm", "npm *")).toBe(true);
    expect(wildcardMatch("npmx", "npm *")).toBe(false);
  });

  // wave-266 residual
  it("empty subject/pattern edges; bare * matches non-empty and empty", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("x", "")).toBe(false);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("anything", "*")).toBe(true);
    expect(wildcardMatch("a", "?")).toBe(true);
    expect(wildcardMatch("ab", "?")).toBe(false);
  });

  it("Windows path case-insensitivity when platform is win32", () => {
    if (process.platform !== "win32") return;
    expect(wildcardMatch("C:/Users/X/A.TS", "c:/users/*/a.ts")).toBe(true);
    expect(wildcardMatch("Src/Main.ts", "src/*.ts")).toBe(true);
  });

  // wave-275 residual
  it("backslash path segments normalize to forward slash before match", () => {
    expect(wildcardMatch("src\\a.ts", "src/a.ts")).toBe(true);
    expect(wildcardMatch("src\\nested\\x.ts", "src/*/*.ts")).toBe(true);
    expect(wildcardMatch("src\\nested\\x.ts", "src/*/x.ts")).toBe(true);
    expect(wildcardMatch("other\\x.ts", "src/*")).toBe(false);
  });

  it("trailing space-star makes trailing args optional only at end", () => {
    expect(wildcardMatch("git", "git *")).toBe(true);
    expect(wildcardMatch("git status", "git *")).toBe(true);
    expect(wildcardMatch("git  status", "git *")).toBe(true);
    expect(wildcardMatch("gits", "git *")).toBe(false);
    // space-star mid-pattern is not special-cased as optional
    expect(wildcardMatch("a b c", "a * c")).toBe(true);
    expect(wildcardMatch("ac", "a * c")).toBe(false);
  });

  // wave-284 residual
  it("escapes regex metacharacters in literal patterns; ? matches single char only", () => {
    expect(wildcardMatch("a+b", "a+b")).toBe(true);
    expect(wildcardMatch("a+b", "a*b")).toBe(true);
    expect(wildcardMatch("file.txt", "file.txt")).toBe(true);
    expect(wildcardMatch("fileXtxt", "file.txt")).toBe(false); // . is literal after escape
    expect(wildcardMatch("abc", "a?c")).toBe(true);
    expect(wildcardMatch("ac", "a?c")).toBe(false);
    expect(wildcardMatch("abbc", "a?c")).toBe(false);
  });

  it("win32 case-insensitive flag; trailing space-star optional args for bare command", () => {
    if (process.platform === "win32") {
      expect(wildcardMatch("Read", "read")).toBe(true);
      expect(wildcardMatch("SRC/App.TS", "src/*.ts")).toBe(true);
    }
    expect(wildcardMatch("ls", "ls *")).toBe(true);
    expect(wildcardMatch("ls -la", "ls *")).toBe(true);
    expect(wildcardMatch("lsa", "ls *")).toBe(false);
  });




  // wave-297 residual
  it("* is .* so single-star spans path segments; ** is just two stars", () => {
    // product: * → .* (not segment-limited)
    expect(wildcardMatch("src/a/b.ts", "src/*.ts")).toBe(true);
    expect(wildcardMatch("src/a/b.ts", "src/**/*.ts")).toBe(true);
    expect(wildcardMatch("src/a.ts", "src/**")).toBe(true);
    expect(wildcardMatch("other/a.ts", "src/*")).toBe(false);
  });

  it("empty string and empty pattern edge cases", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("a", "")).toBe(false);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("", "a*")).toBe(false);
  });

  it("permission-style patterns used by evaluate: bash vs bash *", () => {
    expect(wildcardMatch("bash", "bash")).toBe(true);
    expect(wildcardMatch("bash", "bash *")).toBe(true);
    expect(wildcardMatch("bash -lc ls", "bash *")).toBe(true);
    expect(wildcardMatch("bashx", "bash")).toBe(false);
    expect(wildcardMatch("edit", "*")).toBe(true);
  });


  // wave-321 residual
  it("normalizes backslashes to forward slashes before matching", () => {
    const bs = String.fromCharCode(92);
    expect(wildcardMatch(["C:", "Users", "x", "a.ts"].join(bs), "C:/Users/x/a.ts")).toBe(true);
    expect(wildcardMatch(["src", "foo"].join(bs), "src/foo")).toBe(true);
    expect(wildcardMatch("src/foo", ["src", "foo"].join(bs))).toBe(true);
  });

  it("escapes regex metacharacters in pattern; * and ? remain wildcards", () => {
    expect(wildcardMatch("a+b", "a+b")).toBe(true);
    expect(wildcardMatch("a+b", "a*b")).toBe(true);
    expect(wildcardMatch("file.txt", "file.txt")).toBe(true);
    expect(wildcardMatch("fileXtxt", "file.txt")).toBe(false);
    expect(wildcardMatch("ab", "a?")).toBe(true);
    expect(wildcardMatch("a", "a?")).toBe(false);
  });

  it("trailing space-star makes optional args; bare * matches empty and any", () => {
    expect(wildcardMatch("git", "git *")).toBe(true);
    expect(wildcardMatch("git status", "git *")).toBe(true);
    expect(wildcardMatch("gitignore", "git *")).toBe(false);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("anything", "*")).toBe(true);
  });


});
