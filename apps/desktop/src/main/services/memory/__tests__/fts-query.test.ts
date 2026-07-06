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
});
