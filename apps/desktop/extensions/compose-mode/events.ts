import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildComposePrompt } from "./prompts.ts";
import {
    currentDirective,
    DIRECTIVE_LABELS,
    type ComposeModeCallbacks,
    type ComposeModeState,
} from "./state.ts";

type SessionEntry = {
    type?: string;
    customType?: string;
    data?: {
        enabled?: boolean;
        pendingDirective?: ComposeModeState["pendingDirective"];
        lastDirective?: ComposeModeState["lastDirective"];
        turnCount?: number;
    };
};

function isComposeContextMessage(message: AgentMessage & { customType?: string }): boolean {
    return message.customType === "compose-mode-context";
}

export function registerEvents(
    pi: ExtensionAPI,
    state: ComposeModeState,
    callbacks: ComposeModeCallbacks,
): void {
    pi.on("session_start", async (_event, ctx) => {
        const entry = (ctx.sessionManager.getEntries() as SessionEntry[])
            .filter((item) => item.type === "custom" && item.customType === "compose-mode-state")
            .pop();
        const data = entry?.data;
        if (data) {
            state.enabled = Boolean(data.enabled);
            state.pendingDirective = data.pendingDirective ?? null;
            state.lastDirective = data.lastDirective ?? null;
            state.turnCount = typeof data.turnCount === "number" ? data.turnCount : 0;
            state.activeTurnDirective = null;
        }
        callbacks.updateUI(ctx);
    });

    pi.on("before_agent_start", async (_event, ctx) => {
        if (!state.enabled) return;
        state.turnCount += 1;
        state.activeTurnDirective = state.pendingDirective;
        state.pendingDirective = null;
        callbacks.persistState();
        callbacks.updateUI(ctx);
        return {
            message: {
                customType: "compose-mode-context",
                content: buildComposePrompt(currentDirective(state), state.turnCount),
                display: false,
            },
        };
    });

    pi.on("turn_end", async (_event, ctx) => {
        if (!state.enabled) return;
        if (state.activeTurnDirective) {
            state.lastDirective = state.activeTurnDirective;
            state.activeTurnDirective = null;
            callbacks.persistState();
            callbacks.updateUI(ctx);
        }
    });

    pi.on("agent_end", async (_event, ctx) => {
        if (!state.enabled) return;
        if (state.activeTurnDirective) {
            state.lastDirective = state.activeTurnDirective;
            state.activeTurnDirective = null;
            callbacks.persistState();
            callbacks.updateUI(ctx);
        }
    });

    pi.on("context", async (event) => {
        if (state.enabled) return;
        return {
            messages: event.messages.filter((message) => !isComposeContextMessage(message as AgentMessage & { customType?: string })),
        };
    });
}

export function persistComposeState(pi: ExtensionAPI, state: ComposeModeState): void {
    pi.appendEntry("compose-mode-state", {
        enabled: state.enabled,
        pendingDirective: state.pendingDirective,
        lastDirective: state.lastDirective,
        turnCount: state.turnCount,
        current: DIRECTIVE_LABELS[currentDirective(state)],
    });
}
