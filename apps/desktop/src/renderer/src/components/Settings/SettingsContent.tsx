// 设置内容 — 独立设置窗口复用的左栏单导航壳.

import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { useI18n, useTranslateIpcError } from '../../i18n';
import { type IpcError } from '@shared';
import { CloseIcon } from './_shared';
import { SettingsNav } from './SettingsNav';
import { GeneralTab } from './tabs/GeneralTab';
import { PermissionsTab } from './tabs/PermissionsTab';
import { isSettingsTab, type SettingsSearchResult, type SettingsTab } from './tab-defs';
import { buildSettingsNavigation, getDefaultSettingsAnchor, searchSettings } from './settings-nav-metadata';

const AppearanceTab = lazy(() => import('./tabs/AppearanceTab').then((module) => ({ default: module.AppearanceTab })));
const PiAgentTab = lazy(() => import('./tabs/PiAgentTab').then((module) => ({ default: module.PiAgentTab })));
const AboutTab = lazy(() => import('./tabs/AboutTab').then((module) => ({ default: module.AboutTab })));
const ManagedModelsPanel = lazy(() => import('./tabs/ManagedModelsPanel').then((module) => ({ default: module.ManagedModelsPanel })));
const PiConfigEditor = lazy(() => import('./tabs/PiConfigEditor').then((module) => ({ default: module.PiConfigEditor })));
const UsageTab = lazy(() => import('./tabs/UsageTab').then((module) => ({ default: module.UsageTab })));
const LongHorizonTab = lazy(() => import('./tabs/LongHorizonTab').then((module) => ({ default: module.LongHorizonTab })));
const ShortcutsSettings = lazy(() => import('./ShortcutsSettings/ShortcutsSettings').then((module) => ({ default: module.ShortcutsSettings })));

interface SettingsContentProps {
    onClose?: () => void;
}

function SettingsTabReady({
    tab,
    onReady,
    children,
}: {
    tab: SettingsTab;
    onReady: React.Dispatch<React.SetStateAction<SettingsTab | null>>;
    children: React.ReactNode;
}): React.JSX.Element {
    useEffect(() => {
        onReady(tab);
    }, [onReady, tab]);
    return <>{children}</>;
}

export function SettingsContent({ onClose }: SettingsContentProps = {}): React.JSX.Element {
    const { loadPiConfig, lastWriteError, clearWriteError } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [activeAnchor, setActiveAnchor] = useState<string>(getDefaultSettingsAnchor('general'));
    const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
    const [contentReadyTab, setContentReadyTab] = useState<SettingsTab | null>(null);
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
        if (!pendingAnchor || contentReadyTab !== activeTab) return;

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
    }, [activeTab, contentReadyTab, pendingAnchor]);

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
                        <Suspense fallback={<div className="min-h-full" aria-busy="true" data-testid="settings-tab-loading" />}>
                            <SettingsTabReady tab={activeTab} onReady={setContentReadyTab}>
                                {activeTabContent}
                            </SettingsTabReady>
                        </Suspense>
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
