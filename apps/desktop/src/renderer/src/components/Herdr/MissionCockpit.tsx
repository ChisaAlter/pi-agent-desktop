import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { useSettingsStore } from "../../stores/settings-store";
import { addToast } from "../../stores/toast-store";
import {
    missionDag,
    missionPanels,
    useHerdrStore,
    type HerdrMissionStatus,
} from "../../stores/herdr-store";
import { MissionDag } from "./MissionDag";

/**
 * MissionCockpit — 任务驾驶舱（原型 #missionView 同款）。
 * - hero: 深色渐变 + 状态 pill + 目标输入 + 生成任务图/开始任务
 * - 权威来源横幅: 会话 · 桌面投影序号 · 非重放语义
 * - DAG 卡片: draft 空态，否则 MissionDag（4 节点 + 依赖箭头）
 * - 三栏: 交付物 | 审查与修订 | 分支整合（含修订/复审/合入流程 + 合入确认模态）
 * 非 mock（无运行时）时渲染 herdr.mission.empty 空态，禁止假数据（D6/NL-010）。
 * running → 2200ms 自动推进 review（原型行为），定时器随组件卸载清理。
 */

const STATUS_PILL: Record<HerdrMissionStatus, string> = {
    draft: "bg-[var(--mm-bg-hover)] text-[var(--mm-text-secondary)]",
    planned: "bg-[var(--mm-accent-blue)]/10 text-[var(--mm-accent-blue)]",
    running: "bg-[var(--mm-accent-blue)]/10 text-[var(--mm-accent-blue)]",
    review: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
    revision: "bg-[#b56a0b]/10 text-[#b56a0b]",
    passed: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
};

const STATUS_KEY: Record<HerdrMissionStatus, string> = {
    draft: "herdr.mission.statusDraft",
    planned: "herdr.mission.statusPlanned",
    running: "herdr.mission.statusRunning",
    review: "herdr.mission.statusReview",
    revision: "herdr.mission.statusRevision",
    passed: "herdr.mission.statusPassed",
};

const REVIEW_TITLE_KEY: Record<"rejected" | "revising" | "passed", string> = {
    rejected: "herdr.mission.reviewRejected",
    revising: "herdr.mission.reviewRevising",
    passed: "herdr.mission.reviewPassed",
};

const PANEL_BODY = "grid min-h-[140px] place-items-center text-[13px] text-[var(--mm-text-tertiary)]";
const PRIMARY_BTN =
    "rounded-md bg-[#2563eb] px-3 py-[7px] text-[12px] font-medium text-white transition-colors hover:bg-[#174fc6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff]";

export function MissionCockpit(): React.JSX.Element {
    const { t } = useI18n();
    const mock = useHerdrStore((s) => s.mock);
    const status = useHerdrStore((s) => s.missionStatus);
    const layoutMode = useSettingsStore((s) => s.herdrLayoutMode);
    const seq = useHerdrStore((s) => s.missionSeq);
    const attempt = useHerdrStore((s) => s.missionAttempt);
    const goal = useHerdrStore((s) => s.missionGoal);
    const session = useHerdrStore((s) => s.tree.session);
    const mergeOpen = useHerdrStore((s) => s.mergeConfirmOpen);
    const setMissionGoal = useHerdrStore((s) => s.setMissionGoal);
    const planMission = useHerdrStore((s) => s.planMission);
    const runMission = useHerdrStore((s) => s.runMission);
    const advanceMission = useHerdrStore((s) => s.advanceMission);
    const createRevision = useHerdrStore((s) => s.createRevision);
    const passReview = useHerdrStore((s) => s.passReview);
    const requestMerge = useHerdrStore((s) => s.requestMerge);
    const confirmMerge = useHerdrStore((s) => s.confirmMerge);
    const closeMergeConfirm = useHerdrStore((s) => s.closeMergeConfirm);

    // running → 2200ms 后推进到 review（原型 setTimeout 语义），卸载/状态变化时清理
    useEffect(() => {
        if (status !== "running") return;
        const timer = window.setTimeout(() => {
            advanceMission();
        }, 2200);
        return () => window.clearTimeout(timer);
    }, [status, advanceMission]);

    if (!mock) {
        return (
            <div className="grid min-h-[320px] place-items-center rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[13px] text-[var(--mm-text-tertiary)]">
                {t("herdr.mission.empty")}
            </div>
        );
    }

    const dag = missionDag(status, attempt);
    const panels = missionPanels(status, attempt);

    const handleRun = (): void => {
        if (status === "draft") {
            // 原型行为: draft 直接点开始 → 仅提示先生成任务图
            addToast(t("herdr.toast.runFirst"), "warning");
            return;
        }
        runMission();
    };

    return (
        <div className="space-y-2.5">
            {/* hero — 任务控制中心 */}
            <section
                data-testid="mission-hero"
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-[15px] rounded-[14px] bg-gradient-to-br from-[#15213b] to-[#253d73] p-[18px] text-white shadow-[0_12px_35px_rgba(26,39,66,0.08)]"
            >
                <div className="min-w-0">
                    <h2 className="m-0 text-xl font-bold">{t("herdr.mission.title")}</h2>
                    <p className="m-0 mt-1 text-[13px] text-[#c9d5e8]">{t("herdr.mission.subtitle")}</p>
                </div>
                <span
                    data-testid="mission-status"
                    className={`h-fit self-start whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${STATUS_PILL[status]}`}
                >
                    {t(STATUS_KEY[status])}
                </span>
                <div className="col-span-2 flex gap-2">
                    <input
                        data-testid="mission-goal"
                        value={goal}
                        onChange={(e) => setMissionGoal(e.target.value)}
                        placeholder={t("herdr.mission.goalPlaceholder")}
                        className="min-w-0 flex-1 rounded-[9px] border border-[#5a6d91] bg-white/[0.07] px-3 py-2.5 text-[13px] text-white placeholder:text-[#b8c3d8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff]"
                    />
                    <button
                        type="button"
                        data-testid="mission-plan"
                        onClick={() => {
                            planMission();
                            addToast(t("herdr.toast.planCreated"), "success");
                        }}
                        disabled={status !== "draft"}
                        className="rounded-[9px] border border-white/20 bg-[#4a81ee] px-3.5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#3a6fd8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {t("herdr.mission.plan")}
                    </button>
                    <button
                        type="button"
                        data-testid="mission-run"
                        onClick={handleRun}
                        className="rounded-[9px] border border-white/20 bg-white/10 px-3.5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff]"
                    >
                        {t("herdr.mission.run")}
                    </button>
                </div>
            </section>

            {/* 权威来源横幅 */}
            <div
                data-testid="mission-banner"
                className="rounded-[9px] border border-[#cbdcff] bg-[#eef4ff] px-3 py-2 text-xs leading-5 text-[#2c58a9]"
            >
                {t("herdr.mission.authorityPrefix")}{" "}
                <b>{t("herdr.mission.authoritySession", { session })}</b>
                {" · "}
                <span data-testid="mission-seq">{t("herdr.mission.authorityProjection", { seq })}</span>
                {" · "}
                {t("herdr.mission.authorityNoReplay")}
            </div>

            {/* DAG 卡片 */}
            <section
                data-testid="mission-dag"
                className="min-h-[265px] overflow-auto rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4"
            >
                {status === "draft" ? (
                    <div data-testid="dag-empty" className={PANEL_BODY}>
                        {t("herdr.mission.dagEmpty")}
                    </div>
                ) : (
                    <MissionDag nodes={dag} />
                )}
            </section>

            {/* 三栏: 交付物 | 审查与修订 | 分支整合 */}
            {/* 底部三栏：studio 2 列（原型 mission-lower 1fr 1fr）/ mission 布局 3 列 */}
            <div className={`grid grid-cols-1 gap-2.5 ${layoutMode === "mission" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                <div data-testid="mission-artifacts" className="rounded-[11px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3">
                    <h3 className="m-0 mb-2.5 text-[13px] font-semibold text-[var(--mm-text-primary)]">
                        {t("herdr.mission.artifacts")}
                    </h3>
                    {panels.artifacts ? (
                        <div className="border-l-[3px] border-[var(--color-success)] pl-2.5">
                            <b className="text-xs text-[var(--mm-text-primary)]">
                                {panels.artifacts.owner} · {t("herdr.mission.round", { n: panels.artifacts.attempt })}
                            </b>
                            <p className="m-0 mt-1 text-xs leading-[1.55] text-[var(--mm-text-secondary)]">
                                {panels.artifacts.summary}
                            </p>
                            <div className="mt-2 rounded-md bg-[#121923] p-2 font-mono text-[10px] leading-[1.55] text-[#b9c8db]">
                                <span className="text-[#ff8c98]">{panels.artifacts.diff.del}</span>
                                <br />
                                <span className="text-[#65d6a6]">{panels.artifacts.diff.add}</span>
                            </div>
                            <p className="m-0 mt-2 text-xs text-[var(--mm-text-secondary)]">
                                {t("herdr.mission.artifactCommit", {
                                    commit: panels.artifacts.commit,
                                    tests: panels.artifacts.tests,
                                })}
                            </p>
                        </div>
                    ) : (
                        <div className={PANEL_BODY}>{t("herdr.mission.artifactsWaiting")}</div>
                    )}
                </div>

                <div data-testid="mission-review" className="rounded-[11px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3">
                    <h3 className="m-0 mb-2.5 text-[13px] font-semibold text-[var(--mm-text-primary)]">
                        {t("herdr.mission.review")}
                    </h3>
                    {panels.review ? (
                        <div
                            className={`border-l-[3px] pl-2.5 ${
                                panels.review.kind === "rejected" ? "border-[var(--color-error)]" : "border-[var(--color-success)]"
                            }`}
                        >
                            <b className="text-xs text-[var(--mm-text-primary)]">{t(REVIEW_TITLE_KEY[panels.review.kind])}</b>
                            <p className="m-0 mt-1 text-xs leading-[1.55] text-[var(--mm-text-secondary)]">{panels.review.text}</p>
                            {panels.review.kind === "rejected" ? (
                                <button
                                    type="button"
                                    data-testid="revision-btn"
                                    onClick={() => {
                                        createRevision();
                                        addToast(t("herdr.toast.revisionCreated"), "success");
                                    }}
                                    className={`${PRIMARY_BTN} mt-2`}
                                >
                                    {t("herdr.mission.createRevision")}
                                </button>
                            ) : null}
                            {panels.review.kind === "revising" ? (
                                <button
                                    type="button"
                                    data-testid="review-pass-btn"
                                    onClick={() => {
                                        passReview();
                                        addToast(t("herdr.toast.reviewPassed"), "success");
                                    }}
                                    className={`${PRIMARY_BTN} mt-2`}
                                >
                                    {t("herdr.mission.reviewPassAction")}
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <div className={PANEL_BODY}>{t("herdr.mission.reviewWaiting")}</div>
                    )}
                </div>

                <div data-testid="mission-integration" className="rounded-[11px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3">
                    <h3 className="m-0 mb-2.5 text-[13px] font-semibold text-[var(--mm-text-primary)]">
                        {t("herdr.mission.integration")}
                    </h3>
                    {panels.integration?.state === "ready" ? (
                        <div className="border-l-[3px] border-[var(--color-success)] pl-2.5">
                            <b className="text-xs text-[var(--mm-text-primary)]">{t("herdr.mission.integrationReady")}</b>
                            <p className="m-0 mt-1 text-xs leading-[1.55] text-[var(--mm-text-secondary)]">
                                {panels.integration.text}
                            </p>
                            <button
                                type="button"
                                data-testid="merge-btn"
                                onClick={requestMerge}
                                className={`${PRIMARY_BTN} mt-2`}
                            >
                                {t("herdr.mission.requestMerge")}
                            </button>
                        </div>
                    ) : (
                        <div className={PANEL_BODY}>{t("herdr.mission.integrationWaiting")}</div>
                    )}
                </div>
            </div>

            {/* 合入确认模态 — 合入必须用户确认（UI-REQ-044）。
                portal 到 body：面板栈/动画层有 transform，会破坏 position:fixed 的
                视口定位，导致遮罩只覆盖局部区域。 */}
            {mergeOpen && typeof document !== "undefined"
                ? createPortal(
                      <div className="fixed inset-0 z-[200] grid place-items-center bg-[#0f172a66]" data-testid="merge-confirm-modal">
                      <div className="w-[min(520px,calc(100vw-30px))] rounded-[14px] bg-white p-[18px] shadow-[0_24px_70px_rgba(0,0,0,0.27)]">
                          <h2 className="m-0 mb-2 text-[16px] font-bold text-[var(--mm-text-primary)]">
                              {t("herdr.mission.mergeConfirmTitle")}
                          </h2>
                          <p className="m-0 text-[14px] leading-[1.55] text-[#687386]">
                              {t("herdr.mission.mergeConfirmText")}
                          </p>
                          <div className="mt-[18px] flex justify-end gap-2">
                              <button
                                  type="button"
                                  onClick={closeMergeConfirm}
                                  className="rounded-lg border border-[#dfe4eb] bg-white px-2.5 py-[7px] text-[12px] text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78a5ff]"
                              >
                                  {t("herdr.mission.cancel")}
                              </button>
                                  <button
                                      type="button"
                                      data-testid="merge-confirm-action"
                                      onClick={() => {
                                          confirmMerge();
                                          addToast(t("herdr.toast.mergeConfirmed"), "success");
                                      }}
                                      className={PRIMARY_BTN}
                                  >
                                      {t("herdr.mission.mergeConfirmAction")}
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
