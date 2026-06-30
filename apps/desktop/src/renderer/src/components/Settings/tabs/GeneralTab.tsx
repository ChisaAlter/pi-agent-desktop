// 通用 tab — 语言/自动保存/行号/换行 + 通知/声音/音量. 自行管理 sound/notification 状态.

import React, { useState } from 'react';
import { useSettingsStore } from '../../../stores/settings-store';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '../../../i18n';
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume } from '../../../utils/sounds';
import { requestNotificationPermission, canNotify, isNotificationEnabled, setNotificationEnabled } from '../../../utils/notifications';
import { SectionTitle, FieldRow, SwitchControl } from '../_shared';

export function GeneralTab(): React.JSX.Element {
    const { settings, updateSettings } = useSettingsStore();
    const { t, locale, setLocale } = useI18n();
    const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled());
    const [soundVolume, setSoundVolumeState] = useState(getSoundVolume());
    const [notificationsEnabled, setNotificationsEnabled] = useState(isNotificationEnabled() && canNotify());

    return (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-general" aria-labelledby="settings-tab-general">
            <SectionTitle title={t('settings.general.heading')} description={t('settings.general.description')} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                <FieldRow label={t('settings.language.label')} description={t('settings.language.description')}>
                    <select
                        id="settings-language"
                        value={locale}
                        onChange={(e) => setLocale(e.target.value as Locale)}
                        className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2.5 text-sm text-[var(--mm-text-primary)] focus:border-[var(--mm-accent-blue)] focus:outline-none"
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

            <SectionTitle title={t('settings.general.notifications.heading')} description={t('settings.general.notifications.description')} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                <FieldRow label={t('settings.general.notifications.system.label')} description={t('settings.general.notifications.system.description')}>
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
                </FieldRow>
                <FieldRow label={t('settings.general.notifications.sound.label')} description={t('settings.general.notifications.sound.description')}>
                    <SwitchControl
                        checked={soundEnabled}
                        label={t('settings.general.notifications.sound.label')}
                        onChange={() => {
                            const next = !soundEnabled;
                            setSoundEnabledState(next);
                            setSoundEnabled(next);
                        }}
                    />
                </FieldRow>
                {soundEnabled && (
                    <FieldRow label={t('settings.general.notifications.volume.label', { value: Math.round(soundVolume * 100) })}>
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
                            aria-label={t('settings.general.notifications.volume.aria')}
                        />
                    </FieldRow>
                )}
            </div>
        </div>
    );
}
