/**
 * Wildcard pattern matching — ported from MiMo Code's `util/wildcard.ts`.
 *
 * Semantics:
 *  - `*` → `.*` (any chars)
 *  - `?` → `.` (single char)
 *  - Trailing ` *` (space + wildcard) → `( .*)?` (optional trailing args)
 *  - Backslashes normalized to forward slashes (Windows path compatibility)
 *  - Case-insensitive on Windows (matches MiMo Code behavior)
 *
 * Examples:
 *  - match("ls", "ls *")       → true  (trailing args optional)
 *  - match("ls -la", "ls *")   → true
 *  - match("read", "read")    → true
 *  - match(".env", "*.env")    → true
 *  - match("C:\\x", "c:/x")   → true  (path normalization + case-insensitive)
 *
 * Used by the permission ruleset engine to match (permission, pattern) tuples
 * against runtime tool calls. Mirrors MiMo Code's `Wildcard.match` exactly so
 * ruleset semantics stay identical across the two projects.
 */
export function wildcardMatch(str: string, pattern: string): boolean {
    if (str) str = str.replaceAll("\\", "/");
    if (pattern) pattern = pattern.replaceAll("\\", "/");
    let escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
        .replace(/\*/g, ".*") // * becomes .*
        .replace(/\?/g, "."); // ? becomes .

    // If pattern ends with " *" (space + wildcard), make the trailing part
    // optional. This allows "ls *" to match both "ls" and "ls -la".
    if (escaped.endsWith(" .*")) {
        escaped = escaped.slice(0, -3) + "( .*)?";
    }

    const flags = process.platform === "win32" ? "si" : "s";
    return new RegExp("^" + escaped + "$", flags).test(str);
}
