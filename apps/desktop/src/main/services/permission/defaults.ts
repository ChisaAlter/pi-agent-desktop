/**
 * Default permission ruleset — applied to ALL agents as the base layer.
 *
 * Ported from MiMo Code's `agent.ts` (defaults object, lines 105-120).
 *
 * Critical safety net:
 *  - `doom_loop: ask`        — prevent runaway tool loops
 *  - `external_directory: *` — block writes outside project/user dirs
 *  - `read: *.env: ask`      — prompt before reading .env files
 *  - `question: deny`        — only the main agent (which overrides this to
 *                              `allow`) can ask the user questions
 *
 * Without these defaults, every agent inherits "*: allow" — letting a
 * subagent read `.env` files silently, write to system directories, or
 * trigger doom loops without intervention.
 */
import { app } from "electron";
import { join } from "path";
import { fromConfig } from "./evaluate";
import type { PermissionRuleset } from "./types";

/**
 * Build the default ruleset.
 *
 * `whitelistedDirs` are the external directories (outside the workspace) that
 * subagents ARE allowed to write to:
 *  - The user-data dir (for memory / plans / checkpoints)
 *  - The temp dir (for log files, intermediate scratch)
 *
 * These mirror MiMo Code's `Truncate.GLOB` + skill dir allowlist.
 */
export function buildDefaults(whitelistedDirs: readonly string[]): PermissionRuleset {
    const allowed: Record<string, string> = {};
    for (const dir of whitelistedDirs) {
        // Allow the dir itself + all paths under it
        allowed[dir] = "allow";
        allowed[`${dir}/${"*"}`] = "allow";
    }

    return fromConfig({
        "*": "allow",
        doom_loop: "ask",
        external_directory: {
            "*": "ask",
            ...allowed,
        },
        question: "deny",
        read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
        },
    });
}

/**
 * The default external-write allowlist for Pi Desktop:
 *  - userData dir (memory, plans, checkpoints)
 *  - tmp dir (logs, intermediate)
 *
 * Returned lazily because `app.getPath()` must be called after `app.whenReady`.
 */
export function defaultWhitelistedDirs(): string[] {
    return [join(app.getPath("userData"), "memory"), join(app.getPath("userData"), "plans"), app.getPath("temp")];
}

/** Lazy singleton — most callers should use this. */
let defaultsCache: PermissionRuleset | null = null;

export function getDefaultRuleset(): PermissionRuleset {
    if (!defaultsCache) {
        defaultsCache = buildDefaults(defaultWhitelistedDirs());
    }
    return defaultsCache;
}
