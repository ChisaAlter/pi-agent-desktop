import React from "react";
import { useI18n } from "../../i18n";
import { useHerdrStore, type HerdrLayoutMode } from "../../stores/herdr-store";
import { useSettingsStore } from "../../stores/settings-store";

/**
 * Herdr 布局切换器（UI-REQ-003，D4 作用域：仅「智能体/任务编排」tab 显示）：
 * 左下角浮层（原型 .variant-switch），studio=智能体工作台 / mission=任务优先 /
 * terminal=终端优先。切换时按原型 applyVariant 行为联动默认视图
 * （mission → 任务驾驶舱；terminal → 实时终端）。
 */

const LAYOUTS: HerdrLayoutMode[] = ["studio", "mission", "terminal"];

export function HerdrLayoutSwitcher(): React.JSX.Element {
    const { t } = useI18n();
    const mode = useSettingsStore((s) => s.herdrLayoutMode);
    const setHerdrLayoutMode = useSettingsStore((s) => s.setHerdrLayoutMode);
    const setView = useHerdrStore((s) => s.setView);

    const applyMode = (next: HerdrLayoutMode): void => {
        setHerdrLayoutMode(next);
        // 原型 applyVariant: mission 布局 → 任务驾驶舱; terminal 布局 → 实时终端
        if (next === "mission") setView("mission");
        if (next === "terminal") setView("pane");
    };

    return (
        <div
            className="fixed bottom-3 left-3 z-50 flex items-center gap-1 rounded-[14px] bg-[#182132ef] px-1.5 py-1 shadow-[0_12px_35px_rgba(0,0,0,0.33)]"
            data-testid="layout-switcher"
            aria-label={t("herdr.layout.title")}
        >
            <span className="select-none px-1.5 text-[11px] text-[#aebbd0]" aria-hidden="true">
                {t("herdr.layout.label")}
            </span>
            {LAYOUTS.map((m) => (
                <button
                    key={m}
                    type="button"
                    data-testid={`layout-${m}`}
                    aria-pressed={mode === m}
                    onClick={() => applyMode(m)}
                    className={`rounded-[10px] border border-transparent px-2 py-1 text-[11px] transition-colors ${
                        mode === m ? "bg-white font-medium text-[#182132]" : "text-[#c8d3e4] hover:bg-[#ffffff14]"
                    }`}
                >
                    {t(`herdr.layout.${m}`)}
                </button>
            ))}
        </div>
    );
}
