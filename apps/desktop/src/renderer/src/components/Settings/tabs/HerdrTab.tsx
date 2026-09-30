import React, { useState } from "react";
import { createPortal } from "react-dom";
import { isIpcError } from "@shared";
import { useI18n } from "../../../i18n";
import { useHerdrStore } from "../../../stores/herdr-store";
import { FieldRow, SectionTitle, SettingsCard, SettingsPage } from "../_shared";
/**
 * HerdrTab — 设置窗口「智能体」分组（UI-REQ-060~064）。
 * 全部数据来自 herdr-store 的 Main 权威投影；动作走 typed IPC：
 *   - 连接/重连 → herdrStartServer
 *   - 停止服务 → herdrStopServer({confirmed:true})（确认模态）
 *   - 安装 Pi 集成 → herdrInstallIntegration({target:"pi", confirmed:true})（确认模态）
 * 未实现的功能（自动检查/自动切换/候选版本/安全切换/回滚）不放假按钮。
 */

const BTN_PRIMARY =
    "rounded-lg bg-[#2563eb] px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#174fc6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff] disabled:cursor-not-allowed disabled:opacity-50";
const BTN_GHOST =
    "rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-[13px] text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const PILL_GOOD = "inline-flex items-center rounded-full bg-[#e5f5ed] px-2.5 py-1 text-[11px] text-[#14734f]";
const PILL_WARN = "inline-flex items-center rounded-full bg-[#fff0d9] px-2.5 py-1 text-[11px] text-[#96600f]";
const PILL_NEUTRAL = "inline-flex items-center rounded-full bg-[#edf1f6] px-2.5 py-1 text-[11px] text-[#516074]";

const SOURCE_LABEL_KEY: Record<string, string> = {
    managed: "herdr.statusBar.managedByDesktop",
    system: "herdr.statusBar.systemInstalled",
    external: "herdr.statusBar.systemInstalled",
    env: "settings.herdr.sourceEnv",
    path: "settings.herdr.sourcePath",
    development: "settings.herdr.sourceDev",
};

const CONNECTION_PILL: Record<string, string> = {
    connected: PILL_GOOD,
    reconnecting: PILL_WARN,
    offline: PILL_NEUTRAL,
};

export function HerdrTab(): React.JSX.Element {
    const { t } = useI18n();
    const mock = useHerdrStore((s) => s.mock);
    const server = useHerdrStore((s) => s.server);
    const runtimeStatus = useHerdrStore((s) => s.runtimeStatus);
    const session = useHerdrStore((s) => s.tree.session);

    const [stopModalOpen, setStopModalOpen] = useState(false);
    const [installModalOpen, setInstallModalOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const connected = server === "connected";
    const status = runtimeStatus ?? (mock && connected
        ? {
            connection: "connected" as const,
            source: "managed" as const,
            version: "0.9.0",
            protocol: 3,
            pid: 18420,
            owned: true,
            compatibility: "compatible" as const,
            error: null,
        }
        : null);

    const connectionText = connected
        ? `server：已连接 · 会话 ${session || "—"} · 进程 ${status?.pid ?? "—"}`
        : server === "reconnecting"
            ? "server：正在重连"
            : t("settings.herdr.diagnostics.off");
    const sourceLabelKey = status?.source ? SOURCE_LABEL_KEY[status.source] : undefined;
    const sourceText = status
        ? (sourceLabelKey ? t(sourceLabelKey) : status.source)
        : t("settings.herdr.diagnostics.unknown");

    const handleConnect = async (): Promise<void> => {
        if (!window.piAPI?.herdrStartServer) return;
        setBusy(true);
        try {
            const result = await window.piAPI.herdrStartServer();
            if (isIpcError(result)) {
                console.error("[HerdrTab] start failed:", result.fallback);
            } else {
                // 成功投影直接应用，不依赖事件推送时序
                useHerdrStore.getState().applyProjection(result);
            }
        } finally {
            setBusy(false);
        }
    };

    const handleStop = async (): Promise<void> => {
        if (!window.piAPI?.herdrStopServer) return;
        setStopModalOpen(false);
        setBusy(true);
        try {
            const result = await window.piAPI.herdrStopServer({ confirmed: true });
            if (isIpcError(result)) {
                console.error("[HerdrTab] stop failed:", result.fallback);
            }
        } finally {
            setBusy(false);
        }
    };

    const handleInstallPi = async (): Promise<void> => {
        if (!window.piAPI?.herdrInstallIntegration) return;
        setInstallModalOpen(false);
        setBusy(true);
        try {
            const result = await window.piAPI.herdrInstallIntegration({ target: "pi", confirmed: true });
            if (isIpcError(result)) {
                console.error("[HerdrTab] install pi failed:", result.fallback);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <SettingsPage tabId="herdr" title={t("settings.herdr.heading")} description={t("settings.herdr.description")}>
            <SettingsCard className="px-5 py-4" anchorId="herdr-status">
                <SectionTitle title={t("settings.herdr.status.heading")} description={t("settings.herdr.status.desc")} />
                <FieldRow label={t("settings.herdr.diagnostics.connectionLabel")} description={connectionText}>
                    <span className={CONNECTION_PILL[server]} data-testid="herdr-diag-connection">
                        {connected
                            ? t("settings.herdr.diagnostics.ok")
                            : server === "reconnecting"
                                ? t("herdr.statusBar.reconnecting")
                                : t("settings.herdr.diagnostics.off")}
                    </span>
                </FieldRow>
                <FieldRow label={t("settings.herdr.general.sourceLabel")} description={sourceText}>
                    <span className={status?.owned ? PILL_GOOD : PILL_NEUTRAL} data-testid="herdr-source-pill">
                        {sourceText}
                    </span>
                </FieldRow>
                <FieldRow label={t("settings.herdr.compat.currentLabel")} description={status?.version ?? "—"}>
                    <span className={status?.compatibility === "compatible" ? PILL_GOOD : PILL_NEUTRAL} data-testid="herdr-compat-pill">
                        {status?.compatibility === "compatible"
                            ? t("herdr.statusBar.compatible")
                            : status?.compatibility === "incompatible"
                                ? t("herdr.statusBar.incompatible")
                                : t("herdr.statusBar.compatUnknown")}
                    </span>
                </FieldRow>
                <FieldRow label={t("settings.herdr.status.protocolLabel")} description={t("settings.herdr.status.protocolDesc")}>
                    <code className="block rounded-lg bg-[var(--mm-bg-hover)] px-2.5 py-1.5 text-[11px] text-[var(--mm-text-secondary)]">
                        {status?.protocol ? `protocol v${status.protocol}` : "—"}
                    </code>
                </FieldRow>
                <FieldRow label={t("settings.herdr.diagnostics.dataDirLabel")} description={t("settings.herdr.diagnostics.dataDirDesc")}>
                    <code className="block break-all rounded-lg bg-[var(--mm-bg-hover)] px-2.5 py-1.5 text-[11px] text-[var(--mm-text-secondary)]">
                        %APPDATA%/herdr
                    </code>
                </FieldRow>
            </SettingsCard>

            <SettingsCard className="px-5 py-4" anchorId="herdr-actions">
                <SectionTitle title={t("settings.herdr.actions.heading")} description={t("settings.herdr.actions.desc")} />
                <FieldRow label={t("settings.herdr.actions.connectLabel")} description={t("settings.herdr.actions.connectDesc")}>
                    <button type="button" data-testid="herdr-connect" onClick={() => void handleConnect()} disabled={busy || connected} className={BTN_PRIMARY}>
                        {connected ? t("settings.herdr.actions.connected") : t("settings.herdr.actions.connectButton")}
                    </button>
                </FieldRow>
                <FieldRow label={t("settings.herdr.actions.stopLabel")} description={t("settings.herdr.actions.stopDesc")}>
                    <button type="button" data-testid="herdr-stop" onClick={() => setStopModalOpen(true)} disabled={!connected || busy} className={BTN_GHOST}>
                        {t("settings.herdr.actions.stopButton")}
                    </button>
                </FieldRow>
                <FieldRow label={t("settings.herdr.actions.installPiLabel")} description={t("settings.herdr.actions.installPiDesc")}>
                    <button type="button" data-testid="herdr-install-pi" onClick={() => setInstallModalOpen(true)} disabled={busy} className={BTN_GHOST}>
                        {t("settings.herdr.actions.installPiButton")}
                    </button>
                </FieldRow>
            </SettingsCard>

            <SettingsCard className="px-5 py-4" anchorId="herdr-capabilities">
                <SectionTitle title={t("settings.herdr.compat.capabilitiesHeading")} description={t("settings.herdr.compat.capabilitiesDesc")} />
                {connected ? (
                    <div className="flex flex-wrap gap-2 pb-3">
                        {["session.snapshot", "events.subscribe", "agent.focus", "agent.prompt", "agent.read", "agent.send_keys"].map((cap) => (
                            <span key={cap} className="inline-flex items-center rounded-full bg-[#eaf1ff] px-2.5 py-1 text-[11px] text-[#2458bd]">
                                {cap}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="m-0 pb-3 text-[12px] leading-5 text-[var(--mm-text-tertiary)]" data-testid="herdr-capabilities-offline">
                        {t("settings.herdr.capabilitiesOffline")}
                    </p>
                )}
            </SettingsCard>

            {stopModalOpen && typeof document !== "undefined"
                ? createPortal(
                    <div className="fixed inset-0 z-[200] grid place-items-center bg-[#0f172a66]" data-testid="herdr-stop-modal">
                        <div className="w-[min(520px,calc(100vw-30px))] rounded-[14px] bg-white p-5 shadow-[0_24px_70px_rgba(0,0,0,0.27)]">
                            <h2 className="m-0 mb-3 text-[16px] font-bold text-[var(--mm-text-primary)]">
                                {t("settings.herdr.actions.stopModalTitle")}
                            </h2>
                            <p className="m-0 text-[14px] leading-[1.55] text-[#687386]">{t("settings.herdr.actions.stopModalText")}</p>
                            <div className="mt-5 flex justify-end gap-2">
                                <button type="button" onClick={() => setStopModalOpen(false)} className={BTN_GHOST}>
                                    {t("settings.herdr.actions.cancel")}
                                </button>
                                <button type="button" data-testid="herdr-stop-confirm" onClick={() => void handleStop()} className={BTN_PRIMARY}>
                                    {t("settings.herdr.actions.confirm")}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )
                : null}

            {installModalOpen && typeof document !== "undefined"
                ? createPortal(
                    <div className="fixed inset-0 z-[200] grid place-items-center bg-[#0f172a66]" data-testid="herdr-install-modal">
                        <div className="w-[min(520px,calc(100vw-30px))] rounded-[14px] bg-white p-5 shadow-[0_24px_70px_rgba(0,0,0,0.27)]">
                            <h2 className="m-0 mb-3 text-[16px] font-bold text-[var(--mm-text-primary)]">
                                {t("settings.herdr.actions.installModalTitle")}
                            </h2>
                            <p className="m-0 text-[14px] leading-[1.55] text-[#687386]">{t("settings.herdr.actions.installModalText")}</p>
                            <div className="mt-5 flex justify-end gap-2">
                                <button type="button" onClick={() => setInstallModalOpen(false)} className={BTN_GHOST}>
                                    {t("settings.herdr.actions.cancel")}
                                </button>
                                <button type="button" data-testid="herdr-install-confirm" onClick={() => void handleInstallPi()} className={BTN_PRIMARY}>
                                    {t("settings.herdr.actions.confirm")}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )
                : null}
        </SettingsPage>
    );
}
