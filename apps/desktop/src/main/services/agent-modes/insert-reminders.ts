/**
 * insertReminders — ported from MiMo Code's `session/prompt.ts` insertReminders.
 *
 * MiMo Code injects reminders as synthetic message PARTS into the message
 * stream at LLM-call time. Pi Desktop doesn't have message parts — messages
 * are flat strings. So this module adapts the logic to return a single
 * "reminder block" string that the caller prepends to the outgoing user
 * prompt (in `buildAgentModePrompt`).
 *
 * Three reminder cases (matching MiMo Code's insertReminders):
 *
 *  1. Compose mode active → prepend COMPOSE_DIRECTIVE + optional
 *     `<compose_skills>` block + `<compose_docs_dir>` block.
 *
 *  2. Plan→Build transition (previousMode === "plan", currentMode === "build")
 *     → prepend BUILD_SWITCH + "A plan file exists at X. You should execute
 *     on the plan defined within it" (only when the plan file exists).
 *
 *  3. Entering plan mode (currentMode === "plan", no transition from plan)
 *     → prepend PLAN_DIRECTIVE with plan file info substituted.
 *
 * All three respect the LongHorizonSettings toggles — when a mode is disabled
 * in settings, its reminder is skipped (the renderer shouldn't have offered
 * the mode in the first place, but this is a defense-in-depth).
 */
import type { AgentMode } from "@shared";
import {
    COMPOSE_DIRECTIVE,
    BUILD_SWITCH,
    formatPlanDirective,
    formatComposeDocsBlock,
} from "./directives";
import type { AgentModeRuntimeOptions } from "../agent-modes";

export interface ReminderInput extends AgentModeRuntimeOptions {
    /** Mode the user is sending this prompt in. */
    currentMode: AgentMode;
    /**
     * Mode of the PREVIOUS prompt in this workspace (for transition detection).
     * When undefined, no transition logic applies. Tracked by chat.ipc.ts
     * via `agentModeByWorkspace` Map.
     */
    previousMode?: AgentMode;
    /**
     * Path to the plan file for the current session (e.g. `.pi/plans/abc.md`).
     * Required for plan-mode reminders; if absent, a sensible default is used.
     */
    planFilePath?: string;
    /** Whether the plan file already exists on disk. */
    planFileExists?: boolean;
    /**
     * Compose skills docs dir (where compose skill outputs land).
     * Defaults to `.pi/compose` under the workspace.
     */
    composeDocsDir?: string;
    /**
     * Optional `<compose_skills>` XML block listing available compose skills.
     * When empty/undefined, no skills block is injected (compose mode still
     * works but the model can't invoke compose-specific skills).
     */
    composeSkillsBlock?: string;
}

export interface ReminderBlock {
    readonly kind: "plan" | "compose" | "compose-skills" | "compose-docs" | "build-switch";
    readonly text: string;
}

export interface ReminderResult {
    /** Combined reminder text to prepend to the outgoing user prompt. Empty when no reminder applies. */
    readonly reminder: string;
    /** Structured blocks combined into `reminder` (for logging / debugging). */
    readonly blocks: readonly ReminderBlock[];
}

/**
 * Build the reminder block to prepend to the outgoing user prompt.
 *
 * Returns `{ reminder: "", blocks: [] }` when no reminder applies (e.g. build
 * mode with no transition, or long-horizon disabled).
 *
 * @example
 *   const { reminder } = buildModeReminder({
 *       currentMode: "plan",
 *       longHorizonEnabled: true,
 *       planModeEnabled: true,
 *       planFilePath: ".pi/plans/abc.md",
 *       planFileExists: false,
 *   });
 *   // reminder contains the full PLAN_DIRECTIVE with plan file info
 */
export function buildModeReminder(input: ReminderInput): ReminderResult {
    const longHorizonEnabled = input.longHorizonEnabled ?? true;
    if (!longHorizonEnabled) return { reminder: "", blocks: [] };

    // Case 2: Plan→Build transition (check before Case 3 — transition wins
    // over plain plan-mode injection).
    if (
        input.currentMode === "build" &&
        input.previousMode === "plan" &&
        input.planFileExists === true
    ) {
        const planPath = input.planFilePath ?? defaultPlanFilePath();
        const text = [
            BUILD_SWITCH,
            "",
            `A plan file exists at ${planPath}. You should execute on the plan defined within it`,
        ].join("\n");
        return {
            reminder: text,
            blocks: [{ kind: "build-switch", text }],
        };
    }

    // Case 1: Compose mode active.
    if (input.currentMode === "compose") {
        if (input.composeModeEnabled === false) return { reminder: "", blocks: [] };

        const blocks: ReminderBlock[] = [];
        const parts: string[] = [];

        // Always inject the compose directive when in compose mode.
        blocks.push({ kind: "compose", text: COMPOSE_DIRECTIVE });
        parts.push(COMPOSE_DIRECTIVE);

        // Optional `<compose_skills>` block (when compose skills are installed).
        if (input.composeSkillsBlock && input.composeSkillsBlock.trim()) {
            blocks.push({ kind: "compose-skills", text: input.composeSkillsBlock });
            parts.push(input.composeSkillsBlock);
        }

        // `<compose_docs_dir>` block — tells the model where to save outputs.
        const docsDir = input.composeDocsDir ?? ".pi/compose";
        const docsBlock = formatComposeDocsBlock(docsDir);
        blocks.push({ kind: "compose-docs", text: docsBlock });
        parts.push(docsBlock);

        return {
            reminder: parts.join("\n\n"),
            blocks,
        };
    }

    // Case 3: Entering plan mode (currentMode === "plan", not transitioning out).
    if (input.currentMode === "plan") {
        if (input.planModeEnabled === false) return { reminder: "", blocks: [] };

        const planPath = input.planFilePath ?? defaultPlanFilePath();
        const exists = input.planFileExists ?? false;
        const text = formatPlanDirective(planPath, exists);
        return {
            reminder: text,
            blocks: [{ kind: "plan", text }],
        };
    }

    // Build mode (no transition) — no reminder.
    return { reminder: "", blocks: [] };
}

/**
 * Default plan file path used when the caller doesn't supply one.
 *
 * Mirrors MiMo Code's `Session.plan(session)` shape: `<plans_dir>/<session_id>.md`.
 * Without a session ID we use `current.md` as a fallback — the model will
 * write to this file and the user can rename it later.
 */
function defaultPlanFilePath(): string {
    return ".pi/plans/current.md";
}

/**
 * Compute the plan file path for a given session.
 *
 * Pi Desktop convention: `.pi/plans/<sessionId>.md` (relative to workspace).
 * This matches the existing PlanFileService behavior.
 */
export function planFilePathForSession(sessionId: string): string {
    // Sanitize: only allow alphanumeric + dash + underscore in filename.
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
    return `.pi/plans/${safe || "current"}.md`;
}

// Re-export for callers that need raw access to the directive texts (tests, logging).
export { PLAN_DIRECTIVE_TEMPLATE, COMPOSE_DIRECTIVE, BUILD_SWITCH } from "./directives";
