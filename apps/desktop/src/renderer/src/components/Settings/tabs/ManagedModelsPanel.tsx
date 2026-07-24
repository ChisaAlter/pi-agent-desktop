// 模型配置 tab — 从 SettingsContent.tsx 抽出.
// 管理 Pi Agent 的 Provider 与模型, 含新增/编辑/删除/设默认/测试连接.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslateIpcError } from '../../../i18n';
import { isIpcError, type ManagedModelEntry, type ManagedModelsResult, type ManagedModelSaveInput } from '@shared';
import { SectionTitle, SettingsCard, SettingsPage } from '../_shared';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useMotionPresence } from '../../../hooks/useMotionPresence';

type ModelFormState = {
    originalProviderId?: string;
    originalModelId?: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    api: string;
    apiKey: string;
    modelId: string;
    modelName: string;
    contextWindow: string;
    maxTokens: string;
    reasoning: boolean;
    thinkingLevelMap: string;
    setDefault: boolean;
};

const emptyModelForm: ModelFormState = {
    providerId: '',
    providerName: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    modelId: '',
    modelName: '',
    contextWindow: '',
    maxTokens: '',
    reasoning: false,
    thinkingLevelMap: '',
    setDefault: false,
};

const providerApiOptions = [
    { value: 'openai-completions', label: 'OpenAI 兼容' },
    { value: 'openai-codex-responses', label: 'Codex' },
    { value: 'anthropic-messages', label: 'Claude Code' },
];

function apiFromApiType(apiType?: string): string | undefined {
    if (!apiType?.trim()) return undefined;
    if (apiType === 'openai' || apiType === 'openai-chat-completions' || apiType === 'openai-completions') return 'openai-completions';
    if (apiType === 'responses' || apiType === 'openai-responses') return 'openai-responses';
    if (apiType === 'anthropic' || apiType === 'anthropic-messages') return 'anthropic-messages';
    return apiType;
}

function labelForApi(api?: string): string {
    const value = apiFromApiType(api) ?? 'openai-completions';
    return providerApiOptions.find((option) => option.value === value)?.label ?? value;
}

function modelToForm(model: ManagedModelEntry): ModelFormState {
    return {
        originalProviderId: model.providerId,
        originalModelId: model.modelId,
        providerId: model.providerId,
        providerName: model.providerName,
        baseUrl: model.baseUrl ?? '',
        api: apiFromApiType(model.api ?? model.apiType) ?? 'openai-completions',
        apiKey: '',
        modelId: model.modelId,
        modelName: model.modelName,
        contextWindow: model.contextWindow ? String(model.contextWindow) : '',
        maxTokens: model.maxTokens ? String(model.maxTokens) : '',
        reasoning: Boolean(model.reasoning),
        thinkingLevelMap: model.thinkingLevelMap ? JSON.stringify(model.thinkingLevelMap) : '',
        setDefault: model.isDefault,
    };
}

function parseOptionalInteger(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseThinkingLevelMap(value: string): ManagedModelSaveInput["thinkingLevelMap"] {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("思考级别映射必须是 JSON 对象");
    }
    const result: NonNullable<ManagedModelSaveInput["thinkingLevelMap"]> = {};
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"] as const) {
        const mapped = (parsed as Record<string, unknown>)[level];
        if (mapped === undefined) continue;
        if (typeof mapped !== "string" && mapped !== null) {
            throw new Error(`${level} 的映射必须是字符串或 null`);
        }
        result[level] = mapped;
    }
    return result;
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
    const dialogRef = useRef<HTMLDivElement>(null);
    const deleteDialogRef = useRef<HTMLDivElement>(null);
    const retainedFormRef = useRef<ModelFormState | null>(form);
    const retainedDeleteModelRef = useRef<ManagedModelEntry | null>(pendingDeleteModel);
    if (form) retainedFormRef.current = form;
    if (pendingDeleteModel) retainedDeleteModelRef.current = pendingDeleteModel;
    const formPresence = useMotionPresence(form !== null, 180);
    const deletePresence = useMotionPresence(pendingDeleteModel !== null, 180);
    const displayedForm = form ?? retainedFormRef.current;
    const displayedDeleteModel = pendingDeleteModel ?? retainedDeleteModelRef.current;
    useFocusTrap(dialogRef, form !== null);
    useFocusTrap(deleteDialogRef, pendingDeleteModel !== null);
    const modelRows = result?.models ?? [];

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
                providerId: model.providerId,
                apiKey,
                modelId: model.modelId,
                apiType: model.apiType,
                api: apiFromApiType(model.api ?? model.apiType),
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
        let thinkingLevelMap: ManagedModelSaveInput["thinkingLevelMap"];
        try {
            thinkingLevelMap = parseThinkingLevelMap(form.thinkingLevelMap);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            return;
        }
        const input: ManagedModelSaveInput = {
            originalProviderId: form.originalProviderId,
            originalModelId: form.originalModelId,
            providerId: form.providerId.trim(),
            providerName: form.providerName.trim(),
            baseUrl: form.baseUrl.trim(),
            api: form.api,
            apiKey: form.apiKey.trim() || undefined,
            modelId: form.modelId.trim(),
            modelName: form.modelName.trim(),
            contextWindow: parseOptionalInteger(form.contextWindow),
            maxTokens: parseOptionalInteger(form.maxTokens),
            reasoning: form.reasoning,
            thinkingLevelMap,
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

    const formDialog = formPresence.rendered && displayedForm ? (
        <div className="settings-subdialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-6" data-motion-state={formPresence.state}>
            <div
                ref={dialogRef}
                className="settings-subdialog flex max-h-[calc(100vh-48px)] w-[min(680px,calc(100vw-48px))] flex-col overflow-hidden rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-2xl"
                data-motion-state={formPresence.state}
                role="dialog"
                aria-modal="true"
                aria-label="模型编辑"
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setForm(null);
                }}
            >
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--mm-border)] px-5 py-4">
                    <div className="text-sm font-semibold text-[var(--mm-text-primary)]">{displayedForm.originalModelId ? '编辑模型' : '新增模型'}</div>
                    <button type="button" onClick={() => setForm(null)} className="settings-pressable rounded-md px-2 py-1 text-sm transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">关闭</button>
                </div>
                <div className="grid min-h-0 grid-cols-2 gap-4 overflow-y-auto p-5">
                    <FormInput inputRef={providerIdInputRef} label="Provider ID" value={displayedForm.providerId} onChange={(providerId) => setForm({ ...displayedForm, providerId })} />
                    <FormInput label="Provider 名称" value={displayedForm.providerName} onChange={(providerName) => setForm({ ...displayedForm, providerName })} />
                    <FormInput className="col-span-2" label="Base URL" value={displayedForm.baseUrl} onChange={(baseUrl) => setForm({ ...displayedForm, baseUrl })} />
                    <label className="block text-xs font-medium text-[var(--mm-text-secondary)]">
                        API 类型
                        <select
                            value={displayedForm.api}
                            onChange={(event) => setForm({ ...displayedForm, api: event.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        >
                            {providerApiOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <FormInput label="API Key" value={displayedForm.apiKey} onChange={(apiKey) => setForm({ ...displayedForm, apiKey })} placeholder={displayedForm.originalModelId ? '留空表示不修改' : ''} />
                    <FormInput label="模型 ID" value={displayedForm.modelId} onChange={(modelId) => setForm({ ...displayedForm, modelId })} />
                    <FormInput label="模型名称" value={displayedForm.modelName} onChange={(modelName) => setForm({ ...displayedForm, modelName })} />
                    <FormInput label="上下文窗口" value={displayedForm.contextWindow} onChange={(contextWindow) => setForm({ ...displayedForm, contextWindow })} />
                    <FormInput label="最大输出 Token" value={displayedForm.maxTokens} onChange={(maxTokens) => setForm({ ...displayedForm, maxTokens })} />
                    <label className="flex items-center gap-2 text-sm text-[var(--mm-text-secondary)]">
                        <input type="checkbox" checked={displayedForm.reasoning} onChange={(event) => setForm({ ...displayedForm, reasoning: event.target.checked })} />
                        推理模型
                    </label>
                    <FormInput
                        className="col-span-2"
                        label="思考级别映射 (JSON)"
                        value={displayedForm.thinkingLevelMap}
                        onChange={(thinkingLevelMap) => setForm({ ...displayedForm, thinkingLevelMap })}
                        placeholder='{"minimal":null,"high":"high","xhigh":"max"}'
                    />
                    <label className="flex items-center gap-2 text-sm text-[var(--mm-text-secondary)]">
                        <input type="checkbox" checked={displayedForm.setDefault} onChange={(event) => setForm({ ...displayedForm, setDefault: event.target.checked })} />
                        保存后设为默认
                    </label>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--mm-border)] px-5 py-4">
                    <button type="button" onClick={() => setForm(null)} className="settings-pressable rounded-lg px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">取消</button>
                    <button type="button" onClick={() => void saveModel()} className="settings-pressable rounded-lg bg-[var(--mm-accent-blue)] px-3 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2563eb]">保存模型</button>
                </div>
            </div>
        </div>
    ) : null;

    const deleteDialog = deletePresence.rendered && displayedDeleteModel ? (
        <div className="settings-subdialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-6" data-motion-state={deletePresence.state}>
            <div
                ref={deleteDialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="删除模型确认"
                className="settings-subdialog flex max-h-[calc(100vh-48px)] w-[min(440px,calc(100vw-48px))] flex-col overflow-hidden rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
                data-motion-state={deletePresence.state}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setPendingDeleteModel(null);
                }}
            >
                <div className="shrink-0 border-b border-[var(--mm-border)] px-5 py-4">
                    <div className="text-[15px] font-semibold text-[var(--mm-text-primary)]">删除模型</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">
                        此操作会更新 Pi Agent 配置。删除默认模型时会自动切换到下一个可用模型。
                    </div>
                </div>
                <div className="min-h-0 overflow-y-auto px-5 py-4">
                    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                        <div className="truncate text-sm font-medium text-red-700">{displayedDeleteModel.modelName}</div>
                        <div className="mt-1 truncate font-mono text-xs text-red-500">
                            {displayedDeleteModel.providerId}/{displayedDeleteModel.modelId}
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-5 py-4">
                    <button
                        type="button"
                        onClick={() => setPendingDeleteModel(null)}
                        className="settings-pressable rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                        取消
                    </button>
                    <button
                        ref={deleteConfirmButtonRef}
                        type="button"
                        onClick={() => void deleteModel(displayedDeleteModel)}
                        className="settings-pressable rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
                    >
                        确认删除
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    return (
        <>
        <SettingsPage
            tabId="model"
            title="模型"
            description="查看当前默认模型认知，并集中管理 Pi Code Agent 的 Provider 与模型列表。"
            actions={(
                <button
                    type="button"
                    aria-label="新增模型"
                    onClick={() => setForm(emptyModelForm)}
                    className="settings-pressable shrink-0 rounded-[10px] border border-[var(--settings-border-soft)] bg-[var(--settings-bg-control)] px-3 py-2 text-xs font-medium text-[var(--mm-text-secondary)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--settings-bg-control-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                    + 添加 Provider
                </button>
            )}
        >
            <SettingsCard anchorId="model-defaults" className="px-5 py-4">
                <SectionTitle title="默认模型认知" description="这里显示当前配置文件中的默认 Provider / 模型，以及正在读取的配置目录。" />
                {!result ? (
                    <div className="rounded-xl border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-main)] p-4 text-sm text-[var(--mm-text-tertiary)]">加载模型配置中...</div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] p-4">
                                <div className="text-xs text-[var(--mm-text-tertiary)]">默认 Provider</div>
                                <div className="mt-2 text-sm font-medium text-[var(--mm-text-primary)]">{result.defaultProvider || "未设置"}</div>
                            </div>
                            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] p-4">
                                <div className="text-xs text-[var(--mm-text-tertiary)]">默认模型</div>
                                <div className="mt-2 text-sm font-medium text-[var(--mm-text-primary)]">{result.defaultModel || "未设置"}</div>
                            </div>
                        </div>
                        <div className="mt-3 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] p-4">
                            <div className="text-xs text-[var(--mm-text-tertiary)]">配置目录</div>
                            <div className="mt-2 break-all font-mono text-xs text-[var(--mm-text-secondary)]">{result.configDir}</div>
                        </div>
                    </>
                )}
            </SettingsCard>

            <SettingsCard anchorId="model-provider-list" className="px-5 py-4">
                <SectionTitle title="Provider / 模型管理" description="在这里新增、测试、编辑和删除 Provider 下的模型条目。" />
                {message && (
                    <div className="mb-3 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-xs text-[var(--mm-text-secondary)]">
                        {message}
                    </div>
                )}

                <div className="overflow-hidden rounded-[10px] border border-[var(--settings-border-soft)] bg-[var(--settings-bg-card)]">
                    {!result ? (
                        <div className="p-3 text-[10px] text-[var(--mm-text-tertiary)]">加载模型配置中...</div>
                    ) : modelRows.length === 0 ? (
                        <div className="p-3 text-[10px] text-[var(--mm-text-tertiary)]">暂未检测到模型配置。点击"新增模型"开始配置。</div>
                    ) : (
                        <div className="divide-y divide-[var(--settings-border-soft)]">
                            {modelRows.map((model) => {
                                const key = `${model.providerId}:${model.modelId}`;
                                const apiLabel = labelForApi(model.api ?? model.apiType);
                                const contextLabel = model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : '未设置';
                                const keyLabel = model.hasApiKey ? (model.apiKeyPreview ? `Key ${model.apiKeyPreview}` : 'Key 已配置') : '缺少 Key';
                                const stateLabel = model.isDefault ? '默认' : model.hasApiKey ? '已配置' : '需配置';
                                return (
                                    <div key={key} className="grid min-h-[82px] grid-cols-[minmax(0,1fr)_auto] gap-2 bg-[var(--settings-bg-row)] px-3 py-[11px] transition-colors duration-150 ease-out hover:bg-[var(--settings-bg-control-hover)]">
                                        <div className="min-w-0 text-[10px] leading-[15px]">
                                            <div className="flex items-center gap-1.5">
                                                <div className="truncate text-[11px] font-normal text-[var(--mm-text-primary)]">{model.modelName}</div>
                                                <span className="truncate text-[9px] text-[var(--mm-text-tertiary)]">
                                                    {model.providerName}
                                                </span>
                                                {model.isDefault && <span className="rounded-[3px] bg-[var(--settings-bg-active)] px-1 text-[9px] text-[var(--mm-accent-blue)]">默认</span>}
                                            </div>
                                            <div className="mt-[4px] grid grid-cols-[48px_minmax(0,1fr)] gap-x-2 gap-y-0 text-[9px] leading-[15px] text-[var(--settings-text-secondary)]">
                                                <span>Provider:</span>
                                                <span className="truncate">{model.providerId}</span>
                                                <span>API Base:</span>
                                                <span className="truncate text-[var(--settings-text-secondary)]" title={model.baseUrl ?? ''}>{model.baseUrl ?? '未设置'}</span>
                                                <span>能力:</span>
                                                <span className="truncate">{apiLabel} / {contextLabel} / {keyLabel}</span>
                                            </div>
                                        </div>
                                        <div data-testid="managed-model-actions" className="flex w-[132px] shrink-0 flex-col items-end pt-0">
                                            <div className="flex items-center gap-[6px]">
                                                <span className={`h-[5px] w-[5px] rounded-full ${model.hasApiKey ? 'bg-[#4fb866]' : 'bg-[var(--mm-text-tertiary)]'}`} aria-hidden />
                                                <span className="min-w-[24px] text-[9px] text-[var(--mm-text-secondary)]">
                                                    {stateLabel}
                                                </span>
                                            </div>
                                            <div className="mt-[22px] flex flex-nowrap items-center gap-[6px]">
                                                <button type="button" onClick={() => void testModel(model)} disabled={testingKey === key} aria-label={`测试 ${model.modelName}`} className="settings-pressable shrink-0 whitespace-nowrap rounded border border-[var(--settings-border-soft)] bg-[var(--settings-bg-control)] px-1.5 py-1 text-[9px] text-[var(--mm-text-secondary)] transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-[var(--settings-bg-control-hover)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">
                                                    {testingKey === key ? '测试中' : '测试'}
                                                </button>
                                                <button type="button" onClick={() => setForm(modelToForm(model))} aria-label={`编辑 ${model.modelName}`} className="settings-pressable shrink-0 whitespace-nowrap rounded border border-[var(--settings-border-soft)] bg-[var(--settings-bg-control)] px-1.5 py-1 text-[9px] text-[var(--mm-text-secondary)] transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-[var(--settings-bg-control-hover)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">
                                                    编辑
                                                </button>
                                                <button type="button" onClick={() => setPendingDeleteModel(model)} aria-label={`删除 ${model.modelName}`} className="settings-pressable shrink-0 whitespace-nowrap rounded border border-transparent px-1 py-1 text-[9px] leading-none text-[var(--mm-text-tertiary)] transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-[var(--settings-bg-control-hover)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                                                    删除
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </SettingsCard>
        </SettingsPage>
        {formDialog && typeof document !== 'undefined' ? createPortal(formDialog, document.body) : formDialog}
        {deleteDialog && typeof document !== 'undefined' ? createPortal(deleteDialog, document.body) : deleteDialog}
        </>
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
                className="mt-1 w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)] outline-none focus:border-[var(--mm-accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
            />
        </label>
    );
}
