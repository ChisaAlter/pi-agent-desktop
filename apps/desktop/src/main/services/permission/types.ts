/**
 * Permission ruleset types — ported from MiMo Code's `permission/index.ts`.
 *
 * The 4-layer permission model:
 *   Layer 1: toolAllowlist (tool name whitelist — coarser than ruleset)
 *   Layer 2: permissionRuleset (allow/deny/ask with pattern matching)
 *   Layer 3: hardPermission (cannot be relaxed by user/session approval)
 *   Layer 4: interactive flag (false → auto-deny on ask; for system subagents)
 *
 * Pi Desktop adaptation:
 *  - Pure TypeScript (no Effect/Schema/Context layers).
 *  - Static rules + abort mode only (no runtime ask/reply service).
 *
 * Rule semantics:
 *  - `permission`: matches the tool's logical permission name (e.g. "edit",
 *    "bash", "external_directory"). Wildcard supports `*`/`?`.
 *  - `pattern`: matches the resource pattern (e.g. file path, shell command,
 *    `*` for any). Wildcard supports `*`/`?` + trailing ` *` optional.
 *  - `action`: `allow` (proceed), `deny` (fail), `ask` (prompt user).
 *
 * Evaluation rule (`evaluate` in evaluate.ts):
 *  - Find the LAST matching rule in the merged ruleset (later rules win).
 *  - Default action when no rule matches: `ask`.
 *
 * Merge order (`runtimePermission` in agent-info.ts):
 *  agent.permission → session.permission → agent.hardPermission
 *  hardPermission is appended LAST so its rules always win (findLast picks
 *  the latest match).
 */
// Re-export the canonical types from @shared (single source of truth).
// Local implementations of PermissionAskInput / PermissionReplyInput
// live below — these are main-process-only types that aren't shared with the
// renderer.
export type {
    PermissionAction,
    PermissionRule,
    PermissionRuleset,
    PermissionReply,
    PermissionRequest,
} from "@shared";
import type {
    PermissionAction,
    PermissionRuleset,
    PermissionReply,
} from "@shared";

/**
 * Config-time permission shape — what users write in settings/config.
 *
 * ```ts
 * {
 *   "*": "allow",
 *   edit: "deny",                              // → { permission:"edit", pattern:"*", action:"deny" }
 *   read: {                                     // → 2 rules
 *     "*": "allow",
 *     "*.env": "ask",
 *   },
 * }
 * ```
 *
 * Use `fromConfig()` in evaluate.ts to convert to `PermissionRuleset`.
 */
export type PermissionConfig = Record<
    string, // permission name (or "*")
    PermissionAction | Record<string, PermissionAction> // pattern → action
>;

/** Reply with optional feedback message (for "reject" with correction). */
export interface PermissionReplyInput {
    readonly requestID: string;
    readonly reply: PermissionReply;
    readonly message?: string;
}

/** Input to `Permission.ask()`. */
export interface PermissionAskInput {
    readonly id?: string;
    readonly sessionID: string;
    readonly permission: string;
    readonly patterns: readonly string[];
    readonly metadata?: Record<string, unknown>;
    readonly always?: readonly string[];
    readonly tool?: {
        readonly messageID: string;
        readonly callID: string;
    };
    /** The runtime ruleset (already merged via `runtimePermission`). */
    readonly ruleset: PermissionRuleset;
    /**
     * When false, an ask that would otherwise block on human reply instead
     * fails immediately (auto-deny). Set for system-spawned subagents
     * (dream / distill / checkpoint-writer) which have no human attached.
     * Default (undefined/true) preserves interactive behavior.
     */
    readonly interactive?: boolean;
}
