/**
 * Permission engine — barrel export.
 *
 * Public API:
 *  - `PermissionRule` / `PermissionRuleset` / `PermissionAction` — types
 *  - `evaluate` / `merge` / `fromConfig` / `disabled` — pure functions
 *  - `wildcardMatch` — pattern matching (rarely needed directly)
 *  - `buildDefaults` / `getDefaultRuleset` — default ruleset
 *
 * Note: The runtime ask/reply shell and its IPC bridge were removed — Pi
 * Desktop currently uses static rules + abort mode only, with no runtime
 * user prompting. If runtime ask/reply is needed in the future, it must
 * be re-implemented from scratch.
 */
export * from "./types";
export * from "./wildcard";
export * from "./evaluate";
export * from "./defaults";
