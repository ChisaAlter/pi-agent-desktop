/**
 * Build an FTS5 MATCH expression from a free-form user query.
 *
 * Splits the query into Unicode word tokens (contiguous runs of letters,
 * numbers, and underscore), phrase-quotes each token (neutralizing FTS5
 * special characters like `*`, `(`, `)`, `:`, `"`, etc.), and OR-joins them
 * so BM25 can rank by how many/how-rare the matched tokens are.
 *
 * Returns `null` when no usable tokens are extracted. Callers must treat
 * `null` as "empty query, no results" without sending the query to MATCH
 * (an empty MATCH expression is a syntax error).
 *
 * Extracted verbatim from
 * `apps/desktop/src/main/services/long-horizon/database.ts` (the original
 * `sanitizeFtsQuery` function) so the new memory subsystem can reuse the
 * exact tokenization + escaping semantics without depending on SQLite.
 */
export function buildFtsQuery(raw: string): string | null {
    const tokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map((t) => t.trim()).filter(Boolean) ?? [];
    if (tokens.length === 0) return null;
    return tokens.map((t) => `"${t.replaceAll('"', "")}"`).join(" OR ");
}
