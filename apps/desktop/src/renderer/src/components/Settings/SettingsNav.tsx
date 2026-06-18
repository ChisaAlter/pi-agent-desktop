// 设置侧边导航 — tab 列表 + 重置按钮. 从 SettingsContent 抽出.

import React from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { useI18n } from '../../i18n';
import { type SettingsTab } from './tab-defs';

export function SettingsNav({
    tabs,
    activeTab,
    onSelectTab,
}: {
    tabs: ReadonlyArray<{ id: SettingsTab; label: string; caption: string }>;
    activeTab: SettingsTab;
    onSelectTab: (tab: SettingsTab) => void;
}): React.JSX.Element {
    const { resetSettings } = useSettingsStore();
    const { t } = useI18n();

    return (
        <aside className="flex w-[250px] shrink-0 flex-col border-r border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)]">
            <div className="px-5 pb-4 pt-5">
                <h2 className="m-0 text-[17px] font-semibold text-[var(--mm-text-primary)]">{t('settings.title')}</h2>
            </div>
            <nav className="flex-1 px-3" role="tablist" aria-label={t('settings.tabsAria')}>
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
                            className={`settings-pressable mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-[transform,background-color,color,box-shadow] duration-150 ease-out ${
                                isActive
                                    ? 'bg-[var(--mm-bg-panel)] text-[var(--mm-text-primary)] shadow-sm'
                                    : 'text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]'
                            }`}
                        >
                            <span className="block text-sm font-medium">{tab.label}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-[var(--mm-text-tertiary)]">{tab.caption}</span>
                        </button>
                    );
                })}
            </nav>
            <div className="border-t border-[var(--mm-border)] p-3">
                <button
                    type="button"
                    onClick={resetSettings}
                    className="settings-pressable w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color,color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                    aria-label={t('settings.resetAria')}
                >
                    {t('settings.reset')}
                </button>
            </div>
        </aside>
    );
}