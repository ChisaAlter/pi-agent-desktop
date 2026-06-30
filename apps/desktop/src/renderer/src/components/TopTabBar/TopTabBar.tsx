import React from "react";
import { useI18n } from "../../i18n";

export interface TopTabBarProps {
    activeTab: string;
    onTabChange: (tabId: string) => void;
    rightSlot?: React.ReactNode;
}

interface TabDef {
    id: string;
    labelKey: string;
}

const TAB_DEFS: TabDef[] = [
    { id: "chat", labelKey: "topbar.chat" },
    { id: "tasks", labelKey: "topbar.tasks" },
    { id: "memory", labelKey: "topbar.memory" },
    { id: "tools", labelKey: "topbar.tools" },
    { id: "settings", labelKey: "topbar.settings" },
];

export function TopTabBar({ activeTab, onTabChange, rightSlot }: TopTabBarProps): React.JSX.Element {
    const { t } = useI18n();

    return (
        <div
            className="app-region-drag flex h-full min-w-0 flex-1 items-center bg-transparent"
            data-mmcode-component="top-tabbar"
            role="tablist"
            aria-label={t("topbar.ariaLabel")}
        >
            <div className="app-region-drag flex h-full items-center gap-5 pl-[28px]">
                {TAB_DEFS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-label={t(tab.labelKey)}
                            onClick={() => onTabChange(tab.id)}
                            className={`app-region-no-drag relative flex h-full items-center gap-1 rounded-none px-0 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-accent-blue)] ${
                                isActive
                                    ? "bg-transparent font-normal text-[var(--mm-text-primary)]"
                                    : "font-normal text-[var(--mm-text-tertiary)] hover:text-[var(--mm-text-primary)]"
                            }`}
                            data-mmcode-tab={tab.id}
                        >
                            <span className="whitespace-nowrap">{t(tab.labelKey)}</span>
                            {isActive && (
                                <span
                                    className="absolute bottom-[-1px] left-[-4px] right-[-6px] h-px rounded-full bg-[var(--mm-accent-blue)]"
                                    aria-hidden="true"
                                />
                            )}
                        </button>
                    );
                })}
            </div>
            {rightSlot && <div className="app-region-no-drag ml-auto flex items-center gap-2 pr-2">{rightSlot}</div>}
        </div>
    );
}
