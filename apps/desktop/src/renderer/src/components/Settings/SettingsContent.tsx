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
import { PermissionsTab } from './tabs/PermissionsTab';
import { isSettingsTab, type SettingsTab } from './tab-defs';

interface SettingsContentProps {
    onClose?: () => void;
}

export function SettingsContent({ onClose }: SettingsContentProps = {}): React.JSX.Element {
    const { loadPiConfig, lastWriteError, clearWriteError } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('model');
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
        { id: 'model', label: t('settings.tab.model'), caption: t('settings.tabCaption.model') },
        { id: 'piagent', label: t('settings.tab.piagent'), caption: t('settings.tabCaption.piagent') },
        { id: 'permissions', label: t('settings.tab.permissions'), caption: t('settings.tabCaption.permissions') },
        { id: 'appearance', label: t('settings.tab.appearance'), caption: t('settings.tabCaption.appearance') },
        { id: 'general', label: t('settings.tab.general'), caption: t('settings.tabCaption.general') },
        { id: 'shortcuts', label: t('settings.tab.shortcuts'), caption: t('settings.tabCaption.shortcuts') },
        { id: 'config', label: t('settings.tab.config'), caption: t('settings.tabCaption.config') },
        { id: 'about', label: t('settings.tab.about'), caption: t('settings.tabCaption.about') },
    ];
    const primaryTabs = tabs.filter((tab) => tab.id === 'model' || tab.id === 'piagent' || tab.id === 'permissions');

    return (
        <>
            <SettingsNav tabs={tabs} activeTab={activeTab} onSelectTab={setActiveTab} />

            <main className="flex min-w-0 flex-1 flex-col bg-[#f2f4f6]">
                <div className="flex min-h-[38px] items-center justify-between border-b border-[#dfe5eb] bg-[#f3f5f7] px-[26px] py-1.5">
                    <div className="flex h-full min-w-0 items-end gap-7">
                        {primaryTabs.map((tab) => {
                            const selected = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    aria-label={tab.label}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`relative flex h-[28px] items-center text-[12px] transition-colors ${
                                        selected ? "font-medium text-[#3f74a7]" : "text-[var(--mm-text-secondary)] hover:text-[var(--mm-text-primary)]"
                                    }`}
                                >
                                    {tab.label}
                                    {selected && <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-[var(--mm-accent-blue)]" aria-hidden="true" />}
                                </button>
                            );
                        })}
                    </div>
                    {writeErrorMessage && (
                        <div className="mx-2 flex min-w-0 flex-1 items-center justify-between rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700" role="alert">
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
                            className="settings-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--mm-text-tertiary)] transition-[transform,background-color,color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                            aria-label={t('common.close')}
                            title={t('common.close')}
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto py-0 pl-[6px] pr-[20px]">
                    {activeTab === 'appearance' && <AppearanceTab />}
                    {activeTab === 'model' && (
                        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-model" aria-labelledby="settings-tab-model">
                            <ManagedModelsPanel onPiConfigChanged={loadPiConfig} />
                        </div>
                    )}
                    {activeTab === 'piagent' && <PiAgentTab />}
                    {activeTab === 'permissions' && <PermissionsTab />}
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
