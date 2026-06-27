import React, { useEffect, useMemo, useRef } from "react";
import { useI18n, useTranslateIpcError } from "../../../i18n";
import { SectionTitle } from "../_shared";
import { useUpdaterStore } from "../../../stores/updater-store";
import type { IpcError } from "@shared";

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
                            className="h-full rounded-full bg-[var(--mm-accent-blue)] transition-all duration-300"
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
                    className="rounded-lg bg-[var(--mm-accent-blue)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {t("settings.about.updater.actions.check")}
                </button>

                {state?.phase === "available" && (
                    <button
                        type="button"
                        onClick={() => void downloadUpdate()}
                        disabled={loading}
                        className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-sm text-[var(--mm-text-primary)] transition hover:bg-[var(--mm-bg-sidebar)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {t("settings.about.updater.actions.download")}
                    </button>
                )}

                {state?.phase === "downloaded" && (
                    <button
                        type="button"
                        onClick={() => void installUpdate()}
                        disabled={loading}
                        className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-sm text-[var(--mm-text-primary)] transition hover:bg-[var(--mm-bg-sidebar)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {t("settings.about.updater.actions.install")}
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => void openReleasePage()}
                    className="rounded-lg border border-[var(--mm-border)] bg-transparent px-3 py-2 text-sm text-[var(--mm-text-secondary)] transition hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)]"
                >
                    {t("settings.about.updater.actions.openReleasePage")}
                </button>
            </div>
        </section>
    );
}

export function AboutTab(): React.JSX.Element {
    const { t } = useI18n();
    return (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-about" aria-labelledby="settings-tab-about">
            <SectionTitle title={t("settings.about.heading")} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-sm leading-6 text-[var(--mm-text-secondary)]">
                <p className="m-0 text-[var(--mm-text-primary)]">{t("settings.about.version", { version: getAppVersion() })}</p>
                <p className="m-0 mt-2">{t("settings.about.description")}</p>
                <p className="m-0 mt-2">{t("settings.about.stack")}</p>
            </div>
            <UpdaterActionRow />
        </div>
    );
}
