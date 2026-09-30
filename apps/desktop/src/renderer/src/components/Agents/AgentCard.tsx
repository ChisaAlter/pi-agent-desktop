import React from "react";
import { useI18n } from "../../i18n";
import { useHerdrStore, type HerdrAgent, type HerdrDisplayState, displayStateOf } from "../../stores/herdr-store";
import { useToastStore } from "../../stores/toast-store";
import { AgentStatusBadge } from "./AgentStatusBadge";

/**
 * Herdr 舰队卡片（UI-REQ-020/022/023/024）— 与已批准原型 1:1：
 *   - 无彩色侧边框（NL-003）；选中用统一蓝色描边（outline #77a3f7）
 *   - 单状态主 CTA：阻塞→处理阻塞 / 待查看→标记已查看 / 其他→打开终端
 *   - 最近输出 + 更多 ⋯（读取 agent.read 历史；与 live 终端分离）
 *   - 断线（disconnected）整卡 opacity 0.67
 */

interface AgentCardProps {
    agent: HerdrAgent;
    selected: boolean;
    onSelect: () => void;
}

export function AgentCard({ agent, selected, onSelect }: AgentCardProps): React.JSX.Element {
    const { t } = useI18n();
    const addToast = useToastStore((s) => s.addToast);
    const server = useHerdrStore((s) => s.server);
    const selectAgent = useHerdrStore((s) => s.selectAgent);
    const setView = useHerdrStore((s) => s.setView);
    const markSeen = useHerdrStore((s) => s.markSeen);
    const openPaneForBlocked = useHerdrStore((s) => s.openPaneForBlocked);
    const readRecentOutput = useHerdrStore((s) => s.readRecentOutput);
    const mock = useHerdrStore((s) => s.mock);

    const displayState: HerdrDisplayState = displayStateOf(agent, server);

    const handlePrimary = (): void => {
        selectAgent(agent.name);
        if (displayState === "blocked") {
            openPaneForBlocked();
        } else if (displayState === "done") {
            markSeen(agent.name);
            addToast({ message: t("herdr.toast.markSeen", { name: agent.displayName }), tone: "success" });
        } else {
            setView("pane");
        }
    };

    const handleRecentOutput = (): void => {
        selectAgent(agent.name);
        if (!mock) void readRecentOutput(agent.name);
        addToast({ message: t("herdr.toast.recentOutput"), tone: "info" });
    };

    const handleMore = (): void => {
        selectAgent(agent.name);
        if (!mock) void readRecentOutput(agent.name);
        addToast({ message: t("herdr.toast.more", { pane: agent.pane, action: "read" }), tone: "info" });
    };

    const primaryLabel =
        displayState === "blocked"
            ? t("herdr.card.handleBlocked")
            : displayState === "done"
              ? t("herdr.card.markSeen")
              : t("herdr.card.openTerminal");

    return (
        <article
            className={`overflow-hidden rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-[0_2px_8px_rgba(24,33,58,0.03)] ${
                displayState === "disconnected" ? "opacity-[0.67]" : ""
            } ${selected ? "outline-2 outline-offset-1 outline-[#77a3f7]" : ""}`}
            data-agent={agent.name}
            data-state={displayState}
            data-selected={selected ? "true" : "false"}
            data-testid="agent-card"
            onClick={onSelect}
        >
            <div className="flex items-start gap-[9px] px-3 pb-2 pt-3">
                <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-[#edf2ff] text-[15px] font-bold text-[#365bbb]" aria-hidden="true">
                    {agent.kind[0]}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{agent.displayName}</div>
                    <div className="mt-[3px] truncate text-[11px] text-[var(--mm-text-tertiary)]">
                        {agent.kind} · {t("herdr.card.pane", { pane: agent.pane })} · {agent.workspace}
                    </div>
                </div>
                <span className="ml-auto shrink-0">
                    <AgentStatusBadge status={displayState} />
                </span>
            </div>
            <div className="mx-3 mb-[9px] rounded-[7px] bg-[#f6f8fb] px-2 py-2 text-[12px] leading-[1.45] text-[var(--mm-text-primary)]">{agent.task}</div>
            <div className="flex gap-2 px-3 py-[3px] text-[11px] text-[var(--mm-text-tertiary)]">
                <span>{t("herdr.card.session")}</span>
                <b className="font-medium text-[#465166]">{agent.session}</b>
            </div>
            <div className="flex gap-2 px-3 py-[3px] text-[11px] text-[var(--mm-text-tertiary)]">
                <span>{t("herdr.card.worktree")}</span>
                <b className="font-medium text-[#465166]">{agent.worktree}</b>
            </div>
            <div className="flex gap-2 px-3 py-[3px] text-[11px] text-[var(--mm-text-tertiary)]">
                <span>{t("herdr.card.authority")}</span>
                <b className="truncate font-medium text-[#465166]">{agent.authority}</b>
            </div>
            <div className="mt-[9px] flex flex-wrap gap-1 border-t border-[#edf0f4] px-[9px] py-2" data-testid="card-actions">
                <button
                    type="button"
                    data-testid="card-primary-action"
                    className={`rounded-lg px-2.5 py-[5px] text-[11px] transition-colors ${
                        displayState === "blocked" || displayState === "done"
                            ? "border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#174fc6]"
                            : "border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                    }`}
                    onClick={(e) => {
                        e.stopPropagation();
                        handlePrimary();
                    }}
                >
                    {primaryLabel}
                </button>
                <button
                    type="button"
                    className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-[5px] text-[11px] text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)]"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleRecentOutput();
                    }}
                >
                    {t("herdr.card.recentOutput")}
                </button>
                <button
                    type="button"
                    className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-[5px] text-[11px] text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)]"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleMore();
                    }}
                >
                    {t("herdr.card.more")}
                </button>
            </div>
        </article>
    );
}
