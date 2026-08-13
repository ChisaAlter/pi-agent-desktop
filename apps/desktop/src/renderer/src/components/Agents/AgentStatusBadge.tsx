import React from "react";
import { useI18n } from "../../i18n";
import type { HerdrDisplayState } from "../../stores/herdr-store";

/**
 * Herdr 状态徽章 — 原型 6 态（UI-REQ-021）：
 * 工作中 / 已阻塞 / 已完成·待查看 / 空闲 / 状态未知 / 连接已断开。
 * 配色与原型 statusClass 一致：done=琥珀 warn、blocked/disconnected=红 bad、
 * working=蓝、idle=绿、unknown=灰。
 */

const STATUS_LABEL_KEYS: Record<HerdrDisplayState, string> = {
    working: "herdr.status.working",
    blocked: "herdr.status.blocked",
    done: "herdr.status.done",
    idle: "herdr.status.idle",
    unknown: "herdr.status.unknown",
    disconnected: "herdr.status.disconnected",
};

const STATUS_PILL_CLASS: Record<HerdrDisplayState, string> = {
    working: "bg-[#eaf1ff] text-[#2458bd]",
    blocked: "bg-[#fde9eb] text-[#a4313e]",
    done: "bg-[#fff0d9] text-[#96600f]",
    idle: "bg-[#e5f5ed] text-[#14734f]",
    unknown: "bg-[#edf1f6] text-[#516074]",
    disconnected: "bg-[#fde9eb] text-[#a4313e]",
};

export function AgentStatusBadge({ status }: { status: HerdrDisplayState }): React.JSX.Element {
    const { t } = useI18n();

    let dot: React.ReactNode = null;
    if (status === "working") {
        dot = <span className="pi-motion-running-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />;
    } else if (status === "blocked" || status === "disconnected") {
        dot = (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-current text-[9px] font-bold leading-none text-white" aria-hidden="true">
                !
            </span>
        );
    } else if (status === "done") {
        dot = (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.5 8.5 6.5 11.5 12.5 4.5" />
            </svg>
        );
    } else {
        dot = <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />;
    }

    return (
        <span
            className={`inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 ${STATUS_PILL_CLASS[status]}`}
            role="status"
            data-agent-status={status}
        >
            {dot}
            <span className="whitespace-nowrap">{t(STATUS_LABEL_KEYS[status])}</span>
        </span>
    );
}
