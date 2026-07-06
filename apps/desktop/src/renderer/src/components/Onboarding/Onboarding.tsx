// Onboarding (可用度-D Task)
// 首启 3 步引导:
//   1. 检查 Pi CLI (状态拉取，复用 usePiStatusStore)
//   2. 选 workspace (按钮触发 window.piAPI.selectDirectory())
//   3. 开始用 (写 localStorage 标记完成，关闭模态)
//
// 约束：
//   - localStorage 写失败 try/catch 兜底
//   - 步骤可前可跳回
//   - a11y: role="dialog" + aria-modal + aria-labelledby
//   - v1.0.4: 全部用户可见文案走 t()

import React, { useEffect, useRef, useState, useCallback } from "react";
import { usePiStatusStore } from "../../stores/pi-status-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { markFirstLaunchDone } from "../../utils/first-launch";
import { useI18n, useTranslateIpcError } from "../../i18n";
import { logger } from "../../utils/logger";
import { isIpcError, type IpcError } from "@shared";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export interface OnboardingProps {
    /** 关闭回调（完成时由父组件调用） */
    onComplete: () => void;
    /** 测试/调试用：跳过 Pi 检查（强制"已安装"） */
    forceSkipPiCheck?: boolean;
}

type Step = 1 | 2 | 3;

export function Onboarding({ onComplete, forceSkipPiCheck = false }: OnboardingProps): React.JSX.Element {
    const [step, setStep] = useState<Step>(1);
    const [installing, setInstalling] = useState(false);
    const [workspaceError, setWorkspaceError] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    useFocusTrap(dialogRef);

    const { status, loading, error, progress, isOperating, refreshStatus, install } = usePiStatusStore();
    const { getCurrentWorkspace, createWorkspace } = useWorkspaceStore();
    const { t } = useI18n();
    // v1.0.8: store.error 现在可能是 IpcError, 走 t() 翻译; string 兜底直接显示
    const translateIpcError = useTranslateIpcError();
    const errorMessage: string | null = error == null
        ? null
        : typeof error === "string"
            ? error
            : translateIpcError(error as IpcError);

    const currentWorkspace = getCurrentWorkspace();
    const piInstalled = forceSkipPiCheck || status?.installed === true;

    // 步骤 1 进场时拉一次状态
    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    // 安装完成时自动重拉一次
    useEffect(() => {
        if (progress?.stage === "done") {
            setInstalling(false);
            void refreshStatus();
        }
    }, [progress?.stage, refreshStatus]);

    // 步骤 1 的"下一步"：仅当 Pi 已安装才放行；否则点 Install 触发安装
    const handleInstall = useCallback(async () => {
        setInstalling(true);
        try {
            await install();
        } catch (e) {
            // store 已把 error 设进状态；本组件只把按钮 loading 收起
            setInstalling(false);
            void e;
        }
    }, [install]);

    // 步骤 2：选 workspace
    const handleSelectWorkspace = useCallback(async () => {
        if (!window.piAPI?.selectDirectory) return;
        const path = await window.piAPI.selectDirectory();
        if (isIpcError(path)) {
            setWorkspaceError(path.fallback);
            return;
        }
        if (!path) return;
        const name = path.split(/[\\/]/).pop() || t("onboarding.step2.workspaceFallback");
        try {
            const ws = await createWorkspace(name, path);
            if (!ws) {
                setWorkspaceError(useWorkspaceStore.getState().lastError ?? "创建 workspace 失败");
                return;
            }
            if (window.piAPI.selectWorkspace) {
                const result = await window.piAPI.selectWorkspace(path);
                if (isIpcError(result)) {
                    setWorkspaceError(result.fallback);
                    return;
                }
            }
            setWorkspaceError(null);
        } catch (e) {
            logger.error("[Onboarding] failed to create workspace:", e);
            setWorkspaceError(e instanceof Error ? e.message : String(e));
        }
    }, [createWorkspace, t]);

    // 步骤 3：完成
    const handleFinish = useCallback(() => {
        markFirstLaunchDone();
        onComplete();
    }, [onComplete]);

    // 步骤 1 切到下一步
    const handleStep1Next = useCallback(() => {
        if (piInstalled) {
            setStep(2);
        }
    }, [piInstalled]);

    const title = step === 1
        ? t("onboarding.step1.title")
        : step === 2
        ? t("onboarding.step2.title")
        : t("onboarding.step3.title");

    const description = step === 1
        ? t("onboarding.step1.description")
        : step === 2
        ? t("onboarding.step2.description")
        : t("onboarding.step3.description");

    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            data-testid="onboarding-modal"
            onKeyDown={(e) => {
                if (e.key === "Escape") onComplete();
            }}
        >
            <div className="bg-[var(--mm-bg-panel)] rounded-2xl shadow-2xl w-[560px] max-w-[92vw] p-8">
                {/* Stepper */}
                <Stepper current={step} />

                {/* Title */}
                <h2
                    id="onboarding-title"
                    className="text-xl font-semibold text-[var(--mm-text-primary)] mt-6 mb-2"
                >
                    {title}
                </h2>
                <p className="text-sm text-[var(--mm-text-secondary)] mb-6">{description}</p>

                {/* Step 1: Pi CLI check */}
                {step === 1 && (
                    <div className="space-y-4">
                        <div
                            className="p-4 rounded-lg border bg-[var(--mm-bg-sidebar)] border-[var(--mm-border)]"
                            role="status"
                            aria-live="polite"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span
                                    className={`w-2 h-2 rounded-full ${
                                        piInstalled
                                            ? "bg-[var(--color-success)]"
                                            : loading
                                            ? "bg-[#f59e0b]"
                                            : "bg-[var(--color-error)]"
                                    }`}
                                />
                                <span className="text-sm font-medium">
                                    {piInstalled
                                        ? t("onboarding.step1.status.installed")
                                        : loading
                                        ? t("onboarding.step1.status.checking")
                                        : t("onboarding.step1.status.notFound")}
                                </span>
                            </div>
                            <p className="text-xs text-[var(--mm-text-secondary)]">
                                {piInstalled
                                    ? status?.localVersion
                                        ? t("onboarding.step1.status.versionKnown", { version: status.localVersion })
                                        : t("onboarding.step1.status.versionUnknown")
                                    : t("onboarding.step1.status.notInstalled")}
                            </p>
                            {errorMessage && !piInstalled && (
                                <p className="text-xs text-[var(--color-error)] mt-1" role="alert">
                                    {errorMessage}
                                </p>
                            )}
                            {!piInstalled && isOperating && progress && (
                                <p className="text-xs text-[var(--mm-text-secondary)] mt-1">
                                    {progress.message}
                                    {progress.percent != null && ` (${progress.percent}%)`}
                                </p>
                            )}
                        </div>

                        <div className="flex gap-2">
                            {!piInstalled && (
                                <button
                                    onClick={() => void handleInstall()}
                                    disabled={installing || isOperating}
                                    className="flex-1 px-4 py-2.5 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                    {installing || isOperating ? t("onboarding.step1.installing") : t("onboarding.step1.install")}
                                </button>
                            )}
                            {piInstalled && (
                                <button
                                    onClick={handleStep1Next}
                                    className="flex-1 px-4 py-2.5 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors text-sm font-medium"
                                >
                                    {t("common.next")}
                                </button>
                            )}
                            <button
                                onClick={() => void refreshStatus()}
                                disabled={loading || isOperating}
                                className="px-4 py-2.5 bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] text-[var(--mm-text-secondary)] rounded-lg hover:bg-[var(--mm-bg-sidebar)] transition-colors text-sm"
                                title={t("onboarding.step1.refresh")}
                            >
                                {t("onboarding.step1.refresh")}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Workspace */}
                {step === 2 && (
                    <div className="space-y-4">
                        <div
                            className="p-4 rounded-lg border bg-[var(--mm-bg-sidebar)] border-[var(--mm-border)]"
                            role="status"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span
                                    className={`w-2 h-2 rounded-full ${
                                        currentWorkspace ? "bg-[var(--color-success)]" : "bg-[#999]"
                                    }`}
                                />
                                <span className="text-sm font-medium">
                                    {currentWorkspace
                                        ? t("onboarding.step2.status.selected")
                                        : t("onboarding.step2.status.notSelected")}
                                </span>
                            </div>
                            <p className="text-xs text-[var(--mm-text-secondary)]">
                                {currentWorkspace
                                    ? t("onboarding.step2.status.selectedDetail", {
                                          name: currentWorkspace.name,
                                          path: currentWorkspace.path,
                                      })
                                    : t("onboarding.step2.status.hint")}
                            </p>
                        </div>

                        {workspaceError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                                {workspaceError}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={() => void handleSelectWorkspace()}
                                className="flex-1 px-4 py-2.5 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors text-sm font-medium"
                            >
                                {t("onboarding.step2.select")}
                            </button>
                            <button
                                onClick={() => setStep(1)}
                                className="px-4 py-2.5 bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] text-[var(--mm-text-secondary)] rounded-lg hover:bg-[var(--mm-bg-sidebar)] transition-colors text-sm"
                            >
                                {t("common.back")}
                            </button>
                            <button
                                onClick={() => setStep(3)}
                                disabled={!currentWorkspace}
                                className="px-4 py-2.5 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors text-sm font-medium disabled:opacity-50"
                            >
                                {t("common.next")}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Done */}
                {step === 3 && (
                    <div className="space-y-4">
                        <div
                            className="p-4 rounded-lg border bg-[#f0fdf4] border-[#bbf7d0]"
                            role="status"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
                                <span className="text-sm font-medium text-[var(--mm-text-primary)]">
                                    {t("onboarding.step3.checkedOk")}
                                </span>
                            </div>
                            <p className="text-xs text-[var(--mm-text-secondary)]">
                                {t("onboarding.step3.details", {
                                    cli: status?.localVersion
                                        ? t("onboarding.step3.cliReady", { version: status.localVersion })
                                        : t("onboarding.step3.cliMissing"),
                                    workspace: currentWorkspace
                                        ? t("onboarding.step3.workspaceReady", { name: currentWorkspace.name })
                                        : t("onboarding.step3.workspaceMissing"),
                                })}
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setStep(2)}
                                className="px-4 py-2.5 bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] text-[var(--mm-text-secondary)] rounded-lg hover:bg-[var(--mm-bg-sidebar)] transition-colors text-sm"
                            >
                                {t("common.back")}
                            </button>
                            <button
                                onClick={handleFinish}
                                className="flex-1 px-4 py-2.5 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors text-sm font-medium"
                            >
                                {t("common.done")}
                            </button>
                        </div>
                    </div>
                )}

                {/* Skip option (only if PiCheckDone or step 2 already ok) — keep the
                    escape hatch subtle, not the primary affordance */}
                <div className="mt-6 pt-4 border-t border-[#f0f0f0] text-right">
                    <button
                        onClick={handleFinish}
                        className="text-xs text-[var(--mm-text-tertiary)] hover:text-[var(--mm-text-secondary)] transition-colors"
                    >
                        {t("onboarding.skip")}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Sub-components ─────────────────────────────────────────────────

function Stepper({ current }: { current: Step }): React.JSX.Element {
    const { t } = useI18n();
    const steps: Array<{ id: Step; label: string }> = [
        { id: 1, label: t("onboarding.steps.label1") },
        { id: 2, label: t("onboarding.steps.label2") },
        { id: 3, label: t("onboarding.steps.label3") },
    ];
    return (
        <ol className="flex items-center gap-2" aria-label={t("onboarding.steps.ariaLabel")}>
            {steps.map((s, i) => {
                const active = s.id === current;
                const done = s.id < current;
                return (
                    <li key={s.id} className="flex items-center gap-2 flex-1">
                        <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 transition-colors ${
                                done
                                    ? "bg-[#1a1a1a] text-white"
                                    : active
                                    ? "bg-[#1a1a1a] text-white"
                                    : "bg-[var(--mm-bg-hover)] text-[var(--mm-text-tertiary)]"
                            }`}
                            aria-current={active ? "step" : undefined}
                        >
                            {done ? "✓" : s.id}
                        </span>
                        <span
                            className={`text-xs ${
                                active ? "text-[var(--mm-text-primary)] font-medium" : "text-[var(--mm-text-tertiary)]"
                            }`}
                        >
                            {s.label}
                        </span>
                        {i < steps.length - 1 && (
                            <span className="flex-1 h-px bg-[var(--mm-bg-hover)] ml-1" />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

export default Onboarding;
