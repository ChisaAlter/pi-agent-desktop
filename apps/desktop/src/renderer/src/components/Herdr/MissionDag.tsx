import React from "react";
import { useI18n } from "../../i18n";
import type { HerdrMissionDagNode, HerdrMissionNodeStatus } from "../../stores/herdr-store";

/**
 * MissionDag — 任务 DAG 图（原型 renderDag 同款布局与配色）。
 * 布局: 节点 01 → [02, 03 竖排] → 04，→ 依赖箭头连接。
 * 节点状态色条: ready 琥珀 / running 蓝 / passed 绿 / rejected 红。
 * 纯展示组件: 节点数据由调用方经 store 的 missionDag() 派生后传入。
 */

const STATUS_BAR: Record<HerdrMissionNodeStatus, string> = {
    ready: "bg-[#b56a0b]",
    running: "bg-[var(--mm-accent-blue)]",
    passed: "bg-[var(--color-success)]",
    rejected: "bg-[var(--color-error)]",
};

const STATUS_KEY: Record<HerdrMissionNodeStatus, string> = {
    ready: "herdr.mission.nodeReady",
    running: "herdr.mission.nodeRunning",
    passed: "herdr.mission.nodePassed",
    rejected: "herdr.mission.nodeRejected",
};

function DagNode({ node }: { node: HerdrMissionDagNode }): React.JSX.Element {
    const { t } = useI18n();
    return (
        <div
            className="relative w-[170px] rounded-[10px] border border-[var(--mm-border)] bg-white p-2.5 shadow-[0_4px_12px_rgba(28,41,70,0.05)]"
            data-testid="dag-node"
            data-status={node.status}
        >
            <span className={`absolute bottom-2 left-[-1px] top-2 w-[3px] rounded-[3px] ${STATUS_BAR[node.status]}`} aria-hidden="true" />
            <div className="mb-1 text-[13px] font-bold text-[var(--mm-text-primary)]">
                {node.id} · {node.name}
            </div>
            <div className="text-[10px] leading-[1.5] text-[var(--mm-text-secondary)]">
                {node.agent} · {node.pane}
                <br />
                {t(STATUS_KEY[node.status])} · {t("herdr.mission.round", { n: node.attempt })}
            </div>
        </div>
    );
}

export function MissionDag({ nodes }: { nodes: HerdrMissionDagNode[] }): React.JSX.Element {
    const first = nodes[0];
    const second = nodes[1];
    const third = nodes[2];
    const fourth = nodes[3];
    const arrow = (
        <span className="text-2xl text-[#a1adbd]" aria-hidden="true">
            →
        </span>
    );
    return (
        <div className="flex min-h-[200px] min-w-[780px] items-center justify-center gap-[22px]" data-testid="mission-dag-canvas">
            {first ? <DagNode node={first} /> : null}
            {second || third ? arrow : null}
            {second || third ? (
                <div className="flex flex-col gap-[14px]">
                    {second ? <DagNode node={second} /> : null}
                    {third ? <DagNode node={third} /> : null}
                </div>
            ) : null}
            {fourth ? arrow : null}
            {fourth ? <DagNode node={fourth} /> : null}
        </div>
    );
}
