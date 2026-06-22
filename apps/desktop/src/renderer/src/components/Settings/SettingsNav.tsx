// 设置侧边导航 — tab 列表 + 重置按钮. 从 SettingsContent 抽出.

import React from 'react';
import { useI18n } from '../../i18n';
import { type SettingsTab } from './tab-defs';

function SettingsNavIcon({ id }: { id: SettingsTab }): React.JSX.Element {
    const common = "ml-[3px] h-3.5 w-3.5 shrink-0";
    const paths: Record<SettingsTab, React.ReactNode> = {
        model: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-5v3m0 12v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M3 12h3m12 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />,
        piagent: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M2.5 8.5a15 15 0 0 1 19 0M5.5 11.5a10.5 10.5 0 0 1 13 0M8.5 14.5a6 6 0 0 1 7 0M12 18h.01" />,
        permissions: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 8h16v11H4zM7 8V5h10v3M8 13h8" />,
        usage: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 19V5m0 14h16M8 16v-4m4 4V8m4 8v-7M7 5h10" />,
        longHorizon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 6h7v7H4zM13 4h7v7h-7zM6 15h7v5H6zM15 13h5v7h-5zM11 9h2m-1 4v2" />,
        appearance: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 3l7 3v5c0 4.2-2.7 7.7-7 9-4.3-1.3-7-4.8-7-9V6l7-3Zm-3 9 2 2 4-5" />,
        general: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m2 3h2" />,
        shortcuts: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 12a9 9 0 0 1 15-6.7M21 5v5h-5M21 12a9 9 0 0 1-15 6.7M3 19v-5h5" />,
        config: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8 4h8l3 3v13H8zM16 4v4h4M4 8h3M4 12h3M4 16h3" />,
        about: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 17v-5m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
    };
    return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            {paths[id]}
        </svg>
    );
}

export function SettingsNav({
    tabs,
    activeTab,
    onSelectTab,
}: {
    tabs: ReadonlyArray<{ id: SettingsTab; label: string; caption: string }>;
    activeTab: SettingsTab;
    onSelectTab: (tab: SettingsTab) => void;
}): React.JSX.Element {
    const { t } = useI18n();
    return (
        <aside className="flex w-[142px] shrink-0 flex-col border-r border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)]">
            <nav className="flex-1 px-1 pt-[12px]" role="tablist" aria-label={t('settings.tabsAria')}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={`settings-tabpanel-${tab.id}`}
                            aria-label={tab.label}
                            id={`settings-tab-${tab.id}`}
                            onClick={() => onSelectTab(tab.id)}
                            className={`settings-pressable mb-[4px] flex -ml-px h-[31px] w-full items-center gap-2 rounded-[4px] px-2 text-left transition-[transform,background-color,color,box-shadow] duration-150 ease-out ${
                                isActive
                                    ? 'relative top-[4px] border-l-2 border-l-[var(--mm-accent-blue)] bg-[var(--mm-bg-selected)] text-[var(--mm-accent-blue)] shadow-none'
                                    : 'text-[var(--settings-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]'
                            }`}
                        >
                            <SettingsNavIcon id={tab.id} />
                            <span className="min-w-0">
                                <span className="block truncate text-[12px] font-normal leading-4">{tab.label}</span>
                            </span>
                        </button>
                    );
                })}
            </nav>
        </aside>
    );
}
