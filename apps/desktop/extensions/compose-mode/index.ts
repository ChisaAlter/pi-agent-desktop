import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { registerEvents, persistComposeState } from "./events.ts";
import {
    createInitialState,
    currentDirective,
    DIRECTIVE_LABELS,
    workflowLines,
    type ComposeModeState,
} from "./state.ts";

export default function composeModeExtension(pi: ExtensionAPI): void {
    const state: ComposeModeState = createInitialState();

    function updateUI(ctx: ExtensionContext): void {
        if (!state.enabled) {
            ctx.ui.setStatus("compose-mode", undefined);
            ctx.ui.setWidget("plan-todos", undefined);
            return;
        }

        const directive = DIRECTIVE_LABELS[currentDirective(state)];
        ctx.ui.setStatus("compose-mode", `🧩 compose:${directive}`);
        ctx.ui.setWidget("plan-todos", workflowLines(state));
    }

    function persistState(): void {
        persistComposeState(pi, state);
    }

    registerCommands(pi, state, { updateUI, persistState });
    registerEvents(pi, state, { updateUI, persistState });
}
