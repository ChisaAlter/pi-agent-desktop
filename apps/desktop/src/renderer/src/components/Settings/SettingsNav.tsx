// 设置侧边导航 — 单左栏分段 + 本地搜索.

import React from 'react';
import { useI18n } from '../../i18n';
import type { SettingsNavSection, SettingsSearchResult, SettingsTab } from './tab-defs';

function SearchIcon(): React.JSX.Element {
    return (
        <svg className="h-4 w-4 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
        </svg>
    );
}

function SettingsNavIcon({ id }: { id: SettingsTab }): React.JSX.Element {
    const common = "h-4 w-4 shrink-0";
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

function NavTabButton({
    tab,
    active,
    onClick,
}: {
    tab: SettingsNavSection["tabs"][number];
    active: boolean;
    onClick: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`settings-tabpanel-${tab.id}`}
            aria-label={tab.label}
            id={`settings-tab-${tab.id}`}
            onClick={onClick}
            className={`settings-pressable flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[transform,background-color,color,box-shadow] duration-150 ease-out ${
                active
                    ? 'bg-[var(--mm-bg-selected)] text-[var(--mm-accent-blue)] shadow-[inset_0_0_0_1px_rgba(10,104,196,0.08)]'
                    : 'text-[var(--settings-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]'
            }`}
        >
            <SettingsNavIcon id={tab.id} />
            <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-4">{tab.label}</span>
                <span className={`mt-0.5 block text-[11px] leading-[14px] ${active ? 'text-[var(--mm-accent-blue)]/80' : 'text-[var(--mm-text-tertiary)]'}`}>
                    {tab.caption}
                </span>
            </span>
        </button>
    );
}

function SearchResultButton({
    result,
    active,
    onClick,
}: {
    result: SettingsSearchResult;
    active: boolean;
    onClick: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`settings-tabpanel-${result.tabId}`}
            aria-label={`${result.pageLabel} · ${result.label}`}
            id={`settings-tab-${result.tabId}-search-${result.anchor}`}
            onClick={onClick}
            className={`settings-pressable flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[transform,background-color,color,box-shadow] duration-150 ease-out ${
                active
                    ? 'bg-[var(--mm-bg-selected)] text-[var(--mm-accent-blue)] shadow-[inset_0_0_0_1px_rgba(10,104,196,0.08)]'
                    : 'text-[var(--settings-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]'
            }`}
        >
            <SettingsNavIcon id={result.tabId} />
            <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-4 text-[var(--mm-text-primary)]">{result.label}</span>
                <span className="mt-0.5 block text-[11px] leading-[14px] text-[var(--mm-text-tertiary)]">
                    {result.pageLabel} · {result.pageCaption}
                </span>
                {result.description && (
                    <span className="mt-1 block text-[11px] leading-[14px] text-[var(--mm-text-tertiary)]">
                        {result.description}
                    </span>
                )}
            </span>
        </button>
    );
}

export function SettingsNav({
    sections,
    searchQuery,
    searchResults,
    activeTab,
    activeAnchor,
    onSearchQueryChange,
    onSelectTab,
    onSelectSearchResult,
}: {
    sections: ReadonlyArray<SettingsNavSection>;
    searchQuery: string;
    searchResults: ReadonlyArray<SettingsSearchResult>;
    activeTab: SettingsTab;
    activeAnchor: string;
    onSearchQueryChange: (value: string) => void;
    onSelectTab: (tab: SettingsTab) => void;
    onSelectSearchResult: (result: SettingsSearchResult) => void;
}): React.JSX.Element {
    const { t } = useI18n();
    const inSearchMode = searchQuery.trim().length > 0;

    return (
        <aside className="flex w-[224px] shrink-0 flex-col border-r border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)]">
            <div className="border-b border-[var(--mm-border)] px-3 py-3">
                <div className="flex items-center gap-2 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-2.5 py-2">
                    <SearchIcon />
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => onSearchQueryChange(event.target.value)}
                        className="w-full bg-transparent text-sm text-[var(--mm-text-primary)] outline-none placeholder:text-[var(--mm-text-tertiary)]"
                        placeholder={t('settings.nav.searchPlaceholder')}
                        aria-label={t('settings.nav.searchPlaceholder')}
                    />
                </div>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" role="tablist" aria-label={t('settings.tabsAria')}>
                {inSearchMode ? (
                    <div className="space-y-1.5">
                        <div className="px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--mm-text-tertiary)]">
                            {t('settings.nav.searchResults')}
                        </div>
                        {searchResults.length > 0 ? (
                            searchResults.map((result) => (
                                <SearchResultButton
                                    key={result.id}
                                    result={result}
                                    active={activeTab === result.tabId && activeAnchor === result.anchor}
                                    onClick={() => onSelectSearchResult(result)}
                                />
                            ))
                        ) : (
                            <div className="rounded-xl border border-dashed border-[var(--mm-border)] px-4 py-4 text-sm text-[var(--mm-text-tertiary)]">
                                {t('settings.nav.noResults')}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3.5">
                        {sections.map((section) => (
                            <section key={section.id}>
                                <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--mm-text-tertiary)]">
                                    {section.label}
                                </div>
                                <div className="space-y-0.5">
                                    {section.tabs.map((tab) => (
                                        <NavTabButton
                                            key={tab.id}
                                            tab={tab}
                                            active={activeTab === tab.id}
                                            onClick={() => onSelectTab(tab.id)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </nav>
        </aside>
    );
}
