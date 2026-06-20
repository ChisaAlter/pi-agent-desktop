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
    { id: "skills", labelKey: "topbar.skills" },
    { id: "git", labelKey: "topbar.git" },
    { id: "history", labelKey: "topbar.history" },
];

export function TopTabBar({ activeTab, onTabChange, rightSlot }: TopTabBarProps): React.JSX.Element {
    const { t } = useI18n();

    return (
        <div
            className="flex h-full min-w-0 flex-1 items-center bg-transparent"
            data-mmcode-component="top-tabbar"
            role="tablist"
            aria-label={t("topbar.ariaLabel")}
        >
            <div className="flex h-full items-center gap-5 pl-[28px]">
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
                            className={`relative flex h-full items-center gap-1 rounded-none px-0 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-accent-blue)] ${
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
                <button
                    type="button"
                    onClick={() => void window.piAPI?.openSettingsWindow?.()}
                    className="relative flex h-full items-center rounded-none px-0 text-[14px] font-normal text-[var(--mm-text-tertiary)] transition-colors hover:text-[var(--mm-text-primary)] focus:outline-none"
                    aria-label="打开设置窗口"
                >
                    <span className="whitespace-nowrap">设置</span>
                </button>
            </div>
            {rightSlot && <div className="sr-only">{rightSlot}</div>}
        </div>
    );
}
