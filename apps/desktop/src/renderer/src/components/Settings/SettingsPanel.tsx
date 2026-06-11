// 设置面板 - MiniMax Code 参考风格: 大模态、左侧分类、浅色密集表单.

import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { PiStatusPanel } from '../PiStatusPanel';
import { ShortcutsSettings } from './ShortcutsSettings/ShortcutsSettings';
import { useI18n, useTranslateIpcError, SUPPORTED_LOCALES, type Locale } from '../../i18n';
import type { IpcError, PiAuthFile, PiModelsFile, PiSettingsFile } from '@shared';
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume } from '../../utils/sounds';
import { requestNotificationPermission, canNotify } from '../../utils/notifications';

type SettingsTab = 'appearance' | 'model' | 'piagent' | 'config' | 'general' | 'shortcuts' | 'about';

function CloseIcon(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18 18 6M6 6l12 12" />
        </svg>
    );
}

function SectionTitle({ title, description }: { title: string; description?: string }): React.JSX.Element {
    return (
        <div className="mb-5">
            <h3 className="m-0 text-[15px] font-semibold text-[#1f1f1f]">{title}</h3>
            {description && <p className="m-0 mt-1 text-xs leading-5 text-[#777]">{description}</p>}
        </div>
    );
}

function FieldRow({
    label,
    description,
    children,
}: {
    label: string;
    description?: string;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="grid grid-cols-[minmax(160px,220px)_1fr] items-center gap-6 border-b border-[#f0f0ed] py-4 last:border-b-0">
            <div>
                <label className="block text-sm font-medium text-[#262626]">{label}</label>
                {description && <p className="m-0 mt-1 text-xs leading-5 text-[#777]">{description}</p>}
            </div>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

function SwitchControl({
    checked,
    label,
    onChange,
}: {
    checked: boolean;
    label: string;
    onChange: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={onChange}
            className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-[#1f1f1f]' : 'bg-[#d9d9d4]'}`}
        >
            <span
                aria-hidden="true"
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
        </button>
    );
}

export function SettingsPanel(): React.JSX.Element {
    const { settings, isOpen, closeSettings, updateSettings, resetSettings, piModels, lastWriteError, clearWriteError } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
    const [piFullConfig, setPiFullConfig] = useState<Awaited<ReturnType<typeof window.piAPI.getFullConfig>> | null>(null);
    const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled());
    const [soundVolume, setSoundVolumeState] = useState(getSoundVolume());
    const [notificationsEnabled, setNotificationsEnabled] = useState(canNotify());
    const { t, locale, setLocale } = useI18n();
    const translateIpcError = useTranslateIpcError();
    const writeErrorMessage: string | null = lastWriteError == null
        ? null
        : typeof lastWriteError === "string"
            ? lastWriteError
            : translateIpcError(lastWriteError as IpcError);

    useEffect(() => {
        if (!isOpen) clearWriteError();
    }, [isOpen, clearWriteError]);

    useEffect(() => {
        if (isOpen && window.piAPI?.getFullConfig) {
            window.piAPI.getFullConfig().then(setPiFullConfig).catch(console.error);
        }
    }, [isOpen]);

    if (!isOpen) return <></>;

    const selectedModelKey = settings.provider && settings.model
        ? `${settings.provider}:${settings.model}`
        : settings.model;
    const updateModelFromKey = (key: string): void => {
        const model = piModels?.find((item) => `${item.provider}:${item.id}` === key || item.id === key);
        if (model) {
            updateSettings({ model: model.id, provider: model.provider });
        }
    };
    const updateNumberSetting = (key: 'fontSize' | 'temperature' | 'maxTokens', value: string): void => {
        const next = key === 'temperature' ? Number.parseFloat(value) : Number.parseInt(value, 10);
        if (Number.isFinite(next)) {
            updateSettings({ [key]: next });
        }
    };

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6 backdrop-blur-[1px]">
            <div
                className="flex h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-[#e8e8e4] bg-[#f7f7f4] shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
                role="dialog"
                aria-modal="true"
                aria-label={t('settings.title')}
            >
                <aside className="flex w-[250px] shrink-0 flex-col border-r border-[#e2e2de] bg-[#f1f1ee]">
                    <div className="px-5 pb-4 pt-5">
                        <h2 className="m-0 text-[17px] font-semibold text-[#1f1f1f]">{t('settings.title')}</h2>
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
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                                        isActive
                                            ? 'bg-white text-[#1f1f1f] shadow-sm'
                                            : 'text-[#666] hover:bg-white/60 hover:text-[#262626]'
                                    }`}
                                >
                                    <span className="block text-sm font-medium">{tab.label}</span>
                                    <span className="mt-0.5 block truncate text-[11px] text-[#8a8a84]">{tab.caption}</span>
                                </button>
                            );
                        })}
                    </nav>
                    <div className="border-t border-[#e2e2de] p-3">
                        <button
                            type="button"
                            onClick={resetSettings}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#666] transition-colors hover:bg-white hover:text-[#1f1f1f]"
                            aria-label={t('settings.resetAria')}
                        >
                            {t('settings.reset')}
                        </button>
                    </div>
                </aside>

                <main className="flex min-w-0 flex-1 flex-col bg-white">
                    <div className="flex items-center justify-between border-b border-[#ededeb] px-7 py-4">
                        <div className="min-w-0">
                            <div className="text-[13px] text-[#8a8a84]">{t('settings.title')}</div>
                            <div className="truncate text-[18px] font-semibold text-[#1f1f1f]">
                                {tabs.find((tab) => tab.id === activeTab)?.label}
                            </div>
                        </div>
                        {writeErrorMessage && (
                            <div className="mx-4 flex min-w-0 flex-1 items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                                <span className="truncate">{writeErrorMessage}</span>
                                <button type="button" onClick={clearWriteError} className="ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-500 hover:bg-red-100 hover:text-red-700" aria-label="Dismiss">
                                    <CloseIcon />
                                </button>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={closeSettings}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#777] transition-colors hover:bg-[#f0f0ed] hover:text-[#1f1f1f]"
                            aria-label={t('common.close')}
                            title={t('common.close')}
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
                        {activeTab === 'appearance' && (
                            <div role="tabpanel" id="settings-tabpanel-appearance" aria-labelledby="settings-tab-appearance">
                                <SectionTitle title={t('settings.appearance.heading')} description={t('settings.appearance.description')} />
                                <div className="grid grid-cols-3 gap-3">
                                    {(['light', 'dark', 'system'] as const).map((theme) => {
                                        const active = settings.theme === theme;
                                        return (
                                            <button
                                                key={theme}
                                                type="button"
                                                onClick={() => useSettingsStore.getState().setTheme(theme)}
                                                className={`rounded-xl border p-3 text-left transition-colors ${
                                                    active ? 'border-[#1f1f1f] bg-[#fafafa]' : 'border-[#e4e4e0] bg-white hover:border-[#cfcfca]'
                                                }`}
                                            >
                                                <span className="block text-sm font-medium text-[#1f1f1f]">{t(`settings.theme.${theme}`)}</span>
                                                <span className="mt-3 block h-24 rounded-lg border border-[#e4e4e0] bg-[#f8f8f6] p-2">
                                                    <span className={`block h-full rounded-md ${theme === 'dark' ? 'bg-[#1f1f1f]' : theme === 'system' ? 'bg-gradient-to-r from-white to-[#1f1f1f]' : 'bg-white'} border border-[#dededb]`} />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-6 rounded-xl border border-[#ececea] bg-[#fbfbfa] px-4">
                                    <FieldRow label={t('settings.fontSize.label', { value: settings.fontSize })}>
                                        <input
                                            id="settings-font-size"
                                            type="range"
                                            min="12"
                                            max="20"
                                            value={settings.fontSize}
                                            onChange={(e) => updateNumberSetting('fontSize', e.target.value)}
                                            className="w-full"
                                            aria-label={t('settings.fontSize.aria')}
                                        />
                                    </FieldRow>
                                </div>
                            </div>
                        )}

                        {activeTab === 'model' && (
                            <div role="tabpanel" id="settings-tabpanel-model" aria-labelledby="settings-tab-model">
                                <SectionTitle title={t('settings.modelTab.heading')} description={t('settings.modelTab.description')} />
                                <div className="rounded-xl border border-[#ececea] bg-[#fbfbfa] px-4">
                                    <FieldRow label={t('settings.modelTab.current')} description={t('settings.modelTab.currentDescription')}>
                                        {piModels && piModels.length > 0 ? (
                                            <select
                                                id="settings-model"
                                                value={selectedModelKey}
                                                onChange={(e) => updateModelFromKey(e.target.value)}
                                                className="w-full rounded-lg border border-[#dcdcd8] bg-white px-3 py-2.5 text-sm text-[#1f1f1f] focus:border-[#1f1f1f] focus:outline-none"
                                            >
                                                {piModels.map((model) => (
                                                    <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
                                                        {model.name} ({model.providerName})
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="rounded-lg border border-dashed border-[#d8d8d3] bg-white px-3 py-2.5 text-sm text-[#888]">
                                                {t('settings.modelTab.empty')}
                                            </div>
                                        )}
                                    </FieldRow>
                                    <FieldRow label={t('settings.modelTab.temperature', { value: settings.temperature })}>
                                        <input
                                            id="settings-temperature"
                                            type="range"
                                            min="0"
                                            max="2"
                                            step="0.1"
                                            value={settings.temperature}
                                            onChange={(e) => updateNumberSetting('temperature', e.target.value)}
                                            className="w-full"
                                            aria-label={t('settings.modelTab.temperatureAria')}
                                        />
                                    </FieldRow>
                                    <FieldRow label={t('settings.modelTab.maxTokens')}>
                                        <input
                                            id="settings-max-tokens"
                                            type="number"
                                            value={settings.maxTokens}
                                            onChange={(e) => updateNumberSetting('maxTokens', e.target.value)}
                                            className="w-full rounded-lg border border-[#dcdcd8] bg-white px-3 py-2.5 text-sm text-[#1f1f1f] focus:border-[#1f1f1f] focus:outline-none"
                                        />
                                    </FieldRow>
                                </div>
                            </div>
                        )}

                        {activeTab === 'piagent' && (
                            <div role="tabpanel" id="settings-tabpanel-piagent" aria-labelledby="settings-tab-piagent">
                                <SectionTitle title={t('settings.piagent.heading')} description={t('settings.piagent.description')} />
                                <PiStatusPanel />

                                {piFullConfig ? (
                                    <div className="mt-4 space-y-4">
                                        <div>
                                            <div className="mb-2 text-sm font-medium text-[#262626]">{t('settings.piagent.configPath')}</div>
                                            <div className="rounded-lg border border-[#ececea] bg-[#fbfbfa] p-3 font-mono text-xs text-[#444] break-all">
                                                {piFullConfig.configPath}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="rounded-lg border border-[#ececea] bg-[#fbfbfa] p-3">
                                                <div className="text-xs text-[#777]">{t('settings.piagent.defaultProvider')}</div>
                                                <div className="mt-1 text-sm font-medium text-[#1f1f1f]">{piFullConfig.defaultProvider || t('settings.piagent.notSet')}</div>
                                            </div>
                                            <div className="rounded-lg border border-[#ececea] bg-[#fbfbfa] p-3">
                                                <div className="text-xs text-[#777]">{t('settings.piagent.defaultModel')}</div>
                                                <div className="mt-1 text-sm font-medium text-[#1f1f1f]">{piFullConfig.defaultModel || t('settings.piagent.notSet')}</div>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="mb-2 text-sm font-medium text-[#262626]">{t('settings.piagent.providers', { count: piFullConfig.providers.length })}</div>
                                            <div className="grid gap-2">
                                                {piFullConfig.providers.map((provider) => (
                                                    <div key={provider.id} className="rounded-lg border border-[#ececea] bg-[#fbfbfa] p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="truncate text-sm font-medium text-[#1f1f1f]">{provider.name}</span>
                                                            <span className="shrink-0 text-xs text-[#777]">{t('settings.piagent.modelCount', { count: provider.modelCount })}</span>
                                                        </div>
                                                        {provider.baseUrl && <div className="mt-1 truncate font-mono text-xs text-[#777]">{provider.baseUrl}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-lg border border-dashed border-[#d8d8d3] bg-[#fbfbfa] p-3 text-sm text-[#888]">
                                        {t('settings.piagent.loading')}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'general' && (
                            <div role="tabpanel" id="settings-tabpanel-general" aria-labelledby="settings-tab-general">
                                <SectionTitle title={t('settings.general.heading')} description={t('settings.general.description')} />
                                <div className="rounded-xl border border-[#ececea] bg-[#fbfbfa] px-4">
                                    <FieldRow label={t('settings.language.label')} description={t('settings.language.description')}>
                                        <select
                                            id="settings-language"
                                            value={locale}
                                            onChange={(e) => setLocale(e.target.value as Locale)}
                                            className="w-full rounded-lg border border-[#dcdcd8] bg-white px-3 py-2.5 text-sm text-[#1f1f1f] focus:border-[#1f1f1f] focus:outline-none"
                                        >
                                            {SUPPORTED_LOCALES.map((l) => (
                                                <option key={l} value={l}>
                                                    {t(`settings.language.options.${l}`)}
                                                </option>
                                            ))}
                                        </select>
                                    </FieldRow>
                                    <FieldRow label={t('settings.autoSave.label')}>
                                        <SwitchControl checked={settings.autoSave} label={t('settings.autoSave.label')} onChange={() => updateSettings({ autoSave: !settings.autoSave })} />
                                    </FieldRow>
                                    <FieldRow label={t('settings.showLineNumbers.label')}>
                                        <SwitchControl checked={settings.showLineNumbers} label={t('settings.showLineNumbers.label')} onChange={() => updateSettings({ showLineNumbers: !settings.showLineNumbers })} />
                                    </FieldRow>
                                    <FieldRow label={t('settings.wordWrap.label')}>
                                        <SwitchControl checked={settings.wordWrap} label={t('settings.wordWrap.label')} onChange={() => updateSettings({ wordWrap: !settings.wordWrap })} />
                                    </FieldRow>
                                </div>

                                <SectionTitle title="通知" description="控制系统通知和声音提示" />
                                <div className="rounded-xl border border-[#ececea] bg-[#fbfbfa] px-4">
                                    <FieldRow label="系统通知" description="任务完成和错误时发送系统通知">
                                        <SwitchControl
                                            checked={notificationsEnabled}
                                            label="系统通知"
                                            onChange={async () => {
                                                if (!notificationsEnabled) {
                                                    const result = await requestNotificationPermission();
                                                    setNotificationsEnabled(result === "granted");
                                                } else {
                                                    setNotificationsEnabled(false);
                                                }
                                            }}
                                        />
                                    </FieldRow>
                                    <FieldRow label="提示音" description="消息接收和任务完成时播放声音">
                                        <SwitchControl
                                            checked={soundEnabled}
                                            label="提示音"
                                            onChange={() => {
                                                const next = !soundEnabled;
                                                setSoundEnabledState(next);
                                                setSoundEnabled(next);
                                            }}
                                        />
                                    </FieldRow>
                                    {soundEnabled && (
                                        <FieldRow label={`音量: ${Math.round(soundVolume * 100)}%`}>
                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                value={Math.round(soundVolume * 100)}
                                                onChange={(e) => {
                                                    const vol = Number(e.target.value) / 100;
                                                    setSoundVolumeState(vol);
                                                    setSoundVolume(vol);
                                                }}
                                                className="w-full"
                                                aria-label="音量"
                                            />
                                        </FieldRow>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'config' && (
                            <PiConfigEditor />
                        )}

                        {activeTab === 'shortcuts' && (
                            <div role="tabpanel" id="settings-tabpanel-shortcuts" aria-labelledby="settings-tab-shortcuts">
                                <ShortcutsSettings />
                            </div>
                        )}

                        {activeTab === 'about' && (
                            <div role="tabpanel" id="settings-tabpanel-about" aria-labelledby="settings-tab-about">
                                <SectionTitle title={t('settings.about.heading')} />
                                <div className="rounded-xl border border-[#ececea] bg-[#fbfbfa] p-4 text-sm leading-6 text-[#666]">
                                    <p className="m-0 text-[#1f1f1f]">{t('settings.about.version', { version: '0.2.0' })}</p>
                                    <p className="m-0 mt-2">{t('settings.about.description')}</p>
                                    <p className="m-0 mt-2">{t('settings.about.stack')}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end border-t border-[#ededeb] px-7 py-4">
                        <button
                            type="button"
                            onClick={closeSettings}
                            className="rounded-lg bg-[#1f1f1f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333]"
                            aria-label={t('settings.closeAria')}
                        >
                            {t('common.done')}
                        </button>
                    </div>
                </main>
            </div>
        </div>
    );
}

function PiConfigEditor(): React.JSX.Element {
    const [fileName, setFileName] = useState<'models.json' | 'auth.json' | 'settings.json'>('models.json');
    const [raw, setRaw] = useState('');
    const [message, setMessage] = useState('');
    const [fetchStatus, setFetchStatus] = useState('');
    const [testStatus, setTestStatus] = useState('');

    const parseCurrentJson = <T,>(targetFile: typeof fileName, fallback: T): T => {
        if (fileName !== targetFile) return fallback;
        return JSON.parse(raw) as T;
    };

    const loadProviderSelection = async (setStatus: (message: string) => void): Promise<{
        baseUrl: string;
        apiKey?: string;
        apiType?: string;
        modelId?: string;
    } | null> => {
        const [modelsResult, authResult, settingsResult] = await Promise.all([
            fileName === 'models.json'
                ? Promise.resolve({ parsed: parseCurrentJson<PiModelsFile>('models.json', { providers: {} }) })
                : window.piAPI.configGetModels(),
            fileName === 'auth.json'
                ? Promise.resolve({ parsed: parseCurrentJson<PiAuthFile>('auth.json', {}) })
                : window.piAPI.configGetAuth(),
            fileName === 'settings.json'
                ? Promise.resolve({ parsed: parseCurrentJson<PiSettingsFile>('settings.json', {}) })
                : window.piAPI.configGetSettings(),
        ]);
        const providers = modelsResult.parsed.providers ?? {};
        const providerIds = Object.keys(providers);
        const configuredDefault = settingsResult.parsed.defaultProvider;
        const providerId =
            typeof configuredDefault === "string" && providers[configuredDefault]
                ? configuredDefault
                : providerIds[0];
        if (!providerId) {
            setStatus("请先在 models.json 中配置 provider baseUrl");
            return null;
        }

        const provider = providers[providerId];
        if (!provider?.baseUrl) {
            setStatus("请先在 models.json 中配置 provider baseUrl");
            return null;
        }

        return {
            baseUrl: provider.baseUrl,
            apiKey: authResult.parsed[providerId]?.apiKey,
            apiType: provider.apiType,
            modelId: provider.models?.[0]?.id,
        };
    };

    useEffect(() => {
        let cancelled = false;
        async function load(): Promise<void> {
            setMessage('');
            const result =
                fileName === 'models.json'
                    ? await window.piAPI.configGetModels()
                    : fileName === 'auth.json'
                        ? await window.piAPI.configGetAuth()
                        : await window.piAPI.configGetSettings();
            if (!cancelled) setRaw(result.raw);
        }
        void load().catch((error) => {
            if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
        });
        return () => {
            cancelled = true;
        };
    }, [fileName]);

    const save = async (): Promise<void> => {
        const result = await window.piAPI.configSaveRaw(fileName, raw);
        setMessage(result.valid ? '已保存，新的 Agent 或重启后的 Agent 会读取最新配置。' : result.error ?? '保存失败');
    };

    const exportConfig = async (): Promise<void> => {
        setRaw(await window.piAPI.configExport());
        setMessage('已导出配置包，可复制保存或切换回具体文件继续编辑。');
    };

    const importConfig = async (): Promise<void> => {
        const result = await window.piAPI.configImport(raw);
        setMessage(result.valid ? '已导入配置包。' : result.error ?? '导入失败');
    };

    return (
        <div className="space-y-4" role="tabpanel" id="settings-tabpanel-config" aria-labelledby="settings-tab-config">
            <SectionTitle title="Pi 配置中心" description="编辑 models.json、auth.json 和 settings.json。" />
            <div className="flex flex-wrap items-center gap-2">
                {(['models.json', 'auth.json', 'settings.json'] as const).map((name) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => setFileName(name)}
                        className={`rounded-md px-3 py-1.5 text-sm ${
                            fileName === name ? 'bg-[#1f1f1f] text-white' : 'bg-[#ececea] text-[#333] hover:bg-[#e2e2de]'
                        }`}
                    >
                        {name}
                    </button>
                ))}
            </div>
            <textarea
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                spellCheck={false}
                className="min-h-[300px] w-full rounded-lg border border-[#dcdcd8] bg-white p-3 font-mono text-xs text-[#1f1f1f] outline-none focus:border-[#1f1f1f]"
                aria-label="Pi 配置 JSON"
            />
            {[message, fetchStatus, testStatus].filter(Boolean).map((status) => (
                <div key={status} className="rounded-md border border-[#e2e2de] bg-[#fbfbfa] px-3 py-2 text-xs text-[#555]">
                    {status}
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={save} className="rounded-md bg-[#1f1f1f] px-3 py-2 text-sm text-white hover:bg-[#333]">保存当前文件</button>
                <button type="button" onClick={exportConfig} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[#333] hover:bg-[#e2e2de]">导出配置包</button>
                <button type="button" onClick={importConfig} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[#333] hover:bg-[#e2e2de]">从编辑区导入配置包</button>
                <button type="button" onClick={async () => {
                    setFetchStatus("拉取中...");
                    try {
                        const provider = await loadProviderSelection(setFetchStatus);
                        if (!provider) return;
                        const models = await window.piAPI.configFetchModels(provider.baseUrl, provider.apiKey, provider.apiType);
                        setFetchStatus(`拉取到 ${models.length} 个模型`);
                    } catch (e) {
                        setFetchStatus(`拉取失败: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[#333] hover:bg-[#e2e2de]">拉取模型列表</button>
                <button type="button" onClick={async () => {
                    setTestStatus("测试中...");
                    try {
                        const provider = await loadProviderSelection(setTestStatus);
                        if (!provider) return;
                        const result = await window.piAPI.configTestProvider(provider);
                        setTestStatus(result.ok ? "连接成功" : `连接失败: ${result.message}`);
                    } catch (e) {
                        setTestStatus(`测试失败: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[#333] hover:bg-[#e2e2de]">测试 Provider</button>
            </div>
        </div>
    );
}
