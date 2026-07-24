import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "../fts-query";

/**
 * buildFtsQuery extracts the FTS5 query builder from
 * `services/long-horizon/database.ts` (the original `sanitizeFtsQuery`).
 *
 * Tokenization rule: contiguous runs of `[\p{L}\p{N}_]` (Unicode letters,
 * numbers, underscore) form one token. Each token is phrase-quoted (with
 * embedded `"` stripped to neutralize FTS5 special characters) and OR-joined
 * so BM25 can rank by token frequency/rarity.
 *
 * Empty input (or input with no usable tokens) returns `null` — callers must
 * NOT send `null` to MATCH, since an empty MATCH expression is a syntax error.
 */
describe("buildFtsQuery", () => {
    it("tokenizes an English multi-word query and OR-joins with phrase quotes", () => {
        expect(buildFtsQuery("hello world")).toBe('"hello" OR "world"');
    });

    it("keeps a CJK run as a single token (trigram-friendly, no splitting)", () => {
        // 权限管理 is four contiguous CJK chars → one token. The trigram
        // tokenizer on the index side will produce 2-char trigrams; matching
        // the whole 4-char phrase as one MATCH token lets BM25 rank it.
        expect(buildFtsQuery("权限管理")).toBe('"权限管理"');
    });

    it("tokenizes a mixed English/CJK query into separate OR-joined tokens", () => {
        expect(buildFtsQuery("FTS5 搜索")).toBe('"FTS5" OR "搜索"');
    });

    it("returns null for an empty string", () => {
        expect(buildFtsQuery("")).toBeNull();
    });

    it("returns null for a whitespace-only string", () => {
        expect(buildFtsQuery("   ")).toBeNull();
        expect(buildFtsQuery("\t\n")).toBeNull();
    });

    it("strips FTS5 special characters by treating non-word chars as token boundaries", () => {
        // Parens, colons, asterisks are NOT in [\p{L}\p{N}_], so they split
        // tokens. The resulting tokens are phrase-quoted, neutralizing any
        // remaining FTS5 metacharacters inside a token.
        expect(buildFtsQuery("test (asdf)")).toBe('"test" OR "asdf"');
    });

    it("collapses multiple spaces between tokens", () => {
        expect(buildFtsQuery("a  b")).toBe('"a" OR "b"');
    });

    it("returns null when the query contains only special characters", () => {
        // No usable word chars → no tokens → null. Callers treat this as
        // "empty query, no results" and skip the MATCH clause entirely.
        expect(buildFtsQuery("*()")).toBeNull();
        expect(buildFtsQuery(":\"")).toBeNull();
    });

    it("preserves underscores and digits within a token", () => {
        // [\p{L}\p{N}_] keeps underscores and digits as part of the token.
        expect(buildFtsQuery("my_var_2")).toBe('"my_var_2"');
        expect(buildFtsQuery("FTS5 v2")).toBe('"FTS5" OR "v2"');
    });

    it("strips embedded double quotes from tokens to avoid breaking the phrase quoting", () => {
        // The tokenizer doesn't match `"`, so a query like `say "hello"`
        // produces tokens ["say", "hello"] — the quotes are dropped at the
        // boundary. The `.replaceAll('"', "")` is a defense-in-depth for
        // any token that might contain an embedded quote (it can't, given
        // the regex, but the strip guarantees safety).
        expect(buildFtsQuery('say "hello"')).toBe('"say" OR "hello"');
    });

    it("produces a single-quoted token for a one-word query", () => {
        expect(buildFtsQuery("workflow")).toBe('"workflow"');
    });

    it("tokenizes a long mixed-language query into multiple OR-joined tokens", () => {
        expect(buildFtsQuery("OAuth 认证 workflow 沙箱")).toBe(
            '"OAuth" OR "认证" OR "workflow" OR "沙箱"',
        );
    });


    // wave-89 residual
    it("splits on embedded quotes into separate tokens", () => {
        expect(buildFtsQuery('he"llo wor"ld')).toBe('"he" OR "llo" OR "wor" OR "ld"');
    });

    it("keeps unicode letters beyond basic latin", () => {
        const q = buildFtsQuery("café naïve");
        expect(q).toContain('"café"');
        expect(q).toContain('"naïve"');
        expect(q).toContain(" OR ");
    });

    it("treats hyphen and slash as separators", () => {
        expect(buildFtsQuery("foo-bar/baz")).toBe('"foo" OR "bar" OR "baz"');
    });

    it("phrase-quotes letter tokens from operator-like input", () => {
        const q = buildFtsQuery("AND OR NOT *");
        expect(q).toBe('"AND" OR "OR" OR "NOT"');
        for (const part of q!.split(" OR ")) {
            expect(part.startsWith('"') && part.endsWith('"')).toBe(true);
        }
    });

    // wave-136 residual
    it("returns null for punctuation-only and emoji-only queries", () => {
        expect(buildFtsQuery("...!!!")).toBeNull();
        expect(buildFtsQuery("🔥🚀")).toBeNull();
        expect(buildFtsQuery("—–")).toBeNull();
    });

    it("keeps snake_case identifiers as one token", () => {
        expect(buildFtsQuery("agent_mode_store")).toBe('"agent_mode_store"');
    });

    it("splits Windows and POSIX path separators into path segments", () => {
        expect(buildFtsQuery("C:\\Users\\docs\\readme")).toBe(
            '"C" OR "Users" OR "docs" OR "readme"',
        );
        expect(buildFtsQuery("/home/user/file.txt")).toBe(
            '"home" OR "user" OR "file" OR "txt"',
        );
    });

    it("tokenizes email-like input without producing empty tokens", () => {
        expect(buildFtsQuery("dev@example.com")).toBe('"dev" OR "example" OR "com"');
    });

    it("preserves consecutive CJK without whitespace as one token", () => {
        expect(buildFtsQuery("多显示器缩放")).toBe('"多显示器缩放"');
    });

    it("handles leading/trailing separators without empty OR segments", () => {
        const q = buildFtsQuery("  ,hello,  world,  ");
        expect(q).toBe('"hello" OR "world"');
        expect(q!.includes('""')).toBe(false);
    });

    // wave-158 residual
    it("treats embedded double-quotes as token boundaries; strips quotes from phrase tokens", () => {
        // " is non-word → splits he / llo; stripAll on each token is no-op when quote is separator
        expect(buildFtsQuery('he"llo world')).toBe('"he" OR "llo" OR "world"');
        // surrounding quotes are separators; letter body remains one token
        expect(buildFtsQuery('"quoted"')).toBe('"quoted"');
        // quote inside alnum is still a separator (product: match word runs only)
        expect(buildFtsQuery('a""b')).toBe('"a" OR "b"');
    });

    it("returns null for whitespace-only and empty string", () => {
        expect(buildFtsQuery("")).toBeNull();
        expect(buildFtsQuery("   \t\n")).toBeNull();
    });

    it("OR-joins mixed alphanumeric and CJK tokens in order", () => {
        expect(buildFtsQuery("build 构建 v2")).toBe('"build" OR "构建" OR "v2"');
        expect(buildFtsQuery("T10.3.2")).toBe('"T10" OR "3" OR "2"');
    });

    it("neutralizes FTS5 operators by quoting tokens only", () => {
        expect(buildFtsQuery("foo*bar")).toBe('"foo" OR "bar"');
        expect(buildFtsQuery("a:b(c)")).toBe('"a" OR "b" OR "c"');
        expect(buildFtsQuery("NEAR/3 hello")).toBe('"NEAR" OR "3" OR "hello"');
    });

    // wave-166 residual
    it("treats underscores as word characters and hyphens as separators", () => {
        // product word class is letters/digits/underscore + CJK; hyphen splits
        expect(buildFtsQuery("foo_bar")).toBe('"foo_bar"');
        expect(buildFtsQuery("foo-bar")).toBe('"foo" OR "bar"');
        expect(buildFtsQuery("a_b-c_d")).toBe('"a_b" OR "c_d"');
    });

    it("returns single quoted token for pure digit and pure underscore runs", () => {
        expect(buildFtsQuery("42")).toBe('"42"');
        expect(buildFtsQuery("___")).toBe('"___"');
        expect(buildFtsQuery("v1_0")).toBe('"v1_0"');
    });

    it("does not emit empty OR segments for operator-only input", () => {
        expect(buildFtsQuery("***")).toBeNull();
        expect(buildFtsQuery("()::")).toBeNull();
        expect(buildFtsQuery("OR AND NOT")).toBe('"OR" OR "AND" OR "NOT"');
    });


    // wave-215 residual
    it("treats embedded double quotes as separators; strips residual quotes from tokens", () => {
        // product: quote is not in \p{L}\p{N}_ so it splits tokens; remaining " chars are stripped
        expect(buildFtsQuery('he"llo')).toBe('"he" OR "llo"');
        expect(buildFtsQuery('"quoted"')).toBe('"quoted"');
        expect(buildFtsQuery('a"b c"d')).toBe('"a" OR "b" OR "c" OR "d"');
    });

    it("preserves token order and drops pure-separator gaps", () => {
        expect(buildFtsQuery("  alpha   beta  gamma  ")).toBe('"alpha" OR "beta" OR "gamma"');
        expect(buildFtsQuery("...alpha...beta...")).toBe('"alpha" OR "beta"');
        expect(buildFtsQuery("中文 English 混合")).toBe('"中文" OR "English" OR "混合"');
    });

    it("single emoji-less punctuation returns null; mixed keeps alnum runs", () => {
        expect(buildFtsQuery("!!!")).toBeNull();
        expect(buildFtsQuery("v2.0.1")).toBe('"v2" OR "0" OR "1"');
        expect(buildFtsQuery("user@host")).toBe('"user" OR "host"');
    });


    // wave-223 residual
    it("underscores stay inside tokens; digits form tokens; hyphen splits", () => {
        expect(buildFtsQuery("foo_bar")).toBe('"foo_bar"');
        expect(buildFtsQuery("v1_2_3")).toBe('"v1_2_3"');
        expect(buildFtsQuery("foo-bar")).toBe('"foo" OR "bar"');
        expect(buildFtsQuery("123 456")).toBe('"123" OR "456"');
    });

    it("strips all embedded quotes from tokens before phrase quoting", () => {
        expect(buildFtsQuery('a""b')).toBe('"a" OR "b"');
        expect(buildFtsQuery('""')).toBeNull();
        expect(buildFtsQuery('x"y"z')).toBe('"x" OR "y" OR "z"');
    });

    it("tabs and newlines act as separators between unicode letter runs", () => {
        expect(buildFtsQuery("alpha\tbeta\ngamma")).toBe('"alpha" OR "beta" OR "gamma"');
        expect(buildFtsQuery("你好\n世界")).toBe('"你好" OR "世界"');
    });

    // wave-233 residual
    it("single letter and single digit tokens are phrase-quoted", () => {
        expect(buildFtsQuery("a")).toBe('"a"');
        expect(buildFtsQuery("7")).toBe('"7"');
        expect(buildFtsQuery("a 7 z")).toBe('"a" OR "7" OR "z"');
    });

    it("mixed separators collapse without empty OR slots", () => {
        expect(buildFtsQuery("foo...bar,,,baz")).toBe('"foo" OR "bar" OR "baz"');
        expect(buildFtsQuery("::alpha--beta::")).toBe('"alpha" OR "beta"');
        expect(buildFtsQuery("___")).toBe('"___"'); // underscore is a word char
    });

    it("returns null for pure whitespace and pure non-word punctuation", () => {
        expect(buildFtsQuery(" \t \n ")).toBeNull();
        expect(buildFtsQuery(".,;:!@#$%^&*()")).toBeNull();
        expect(buildFtsQuery('"""')).toBeNull();
    });

    // wave-243 residual
    it("phrase-quotes neutralize FTS operators inside tokens after strip of embedded quotes", () => {
        // tokens are word runs only; operators become separators
        expect(buildFtsQuery("foo*bar")).toBe('"foo" OR "bar"');
        expect(buildFtsQuery("a:b")).toBe('"a" OR "b"');
        expect(buildFtsQuery("(alpha)")).toBe('"alpha"');
        expect(buildFtsQuery("NOT AND OR")).toBe('"NOT" OR "AND" OR "OR"');
        // product: " is not a word char → splits tokens; residual quotes then stripped from each
        expect(buildFtsQuery('he"llo')).toBe('"he" OR "llo"');
        expect(buildFtsQuery('he""llo')).toBe('"he" OR "llo"');
    });

    it("unicode letters+digits+underscore stay one token; hyphen splits", () => {
        expect(buildFtsQuery("café123")).toBe('"café123"');
        expect(buildFtsQuery("foo_bar_baz")).toBe('"foo_bar_baz"');
        expect(buildFtsQuery("foo-bar")).toBe('"foo" OR "bar"');
        expect(buildFtsQuery("日本語テスト")).toBe('"日本語テスト"');
        expect(buildFtsQuery("a_b c_d")).toBe('"a_b" OR "c_d"');
    });

    // wave-254 residual
    it("strips embedded quotes from tokens and OR-joins remaining word runs", () => {
        expect(buildFtsQuery('alpha"beta')).toBe('"alpha" OR "beta"');
        expect(buildFtsQuery('"quoted"')).toBe('"quoted"');
        expect(buildFtsQuery('""')).toBeNull();
        expect(buildFtsQuery("token1  token2\ttoken3")).toBe('"token1" OR "token2" OR "token3"');
    });

    it("preserves leading zeros and mixed alnum as single tokens", () => {
        expect(buildFtsQuery("007")).toBe('"007"');
        expect(buildFtsQuery("v2")).toBe('"v2"');
        expect(buildFtsQuery("API2key")).toBe('"API2key"');
        expect(buildFtsQuery("x_1 y_2")).toBe('"x_1" OR "y_2"');
    });

    // wave-264 residual
    it("empty string and emoji-only queries return null; emoji+word keeps word", () => {
        expect(buildFtsQuery("")).toBeNull();
        expect(buildFtsQuery("😀🎉")).toBeNull();
        expect(buildFtsQuery("😀 hello 🎉")).toBe('"hello"');
    });

    it("multiple spaces and mixed separators collapse to OR-joined unique word runs", () => {
        expect(buildFtsQuery("one   two	three")).toBe('"one" OR "two" OR "three"');
        expect(buildFtsQuery("path/to/file")).toBe('"path" OR "to" OR "file"');
        expect(buildFtsQuery("a+b=c")).toBe('"a" OR "b" OR "c"');
        expect(buildFtsQuery("END")).toBe('"END"');
    });


    // wave-273 residual
    it("strips FTS special chars by phrase-quoting tokens only", () => {
        expect(buildFtsQuery("foo*bar")).toBe('"foo" OR "bar"');
        expect(buildFtsQuery("(hello:world)")).toBe('"hello" OR "world"');
        expect(buildFtsQuery("a:b:c")).toBe('"a" OR "b" OR "c"');
        expect(buildFtsQuery("___")).toBe('"___"');
    });

    it("unicode letters/numbers and underscore stay one token; punctuation splits", () => {
        expect(buildFtsQuery("café_123")).toBe('"café_123"');
        expect(buildFtsQuery("hello,world!")).toBe('"hello" OR "world"');
        expect(buildFtsQuery("   \t  ")).toBeNull();
        expect(buildFtsQuery("one-two-three")).toBe('"one" OR "two" OR "three"');
    });


    // wave-276 residual
    it("single token has no OR; CJK letters form word runs", () => {
        expect(buildFtsQuery("solo")).toBe('"solo"');
        expect(buildFtsQuery("你好世界")).toBe('"你好世界"');
        expect(buildFtsQuery("你好 世界")).toBe('"你好" OR "世界"');
        expect(buildFtsQuery("mixed中文abc")).toBe('"mixed中文abc"');
    });

    it("underscore-only and digit-only tokens preserved; leading/trailing punctuation stripped via split", () => {
        expect(buildFtsQuery("_id")).toBe('"_id"');
        expect(buildFtsQuery("42")).toBe('"42"');
        expect(buildFtsQuery("...hello...")).toBe('"hello"');
        expect(buildFtsQuery("!!!")).toBeNull();
    });

    // wave-285 residual
    it("null for emoji-only/punctuation; multi-token OR join; strips embedded quotes", () => {
        expect(buildFtsQuery("😀😃")).toBeNull();
        expect(buildFtsQuery("***")).toBeNull();
        expect(buildFtsQuery('say "hello" world')).toBe('"say" OR "hello" OR "world"');
        expect(buildFtsQuery("a b c")).toBe('"a" OR "b" OR "c"');
    });

    it("whitespace-only null; mixed punctuation splits tokens cleanly", () => {
        expect(buildFtsQuery(" \n\t ")).toBeNull();
        expect(buildFtsQuery("foo/bar\\baz")).toBe('"foo" OR "bar" OR "baz"');
        expect(buildFtsQuery("v1.2.3")).toBe('"v1" OR "2" OR "3"');
    });




    // wave-317 residual
    it("returns null when no Unicode letter/number/underscore tokens", () => {
        expect(buildFtsQuery("")).toBeNull();
        expect(buildFtsQuery("   ")).toBeNull();
        expect(buildFtsQuery("---")).toBeNull();
        expect(buildFtsQuery("()[]{}*")).toBeNull();
    });

    it("phrase-quotes each token and OR-joins; embedded quotes split tokens then strip", () => {
        expect(buildFtsQuery("alpha beta")).toBe('"alpha" OR "beta"');
        // product tokenizes via [\p{L}\p{N}_]+ so quote splits before replaceAll
        expect(buildFtsQuery('he"llo')).toBe('"he" OR "llo"');
        // whole-token quotes are separators; remaining words phrase-quoted
        expect(buildFtsQuery('say "hello" world')).toBe('"say" OR "hello" OR "world"');
        expect(buildFtsQuery("foo_bar baz")).toBe('"foo_bar" OR "baz"');
        expect(buildFtsQuery("42_id")).toBe('"42_id"');
    });

    it("punctuation and operators split tokens; CJK and alnum stay contiguous", () => {
        expect(buildFtsQuery("a:b(c)")).toBe('"a" OR "b" OR "c"');
        expect(buildFtsQuery("path/to/file")).toBe('"path" OR "to" OR "file"');
        expect(buildFtsQuery("记忆_1")).toBe('"记忆_1"');
        expect(buildFtsQuery("记忆 1")).toBe('"记忆" OR "1"');
    });

});
