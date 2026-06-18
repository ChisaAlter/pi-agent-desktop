// Pi Agent tab — Pi 状态 + 完整配置展示. 自行加载 piFullConfig.

import React, { useEffect, useState } from 'react';
import { PiStatusPanel } from '../../PiStatusPanel';
import { useI18n } from '../../../i18n';
import { SectionTitle } from '../_shared';

export function PiAgentTab(): React.JSX.Element {
    const { t } = useI18n();
    const [piFullConfig, setPiFullConfig] = useState<Awaited<ReturnType<typeof window.piAPI.getFullConfig>> | null>(null);

    useEffect(() => {
        if (window.piAPI?.getFullConfig) {
            window.piAPI.getFullConfig().then(setPiFullConfig).catch(console.error);
        }
    }, []);

    return (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-piagent" aria-labelledby="settings-tab-piagent">
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
    );
}