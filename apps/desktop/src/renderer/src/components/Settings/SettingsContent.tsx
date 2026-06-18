// 设置内容 — 提取自 SettingsPanel, 可在独立窗口和模态中共用.
// 不含模态 chrome (backdrop / dialog / close 按钮). 仅做 tab 路由 + 外壳.

import React, { useEffect, useState } from 'react';
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
import { isSettingsTab, type SettingsTab } from './tab-defs';

interface SettingsContentProps {
    onClose?: () => void;
}

export function SettingsContent({ onClose }: SettingsContentProps = {}): React.JSX.Element {
    const { loadPiConfig, lastWriteError, clearWriteError } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
    const { t } = useI18n();
    const translateIpcError = useTranslateIpcError();
    const writeErrorMessage: string | null = lastWriteError == null
        ? null
        : typeof lastWriteError === "string"
            ? lastWriteError
            : translateIpcError(lastWriteError as IpcError);

    useEffect(() => {
        clearWriteError();
    }, [clearWriteError]);

    useEffect(() => {
        const onSelectTab = (event: Event): void => {
            const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab;
            if (isSettingsTab(tab)) setActiveTab(tab);
        };
        window.addEventListener("settings:select-tab", onSelectTab);
        return () => window.removeEventListener("settings:select-tab", onSelectTab);
    }, []);

    const tabs: Array<{ id: SettingsTab; label: string; caption: string }> = [
        { id: 'appearance', label: t('settings.tab.appearance'), caption: t('settings.tabCaption.appearance') },
        { id: 'model', label: t('settings.tab.model'), caption: t('settings.tabCaption.model') },
        { id: 'piagent', label: t('settings.tab.piagent'), caption: t('settings.tabCaption.piagent') },
        { id: 'config', label: '配置中心', caption: '编辑 Pi Agent JSON 配置' },
        { id: 'general', label: t('settings.tab.general'), caption: t('settings.tabCaption.general') },
        { id: 'shortcuts', label: '快捷键', caption: '自定义键盘快捷键' },
        { id: 'about', label: t('settings.tab.about'), caption: t('settings.tabCaption.about') },
    ];

    return (
        <>
            <SettingsNav tabs={tabs} activeTab={activeTab} onSelectTab={setActiveTab} />

            <main className="flex min-w-0 flex-1 flex-col bg-[var(--mm-bg-panel)]">
                <div className="flex items-center justify-between border-b border-[var(--mm-border)] px-7 py-4">
                    <div className="min-w-0">
                        <div className="text-[13px] text-[var(--mm-text-tertiary)]">{t('settings.title')}</div>
                        <div className="truncate text-[18px] font-semibold text-[var(--mm-text-primary)]">
                            {tabs.find((tab) => tab.id === activeTab)?.label}
                        </div>
                    </div>
                    {writeErrorMessage && (
                        <div className="mx-4 flex min-w-0 flex-1 items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                            <span className="truncate">{writeErrorMessage}</span>
                            <button type="button" onClick={clearWriteError} className="settings-pressable ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-500 transition-[transform,background-color,color] duration-150 ease-out hover:bg-red-100 hover:text-red-700" aria-label="Dismiss">
                                <CloseIcon />
                            </button>
                        </div>
                    )}
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="settings-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--mm-text-tertiary)] transition-[transform,background-color,color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                            aria-label={t('common.close')}
                            title={t('common.close')}
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
                    {activeTab === 'appearance' && <AppearanceTab />}
                    {activeTab === 'model' && (
                        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-model" aria-labelledby="settings-tab-model">
                            <ManagedModelsPanel onPiConfigChanged={loadPiConfig} />
                        </div>
                    )}
                    {activeTab === 'piagent' && <PiAgentTab />}
                    {activeTab === 'general' && <GeneralTab />}
                    {activeTab === 'config' && <PiConfigEditor />}
                    {activeTab === 'shortcuts' && (
                        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-shortcuts" aria-labelledby="settings-tab-shortcuts">
                            <ShortcutsSettings />
                        </div>
                    )}
                    {activeTab === 'about' && <AboutTab />}
                </div>

                {onClose && (
                    <div className="flex justify-end border-t border-[var(--mm-border)] px-7 py-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="settings-pressable rounded-lg bg-[#1f1f1f] px-4 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-[#333]"
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