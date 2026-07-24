// 通用 tab — 语言/自动保存/行号/换行 + 通知/声音/音量. 自行管理 sound/notification 状态.

import React, { useState } from 'react';
import { useSettingsStore } from '../../../stores/settings-store';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '../../../i18n';
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume } from '../../../utils/sounds';
import { requestNotificationPermission, canNotify, isNotificationEnabled, setNotificationEnabled } from '../../../utils/notifications';
import { SettingsCard, SettingsPage, FieldRow, SwitchControl } from '../_shared';

export function GeneralTab(): React.JSX.Element {
    const { settings, updateSettings } = useSettingsStore();
    const { t, locale, setLocale } = useI18n();
    const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled());
    const [soundVolume, setSoundVolumeState] = useState(getSoundVolume());
    const [notificationsEnabled, setNotificationsEnabled] = useState(isNotificationEnabled() && canNotify());

    return (
        <SettingsPage tabId="general" title={t('settings.tab.general')} description={t('settings.general.description')}>
            <SettingsCard>
                <FieldRow anchorId="general-language" label={t('settings.language.label')} description={t('settings.language.description')}>
                    <select
                        id="settings-language"
                        value={locale}
                        onChange={(e) => setLocale(e.target.value as Locale)}
                        className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2.5 text-sm text-[var(--mm-text-primary)] focus:border-[var(--mm-accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                        {SUPPORTED_LOCALES.map((l) => (
                            <option key={l} value={l}>
                                {t(`settings.language.options.${l}`)}
                            </option>
                        ))}
                    </select>
                </FieldRow>
                <FieldRow anchorId="general-generated-ui" label={t('settings.general.generatedUi.label')} description={t('settings.general.generatedUi.description')}>
                    <SwitchControl
                        checked={settings.generatedUiEnabled !== false}
                        label={t('settings.general.generatedUi.label')}
                        onChange={() => updateSettings({ generatedUiEnabled: settings.generatedUiEnabled === false })}
                    />
                </FieldRow>
                <FieldRow anchorId="general-auto-compaction" label={t('settings.autoCompaction.label')} description={t('settings.autoCompaction.description')}>
                    <SwitchControl
                        checked={settings.autoCompactionEnabled === true}
                        label={t('settings.autoCompaction.label')}
                        onChange={() => updateSettings({ autoCompactionEnabled: settings.autoCompactionEnabled !== true })}
                    />
                </FieldRow>
                <FieldRow anchorId="general-notifications" label={t('settings.general.notifications.heading')} description={t('settings.general.notifications.description')}>
                    <div className="space-y-3">
                        <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-3">
                            <div>
                                <div className="text-sm font-medium text-[var(--mm-text-primary)]">{t('settings.general.notifications.system.label')}</div>
                                <div className="mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">{t('settings.general.notifications.system.description')}</div>
                            </div>
                            <SwitchControl
                                checked={notificationsEnabled}
                                label={t('settings.general.notifications.system.label')}
                                onChange={async () => {
                                    if (!notificationsEnabled) {
                                        const result = await requestNotificationPermission();
                                        const next = result === "granted";
                                        setNotificationEnabled(next);
                                        setNotificationsEnabled(next);
                                    } else {
                                        setNotificationEnabled(false);
                                        setNotificationsEnabled(false);
                                    }
                                }}
                            />
                        </div>
                        <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-3">
                            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                                <div>
                                    <div className="text-sm font-medium text-[var(--mm-text-primary)]">{t('settings.general.notifications.sound.label')}</div>
                                    <div className="mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">{t('settings.general.notifications.sound.description')}</div>
                                </div>
                                <SwitchControl
                                    checked={soundEnabled}
                                    label={t('settings.general.notifications.sound.label')}
                                    onChange={() => {
                                        const next = !soundEnabled;
                                        setSoundEnabledState(next);
                                        setSoundEnabled(next);
                                    }}
                                />
                            </div>
                            {soundEnabled && (
                                <div className="mt-4 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-3">
                                    <div className="mb-2 text-xs font-medium text-[var(--mm-text-secondary)]">
                                        {t('settings.general.notifications.volume.label', { value: Math.round(soundVolume * 100) })}
                                    </div>
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
                                        className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                                        aria-label={t('settings.general.notifications.volume.aria')}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </FieldRow>
                <FieldRow anchorId="general-autosave" label={t('settings.autoSave.label')}>
                    <SwitchControl checked={settings.autoSave} label={t('settings.autoSave.label')} onChange={() => updateSettings({ autoSave: !settings.autoSave })} />
                </FieldRow>
                <FieldRow anchorId="general-line-numbers" label={t('settings.showLineNumbers.label')}>
                    <SwitchControl checked={settings.showLineNumbers} label={t('settings.showLineNumbers.label')} onChange={() => updateSettings({ showLineNumbers: !settings.showLineNumbers })} />
                </FieldRow>
                <FieldRow anchorId="general-word-wrap" label={t('settings.wordWrap.label')}>
                    <SwitchControl checked={settings.wordWrap} label={t('settings.wordWrap.label')} onChange={() => updateSettings({ wordWrap: !settings.wordWrap })} />
                </FieldRow>
            </SettingsCard>
        </SettingsPage>
    );
}
