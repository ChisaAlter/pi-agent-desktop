/**
 * Permission ruleset engine — ported from MiMo Code's
 * `permission/evaluate.ts` + `permission/index.ts` (fromConfig/merge/disabled).
 *
 * Pure functions only — no I/O, no state. The runtime `Permission` service
 * (service.ts) builds on top of these.
 */
import os from "os";
import { wildcardMatch } from "./wildcard";
import type { PermissionAction, PermissionRule, PermissionRuleset, PermissionConfig } from "./types";

/**
 * Evaluate a (permission, pattern) tuple against one or more rulesets.
 *
 * Returns the LAST matching rule (later rules win), or a default `ask` rule
 * when no rule matches. Mirrors MiMo Code's `evaluate` exactly so ruleset
 * semantics stay identical.
 *
 * @example
 *   evaluate("edit", "/foo/bar.ts", ruleset).action  // → "deny" | "allow" | "ask"
 */
export function evaluate(
    permission: string,
    pattern: string,
    ...rulesets: PermissionRuleset[]
): PermissionRule {
    const rules = rulesets.flat();
    // Reverse iterate to find the LAST matching rule (equivalent to
    // Array.prototype.findLast, but works on older ES targets).
    for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (wildcardMatch(permission, rule.permission) && wildcardMatch(pattern, rule.pattern)) {
            return rule;
        }
    }
    return { action: "ask", permission, pattern: "*" };
}

/**
 * Merge multiple rulesets into one (just flattens, since `evaluate` uses
 * `findLast` — later rules naturally win).
 */
export function merge(...rulesets: PermissionRuleset[]): PermissionRuleset {
    return rulesets.flat();
}

/**
 * Expand user paths in patterns (`~/...`, `$HOME/...`) to absolute paths.
 */
function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1);
    if (pattern === "~") return os.homedir();
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5);
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5);
    return pattern;
}

/**
 * Convert a user-facing PermissionConfig (object form) into a normalized
 * PermissionRuleset (array of rules).
 *
 * @example
 *   fromConfig({ edit: "deny" })
 *   // → [{ permission: "edit", pattern: "*", action: "deny" }]
 *
 *   fromConfig({ read: { "*": "allow", "*.env": "ask" } })
 *   // → [
 *   //   { permission: "read", pattern: "*", action: "allow" },
 *   //   { permission: "read", pattern: "*.env", action: "ask" },
 *   // ]
 */
export function fromConfig(config: PermissionConfig): PermissionRuleset {
    const ruleset: PermissionRule[] = [];
    for (const [key, value] of Object.entries(config)) {
        if (typeof value === "string") {
            ruleset.push({ permission: key, action: value as PermissionAction, pattern: "*" });
            continue;
        }
        const patterns = value as Record<string, PermissionAction>;
        for (const [pattern, action] of Object.entries(patterns)) {
            ruleset.push({
                permission: key,
                pattern: expand(pattern),
                action: action as PermissionAction,
            });
        }
    }
    return ruleset;
}

/**
 * Edit-family tools share the "edit" permission name (MiMo Code's aliasing).
 * `edit: "deny"` covers all of these. A tool-specific rule placed after the
 * group rule wins naturally via `findLast`.
 *
 * Exported so callers (e.g. the approval interceptor) can identify which tools
 * share the "edit" permission without duplicating the list.
 */
export const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"];

/**
 * Compute the set of tools to fully remove from the LLM's tool list.
 *
 * A tool is removed ONLY when its rule has `pattern === "*" && action === "deny"`
 * (full tool removal). Non-star patterns (like `*.env`) keep the tool in the
 * list — they're meant for runtime `ctx.ask()` interception, not schema removal.
 *
 * This conservative behavior matches MiMo Code's PR #1207 design goal: avoid
 * mode-switch-induced tool-list mutation that would invalidate prompt cache.
 */
export function disabled(tools: readonly string[], ruleset: PermissionRuleset): Set<string> {
    const result = new Set<string>();
    for (const tool of tools) {
        // Reverse iterate to find the LAST matching rule (equivalent to
        // Array.prototype.findLast, but works on older ES targets).
        let matchedRule: PermissionRule | null = null;
        for (let i = ruleset.length - 1; i >= 0; i--) {
            const r = ruleset[i];
            if (
                wildcardMatch(tool, r.permission) ||
                (EDIT_TOOLS.includes(tool) && wildcardMatch("edit", r.permission))
            ) {
                matchedRule = r;
                break;
            }
        }
        if (!matchedRule) continue;
        if (matchedRule.pattern === "*" && matchedRule.action === "deny") result.add(tool);
    }
    return result;
}
