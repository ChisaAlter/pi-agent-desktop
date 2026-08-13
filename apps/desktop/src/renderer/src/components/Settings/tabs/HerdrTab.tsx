import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n";
import { useHerdrStore } from "../../../stores/herdr-store";

/**
 * HerdrTab — 设置窗口「智能体」分组（UI-REQ-060~064）。
 * 四区：通用（来源/自动检查/自动切换）· 兼容性与能力（版本/候选/能力清单）·
 * 更新流程（检查→下载候选→验证→安全切换→回滚）· 诊断（连接/Pi 集成/运行策略/数据目录）。
 *
 * 数据语义（D6/NL-010）：当前阶段 mock（版本 v0.9.0、候选 v0.9.1、能力清单、
 * 运行中智能体数 3 均为原型同款模拟值，Phase 3 由真实运行时接管）；
 * 诊断的服务连接行读取 herdr-store.server（非 mock 显示未连接，不伪造）。
 */

/** mock 能力清单（原型设置「能力清单」同款；Phase 3 由握手+契约测试得出） */
const MOCK_CAPABILITIES = [
    "agent.start",
    "agent.prompt",
    "agent.wait",
    "agent.read",
    "agent.send_keys",
    "agent.focus",
    "worktree.create",
    "events.subscribe",
    "terminal.attach",
    "resume",
];

const ROW_LABEL = "text-[13px] font-semibold text-[var(--mm-text-primary)]";
const ROW_DESC = "mt-0.5 text-[11px] leading-5 text-[var(--mm-text-tertiary)]";
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[#edf0f4] px-3.5 py-3 last:border-b-0";
const CARD = "overflow-hidden rounded-[11px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]";
const SWITCH = "relative h-[22px] w-[38px] rounded-full border border-[#c2cbd6] bg-[#ccd3dd] transition-colors";
const SWITCH_ON = "border-[#2563eb] bg-[#2563eb]";
const SWITCH_KNOB = "absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.33)] transition-[left]";
const SWITCH_KNOB_ON = "left-[18px]";
const PILL_GOOD = "inline-flex items-center rounded-full bg-[#e5f5ed] px-2 py-0.5 text-[11px] text-[#14734f]";
const PILL_WARN = "inline-flex items-center rounded-full bg-[#fff0d9] px-2 py-0.5 text-[11px] text-[#96600f]";
const PILL_BLUE = "inline-flex items-center rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[11px] text-[#2458bd]";
const BTN_PRIMARY = "rounded-lg bg-[#2563eb] px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#174fc6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff]";
const BTN_GHOST = "rounded-lg border border-[#dfe4eb] bg-white px-2.5 py-1.5 text-[12px] text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)]";

function Toggle({ on, onChange, ariaLabel }: { on: boolean; onChange: (next: boolean) => void; ariaLabel: string }): React.JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={ariaLabel}
            onClick={() => onChange(!on)}
            className={`${SWITCH} ${on ? SWITCH_ON : ""}`}
        >
            <span className={`${SWITCH_KNOB} ${on ? SWITCH_KNOB_ON : ""}`} aria-hidden="true" />
        </button>
    );
}

export function HerdrTab(): React.JSX.Element {
    const { t } = useI18n();
    const mock = useHerdrStore((s) => s.mock);
    const server = useHerdrStore((s) => s.server);

    // 通用区开关（mock 状态；Phase 3 接设置持久化）
    const [autoCheck, setAutoCheck] = useState(true);
    const [autoSwitch, setAutoSwitch] = useState(false);
    // 更新流程状态机（原型 check→verify→switch 语义）
    const [updateState, setUpdateState] = useState<"idle" | "available" | "verified">("idle");
    const [switchModalOpen, setSwitchModalOpen] = useState(false);

    const connected = mock && server === "connected";

    return (
        <div className="space-y-5" data-testid="herdr-tab">
            {/* 通用 */}
            <section data-settings-anchor="herdr-source">
                <h3 className="m-0 text-[13px] font-semibold text-[var(--mm-text-primary)]">{t("settings.tab.herdr")}</h3>
                <p className="m-0 mb-2.5 text-xs text-[var(--mm-text-tertiary)]">{t("settings.herdr.description")}</p>
                <div className={CARD}>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.general.sourceLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.general.sourceDesc")}</div>
                        </div>
                        <select
                            className="rounded-[7px] border border-[var(--mm-border)] bg-white px-2 py-1 text-xs text-[var(--mm-text-secondary)] focus:outline-none"
                            defaultValue="managed"
                            aria-label={t("settings.herdr.general.sourceLabel")}
                        >
                            <option value="managed">{t("herdr.statusBar.managedByDesktop")}</option>
                            <option value="system">{t("herdr.statusBar.systemInstalled")}</option>
                        </select>
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.general.autoCheckLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.general.autoCheckDesc")}</div>
                        </div>
                        <Toggle on={autoCheck} onChange={setAutoCheck} ariaLabel={t("settings.herdr.general.autoCheckLabel")} />
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.general.autoSwitchLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.general.autoSwitchDesc")}</div>
                        </div>
                        <Toggle on={autoSwitch} onChange={setAutoSwitch} ariaLabel={t("settings.herdr.general.autoSwitchLabel")} />
                    </div>
                </div>
            </section>

            {/* 兼容性与能力 */}
            <section data-settings-anchor="herdr-compat">
                <h3 className="m-0 text-[13px] font-semibold text-[var(--mm-text-primary)]">{t("settings.herdr.compat.currentLabel")}</h3>
                <p className="m-0 mb-2.5 text-xs text-[var(--mm-text-tertiary)]">{t("settings.herdr.compat.currentDesc")}</p>
                <div className={CARD}>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.compat.currentLabel")}</div>
                            <div className={ROW_DESC}>
                                {connected ? "Desktop 托管 · v0.9.0 · API v3" : t("settings.herdr.diagnostics.none")}
                            </div>
                        </div>
                        <span className={connected ? PILL_GOOD : PILL_WARN} data-testid="herdr-compat-pill">
                            {connected ? t("herdr.statusBar.compatible") : t("herdr.statusBar.offline")}
                        </span>
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.compat.candidateLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.compat.candidateDesc")}</div>
                        </div>
                        <button type="button" data-testid="check-update" onClick={() => setUpdateState("available")} className={BTN_GHOST}>
                            {t("settings.herdr.compat.checkAction")}
                        </button>
                    </div>
                </div>
                <h3 className="m-0 mt-5 text-[13px] font-semibold text-[var(--mm-text-primary)]">{t("settings.herdr.compat.capabilitiesHeading")}</h3>
                <p className="m-0 mb-2.5 text-xs text-[var(--mm-text-tertiary)]">{t("settings.herdr.compat.capabilitiesDesc")}</p>
                <div className={CARD}>
                    <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
                        {MOCK_CAPABILITIES.map((cap) => (
                            <span key={cap} className={PILL_BLUE}>
                                {cap}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* 更新流程（检查→候选→验证→安全切换→回滚） */}
            {updateState !== "idle" ? (
                <section data-settings-anchor="herdr-update">
                    <h3 className="m-0 text-[13px] font-semibold text-[var(--mm-text-primary)]">{t("settings.herdr.update.checkHeading")}</h3>
                    <p className="m-0 mb-2.5 text-xs text-[var(--mm-text-tertiary)]">{t("settings.herdr.update.checkDesc")}</p>
                    <div className={CARD}>
                        <div className={`${ROW} border-l-[3px] ${updateState === "verified" ? "border-l-[#16845b]" : "border-l-[#2563eb]"}`}>
                            <div>
                                <div className="text-[13px] font-bold text-[var(--mm-text-primary)]">{t("settings.herdr.update.candidateVersion")}</div>
                                <div className="mt-0.5 text-[11px] text-[var(--mm-text-tertiary)]">{t("settings.herdr.update.candidateMeta")}</div>
                            </div>
                            <span className={updateState === "verified" ? PILL_GOOD : PILL_WARN}>
                                {updateState === "verified" ? t("settings.herdr.compat.verified") : t("settings.herdr.compat.pending")}
                            </span>
                        </div>
                        <div className={`${ROW} border-l-[3px] ${updateState === "verified" ? "border-l-[#16845b]" : "border-l-[#2563eb]"}`}>
                            <div>
                                <div className={ROW_LABEL}>{t("settings.herdr.update.verifyRow")}</div>
                                <div className={ROW_DESC}>
                                    {updateState === "verified" ? t("settings.herdr.update.verifyRowMetaDone") : t("settings.herdr.update.verifyRowMeta")}
                                </div>
                            </div>
                            {updateState === "available" ? (
                                <button type="button" data-testid="verify-update" onClick={() => setUpdateState("verified")} className={BTN_PRIMARY}>
                                    {t("settings.herdr.compat.verifyAction")}
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <h3 className="m-0 mt-5 text-[13px] font-semibold text-[var(--mm-text-primary)]">{t("settings.herdr.update.switchHeading")}</h3>
                    <p className="m-0 mb-2.5 text-xs text-[var(--mm-text-tertiary)]">{t("settings.herdr.update.switchDesc")}</p>
                    <div className={CARD}>
                        <div className={ROW}>
                            <div>
                                <div className={ROW_LABEL}>{t("settings.herdr.update.waitPoint")}</div>
                                <div className={ROW_DESC}>{t("settings.herdr.update.waitPointDesc")}</div>
                            </div>
                            <button type="button" data-testid="switch-update" onClick={() => setSwitchModalOpen(true)} className={BTN_PRIMARY}>
                                {t("settings.herdr.update.switchButton")}
                            </button>
                        </div>
                        <div className={ROW}>
                            <div>
                                <div className={ROW_LABEL}>{t("settings.herdr.update.rollbackLabel")}</div>
                                <div className={ROW_DESC}>{t("settings.herdr.update.rollbackDesc")}</div>
                            </div>
                            <button type="button" className={BTN_GHOST}>
                                {t("settings.herdr.update.rollbackButton")}
                            </button>
                        </div>
                    </div>
                </section>
            ) : null}

            {/* 诊断 */}
            <section data-settings-anchor="herdr-diagnostics">
                <h3 className="m-0 text-[13px] font-semibold text-[var(--mm-text-primary)]">{t("settings.herdr.diagnostics.runtimePolicyHeading")}</h3>
                <p className="m-0 mb-2.5 text-xs text-[var(--mm-text-tertiary)]">{t("settings.herdr.diagnostics.runtimePolicyDesc")}</p>
                <div className={CARD}>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.diagnostics.connectionLabel")}</div>
                            <div className={ROW_DESC}>
                                {connected ? "server：已连接 · 会话 pi-desktop · 进程 18420" : t("settings.herdr.diagnostics.off")}
                            </div>
                        </div>
                        <span className={connected ? PILL_GOOD : PILL_WARN} data-testid="herdr-diag-connection">
                            {connected ? t("settings.herdr.diagnostics.ok") : t("settings.herdr.diagnostics.off")}
                        </span>
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.diagnostics.piIntegrationLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.diagnostics.piIntegrationDesc")}</div>
                        </div>
                        <span className={connected ? PILL_GOOD : PILL_WARN}>{connected ? t("settings.herdr.diagnostics.ok") : t("settings.herdr.diagnostics.unknown")}</span>
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.diagnostics.keepRunningLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.diagnostics.keepRunningDesc")}</div>
                        </div>
                        <Toggle on={true} onChange={() => undefined} ariaLabel={t("settings.herdr.diagnostics.keepRunningLabel")} />
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.diagnostics.reconnectLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.diagnostics.reconnectDesc")}</div>
                        </div>
                        <Toggle on={true} onChange={() => undefined} ariaLabel={t("settings.herdr.diagnostics.reconnectLabel")} />
                    </div>
                    <div className={ROW}>
                        <div>
                            <div className={ROW_LABEL}>{t("settings.herdr.diagnostics.dataDirLabel")}</div>
                            <div className={ROW_DESC}>{t("settings.herdr.diagnostics.dataDirDesc")}</div>
                        </div>
                        <code className="rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[11px] text-[var(--mm-text-secondary)]">%LOCALAPPDATA%/pi-desktop/herdr</code>
                    </div>
                </div>
            </section>

            {/* 安全切换确认（有智能体排队，不静默重启 — UI-REQ-063） */}
            {switchModalOpen && typeof document !== "undefined"
                ? createPortal(
                      <div className="fixed inset-0 z-[200] grid place-items-center bg-[#0f172a66]" data-testid="herdr-switch-modal">
                          <div className="w-[min(520px,calc(100vw-30px))] rounded-[14px] bg-white p-[18px] shadow-[0_24px_70px_rgba(0,0,0,0.27)]">
                              <h2 className="m-0 mb-2 text-[16px] font-bold text-[var(--mm-text-primary)]">
                                  {t("settings.herdr.update.modalTitle")}
                              </h2>
                              <p className="m-0 text-[14px] leading-[1.55] text-[#687386]">{t("settings.herdr.update.modalText")}</p>
                              <div className="mt-[18px] flex justify-end gap-2">
                                  <button type="button" onClick={() => setSwitchModalOpen(false)} className={BTN_GHOST}>
                                      {t("settings.herdr.update.cancel")}
                                  </button>
                                  <button
                                      type="button"
                                      data-testid="herdr-switch-confirm"
                                      onClick={() => setSwitchModalOpen(false)}
                                      className={BTN_PRIMARY}
                                  >
                                      {t("settings.herdr.update.confirm")}
                                  </button>
                              </div>
                          </div>
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
