// 关于 tab — 版本/描述/技术栈.

import React from 'react';
import { useI18n } from '../../../i18n';
import { SectionTitle } from '../_shared';

export function AboutTab(): React.JSX.Element {
    const { t } = useI18n();
    return (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-about" aria-labelledby="settings-tab-about">
            <SectionTitle title={t('settings.about.heading')} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-sm leading-6 text-[var(--mm-text-secondary)]">
                <p className="m-0 text-[var(--mm-text-primary)]">{t('settings.about.version', { version: __APP_VERSION__ ?? '0.2.0' })}</p>
                <p className="m-0 mt-2">{t('settings.about.description')}</p>
                <p className="m-0 mt-2">{t('settings.about.stack')}</p>
            </div>
        </div>
    );
}