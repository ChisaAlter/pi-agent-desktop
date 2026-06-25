import type { ComposeDirective } from "./state.ts";

const BASE_WORKFLOW = [
    "Compose runtime is active.",
    "Operate as a long-horizon workflow orchestrator inside Pi Desktop.",
    "Work from repository evidence, not generic advice.",
    "Default sequence: clarify only if blocked, then plan, execute in small slices, verify, and report evidence.",
    "When editing code, keep changes incremental and verification-first.",
    "Do not claim work is complete without concrete validation results.",
].join("\n");

const DIRECTIVE_PROMPTS: Record<ComposeDirective, string> = {
    auto: [
        "Choose the next workflow step based on the latest user request.",
        "If the task is non-trivial, produce or refine a concrete plan before mutating code.",
    ].join("\n"),
    ask: [
        "Focus this turn on clarification.",
        "Ask at most one or two short blocking questions; if a safe assumption exists, state it and continue.",
    ].join("\n"),
    plan: [
        "Focus this turn on planning.",
        "Return a concrete implementation plan with files, steps, and verification checkpoints before coding.",
    ].join("\n"),
    execute: [
        "Focus this turn on execution.",
        "Implement the current approved plan directly, keep scope tight, and avoid unrelated refactors.",
    ].join("\n"),
    verify: [
        "Focus this turn on verification.",
        "Run the relevant checks, interpret failures precisely, and only claim passing work when the evidence is real.",
    ].join("\n"),
    report: [
        "Focus this turn on reporting.",
        "Summarize what changed, what was verified, what failed, and what risk remains.",
    ].join("\n"),
    tdd: [
        "Apply strict TDD discipline on this turn.",
        "Write or update a failing test first, watch it fail for the correct reason, then implement the minimum fix.",
    ].join("\n"),
    debug: [
        "Apply systematic debugging on this turn.",
        "Reproduce, isolate the actual mechanism, gather evidence, then fix and run targeted regression checks.",
    ].join("\n"),
};

export function buildComposePrompt(directive: ComposeDirective, turnCount: number): string {
    const brevityLine = turnCount > 1
        ? "This is not the first compose-guided turn. Reuse the established plan/context instead of restating everything."
        : "This is the first compose-guided turn for the current session.";
    return [
        BASE_WORKFLOW,
        "",
        DIRECTIVE_PROMPTS[directive],
        "",
        brevityLine,
    ].join("\n");
}
