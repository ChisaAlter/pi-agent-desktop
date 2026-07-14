// 设置内容 — 独立设置窗口复用的左栏单导航壳.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { ShortcutsSettings } from './ShortcutsSettings/ShortcutsSettings';
import { useI18n, useTranslateIpcError } from '../../i18n';
import { type IpcError } from '@shared';
import { CloseIcon } from './_shared';
import { SettingsNav } from './SettingsNav';
import { AppearanceTab } from './tabs/AppearanceTab';
import { PiAgentTab } from './tabs/PiAgentTab';
import { GeneralTab } from './tabs/GeneralTab';
import { AboutTab } from './tabs/AboutTab';
import { ManagedModelsPanel } from './tabs/ManagedModelsPanel';
import { PiConfigEditor } from './tabs/PiConfigEditor';
import { PermissionsTab } from './tabs/PermissionsTab';
import { UsageTab } from './tabs/UsageTab';
import { LongHorizonTab } from './tabs/LongHorizonTab';
import { isSettingsTab, type SettingsSearchResult, type SettingsTab } from './tab-defs';
import { buildSettingsNavigation, getDefaultSettingsAnchor, searchSettings } from './settings-nav-metadata';

interface SettingsContentProps {
    onClose?: () => void;
}

export function SettingsContent({ onClose }: SettingsContentProps = {}): React.JSX.Element {
    const { loadPiConfig, lastWriteError, clearWriteError } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [activeAnchor, setActiveAnchor] = useState<string>(getDefaultSettingsAnchor('general'));
    const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const scrollRegionRef = useRef<HTMLDivElement>(null);
    const { t } = useI18n();
    const translateIpcError = useTranslateIpcError();

    const writeErrorMessage: string | null = lastWriteError == null
        ? null
        : typeof lastWriteError === "string"
            ? lastWriteError
            : translateIpcError(lastWriteError as IpcError);

    const sections = useMemo(() => buildSettingsNavigation(t), [t]);
    const searchResults = useMemo(() => searchSettings(sections, searchQuery), [searchQuery, sections]);

    const selectLocation = (tab: SettingsTab, anchor = getDefaultSettingsAnchor(tab)): void => {
        setActiveTab(tab);
        setActiveAnchor(anchor);
        setPendingAnchor(anchor);
    };

    useEffect(() => {
        clearWriteError();
    }, [clearWriteError]);

    useEffect(() => {
        const onSelectTab = (event: Event): void => {
            const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab;
            if (isSettingsTab(tab)) {
                selectLocation(tab);
            }
        };
        window.addEventListener("settings:select-tab", onSelectTab);
        return () => window.removeEventListener("settings:select-tab", onSelectTab);
    }, []);

    useEffect(() => {
        if (!pendingAnchor) return;

        const root = scrollRegionRef.current;
        const frame = window.requestAnimationFrame(() => {
            const target = root?.querySelector<HTMLElement>(`[data-settings-anchor="${pendingAnchor}"]`);
            if (target) {
                target.scrollIntoView({ block: "start" });
            } else {
                root?.scrollTo({ top: 0 });
            }
            setPendingAnchor(null);
        });

        return () => window.cancelAnimationFrame(frame);
    }, [activeTab, pendingAnchor]);

    const activeTabContent = (() => {
        switch (activeTab) {
            case 'appearance': return <AppearanceTab />;
            case 'model': return <ManagedModelsPanel onPiConfigChanged={loadPiConfig} />;
            case 'piagent': return <PiAgentTab />;
            case 'permissions': return <PermissionsTab />;
            case 'usage': return <UsageTab />;
            case 'longHorizon': return <LongHorizonTab />;
            case 'general': return <GeneralTab />;
            case 'config': return <PiConfigEditor />;
            case 'shortcuts': return <ShortcutsSettings />;
            case 'about': return <AboutTab />;
        }
    })();

    return (
        <>
            <SettingsNav
                sections={sections}
                searchQuery={searchQuery}
                searchResults={searchResults}
                activeTab={activeTab}
                activeAnchor={activeAnchor}
                onSearchQueryChange={setSearchQuery}
                onSelectTab={(tab) => selectLocation(tab)}
                onSelectSearchResult={(result: SettingsSearchResult) => selectLocation(result.tabId, result.anchor)}
            />

            <main className="flex min-w-0 flex-1 flex-col bg-[var(--mm-bg-main)]">
                {(writeErrorMessage || onClose) && (
                    <div className="flex min-h-[54px] items-center justify-between border-b border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-6 py-3">
                        {writeErrorMessage ? (
                            <div className="mx-0 flex min-w-0 flex-1 items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                                <span className="truncate">{writeErrorMessage}</span>
                                <button type="button" onClick={clearWriteError} className="settings-pressable ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-500 transition-[transform,background-color,color] duration-150 ease-out hover:bg-red-100 hover:text-red-700" aria-label="Dismiss">
                                    <CloseIcon />
                                </button>
                            </div>
                        ) : <div />}
                        {onClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="settings-pressable ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--mm-text-tertiary)] transition-[transform,background-color,color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                                aria-label={t('common.close')}
                                title={t('common.close')}
                            >
                                <CloseIcon />
                            </button>
                        )}
                    </div>
                )}

                <div ref={scrollRegionRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-scroll-region">
                    <div
                        key={activeTab}
                        className="settings-tab-panel-motion min-h-full"
                        data-testid="settings-active-panel"
                        data-settings-active-tab={activeTab}
                    >
                        {activeTabContent}
                    </div>
                </div>

                {onClose && (
                    <div className="flex justify-end border-t border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-7 py-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="settings-pressable rounded-lg bg-[var(--mm-accent-blue)] px-4 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:opacity-90"
                            aria-label={t('settings.closeAria')}
                        >
                            {t('common.done')}
                        </button>
                    </div>
                )}
            </main>
        </>
    );
}
