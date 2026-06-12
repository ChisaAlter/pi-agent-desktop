// 设置面板 - MiniMax Code 参考风格: 大模态、左侧分类、浅色密集表单.

import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { PiStatusPanel } from '../PiStatusPanel';
import { ShortcutsSettings } from './ShortcutsSettings/ShortcutsSettings';
import { useI18n, useTranslateIpcError, SUPPORTED_LOCALES, type Locale } from '../../i18n';
import type { IpcError, ManagedModelEntry, ManagedModelsResult, ManagedModelSaveInput, PiAuthFile, PiModelsFile, PiSettingsFile } from '@shared';
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
            <h3 className="m-0 text-[15px] font-semibold text-[var(--mm-text-primary)]">{title}</h3>
            {description && <p className="m-0 mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">{description}</p>}
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
        <div className="grid grid-cols-[minmax(160px,220px)_1fr] items-center gap-6 border-b border-[var(--mm-border)] py-4 last:border-b-0">
            <div>
                <label className="block text-sm font-medium text-[var(--mm-text-primary)]">{label}</label>
                {description && <p className="m-0 mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">{description}</p>}
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
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--mm-bg-panel)] shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
        </button>
    );
}

export function SettingsPanel(): React.JSX.Element {
    const { settings, isOpen, closeSettings, updateSettings, resetSettings, loadPiConfig, lastWriteError, clearWriteError } = useSettingsStore();
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

    const updateNumberSetting = (key: 'fontSize', value: string): void => {
        const next = Number.parseInt(value, 10);
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
                className="flex h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
                role="dialog"
                aria-modal="true"
                aria-label={t('settings.title')}
            >
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
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
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
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                            aria-label={t('settings.resetAria')}
                        >
                            {t('settings.reset')}
                        </button>
                    </div>
                </aside>

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
                                <button type="button" onClick={clearWriteError} className="ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-500 hover:bg-red-100 hover:text-red-700" aria-label="Dismiss">
                                    <CloseIcon />
                                </button>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={closeSettings}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
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
                                                    active ? 'border-[#1f1f1f] bg-[var(--mm-bg-panel)]' : 'border-[var(--mm-border)] bg-[var(--mm-bg-panel)] hover:border-[#cfcfca]'
                                                }`}
                                            >
                                                <span className="block text-sm font-medium text-[var(--mm-text-primary)]">{t(`settings.theme.${theme}`)}</span>
                                                <span className="mt-3 block h-24 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] p-2">
                                                    <span className={`block h-full rounded-md ${theme === 'dark' ? 'bg-[#1f1f1f]' : theme === 'system' ? 'bg-gradient-to-r from-white to-[#1f1f1f]' : 'bg-[var(--mm-bg-panel)]'} border border-[var(--mm-border)]`} />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-6 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
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
                                <ManagedModelsPanel onPiConfigChanged={loadPiConfig} />
                            </div>
                        )}

                        {activeTab === 'piagent' && (
                            <div role="tabpanel" id="settings-tabpanel-piagent" aria-labelledby="settings-tab-piagent">
                                <SectionTitle title={t('settings.piagent.heading')} description={t('settings.piagent.description')} />
                                <PiStatusPanel />

                                {piFullConfig ? (
                                    <div className="mt-4 space-y-4">
                                        <div>
                                            <div className="mb-2 text-sm font-medium text-[var(--mm-text-primary)]">{t('settings.piagent.configPath')}</div>
                                            <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3 font-mono text-xs text-[var(--mm-text-secondary)] break-all">
                                                {piFullConfig.configPath}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3">
                                                <div className="text-xs text-[var(--mm-text-tertiary)]">{t('settings.piagent.defaultProvider')}</div>
                                                <div className="mt-1 text-sm font-medium text-[var(--mm-text-primary)]">{piFullConfig.defaultProvider || t('settings.piagent.notSet')}</div>
                                            </div>
                                            <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3">
                                                <div className="text-xs text-[var(--mm-text-tertiary)]">{t('settings.piagent.defaultModel')}</div>
                                                <div className="mt-1 text-sm font-medium text-[var(--mm-text-primary)]">{piFullConfig.defaultModel || t('settings.piagent.notSet')}</div>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="mb-2 text-sm font-medium text-[var(--mm-text-primary)]">{t('settings.piagent.providers', { count: piFullConfig.providers.length })}</div>
                                            <div className="grid gap-2">
                                                {piFullConfig.providers.map((provider) => (
                                                    <div key={provider.id} className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="truncate text-sm font-medium text-[var(--mm-text-primary)]">{provider.name}</span>
                                                            <span className="shrink-0 text-xs text-[var(--mm-text-tertiary)]">{t('settings.piagent.modelCount', { count: provider.modelCount })}</span>
                                                        </div>
                                                        {provider.baseUrl && <div className="mt-1 truncate font-mono text-xs text-[var(--mm-text-tertiary)]">{provider.baseUrl}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3 text-sm text-[var(--mm-text-tertiary)]">
                                        {t('settings.piagent.loading')}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'general' && (
                            <div role="tabpanel" id="settings-tabpanel-general" aria-labelledby="settings-tab-general">
                                <SectionTitle title={t('settings.general.heading')} description={t('settings.general.description')} />
                                <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                                    <FieldRow label={t('settings.language.label')} description={t('settings.language.description')}>
                                        <select
                                            id="settings-language"
                                            value={locale}
                                            onChange={(e) => setLocale(e.target.value as Locale)}
                                            className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2.5 text-sm text-[var(--mm-text-primary)] focus:border-[#1f1f1f] focus:outline-none"
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
                                <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
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
                                <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-sm leading-6 text-[var(--mm-text-secondary)]">
                                    <p className="m-0 text-[var(--mm-text-primary)]">{t('settings.about.version', { version: '0.2.0' })}</p>
                                    <p className="m-0 mt-2">{t('settings.about.description')}</p>
                                    <p className="m-0 mt-2">{t('settings.about.stack')}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end border-t border-[var(--mm-border)] px-7 py-4">
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

type ModelFormState = {
    originalProviderId?: string;
    originalModelId?: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    apiType: 'openai' | 'responses';
    apiKey: string;
    modelId: string;
    modelName: string;
    contextWindow: string;
    maxTokens: string;
    reasoning: boolean;
    setDefault: boolean;
};

const emptyModelForm: ModelFormState = {
    providerId: '',
    providerName: '',
    baseUrl: '',
    apiType: 'openai',
    apiKey: '',
    modelId: '',
    modelName: '',
    contextWindow: '',
    maxTokens: '',
    reasoning: false,
    setDefault: false,
};

function modelToForm(model: ManagedModelEntry): ModelFormState {
    return {
        originalProviderId: model.providerId,
        originalModelId: model.modelId,
        providerId: model.providerId,
        providerName: model.providerName,
        baseUrl: model.baseUrl ?? '',
        apiType: model.apiType ?? 'openai',
        apiKey: '',
        modelId: model.modelId,
        modelName: model.modelName,
        contextWindow: model.contextWindow ? String(model.contextWindow) : '',
        maxTokens: model.maxTokens ? String(model.maxTokens) : '',
        reasoning: Boolean(model.reasoning),
        setDefault: model.isDefault,
    };
}

function compactNumber(value?: number): string {
    if (!value) return '未知';
    if (value >= 1000) return `${Math.round(value / 1000)}K`;
    return String(value);
}

function parseOptionalInteger(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function ManagedModelsPanel({ onPiConfigChanged }: { onPiConfigChanged: () => Promise<void> }): React.JSX.Element {
    const [result, setResult] = useState<ManagedModelsResult | null>(null);
    const [message, setMessage] = useState('');
    const [testingKey, setTestingKey] = useState<string | null>(null);
    const [form, setForm] = useState<ModelFormState | null>(null);

    const refresh = async (): Promise<void> => {
        const next = await window.piAPI.configListManagedModels();
        setResult(next);
    };

    useEffect(() => {
        let cancelled = false;
        void window.piAPI.configListManagedModels()
            .then((next) => {
                if (!cancelled) setResult(next);
            })
            .catch((error) => {
                if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const defaultModel = result?.models.find((model) => model.isDefault);

    const loadApiKey = async (providerId: string): Promise<string | undefined> => {
        const auth = await window.piAPI.configGetAuth();
        const item = auth.parsed[providerId];
        return item?.key || item?.apiKey;
    };

    const testModel = async (model: ManagedModelEntry): Promise<void> => {
        if (!model.baseUrl) {
            setMessage('缺少 Base URL，无法测试连接。');
            return;
        }
        const key = `${model.providerId}:${model.modelId}`;
        setTestingKey(key);
        setMessage('测试中...');
        try {
            const apiKey = await loadApiKey(model.providerId);
            const response = await window.piAPI.configTestProvider({
                baseUrl: model.baseUrl,
                apiKey,
                modelId: model.modelId,
                apiType: model.apiType,
                headers: model.headers,
            });
            setMessage(response.ok ? '连接成功' : response.message);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setTestingKey(null);
        }
    };

    const saveModel = async (): Promise<void> => {
        if (!form) return;
        const input: ManagedModelSaveInput = {
            originalProviderId: form.originalProviderId,
            originalModelId: form.originalModelId,
            providerId: form.providerId.trim(),
            providerName: form.providerName.trim(),
            baseUrl: form.baseUrl.trim(),
            apiType: form.apiType,
            apiKey: form.apiKey.trim() || undefined,
            modelId: form.modelId.trim(),
            modelName: form.modelName.trim(),
            contextWindow: parseOptionalInteger(form.contextWindow),
            maxTokens: parseOptionalInteger(form.maxTokens),
            reasoning: form.reasoning,
            setDefault: form.setDefault,
        };
        const response = await window.piAPI.configSaveManagedModel(input);
        if (!response.valid) {
            setMessage(response.error ?? '保存失败');
            return;
        }
        setForm(null);
        setMessage('模型已保存');
        await refresh();
        await onPiConfigChanged();
    };

    const deleteModel = async (model: ManagedModelEntry): Promise<void> => {
        if (!window.confirm(`删除模型 ${model.modelName}？`)) return;
        const response = await window.piAPI.configDeleteManagedModel({
            providerId: model.providerId,
            modelId: model.modelId,
        });
        if (!response.valid) {
            setMessage(response.error ?? '删除失败');
            return;
        }
        setMessage('模型已删除');
        await refresh();
        await onPiConfigChanged();
    };

    const setDefault = async (model: ManagedModelEntry): Promise<void> => {
        const response = await window.piAPI.configSetDefaultModel(model.providerId, model.modelId);
        if (!response.valid) {
            setMessage(response.error ?? '设置默认模型失败');
            return;
        }
        setMessage('默认模型已更新');
        await refresh();
        await onPiConfigChanged();
    };

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
                <SectionTitle title="模型配置" description="管理 Pi Agent 的 Provider 与模型。更改会写入 ~/.pi/agent 配置。" />
                <button
                    type="button"
                    onClick={() => setForm(emptyModelForm)}
                    className="shrink-0 rounded-lg bg-[#1f1f1f] px-3 py-2 text-sm font-medium text-white hover:bg-[#333]"
                >
                    新增模型
                </button>
            </div>

            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-xs text-[var(--mm-text-tertiary)]">默认模型</div>
                        <div className="mt-1 text-sm font-semibold text-[var(--mm-text-primary)]">
                            {defaultModel ? `${defaultModel.modelName} · ${defaultModel.providerName}` : '未设置'}
                        </div>
                    </div>
                    <div className="font-mono text-xs text-[var(--mm-text-tertiary)]">{result?.configDir ?? '加载中...'}</div>
                </div>
            </div>

            {message && (
                <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs text-[var(--mm-text-secondary)]">
                    {message}
                </div>
            )}

            <div className="overflow-hidden rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
                {!result ? (
                    <div className="p-4 text-sm text-[var(--mm-text-tertiary)]">加载模型配置中...</div>
                ) : result.models.length === 0 ? (
                    <div className="p-5 text-sm text-[var(--mm-text-tertiary)]">暂未检测到模型配置。点击“新增模型”开始配置。</div>
                ) : (
                    <div className="divide-y divide-[var(--mm-border)]">
                        {result.models.map((model) => {
                            const key = `${model.providerId}:${model.modelId}`;
                            return (
                                <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 p-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="truncate text-sm font-semibold text-[var(--mm-text-primary)]">{model.modelName}</div>
                                            {model.isDefault && <span className="rounded bg-[#e8f2ff] px-1.5 py-0.5 text-[11px] text-[#0b67bd]">默认</span>}
                                            <span className="rounded bg-[#f0f0ed] px-1.5 py-0.5 text-[11px] text-[var(--mm-text-tertiary)]">
                                                {model.source === 'yaml' ? 'YAML' : 'JSON'}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--mm-text-tertiary)]">
                                            <span>{model.providerName}</span>
                                            <span className="font-mono">{model.providerId}/{model.modelId}</span>
                                            {model.baseUrl && <span className="max-w-[360px] truncate font-mono">{model.baseUrl}</span>}
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--mm-text-secondary)]">
                                            <span>API: {model.apiType ?? model.api ?? '未设置'}</span>
                                            <span>上下文: {compactNumber(model.contextWindow)}</span>
                                            <span>最大输出: {compactNumber(model.maxTokens)}</span>
                                            <span>{model.hasApiKey ? `Key ${model.apiKeyPreview ?? '已配置'}` : '未配置 Key'}</span>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {!model.isDefault && (
                                            <button type="button" onClick={() => void setDefault(model)} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">
                                                设为默认
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void testModel(model)}
                                            disabled={testingKey === key}
                                            aria-label={`测试 ${model.modelName}`}
                                            className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-50"
                                        >
                                            测试
                                        </button>
                                        <button type="button" onClick={() => setForm(modelToForm(model))} aria-label={`编辑 ${model.modelName}`} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">
                                            编辑
                                        </button>
                                        <button type="button" onClick={() => void deleteModel(model)} aria-label={`删除 ${model.modelName}`} className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                                            删除
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {form && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6">
                    <div className="w-[min(680px,calc(100vw-48px))] rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-2xl" role="dialog" aria-modal="true" aria-label="模型编辑">
                        <div className="flex items-center justify-between border-b border-[var(--mm-border)] px-5 py-4">
                            <div className="text-sm font-semibold text-[var(--mm-text-primary)]">{form.originalModelId ? '编辑模型' : '新增模型'}</div>
                            <button type="button" onClick={() => setForm(null)} className="rounded-md px-2 py-1 text-sm hover:bg-[var(--mm-bg-sidebar)]">关闭</button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 p-5">
                            <FormInput label="Provider ID" value={form.providerId} onChange={(providerId) => setForm({ ...form, providerId })} />
                            <FormInput label="Provider 名称" value={form.providerName} onChange={(providerName) => setForm({ ...form, providerName })} />
                            <FormInput className="col-span-2" label="Base URL" value={form.baseUrl} onChange={(baseUrl) => setForm({ ...form, baseUrl })} />
                            <label className="block text-xs font-medium text-[var(--mm-text-secondary)]">
                                API 类型
                                <select
                                    value={form.apiType}
                                    onChange={(event) => setForm({ ...form, apiType: event.target.value as ModelFormState['apiType'] })}
                                    className="mt-1 w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)]"
                                >
                                    <option value="openai">OpenAI Chat Completions</option>
                                    <option value="responses">OpenAI Responses</option>
                                </select>
                            </label>
                            <FormInput label="API Key" value={form.apiKey} onChange={(apiKey) => setForm({ ...form, apiKey })} placeholder={form.originalModelId ? '留空表示不修改' : ''} />
                            <FormInput label="模型 ID" value={form.modelId} onChange={(modelId) => setForm({ ...form, modelId })} />
                            <FormInput label="模型名称" value={form.modelName} onChange={(modelName) => setForm({ ...form, modelName })} />
                            <FormInput label="上下文窗口" value={form.contextWindow} onChange={(contextWindow) => setForm({ ...form, contextWindow })} />
                            <FormInput label="最大输出 Token" value={form.maxTokens} onChange={(maxTokens) => setForm({ ...form, maxTokens })} />
                            <label className="flex items-center gap-2 text-sm text-[var(--mm-text-secondary)]">
                                <input type="checkbox" checked={form.reasoning} onChange={(event) => setForm({ ...form, reasoning: event.target.checked })} />
                                推理模型
                            </label>
                            <label className="flex items-center gap-2 text-sm text-[var(--mm-text-secondary)]">
                                <input type="checkbox" checked={form.setDefault} onChange={(event) => setForm({ ...form, setDefault: event.target.checked })} />
                                保存后设为默认
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-[var(--mm-border)] px-5 py-4">
                            <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-2 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]">取消</button>
                            <button type="button" onClick={() => void saveModel()} className="rounded-lg bg-[#1f1f1f] px-3 py-2 text-sm font-medium text-white hover:bg-[#333]">保存模型</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function FormInput({
    label,
    value,
    onChange,
    placeholder,
    className = '',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}): React.JSX.Element {
    const id = `model-form-${label.replace(/\s+/g, '-').toLowerCase()}`;
    return (
        <label htmlFor={id} className={`block text-xs font-medium text-[var(--mm-text-secondary)] ${className}`}>
            {label}
            <input
                id={id}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)] outline-none focus:border-[#1f1f1f]"
            />
        </label>
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
            apiKey: authResult.parsed[providerId]?.key || authResult.parsed[providerId]?.apiKey,
            apiType: provider.apiType ?? (provider.api === 'openai-responses' ? 'responses' : undefined),
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
                            fileName === name ? 'bg-[#1f1f1f] text-white' : 'bg-[#ececea] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]'
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
                className="min-h-[300px] w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3 font-mono text-xs text-[var(--mm-text-primary)] outline-none focus:border-[#1f1f1f]"
                aria-label="Pi 配置 JSON"
            />
            {[message, fetchStatus, testStatus].filter(Boolean).map((status) => (
                <div key={status} className="rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs text-[var(--mm-text-secondary)]">
                    {status}
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={save} className="rounded-md bg-[#1f1f1f] px-3 py-2 text-sm text-white hover:bg-[#333]">保存当前文件</button>
                <button type="button" onClick={exportConfig} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]">导出配置包</button>
                <button type="button" onClick={importConfig} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]">从编辑区导入配置包</button>
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
                }} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]">拉取模型列表</button>
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
                }} className="rounded-md bg-[#ececea] px-3 py-2 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]">测试 Provider</button>
            </div>
        </div>
    );
}
