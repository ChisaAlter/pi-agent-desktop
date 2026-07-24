// 外观 tab — 主题选择 + 字号滑块.

import React from 'react';
import { useSettingsStore } from '../../../stores/settings-store';
import { useI18n } from '../../../i18n';
import { SettingsCard, SettingsPage, FieldRow } from '../_shared';

export function AppearanceTab(): React.JSX.Element {
    const { settings, updateSettings } = useSettingsStore();
    const { t } = useI18n();

    const updateNumberSetting = (key: 'fontSize', value: string): void => {
        const next = Number.parseInt(value, 10);
        if (Number.isFinite(next)) {
            updateSettings({ [key]: next });
        }
    };

    return (
        <SettingsPage tabId="appearance" title={t('settings.appearance.heading')} description={t('settings.appearance.description')}>
            <SettingsCard>
                <FieldRow anchorId="appearance-theme" label={t('settings.theme.label')}>
                    <div className="grid grid-cols-3 gap-3">
                        {(['light', 'dark', 'system'] as const).map((theme) => {
                            const active = settings.theme === theme;
                            return (
                                <button
                                    key={theme}
                                    type="button"
                                    onClick={() => useSettingsStore.getState().setTheme(theme)}
                                    className={`settings-pressable rounded-xl border p-3 text-left transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${
                                        active ? 'border-[var(--mm-accent-blue)] bg-[var(--mm-bg-panel)]' : 'border-[var(--mm-border)] bg-[var(--mm-bg-panel)] hover:border-[var(--mm-border-strong)]'
                                    }`}
                                >
                                    <span className="block text-sm font-medium text-[var(--mm-text-primary)]">{t(`settings.theme.${theme}`)}</span>
                                    <span className="mt-3 block h-24 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] p-2">
                                        <span
                                            data-allow-light-surface="theme-preview"
                                            className={`block h-full rounded-md ${theme === 'dark' ? 'bg-[#1f1f1f]' : theme === 'system' ? 'bg-gradient-to-r from-white to-[#1f1f1f]' : 'bg-[var(--mm-bg-panel)]'} border border-[var(--mm-border)]`}
                                        />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </FieldRow>
                <FieldRow anchorId="appearance-font-size" label={t('settings.fontSize.label', { value: settings.fontSize })}>
                    <input
                        id="settings-font-size"
                        type="range"
                        min="12"
                        max="20"
                        value={settings.fontSize}
                        onChange={(e) => updateNumberSetting('fontSize', e.target.value)}
                        className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        aria-label={t('settings.fontSize.aria')}
                    />
                </FieldRow>
            </SettingsCard>
        </SettingsPage>
    );
}
