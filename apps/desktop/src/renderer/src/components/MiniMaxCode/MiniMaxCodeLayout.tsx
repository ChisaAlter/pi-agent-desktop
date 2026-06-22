// MiniMaxCodeLayout (M1 - 前置)
// MiniMax Code 风格三栏布局壳子 (1:1 还原目标 UI):
//   ┌──────────────────── window title bar (32px) ────────────────────┐
//   │ ┌──────────┐ ┌────────────────────────────┐ ┌──────────┐         │
//   │ │ leftSlot │ │       centerSlot            │ │ rightSlot│         │
//   │ │ 220px    │ │       flex-1                │ │ 280px    │         │
//   │ │ #f7f7f7  │ │       #ffffff               │ │ #ffffff  │         │
//   │ └──────────┘ └────────────────────────────┘ └──────────┘         │
//   └──────────────────────────────────────────────────────────────────┘
// 颜色/尺寸全部走 --mm-* token,本组件不硬编码。
// 不持有任何业务状态:全部由父级传入,layout 只负责排版与占位。
// v2.0: 支持左右栏折叠 + CSS 动画过渡

import React, { useEffect, useState } from "react";
import { MiniMaxCodeTitleBar } from "./MiniMaxCodeTitleBar";

export interface MiniMaxCodeLayoutProps {
    /** 顶部标题 */
    title?: string;
    /** 顶部中间摘要 */
    subtitle?: string;
    /** 顶部状态文案 */
    statusLabel?: string;
    /** 顶部状态色 */
    statusTone?: "idle" | "ready" | "busy" | "error";
    /** 左侧栏(任务/技能/历史导航) */
    leftSlot: React.ReactNode;
    /** 主区(对话/内容) */
    centerSlot: React.ReactNode;
    /** 右侧栏(上下文/详情) */
    rightSlot: React.ReactNode;
    /** 左栏是否折叠 */
    leftCollapsed?: boolean;
    /** 右栏是否折叠 */
    rightCollapsed?: boolean;
    /** 折叠左栏回调 */
    onCollapseLeft?: () => void;
    /** 折叠右栏回调 */
    onCollapseRight?: () => void;
    /** 标题栏下方的 tab 栏 slot */
    topBarSlot?: React.ReactNode;
    /** 整体容器的额外 className */
    className?: string;
}

const SidebarToggleIcon: React.FC<{ side: "left" | "right"; collapsed: boolean }> = ({ side, collapsed }) => (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        {side === "left" ? <line x1="6" y1="3" x2="6" y2="13" /> : <line x1="10" y1="3" x2="10" y2="13" />}
        {collapsed && side === "left" && <path d="M8.5 6 10.5 8 8.5 10" strokeLinecap="round" strokeLinejoin="round" />}
        {collapsed && side === "right" && <path d="M7.5 6 5.5 8 7.5 10" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
);

const FloatingToggleButton: React.FC<{
    side: "left" | "right";
    collapsed: boolean;
    onClick?: () => void;
}> = ({ side, collapsed, onClick }) => {
    if (!onClick) return null;
    const sideClass = side === "left" ? "left-2" : "right-2";
    const label = side === "left"
        ? collapsed ? "展开左侧栏" : "折叠左侧栏"
        : collapsed ? "展开右侧栏" : "折叠右侧栏";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`absolute top-4 z-50 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-main)] text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${sideClass}`}
        >
            <SidebarToggleIcon side={side} collapsed={collapsed} />
        </button>
    );
};

export function MiniMaxCodeLayout({
    title = "Pi Agent",
    subtitle,
    statusLabel,
    statusTone,
    leftSlot,
    centerSlot,
    rightSlot,
    topBarSlot,
    leftCollapsed = false,
    rightCollapsed = false,
    onCollapseLeft,
    onCollapseRight,
    className = "",
}: MiniMaxCodeLayoutProps): React.JSX.Element {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined" || !window.piAPI) return;
        void window.piAPI.windowIsMaximized?.().then(setIsMaximized).catch(() => undefined);
        const unsub = window.piAPI.onWindowMaximizeChanged?.((max) => setIsMaximized(max));
        return () => { if (typeof unsub === "function") unsub(); };
    }, []);

    return (
        <div
            className={`flex h-screen w-screen overflow-hidden bg-transparent text-[var(--mm-text-primary)] p-0 ${className}`}
            data-mmcode-layout="root"
        >
            <div
                className={`flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--mm-border)] bg-[var(--mm-bg-main)] ${
                    isMaximized ? "rounded-none shadow-none" : "rounded-[var(--mm-window-radius)] shadow-[var(--mm-window-shadow)]"
                }`}
                data-mmcode-layout="window-frame"
                data-mm-window-kind="main"
            >
                <MiniMaxCodeTitleBar
                    title={title}
                    subtitle={subtitle}
                    statusLabel={statusLabel}
                    statusTone={statusTone}
                    navigationSlot={topBarSlot}
                />

                <div
                    className="relative flex min-h-0 w-full flex-1 data-[has-global-composer=true]:pb-[var(--pi-global-composer-height,103px)]"
                    data-mmcode-region="body"
                >
                    <FloatingToggleButton
                        side="left"
                        collapsed={leftCollapsed}
                        onClick={onCollapseLeft}
                    />
                    <FloatingToggleButton
                        side="right"
                        collapsed={rightCollapsed}
                        onClick={onCollapseRight}
                    />

                    {/* 左侧栏 */}
                    <aside
                        className="flex shrink-0 flex-col border-r border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] animate-layout overflow-hidden"
                        style={{ width: leftCollapsed ? 0 : "var(--mm-width-sidebar-left)", opacity: leftCollapsed ? 0 : 1 }}
                        data-mmcode-region="left"
                        aria-label="primary navigation"
                    >
                        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${leftCollapsed ? "" : "pl-10"}`} style={{ minWidth: leftCollapsed ? 0 : undefined }}>
                            {leftSlot}
                        </div>
                    </aside>

                    <main
                        className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--mm-bg-main)] ${leftCollapsed ? "pl-10" : ""} ${rightCollapsed ? "pr-10" : ""}`}
                        data-mmcode-region="center"
                        aria-label="main content"
                    >
                        {centerSlot}
                    </main>

                    {/* 右侧栏 */}
                    <aside
                        className="flex shrink-0 flex-col bg-[var(--mm-bg-main)] animate-layout overflow-hidden"
                        style={{ width: rightCollapsed ? 0 : "var(--mm-width-sidebar-right)", opacity: rightCollapsed ? 0 : 1 }}
                        data-mmcode-region="right"
                        aria-label="context panel"
                    >
                        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${rightCollapsed ? "" : "pr-10"}`} style={{ minWidth: rightCollapsed ? 0 : undefined }}>
                            {rightSlot}
                        </div>
                    </aside>

                    <div
                        id="pi-global-composer-root"
                        className="pointer-events-auto absolute inset-x-0 bottom-0 z-40"
                        aria-live="polite"
                    />
                </div>
            </div>
        </div>
    );
}
