import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useTranslateIpcError } from "../../../i18n";
import { SectionTitle, SettingsCard, SettingsPage } from "../_shared";
import { useUpdaterStore } from "../../../stores/updater-store";
import { isIpcError, type IpcError } from "@shared";

function formatTimestamp(timestamp: number | null, locale: string): string {
    if (!timestamp) return "—";
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(timestamp));
}

function getAppVersion(): string {
    return typeof __APP_VERSION__ === "undefined" ? "0.2.0" : __APP_VERSION__;
}

function UpdaterActionRow(): React.JSX.Element {
    const { t, locale } = useI18n();
    const translateIpcError = useTranslateIpcError();
    const {
        state,
        loading,
        error,
        setupListeners,
        cleanupListeners,
        hydrate,
        checkForUpdates,
        downloadUpdate,
        installUpdate,
    } = useUpdaterStore();
    const setupListenersRef = useRef(setupListeners);
    const cleanupListenersRef = useRef(cleanupListeners);
    const hydrateRef = useRef(hydrate);
    setupListenersRef.current = setupListeners;
    cleanupListenersRef.current = cleanupListeners;
    hydrateRef.current = hydrate;

    useEffect(() => {
        setupListenersRef.current();
        void hydrateRef.current();
        return () => cleanupListenersRef.current();
    }, []);

    const errorMessage = useMemo(() => {
        if (error) {
            return typeof error === "string" ? error : translateIpcError(error as IpcError);
        }
        return state?.error ?? null;
    }, [error, state?.error, translateIpcError]);

    const currentVersion = state?.currentVersion ?? getAppVersion();
    const latestVersion = state?.latestVersion ?? t("settings.about.unknownVersion");
    const lastCheckedLabel = formatTimestamp(state?.lastCheckedAt ?? null, locale);

    const openReleasePage = async () => {
        if (!state?.releasePageUrl) return;
        await window.piAPI?.openPath?.(state.releasePageUrl);
    };

    return (
        <section className="mt-4 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="m-0 text-sm font-medium text-[var(--mm-text-primary)]">{t("settings.about.updater.heading")}</p>
                    <p className="m-0 mt-1 text-xs text-[var(--mm-text-secondary)]">
                        {t("settings.about.updater.currentVersion", { version: currentVersion })}
                    </p>
                    <p className="m-0 mt-1 text-xs text-[var(--mm-text-secondary)]">
                        {t("settings.about.updater.latestVersion", { version: latestVersion })}
                    </p>
                    <p className="m-0 mt-1 text-xs text-[var(--mm-text-tertiary)]">
                        {t("settings.about.updater.lastChecked", { timestamp: lastCheckedLabel })}
                    </p>
                </div>
                <div className="shrink-0 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-1 text-xs text-[var(--mm-text-secondary)]">
                    {t(`settings.about.updater.phase.${state?.phase ?? "idle"}`)}
                </div>
            </div>

            {state?.disabledReason && (
                <p className="m-0 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {state.disabledReason}
                </p>
            )}

            {errorMessage && (
                <p className="m-0 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {errorMessage}
                </p>
            )}

            {state?.progress && (
                <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--mm-text-secondary)]">
                        <span>{t("settings.about.updater.progress")}</span>
                        <span>{Math.round(state.progress.percent)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--mm-bg-main)]">
                        <div
                            className="h-full rounded-full bg-[var(--mm-accent-blue)] transition-[width] duration-[var(--motion-panel)]"
                            style={{ width: `${Math.max(0, Math.min(100, state.progress.percent))}%` }}
                        />
                    </div>
                </div>
            )}

            {state?.releaseNotes && (
                <div className="mt-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] p-3">
                    <p className="m-0 text-xs font-medium text-[var(--mm-text-primary)]">{t("settings.about.updater.releaseNotes")}</p>
                    <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--mm-text-secondary)]">
                        {state.releaseNotes}
                    </pre>
                </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => void checkForUpdates()}
                    disabled={loading || state?.phase === "checking" || state?.phase === "downloading"}
                    className="rounded-lg bg-[var(--mm-accent-blue)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2563eb]"
                >
                    {t("settings.about.updater.actions.check")}
                </button>

                {state?.phase === "available" && !state.disabledReason && (
                    <button
                        type="button"
                        onClick={() => void downloadUpdate()}
                        disabled={loading}
                        className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-sm text-[var(--mm-text-primary)] transition hover:bg-[var(--mm-bg-sidebar)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                        {t("settings.about.updater.actions.download")}
                    </button>
                )}

                {state?.phase === "downloaded" && (
                    <button
                        type="button"
                        onClick={() => void installUpdate()}
                        disabled={loading}
                        className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-sm text-[var(--mm-text-primary)] transition hover:bg-[var(--mm-bg-sidebar)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                        {t("settings.about.updater.actions.install")}
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => void openReleasePage()}
                    className="rounded-lg border border-[var(--mm-border)] bg-transparent px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                    {t("settings.about.updater.actions.openReleasePage")}
                </button>
            </div>
        </section>
    );
}

function DiagnosticsSection(): React.JSX.Element {
    const { t } = useI18n();
    const [exporting, setExporting] = useState(false);
    const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

    const exportDiagnostics = async (): Promise<void> => {
        setExporting(true);
        setStatus(null);
        try {
            const result = await window.piAPI.diagnosticsExport();
            if (isIpcError(result)) throw new Error(result.fallback);
            if (!result.cancelled) {
                setStatus({ tone: "success", message: t("settings.about.diagnostics.exported", { path: result.path ?? "" }) });
            }
        } catch (error) {
            setStatus({
                tone: "error",
                message: t("settings.about.diagnostics.failed", {
                    message: error instanceof Error ? error.message : String(error),
                }),
            });
        } finally {
            setExporting(false);
        }
    };

    return (
        <SettingsCard anchorId="about-diagnostics" className="px-5 py-4">
            <SectionTitle title={t("settings.about.diagnostics.heading")} />
            <p className="m-0 text-sm leading-6 text-[var(--mm-text-secondary)]">
                {t("settings.about.diagnostics.description")}
            </p>
            <button
                type="button"
                onClick={() => void exportDiagnostics()}
                disabled={exporting}
                className="mt-4 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-sm text-[var(--mm-text-primary)] transition hover:bg-[var(--mm-bg-sidebar)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
            >
                {exporting ? t("settings.about.diagnostics.exporting") : t("settings.about.diagnostics.export")}
            </button>
            {status && (
                <p
                    role="status"
                    className={`m-0 mt-3 text-xs ${status.tone === "success" ? "text-emerald-600" : "text-red-600"}`}
                >
                    {status.message}
                </p>
            )}
        </SettingsCard>
    );
}
export function AboutTab(): React.JSX.Element {
    const { t } = useI18n();
    return (
        <SettingsPage tabId="about" title={t("settings.about.heading")} description={t("settings.about.description")}>
            <SettingsCard anchorId="about-overview" className="px-5 py-4">
                <SectionTitle title={t("settings.about.summaryHeading")} />
                <div className="text-sm leading-6 text-[var(--mm-text-secondary)]">
                    <p className="m-0 text-[var(--mm-text-primary)]">{t("settings.about.version", { version: getAppVersion() })}</p>
                    <p className="m-0 mt-2">{t("settings.about.description")}</p>
                    <p className="m-0 mt-2">{t("settings.about.stack")}</p>
                </div>
            </SettingsCard>
            <DiagnosticsSection />
            <div data-settings-anchor="about-updates">
                <UpdaterActionRow />
            </div>
        </SettingsPage>
    );
}
