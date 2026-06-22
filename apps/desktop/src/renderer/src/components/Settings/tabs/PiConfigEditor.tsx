// Pi 配置中心 tab — 从 SettingsContent.tsx 抽出.
// 原始 JSON 编辑器, 编辑 models.json / auth.json / settings.json, 含拉取模型/测试 Provider.

import React, { useEffect, useState } from 'react';
import { useTranslateIpcError } from '../../../i18n';
import { isIpcError, type PiAuthFile, type PiModelsFile, type PiSettingsFile } from '@shared';
import { SectionTitle } from '../_shared';

export function PiConfigEditor(): React.JSX.Element {
    const translateIpcError = useTranslateIpcError();
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
        <div className="settings-tab-panel space-y-4" role="tabpanel" id="settings-tabpanel-config" aria-labelledby="settings-tab-config">
            <SectionTitle title="Pi 配置中心" description="编辑 models.json、auth.json 和 settings.json。" />
            <div className="flex flex-wrap items-center gap-2">
                {(['models.json', 'auth.json', 'settings.json'] as const).map((name) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => setFileName(name)}
                        className={`settings-pressable rounded-md px-3 py-1.5 text-sm transition-[transform,background-color,color] duration-150 ease-out ${
                            fileName === name ? 'bg-[var(--mm-accent-blue)] text-white' : 'bg-[var(--settings-bg-control)] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]'
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
                className="min-h-[300px] w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3 font-mono text-xs text-[var(--mm-text-primary)] outline-none focus:border-[var(--mm-accent-blue)]"
                aria-label="Pi 配置 JSON"
            />
            {[message, fetchStatus, testStatus].filter(Boolean).map((status) => (
                <div key={status} className="rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs text-[var(--mm-text-secondary)]">
                    {status}
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={save} className="settings-pressable rounded-md bg-[var(--mm-accent-blue)] px-3 py-2 text-sm text-white transition-[transform,background-color] duration-150 ease-out hover:opacity-90">保存当前文件</button>
                <button type="button" onClick={exportConfig} className="settings-pressable rounded-md bg-[var(--settings-bg-control)] px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]">导出配置包</button>
                <button type="button" onClick={importConfig} className="settings-pressable rounded-md bg-[var(--settings-bg-control)] px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]">从编辑区导入配置包</button>
                <button type="button" onClick={async () => {
                    setFetchStatus("拉取中...");
                    try {
                        const provider = await loadProviderSelection(setFetchStatus);
                        if (!provider) return;
                        const models = await window.piAPI.configFetchModels(provider.baseUrl, provider.apiKey, provider.apiType);
                        if (isIpcError(models)) {
                            setFetchStatus(`拉取失败: ${translateIpcError(models)}`);
                            return;
                        }
                        setFetchStatus(`拉取到 ${models.length} 个模型`);
                    } catch (e) {
                        setFetchStatus(`拉取失败: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }} className="settings-pressable rounded-md bg-[var(--settings-bg-control)] px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]">拉取模型列表</button>
                <button type="button" onClick={async () => {
                    setTestStatus("测试中...");
                    try {
                        const provider = await loadProviderSelection(setTestStatus);
                        if (!provider) return;
                        const result = await window.piAPI.configTestProvider(provider);
                        if (isIpcError(result)) {
                            setTestStatus(`测试失败: ${translateIpcError(result)}`);
                            return;
                        }
                        setTestStatus(result.ok ? "连接成功" : `连接失败: ${result.message}`);
                    } catch (e) {
                        setTestStatus(`测试失败: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }} className="settings-pressable rounded-md bg-[var(--settings-bg-control)] px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]">测试 Provider</button>
            </div>
        </div>
    );
}
