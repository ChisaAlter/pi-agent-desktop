import React from "react";
import { useI18n } from "../../i18n";
import { useHerdrStore, type HerdrView } from "../../stores/herdr-store";
import { useSettingsStore } from "../../stores/settings-store";
import { AgentsPanel } from "../Agents/AgentsPanel";
import { HerdrPaneTerminal } from "./HerdrPaneTerminal";
import { MissionCockpit } from "./MissionCockpit";

/**
 * HerdrControlSurface — 「智能体」tab 中部控制面（与原型 .center 1:1）：
 *   - 视图切换：智能体总览 / 实时终端 / 任务驾驶舱
 *   - 布局模式（D4）：terminal 模式 → 暗色控制面 + 终端全宽（隐藏身份面板）；
 *     mission 模式 → 任务优先（由切换器切视图）
 *   - 顶部行 pl-12 给左上「折叠左侧栏」浮层按钮让位（UI-REQ-071 惯例）
 */
const VIEW_TABS: HerdrView[] = ["fleet", "pane", "mission"];

export function HerdrControlSurface(): React.JSX.Element {
    const { t } = useI18n();
    const view = useHerdrStore((s) => s.view);
    const setView = useHerdrStore((s) => s.setView);
    const layoutMode = useSettingsStore((s) => s.herdrLayoutMode);

    const terminalDark = layoutMode === "terminal";

    return (
        <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-colors ${terminalDark ? "bg-[#111827]" : ""}`}
            data-testid="herdr-control-surface"
        >
            <div
                className={`flex shrink-0 items-center gap-2 pl-12 pr-4 pt-3 pb-2 ${terminalDark ? "text-[#dce5f4]" : ""}`}
                data-testid="herdr-view-tabs"
            >
                {VIEW_TABS.map((v) => {
                    const isActive = view === v;
                    return (
                        <button
                            key={v}
                            type="button"
                            data-testid="herdr-view-tab"
                            data-view={v}
                            aria-selected={isActive}
                            onClick={() => setView(v)}
                            className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
                                isActive
                                    ? "border-[#1f2937] bg-[#1f2937] text-white"
                                    : terminalDark
                                      ? "border-[#344156] bg-transparent text-[#c8d3e4] hover:border-[#4a5a72]"
                                      : "border-[var(--mm-border)] bg-transparent text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
                            }`}
                        >
                            {t(`herdr.view.${v}`)}
                        </button>
                    );
                })}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {view === "fleet" ? <AgentsPanel /> : null}
                {view === "pane" ? <HerdrPaneTerminal hideIdentity={terminalDark} /> : null}
                {view === "mission" ? <MissionCockpit /> : null}
            </div>
        </div>
    );
}
