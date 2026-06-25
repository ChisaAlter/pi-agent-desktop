import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ComposeModeCallbacks, ComposeModeState, ComposeDirective } from "./state.ts";

interface CommandDef {
    name: string;
    description: string;
    directive?: ComposeDirective;
}

const DIRECTIVE_COMMANDS: CommandDef[] = [
    { name: "compose:ask", description: "进入 compose 提问阶段，专注澄清阻塞点。", directive: "ask" },
    { name: "compose:plan", description: "进入 compose 计划阶段，先给出可执行计划。", directive: "plan" },
    { name: "compose:execute", description: "进入 compose 执行阶段，按既有计划直接实施。", directive: "execute" },
    { name: "compose:verify", description: "进入 compose 验证阶段，运行并解释检查结果。", directive: "verify" },
    { name: "compose:report", description: "进入 compose 汇报阶段，输出证据、风险与后续动作。", directive: "report" },
    { name: "compose:tdd", description: "进入 compose TDD 阶段，本轮严格先红后绿。", directive: "tdd" },
    { name: "compose:debug", description: "进入 compose 调试阶段，先复现和定位机制。", directive: "debug" },
];

function emitComposeNote(pi: ExtensionAPI, message: string): void {
    pi.sendMessage(
        {
            customType: "compose-status",
            content: message,
            display: true,
        },
        { triggerTurn: false },
    );
}

function normalizeToggleArg(value: string): "on" | "off" | "status" | "toggle" {
    const normalized = value.trim().toLowerCase();
    if (normalized === "on" || normalized === "off" || normalized === "status") return normalized;
    return "toggle";
}

function enableCompose(
    pi: ExtensionAPI,
    state: ComposeModeState,
    callbacks: ComposeModeCallbacks,
    mode: "on" | "off" | "toggle",
    notify: boolean,
    cwdLabel: string,
): void {
    if (mode === "off" || (mode === "toggle" && state.enabled)) {
        state.enabled = false;
        state.pendingDirective = null;
        state.activeTurnDirective = null;
        state.lastDirective = null;
        if (notify) emitComposeNote(pi, `Compose mode 已关闭。当前目录：${cwdLabel}`);
        callbacks.persistState();
        return;
    }

    state.enabled = true;
    state.pendingDirective = null;
    if (notify) emitComposeNote(pi, `Compose mode 已开启。当前目录：${cwdLabel}`);
    callbacks.persistState();
}

function queueDirective(
    pi: ExtensionAPI,
    state: ComposeModeState,
    callbacks: ComposeModeCallbacks,
    directive: ComposeDirective,
    args: string,
): void {
    state.enabled = true;
    state.pendingDirective = directive;
    callbacks.persistState();
    const trimmed = args.trim();
    if (trimmed) {
        pi.sendUserMessage(trimmed);
        return;
    }
    emitComposeNote(pi, `Compose 已切到 ${directive} 阶段，下一轮将按该工作流执行。`);
}

export function registerCommands(
    pi: ExtensionAPI,
    state: ComposeModeState,
    callbacks: ComposeModeCallbacks,
): void {
    pi.registerCommand("compose", {
        description: "切换 compose runtime。用法: /compose on|off|status",
        handler: async (args, ctx) => {
            const mode = normalizeToggleArg(args ?? "");
            if (mode === "status") {
                const current = state.enabled ? (state.pendingDirective ?? state.lastDirective ?? "auto") : "off";
                emitComposeNote(pi, `Compose 当前状态：${current}`);
                callbacks.updateUI(ctx);
                return;
            }
            enableCompose(pi, state, callbacks, mode, true, ctx.cwd);
            callbacks.updateUI(ctx);
        },
    });

    for (const command of DIRECTIVE_COMMANDS) {
        pi.registerCommand(command.name, {
            description: command.description,
            handler: async (args, ctx) => {
                queueDirective(pi, state, callbacks, command.directive!, args ?? "");
                callbacks.updateUI(ctx);
            },
        });
    }
}
