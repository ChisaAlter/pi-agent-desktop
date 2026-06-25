import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ComposeDirective =
    | "auto"
    | "ask"
    | "plan"
    | "execute"
    | "verify"
    | "report"
    | "tdd"
    | "debug";

export interface ComposeModeState {
    enabled: boolean;
    pendingDirective: ComposeDirective | null;
    activeTurnDirective: ComposeDirective | null;
    lastDirective: ComposeDirective | null;
    turnCount: number;
}

export interface ComposeModeCallbacks {
    updateUI(ctx: ExtensionContext): void;
    persistState(): void;
}

export const DIRECTIVE_LABELS: Record<ComposeDirective, string> = {
    auto: "auto",
    ask: "ask",
    plan: "plan",
    execute: "execute",
    verify: "verify",
    report: "report",
    tdd: "tdd",
    debug: "debug",
};

export function createInitialState(): ComposeModeState {
    return {
        enabled: false,
        pendingDirective: null,
        activeTurnDirective: null,
        lastDirective: null,
        turnCount: 0,
    };
}

export function currentDirective(state: ComposeModeState): ComposeDirective {
    return state.activeTurnDirective ?? state.pendingDirective ?? "auto";
}

export function workflowLines(state: ComposeModeState): string[] {
    if (!state.enabled) return [];

    const active = currentDirective(state);
    const completed = new Set<ComposeDirective>();
    if (state.lastDirective && state.lastDirective !== "auto") completed.add(state.lastDirective);

    const lines: Array<{ directive: ComposeDirective; text: string }> = [
        { directive: "ask", text: "只在真正阻塞时提问，优先基于证据继续" },
        { directive: "plan", text: "先形成可验证计划，再动实现" },
        { directive: "execute", text: "按计划分步实现，避免大爆改" },
        { directive: "verify", text: "运行验证链路并定位失败原因" },
        { directive: "report", text: "汇总证据、风险与后续动作" },
    ];

    const rendered = lines.map(({ directive, text }) => {
        if (active === directive) return `▶ ${text}`;
        if (completed.has(directive)) return `[x] ${text}`;
        return `[ ] ${text}`;
    });

    if (active === "tdd") rendered.unshift("▶ 当前切片强制先写失败测试，再实现最小代码");
    if (active === "debug") rendered.unshift("▶ 当前切片先复现、定位机制、再修复并回归");
    if (active === "auto") rendered.unshift("▶ Compose 自动编排当前回合的 ask/plan/execute/verify/report");

    return rendered;
}
