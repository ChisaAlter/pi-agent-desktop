/**
 * Agent.Info — ported from MiMo Code's `agent/agent.ts` (Info schema + agents record).
 *
 * This is the canonical agent definition for the permission engine. It carries
 * the 4-layer permission model:
 *   1. `toolAllowlist`  — coarse tool-name whitelist (Layer 1)
 *   2. `permission`     — merged ruleset: defaults + agent-specific + user (Layer 2)
 *   3. `hardPermission` — non-overridable rules appended AFTER user merge (Layer 3)
 *   4. `interactive`    — false → auto-deny on ask (Layer 4, for system subagents)
 *
 * The 3 primary modes (build/plan/compose) are defined here. Subagents are
 * defined in `subagent/registry.ts` and reuse the same `AgentInfo` shape.
 *
 * `runtimePermission()` merges agent.permission → session → agent.hardPermission
 * (hardPermission LAST so `findLast` evaluation always picks it).
 *
 * Pi Desktop adaptation:
 *  - Pure TypeScript (no Effect/Schema/Context). Schema validation is done
 *    via Zod at IPC boundaries, not here.
 *  - `app.getPath("userData")` is computed lazily inside `getAgentInfo()` to
 *    avoid touching Electron before `app.whenReady()`.
 *  - `LongHorizonSettings` toggles gate which modes are returned (the existing
 *    settings-panel switches continue to control availability).
 */
import { app } from "electron";
import { join, relative } from "path";
import type { AgentMode, PermissionRuleset } from "@shared";
import { fromConfig, merge } from "../permission/evaluate";
import { getDefaultRuleset } from "../permission/defaults";
import type { AgentModeRuntimeOptions } from "../agent-modes";

/**
 * Canonical agent definition — used by the permission engine.
 *
 * Subset of MiMo Code's `Agent.Info`: only fields the permission engine reads.
 * Display-only fields (color, topP, temperature, model) live elsewhere.
 */
export interface AgentInfo {
    /** Agent name (matches registry id, e.g. "build" / "plan" / "compose"). */
    readonly name: string;
    /** "primary" for top-level modes, "subagent" for spawned helpers. */
    readonly mode: "primary" | "subagent";
    /** Short description shown in the UI. */
    readonly description: string;
    /**
     * Layer 2: merged ruleset (defaults + agent-specific + user config).
     * Constructed at registration time via `Permission.merge(defaults, ...)`.
     */
    readonly permission: PermissionRuleset;
    /**
     * Layer 3: non-overridable rules appended AFTER user/session merge.
     * Use for agent invariants that config must NOT be able to relax —
     * e.g. plan mode's `edit:*:deny` block.
     */
    readonly hardPermission?: PermissionRuleset;
    /**
     * Layer 1: coarse tool-name whitelist. Tools NOT in this list are removed
     * from the LLM's schema entirely. When undefined, all tools are visible
     * (subject to ruleset filtering at runtime).
     */
    readonly toolAllowlist?: readonly string[];
    /**
     * Optional system-prompt directive prepended to user messages
     * (e.g. PLAN_DIRECTIVE, COMPOSE_DIRECTIVE — see Slice 3).
     */
    readonly prompt?: string;
    /**
     * Layer 4: when false, an `ask` that would block on human reply instead
     * fails immediately (auto-deny). Set for system-spawned subagents
     * (dream / distill / checkpoint-writer) which have no human attached.
     * Primary agents are always interactive (default true).
     */
    readonly interactive?: boolean;
    /** Optional step cap (subagent-only; primary agents ignore this). */
    readonly steps?: number;
}

/**
 * Merge an agent's permission with the user/session ruleset, then re-append
 * the agent's hardPermission so those invariants win over any allow rule a
 * user or session approval could introduce.
 *
 * Every permission-evaluation site routes through this — there is no per-agent
 * name special-casing. Ported verbatim from MiMo Code's `runtimePermission`.
 */
export function runtimePermission(
    agent: AgentInfo,
    sessionPermission: PermissionRuleset = [],
): PermissionRuleset {
    return merge(agent.permission, sessionPermission, agent.hardPermission ?? []);
}

/**
 * Resolve the user-data "plans" directory absolute path.
 *
 * Lazy because `app.getPath()` requires `app.whenReady()`. Don't call at
 * module load time.
 */
function getUserDataPlansDir(): string {
    return join(app.getPath("userData"), "plans");
}

/**
 * Build the AgentInfo for one of the 3 primary modes.
 *
 * Returns `null` when the mode is disabled by `LongHorizonSettings` (e.g.
 * `options.planModeEnabled === false`). Callers should fall back to "build".
 *
 * @param mode      Target mode.
 * @param options   Long-horizon runtime toggles (governed by settings panel).
 * @param workspacePath  Absolute workspace dir — used to compute the
 *                       worktree-relative path to the global plans dir, so
 *                       plan-mode writes via relative paths also match.
 * @param composeWorktreePath  Absolute path to the compose worktree dir.
 *                              When provided (compose mode only), the compose
 *                              agent's `hardPermission` restricts
 *                              `external_directory` writes to the worktree
 *                              (allow) and asks for any other external path.
 *                              Omit to fall back to no hardPermission (legacy
 *                              behavior — used by `listEnabledAgents`).
 */
export function getAgentInfo(
    mode: AgentMode,
    options: AgentModeRuntimeOptions = {},
    workspacePath?: string,
    composeWorktreePath?: string,
): AgentInfo | null {
    const longHorizonEnabled = options.longHorizonEnabled ?? true;
    if (!longHorizonEnabled) {
        // Long-horizon system off — only build is available.
        return mode === "build" ? buildAgent() : null;
    }

    switch (mode) {
        case "build":
            return buildAgent();
        case "plan":
            if (options.planModeEnabled === false) return null;
            return planAgent(workspacePath);
        case "compose":
            if (options.composeModeEnabled === false) return null;
            return composeAgent(composeWorktreePath);
        default:
            return null;
    }
}

/**
 * Build mode — default implementation agent.
 *
 * `defaults + question:allow` (no hardPermission).
 * The `question:allow` override is what distinguishes a primary agent from a
 * subagent: only primary agents may ask the user clarifying questions.
 */
function buildAgent(): AgentInfo {
    return {
        name: "build",
        mode: "primary",
        description: "Default implementation mode. Executes tools based on configured permissions.",
        permission: merge(
            getDefaultRuleset(),
            fromConfig({ question: "allow" }),
        ),
        interactive: true,
    };
}

/**
 * Plan mode — read-only with `.pi/plans/*.md` as the only write target.
 *
 * Permission shape (mirrors MiMo Code):
 *  - `defaults + question:allow + external_directory:<userData>/plans/*:allow`
 *  - `hardPermission: edit: { *:deny, .pi/plans/*.md:allow, <userData>/plans/*.md:allow }`
 *
 * The `edit:*:deny` hard rule means EVERY write tool (write/edit/multiedit/
 * apply_patch/notebook_edit — all aliased to "edit" permission) is blocked
 * unless the pattern matches one of the allow exceptions. User/session
 * approval CANNOT relax this — that's the whole point of hardPermission.
 *
 * Path matching: both project-local (`.pi/plans/*.md`) and absolute
 * (`<userData>/plans/*.md`) paths are allowed, plus the worktree-relative
 * path to the global plans dir (so LLM-passed relative paths also match).
 *
 * Note: bash/change_directory/workflow are NOT blocked by hardPermission —
 * they're left to the model's read-only discipline + the plan prompt
 * directive (Slice 3). This matches MiMo Code's "trust the model, permission
 * layer is a backstop" stance.
 */
function planAgent(workspacePath?: string): AgentInfo {
    const userDataPlansDir = getUserDataPlansDir();
    const userDataPlansGlob = join(userDataPlansDir, "*.md").replace(/\\/g, "/");

    // The 3 allowed edit patterns:
    //  1. Project-local `.pi/plans/*.md` (matches MiMo Code's `.mimocode/plans/*.md`)
    //  2. Absolute userData/plans/*.md path (LLM may pass absolute)
    //  3. Worktree-relative path to userData/plans/*.md (LLM may pass relative)
    const allowedEditPatterns: Record<string, "allow"> = {
        ".pi/plans/*.md": "allow",
        [userDataPlansGlob]: "allow",
    };
    if (workspacePath) {
        const rel = relative(workspacePath, userDataPlansGlob).replace(/\\/g, "/");
        if (rel && !rel.startsWith("../..")) {
            // Only register the relative pattern when userData is reasonably
            // close to the workspace (within 1 parent dir). When userData is
            // far away, the relative path becomes unwieldy and the absolute
            // pattern alone is sufficient.
            allowedEditPatterns[rel] = "allow";
        } else if (rel) {
            // Still register it — the LLM could compute it.
            allowedEditPatterns[rel] = "allow";
        }
    }

    return {
        name: "plan",
        mode: "primary",
        description: "Plan mode. Disallows all edit tools except writes to .pi/plans/*.md.",
        permission: merge(
            getDefaultRuleset(),
            fromConfig({
                question: "allow",
                external_directory: {
                    [userDataPlansGlob]: "allow",
                },
            }),
        ),
        hardPermission: fromConfig({
            edit: {
                "*": "deny",
                ...allowedEditPatterns,
            },
        }),
        interactive: true,
    };
}

/**
 * Compose mode — workflow orchestrator.
 *
 * Same permission shape as build (`defaults + question:allow`). When a
 * `composeWorktreePath` is supplied (i.e. the compose workflow has spawned a
 * worktree under `%TEMP%/pi-desktop-compose-worktrees/<repoSlug>-<repoHash>/`),
 * a `hardPermission` is appended that restricts `external_directory` writes to
 * the worktree path — every other external write is forced to `ask`. Without
 * a worktreePath, the agent behaves identically to build (no hardPermission);
 * the compose workflow is responsible for passing the worktree path so the
 * backstop engages.
 *
 * The hardPermission is appended AFTER session merge (see `runtimePermission`),
 * so user/session approvals cannot relax the worktree constraint — only the
 * named worktree dir is allowed, every other external path falls through to
 * `ask` (which the bundled permission extension surfaces to the user).
 *
 * Distinguished from build by the COMPOSE_DIRECTIVE prompt (added in Slice 3)
 * and the `composeSkillsBlock` skill injection.
 *
 * @param composeWorktreePath  Absolute path to the compose worktree. When
 *                              undefined, no hardPermission is applied (legacy
 *                              behavior — used by `listEnabledAgents`).
 */
function composeAgent(composeWorktreePath?: string): AgentInfo {
    let hardPermission: PermissionRuleset | undefined;
    if (composeWorktreePath) {
        // Normalize backslashes to forward slashes so wildcard matching is
        // consistent on Windows (wildcardMatch normalises both sides, but the
        // ruleset patterns are stored verbatim and shown to users).
        const normalizedWorktree = composeWorktreePath.replace(/\\/g, "/");
        // `*: ask` MUST be listed first so the more specific allow rules
        // (placed AFTER it in the array) win via `findLast` evaluation —
        // the same pattern the plan agent uses with `*: deny`.
        hardPermission = fromConfig({
            external_directory: {
                "*": "ask",
                [normalizedWorktree]: "allow",
                [`${normalizedWorktree}/*`]: "allow",
            },
        });
    }

    return {
        name: "compose",
        mode: "primary",
        description: "Compose mode. Orchestrates workflows with built-in compose skills.",
        permission: merge(
            getDefaultRuleset(),
            fromConfig({ question: "allow" }),
        ),
        hardPermission,
        interactive: true,
    };
}

/**
 * List all enabled primary agents (for the renderer's mode switcher).
 *
 * Respects LongHorizonSettings — when `planModeEnabled` or `composeModeEnabled`
 * is false, the corresponding agent is omitted. The renderer's existing
 * `agentRegistry()` function continues to drive the UI; this is a parallel
 * listing for the permission engine to consume.
 */
export function listEnabledAgents(options: AgentModeRuntimeOptions = {}): AgentInfo[] {
    const longHorizonEnabled = options.longHorizonEnabled ?? true;
    if (!longHorizonEnabled) return [buildAgent()];

    const result: AgentInfo[] = [buildAgent()];
    if (options.planModeEnabled !== false) result.push(planAgent());
    if (options.composeModeEnabled !== false) result.push(composeAgent());
    return result;
}
