// MiniMaxCodeLayout (M1 - 前置)
// MiniMax Code 风格三栏布局壳子 (1:1 还原目标 UI):
//   ┌──────────────────── window title bar (32px) ────────────────────┐
//   │ ┌──────────┐ ┌────────────────────────────┐ ┌──────────┐         │
//   │ │ leftSlot │ │       centerSlot            │ │ rightSlot│         │
//   │ │ 220px    │ │       flex-1                │ │ 280px    │         │
//   │ │ #fff     │ │       #fafafa               │ │ #fff     │         │
//   │ └──────────┘ └────────────────────────────┘ └──────────┘         │
//   └──────────────────────────────────────────────────────────────────┘
// 颜色/尺寸全部走 --mm-* token,本组件不硬编码。
// 不持有任何业务状态:全部由父级传入,layout 只负责排版与占位。

import React from "react";
import { MiniMaxCodeTitleBar } from "./MiniMaxCodeTitleBar";

export interface MiniMaxCodeLayoutProps {
    /** 左侧栏(任务/技能/历史导航) */
    leftSlot: React.ReactNode;
    /** 主区(对话/内容) */
    centerSlot: React.ReactNode;
    /** 右侧栏(上下文/详情) */
    rightSlot: React.ReactNode;
    /** 折叠左栏回调(本期不实现,留 hook 供后续) */
    onCollapseLeft?: () => void;
    /** 折叠右栏回调(本期不实现,留 hook 供后续) */
    onCollapseRight?: () => void;
    /** 整体容器的额外 className(用于外部覆盖) */
    className?: string;
}

/**
 * MiniMax Code 风格三栏布局壳子
 *
 * 设计约束(来自 globals.css --mm-* token):
 *  - 高度 100vh,无外边距
 *  - 左 220px / 中 flex-1 / 右 280px,左右白底,主区 #fafafa
 *  - 不用 border 硬分割,靠背景色差分层
 *  - 窗口标题栏 32px 占位(`window-title` div,后续接原生 title bar)
 *  - 三个主区域 min-w-0,防止子节点撑爆父容器
 *  - 语义化标签:左 <aside>/中 <main>/右 <aside>,配合 aria-label 便于无障碍
 */
export function MiniMaxCodeLayout({
    leftSlot,
    centerSlot,
    rightSlot,
    onCollapseLeft: _onCollapseLeft,
    onCollapseRight: _onCollapseRight,
    className = "",
}: MiniMaxCodeLayoutProps): React.JSX.Element {
    return (
        <div
            className={`flex h-screen w-screen flex-col overflow-hidden bg-[var(--mm-bg-main)] text-[var(--mm-text-primary)] ${className}`}
            data-mmcode-layout="root"
        >
            {/* 顶部 32px 标题栏(跨平台:macOS 保留 traffic lights,Windows/Linux 自带 min/max/close) */}
            <MiniMaxCodeTitleBar title="MiniMax Code" />

            {/* 三栏主体:左 aside + 中 main + 右 aside */}
            <div className="flex min-h-0 flex-1 w-full">
                <aside
                    className="flex shrink-0 flex-col bg-[var(--mm-bg-sidebar)]"
                    style={{ width: "var(--mm-width-sidebar-left)" }}
                    data-mmcode-region="left"
                    aria-label="primary navigation"
                >
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                        {leftSlot}
                    </div>
                </aside>

                <main
                    className="min-w-0 min-h-0 flex-1 overflow-y-auto bg-[var(--mm-bg-main)]"
                    data-mmcode-region="center"
                    aria-label="main content"
                >
                    {centerSlot}
                </main>

                <aside
                    className="flex shrink-0 flex-col bg-[var(--mm-bg-main)]"
                    style={{ width: "var(--mm-width-sidebar-right)" }}
                    data-mmcode-region="right"
                    aria-label="context panel"
                >
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                        {rightSlot}
                    </div>
                </aside>
            </div>
        </div>
    );
}
