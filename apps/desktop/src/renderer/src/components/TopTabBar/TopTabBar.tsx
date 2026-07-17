import React from "react";
import { useI18n } from "../../i18n";

export interface TopTabBarProps {
    activeTab: string;
    onTabChange: (tabId: string) => void;
    onOpenSettings?: () => void;
    rightSlot?: React.ReactNode;
}

interface TabDef {
    id: string;
    labelKey: string;
}

const TAB_DEFS: TabDef[] = [
    { id: "chat", labelKey: "topbar.chat" },
    { id: "run", labelKey: "topbar.run" },
    { id: "workbench", labelKey: "topbar.workbench" },
    { id: "extensions", labelKey: "topbar.extensions" },
];

export function TopTabBar({ activeTab, onTabChange, onOpenSettings, rightSlot }: TopTabBarProps): React.JSX.Element {
    const { t } = useI18n();
    const dragPointerRef = React.useRef<number | null>(null);

    const finishTitlebarDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
        if (dragPointerRef.current !== event.pointerId) return;
        dragPointerRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        window.piAPI?.windowEndDrag();
    };

    return (
        <div
            className="app-region-drag flex h-full min-w-0 flex-1 items-center bg-transparent"
            data-mmcode-component="top-tabbar"
            role="tablist"
            aria-label={t("topbar.ariaLabel")}
        >
            <div className="app-region-drag flex h-full shrink-0 items-center gap-5 pl-[28px]">
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
            <div
                className="app-region-no-drag h-full min-w-[96px] flex-1 touch-none cursor-default"
                data-mmcode-region="titlebar-drag-surface"
                aria-hidden="true"
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    dragPointerRef.current = event.pointerId;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    window.piAPI?.windowBeginDrag(event.screenX, event.screenY);
                }}
                onPointerMove={(event) => {
                    if (dragPointerRef.current !== event.pointerId) return;
                    if (event.buttons === 0) {
                        finishTitlebarDrag(event);
                        return;
                    }
                    window.piAPI?.windowUpdateDrag(event.screenX, event.screenY);
                }}
                onPointerUp={finishTitlebarDrag}
                onPointerCancel={finishTitlebarDrag}
                onDoubleClick={() => void window.piAPI?.windowToggleMaximize()}
            />
            {rightSlot || onOpenSettings ? (
                <div className="app-region-no-drag flex shrink-0 items-center gap-2 pr-2">
                    {rightSlot}
                    {onOpenSettings ? (
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-accent-blue)]"
                            aria-label={t("app.openSettingsAria")}
                            title={t("topbar.settings")}
                        >
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.03 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.61.77 1 1.52 1H21v4h-.08c-.75 0-1.32.39-1.52 1Z" />
                            </svg>
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
