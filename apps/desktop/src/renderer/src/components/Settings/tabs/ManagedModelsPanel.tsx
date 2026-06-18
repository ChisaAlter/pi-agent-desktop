// 模型配置 tab — 从 SettingsContent.tsx 抽出.
// 管理 Pi Agent 的 Provider 与模型, 含新增/编辑/删除/设默认/测试连接.

import React, { useEffect, useRef, useState } from 'react';
import { useTranslateIpcError } from '../../../i18n';
import { isIpcError, type ManagedModelEntry, type ManagedModelsResult, type ManagedModelSaveInput } from '@shared';
import { SectionTitle } from '../_shared';

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

export function ManagedModelsPanel({ onPiConfigChanged }: { onPiConfigChanged: () => Promise<void> }): React.JSX.Element {
    const [result, setResult] = useState<ManagedModelsResult | null>(null);
    const [message, setMessage] = useState('');
    const [testingKey, setTestingKey] = useState<string | null>(null);
    const [form, setForm] = useState<ModelFormState | null>(null);
    const [pendingDeleteModel, setPendingDeleteModel] = useState<ManagedModelEntry | null>(null);
    const translateIpcError = useTranslateIpcError();
    const providerIdInputRef = useRef<HTMLInputElement>(null);
    const deleteConfirmButtonRef = useRef<HTMLButtonElement>(null);

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
    const formFocusKey = form ? `${form.originalProviderId ?? ''}:${form.originalModelId ?? ''}:${form.originalModelId ? 'edit' : 'new'}` : null;
    const pendingDeleteFocusKey = pendingDeleteModel ? `${pendingDeleteModel.providerId}:${pendingDeleteModel.modelId}` : null;

    useEffect(() => {
        if (!formFocusKey) return;
        providerIdInputRef.current?.focus();
    }, [formFocusKey]);

    useEffect(() => {
        if (!pendingDeleteFocusKey) return;
        deleteConfirmButtonRef.current?.focus();
    }, [pendingDeleteFocusKey]);

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
            if (isIpcError(response)) {
                setMessage(translateIpcError(response));
                return;
            }
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
        const response = await window.piAPI.configDeleteManagedModel({
            providerId: model.providerId,
            modelId: model.modelId,
        });
        if (!response.valid) {
            setMessage(response.error ?? '删除失败');
            return;
        }
        setPendingDeleteModel(null);
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
                    className="settings-pressable shrink-0 rounded-lg bg-[#1f1f1f] px-3 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-[#333]"
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
                    <div className="p-5 text-sm text-[var(--mm-text-tertiary)]">暂未检测到模型配置。点击"新增模型"开始配置。</div>
                ) : (
                    <div className="divide-y divide-[var(--mm-border)]">
                        {result.models.map((model) => {
                            const key = `${model.providerId}:${model.modelId}`;
                            return (
                                <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 p-4 transition-colors duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)]">
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
                                            <button type="button" onClick={() => void setDefault(model)} className="settings-pressable rounded-md px-2 py-1 text-xs transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]">
                                                设为默认
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void testModel(model)}
                                            disabled={testingKey === key}
                                            aria-label={`测试 ${model.modelName}`}
                                            className="settings-pressable rounded-md px-2 py-1 text-xs transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-[var(--mm-bg-hover)] disabled:opacity-50"
                                        >
                                            测试
                                        </button>
                                        <button type="button" onClick={() => setForm(modelToForm(model))} aria-label={`编辑 ${model.modelName}`} className="settings-pressable rounded-md px-2 py-1 text-xs transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]">
                                            编辑
                                        </button>
                                        <button type="button" onClick={() => setPendingDeleteModel(model)} aria-label={`删除 ${model.modelName}`} className="settings-pressable rounded-md px-2 py-1 text-xs text-red-600 transition-[transform,background-color] duration-150 ease-out hover:bg-red-50">
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
                <div className="settings-subdialog-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6">
                    <div className="settings-subdialog w-[min(680px,calc(100vw-48px))] rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-2xl" role="dialog" aria-modal="true" aria-label="模型编辑">
                        <div className="flex items-center justify-between border-b border-[var(--mm-border)] px-5 py-4">
                            <div className="text-sm font-semibold text-[var(--mm-text-primary)]">{form.originalModelId ? '编辑模型' : '新增模型'}</div>
                            <button type="button" onClick={() => setForm(null)} className="settings-pressable rounded-md px-2 py-1 text-sm transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)]">关闭</button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 p-5">
                            <FormInput inputRef={providerIdInputRef} label="Provider ID" value={form.providerId} onChange={(providerId) => setForm({ ...form, providerId })} />
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
                            <button type="button" onClick={() => setForm(null)} className="settings-pressable rounded-lg px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)]">取消</button>
                            <button type="button" onClick={() => void saveModel()} className="settings-pressable rounded-lg bg-[#1f1f1f] px-3 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-[#333]">保存模型</button>
                        </div>
                    </div>
                </div>
            )}

            {pendingDeleteModel && (
                <div className="settings-subdialog-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-6 backdrop-blur-[1px]">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="删除模型确认"
                        className="settings-subdialog w-[min(440px,calc(100vw-48px))] overflow-hidden rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
                    >
                        <div className="border-b border-[var(--mm-border)] px-5 py-4">
                            <div className="text-[15px] font-semibold text-[var(--mm-text-primary)]">删除模型</div>
                            <div className="mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">
                                此操作会更新 Pi Agent 配置。删除默认模型时会自动切换到下一个可用模型。
                            </div>
                        </div>
                        <div className="px-5 py-4">
                            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                                <div className="truncate text-sm font-medium text-red-700">{pendingDeleteModel.modelName}</div>
                                <div className="mt-1 truncate font-mono text-xs text-red-500">
                                    {pendingDeleteModel.providerId}/{pendingDeleteModel.modelId}
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setPendingDeleteModel(null)}
                                className="settings-pressable rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)]"
                            >
                                取消
                            </button>
                            <button
                                ref={deleteConfirmButtonRef}
                                type="button"
                                onClick={() => void deleteModel(pendingDeleteModel)}
                                className="settings-pressable rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-red-700"
                            >
                                确认删除
                            </button>
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
    inputRef,
    className = '',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    inputRef?: React.Ref<HTMLInputElement>;
    className?: string;
}): React.JSX.Element {
    const id = `model-form-${label.replace(/\s+/g, '-').toLowerCase()}`;
    return (
        <label htmlFor={id} className={`block text-xs font-medium text-[var(--mm-text-secondary)] ${className}`}>
            {label}
            <input
                ref={inputRef}
                id={id}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)] outline-none focus:border-[#1f1f1f]"
            />
        </label>
    );
}