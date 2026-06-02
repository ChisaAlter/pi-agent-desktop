// 设置面板 - Codex 浅色主题
// v1.0.4: 用户可见文案 + 语言切换器走 t()

import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { PiStatusPanel } from '../PiStatusPanel';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '../../i18n';

export function SettingsPanel(): React.JSX.Element {
    const { settings, isOpen, closeSettings, updateSettings, resetSettings, piModels } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<'general' | 'model' | 'piagent' | 'about'>('general');
    const [piFullConfig, setPiFullConfig] = useState<Awaited<ReturnType<typeof window.piAPI.getFullConfig>> | null>(null);
    const { t, locale, setLocale } = useI18n();

    useEffect(() => {
        if (isOpen && window.piAPI?.getFullConfig) {
            window.piAPI.getFullConfig().then(setPiFullConfig).catch(console.error);
        }
    }, [isOpen]);

    if (!isOpen) return <></>;

    const tabs = [
        { id: 'general' as const, label: t('settings.tab.general') },
        { id: 'model' as const, label: t('settings.tab.model') },
        { id: 'piagent' as const, label: t('settings.tab.piagent') },
        { id: 'about' as const, label: t('settings.tab.about') },
    ];

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-label={t('settings.title')}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between p-4 border-b border-[#e5e5e5]">
                    <h2 className="text-lg font-semibold text-[#1a1a1a]">{t('settings.title')}</h2>
                    <button
                        type="button"
                        onClick={closeSettings}
                        className="p-2 hover:bg-[#f0f0f0] rounded-lg transition-colors"
                        aria-label={t('common.close')}
                        title={t('common.close')}
                    >
                        <svg className="w-4 h-4 text-[#666]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* 侧边栏 */}
                    <div
                        className="w-48 border-r border-[#e5e5e5] p-2"
                        role="tablist"
                        aria-label={t('settings.tabsAria')}
                    >
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls={`settings-tabpanel-${tab.id}`}
                                    id={`settings-tab-${tab.id}`}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                                        isActive
                                            ? 'bg-[#1a1a1a] text-white'
                                            : 'text-[#666] hover:bg-[#f0f0f0]'
                                    }`}
                                >
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* 内容 */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        {activeTab === 'general' && (
                            <div
                                className="space-y-6"
                                role="tabpanel"
                                id="settings-tabpanel-general"
                                aria-labelledby="settings-tab-general"
                            >
                                <h3 className="text-base font-medium text-[#1a1a1a]">
                                    {t('settings.general.heading')}
                                </h3>

                                {/* 语言切换器 (v1.0.4 新增) */}
                                <div>
                                    <label htmlFor="settings-language" className="block text-sm text-[#666] mb-2">
                                        {t('settings.language.label')}
                                    </label>
                                    <select
                                        id="settings-language"
                                        value={locale}
                                        onChange={(e) => setLocale(e.target.value as Locale)}
                                        className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                                        aria-describedby="settings-language-desc"
                                    >
                                        {SUPPORTED_LOCALES.map((l) => (
                                            <option key={l} value={l}>
                                                {t(`settings.language.options.${l}`)}
                                            </option>
                                        ))}
                                    </select>
                                    <p id="settings-language-desc" className="text-xs text-[#999] mt-1">
                                        {t('settings.language.description')}
                                    </p>
                                </div>

                                {/* 主题 */}
                                <div>
                                    <label htmlFor="settings-theme" className="block text-sm text-[#666] mb-2">
                                        {t('settings.theme.label')}
                                    </label>
                                    <select
                                        id="settings-theme"
                                        value={settings.theme}
                                        onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' })}
                                        className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                                    >
                                        <option value="light">{t('settings.theme.light')}</option>
                                        <option value="dark">{t('settings.theme.dark')}</option>
                                    </select>
                                </div>

                                {/* 字体大小 */}
                                <div>
                                    <label htmlFor="settings-font-size" className="block text-sm text-[#666] mb-2">
                                        {t('settings.fontSize.label', { value: settings.fontSize })}
                                    </label>
                                    <input
                                        id="settings-font-size"
                                        type="range"
                                        min="12"
                                        max="20"
                                        value={settings.fontSize}
                                        onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}
                                        className="w-full"
                                        aria-label={t('settings.fontSize.aria')}
                                    />
                                </div>

                                {/* 自动保存 */}
                                <div className="flex items-center justify-between">
                                    <label htmlFor="settings-auto-save" className="text-sm text-[#666]">
                                        {t('settings.autoSave.label')}
                                    </label>
                                    <button
                                        id="settings-auto-save"
                                        type="button"
                                        role="switch"
                                        aria-checked={settings.autoSave}
                                        aria-label={t('settings.autoSave.label')}
                                        onClick={() => updateSettings({ autoSave: !settings.autoSave })}
                                        className={`w-12 h-6 rounded-full transition-colors ${
                                            settings.autoSave ? 'bg-[#1a1a1a]' : 'bg-[#e5e5e5]'
                                        }`}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                                                settings.autoSave ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                </div>

                                {/* 显示行号 */}
                                <div className="flex items-center justify-between">
                                    <label htmlFor="settings-line-numbers" className="text-sm text-[#666]">
                                        {t('settings.showLineNumbers.label')}
                                    </label>
                                    <button
                                        id="settings-line-numbers"
                                        type="button"
                                        role="switch"
                                        aria-checked={settings.showLineNumbers}
                                        aria-label={t('settings.showLineNumbers.label')}
                                        onClick={() => updateSettings({ showLineNumbers: !settings.showLineNumbers })}
                                        className={`w-12 h-6 rounded-full transition-colors ${
                                            settings.showLineNumbers ? 'bg-[#1a1a1a]' : 'bg-[#e5e5e5]'
                                        }`}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                                                settings.showLineNumbers ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                </div>

                                {/* 自动换行 */}
                                <div className="flex items-center justify-between">
                                    <label htmlFor="settings-word-wrap" className="text-sm text-[#666]">
                                        {t('settings.wordWrap.label')}
                                    </label>
                                    <button
                                        id="settings-word-wrap"
                                        type="button"
                                        role="switch"
                                        aria-checked={settings.wordWrap}
                                        aria-label={t('settings.wordWrap.label')}
                                        onClick={() => updateSettings({ wordWrap: !settings.wordWrap })}
                                        className={`w-12 h-6 rounded-full transition-colors ${
                                            settings.wordWrap ? 'bg-[#1a1a1a]' : 'bg-[#e5e5e5]'
                                        }`}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                                                settings.wordWrap ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'model' && (
                            <div
                                className="space-y-6"
                                role="tabpanel"
                                id="settings-tabpanel-model"
                                aria-labelledby="settings-tab-model"
                            >
                                <h3 className="text-base font-medium text-[#1a1a1a]">
                                    {t('settings.modelTab.heading')}
                                </h3>

                                {/* 当前模型 */}
                                <div>
                                    <label htmlFor="settings-model" className="block text-sm text-[#666] mb-2">
                                        {t('settings.modelTab.current')}
                                    </label>
                                    <select
                                        id="settings-model"
                                        value={settings.model}
                                        onChange={(e) => updateSettings({ model: e.target.value })}
                                        className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                                    >
                                        {piModels ? (
                                            piModels.map((model) => (
                                                <option key={model.id} value={model.id}>
                                                    {model.name} ({model.providerName})
                                                </option>
                                            ))
                                        ) : (
                                            <>
                                                <option value="mimo-v2.5-pro">mimo-v2.5-pro</option>
                                                <option value="gpt-4">GPT-4</option>
                                                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                                            </>
                                        )}
                                    </select>
                                </div>

                                {/* 温度 */}
                                <div>
                                    <label htmlFor="settings-temperature" className="block text-sm text-[#666] mb-2">
                                        {t('settings.modelTab.temperature', { value: settings.temperature })}
                                    </label>
                                    <input
                                        id="settings-temperature"
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.1"
                                        value={settings.temperature}
                                        onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })}
                                        className="w-full"
                                        aria-label={t('settings.modelTab.temperatureAria')}
                                    />
                                </div>

                                {/* 最大 Token */}
                                <div>
                                    <label htmlFor="settings-max-tokens" className="block text-sm text-[#666] mb-2">
                                        {t('settings.modelTab.maxTokens')}
                                    </label>
                                    <input
                                        id="settings-max-tokens"
                                        type="number"
                                        value={settings.maxTokens}
                                        onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
                                        className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                                    />
                                </div>
                            </div>
                        )}

                        {activeTab === 'piagent' && (
                            <div
                                className="space-y-6"
                                role="tabpanel"
                                id="settings-tabpanel-piagent"
                                aria-labelledby="settings-tab-piagent"
                            >
                                {/* Pi CLI 状态管理 */}
                                <PiStatusPanel />

                                <h3 className="text-base font-medium text-[#1a1a1a]">
                                    {t('settings.piagent.heading')}
                                </h3>

                                {piFullConfig ? (
                                    <>
                                        {/* 配置目录 */}
                                        <div>
                                            <label className="block text-sm text-[#666] mb-2">
                                                {t('settings.piagent.configPath')}
                                            </label>
                                            <div className="bg-[#f5f5f5] rounded-lg p-3 font-mono text-sm text-[#1a1a1a] break-all">
                                                {piFullConfig.configPath}
                                            </div>
                                        </div>

                                        {/* 默认配置 */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm text-[#666] mb-2">
                                                    {t('settings.piagent.defaultProvider')}
                                                </label>
                                                <div className="bg-[#f5f5f5] rounded-lg p-3 text-sm text-[#1a1a1a]">
                                                    {piFullConfig.defaultProvider || t('settings.piagent.notSet')}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-sm text-[#666] mb-2">
                                                    {t('settings.piagent.defaultModel')}
                                                </label>
                                                <div className="bg-[#f5f5f5] rounded-lg p-3 text-sm text-[#1a1a1a]">
                                                    {piFullConfig.defaultModel || t('settings.piagent.notSet')}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Provider 列表 */}
                                        <div>
                                            <label className="block text-sm text-[#666] mb-2">
                                                {t('settings.piagent.providers', { count: piFullConfig.providers.length })}
                                            </label>
                                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                                {piFullConfig.providers.map((provider) => (
                                                    <div key={provider.id} className="bg-[#f5f5f5] rounded-lg p-3">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-sm font-medium text-[#1a1a1a]">{provider.name}</span>
                                                            <span className="text-xs text-[#999]">
                                                                {t('settings.piagent.modelCount', { count: provider.modelCount })}
                                                            </span>
                                                        </div>
                                                        {provider.baseUrl && (
                                                            <div className="text-xs text-[#666] font-mono truncate">{provider.baseUrl}</div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-[#999]">{t('settings.piagent.loading')}</div>
                                )}
                            </div>
                        )}

                        {activeTab === 'about' && (
                            <div
                                className="space-y-4"
                                role="tabpanel"
                                id="settings-tabpanel-about"
                                aria-labelledby="settings-tab-about"
                            >
                                <h3 className="text-base font-medium text-[#1a1a1a]">
                                    {t('settings.about.heading')}
                                </h3>
                                <div className="text-sm text-[#666]">
                                    <p>{t('settings.about.version', { version: '0.2.0' })}</p>
                                    <p className="mt-2">{t('settings.about.description')}</p>
                                    <p className="mt-2">{t('settings.about.stack')}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* 底部 */}
                <div className="flex items-center justify-between p-4 border-t border-[#e5e5e5]">
                    <button
                        type="button"
                        onClick={resetSettings}
                        className="px-4 py-2 text-sm text-[#666] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors"
                        aria-label={t('settings.resetAria')}
                    >
                        {t('settings.reset')}
                    </button>
                    <button
                        type="button"
                        onClick={closeSettings}
                        className="px-4 py-2 text-sm bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors"
                        aria-label={t('settings.closeAria')}
                    >
                        {t('common.done')}
                    </button>
                </div>
            </div>
        </div>
    );
}
