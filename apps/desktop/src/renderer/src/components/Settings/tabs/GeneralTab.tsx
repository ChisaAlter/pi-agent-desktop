// 通用 tab — 语言/自动保存/行号/换行 + 通知/声音/音量. 自行管理 sound/notification 状态.

import React, { useState } from 'react';
import { useSettingsStore } from '../../../stores/settings-store';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '../../../i18n';
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume } from '../../../utils/sounds';
import { requestNotificationPermission, canNotify } from '../../../utils/notifications';
import { SectionTitle, FieldRow, SwitchControl } from '../_shared';

export function GeneralTab(): React.JSX.Element {
    const { settings, updateSettings } = useSettingsStore();
    const { t, locale, setLocale } = useI18n();
    const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled());
    const [soundVolume, setSoundVolumeState] = useState(getSoundVolume());
    const [notificationsEnabled, setNotificationsEnabled] = useState(canNotify());

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
    );
}
