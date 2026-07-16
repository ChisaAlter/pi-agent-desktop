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

import React, { useEffect, useRef, useState } from "react";
import { MINIMAX_CHROME_ICON_BUTTON_CLASSNAME } from "./chromeButton";
import { MiniMaxCodeTitleBar } from "./MiniMaxCodeTitleBar";

const DEFAULT_LEFT_WIDTH = 190;
const MIN_LEFT_WIDTH = 160;
const MAX_LEFT_WIDTH = 320;
const RIGHT_FLOATING_MOTION_MS = 180;

function clampLeftWidth(width: number): number {
    return Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, Math.round(width)));
}

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
    /** 左栏宽度 */
    leftWidth?: number;
    /** 右栏是否以工作区浮窗形式显示 */
    rightFloatingOpen?: boolean;
    /** 右侧浮层距顶部的安全边距 */
    rightFloatingTopOffset?: string;
    /** 右侧浮层距底部输入区的安全边距 */
    rightFloatingBottomOffset?: string;
    /** 是否渲染右侧浮层外层 chrome */
    rightFloatingChrome?: boolean;
    /** 折叠左栏回调 */
    onCollapseLeft?: () => void;
    /** 折叠右栏回调 */
    onCollapseRight?: () => void;
    /** 左栏拖拽宽度变更 */
    onLeftWidthChange?: (width: number) => void;
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

const FLOATING_TOGGLE_CLASSNAME = `absolute top-[calc((42px-1.75rem)/2)] z-[80] ${MINIMAX_CHROME_ICON_BUTTON_CLASSNAME}`;

const FloatingToggleButton: React.FC<{
    side: "left" | "right";
    collapsed: boolean;
    onClick?: () => void;
}> = ({ side, collapsed, onClick }) => {
    if (!onClick) return null;
    const sideClass = side === "left" ? "left-3" : "right-3";
    const label = side === "left"
        ? collapsed ? "展开左侧栏" : "折叠左侧栏"
        : collapsed ? "展开右侧栏" : "折叠右侧栏";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`${FLOATING_TOGGLE_CLASSNAME} ${sideClass}`}
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
    leftWidth = DEFAULT_LEFT_WIDTH,
    rightFloatingOpen = false,
    rightFloatingTopOffset = "12px",
    rightFloatingBottomOffset = "12px",
    rightFloatingChrome = true,
    onCollapseLeft,
    onCollapseRight,
    onLeftWidthChange,
    className = "",
}: MiniMaxCodeLayoutProps): React.JSX.Element {
    const [isMaximized, setIsMaximized] = useState(false);
    const [isResizingLeft, setIsResizingLeft] = useState(false);
    const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const resolvedLeftWidth = clampLeftWidth(leftWidth);
    const showRightFloating = Boolean(rightSlot && rightFloatingOpen && !rightCollapsed);
    const [renderRightFloating, setRenderRightFloating] = useState(showRightFloating);
    const [rightFloatingMotionState, setRightFloatingMotionState] = useState<"enter" | "exit">("exit");

    useEffect(() => {
        if (typeof window === "undefined" || !window.piAPI) return;
        void window.piAPI.windowIsMaximized?.().then(setIsMaximized).catch(() => undefined);
        const unsub = window.piAPI.onWindowMaximizeChanged?.((max) => setIsMaximized(max));
        return () => { if (typeof unsub === "function") unsub(); };
    }, []);

    useEffect(() => {
        const handleMove = (clientX: number): void => {
            const state = resizeStateRef.current;
            if (!state || !onLeftWidthChange) return;
            onLeftWidthChange(clampLeftWidth(state.startWidth + clientX - state.startX));
        };
        const handlePointerMove = (event: PointerEvent): void => {
            handleMove(event.clientX);
        };
        const handleMouseMove = (event: MouseEvent): void => {
            handleMove(event.clientX);
        };
        const handleEnd = (): void => {
            resizeStateRef.current = null;
            setIsResizingLeft(false);
        };
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("pointerup", handleEnd);
        window.addEventListener("mouseup", handleEnd);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("pointerup", handleEnd);
            window.removeEventListener("mouseup", handleEnd);
        };
    }, [onLeftWidthChange]);

    useEffect(() => {
        let frameId: number | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        if (showRightFloating) {
            setRenderRightFloating(true);
            setRightFloatingMotionState("exit");
            frameId = window.requestAnimationFrame(() => {
                setRightFloatingMotionState("enter");
            });
        } else {
            setRightFloatingMotionState("exit");
            timeoutId = setTimeout(() => {
                setRenderRightFloating(false);
            }, RIGHT_FLOATING_MOTION_MS);
        }

        return () => {
            if (frameId !== null) window.cancelAnimationFrame(frameId);
            if (timeoutId !== null) clearTimeout(timeoutId);
        };
    }, [showRightFloating]);

    const startLeftResize = (clientX: number): void => {
        if (!onLeftWidthChange) return;
        resizeStateRef.current = {
            startX: clientX,
            startWidth: resolvedLeftWidth,
        };
        setIsResizingLeft(true);
    };

    const handleLeftResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
        if (!onLeftWidthChange) return;
        event.preventDefault();
        startLeftResize(event.clientX);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handleLeftResizeMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
        if (!onLeftWidthChange) return;
        event.preventDefault();
        startLeftResize(event.clientX);
    };

    return (
        <div
            className={`flex h-screen w-screen overflow-hidden bg-transparent p-0 text-[var(--mm-text-primary)] ${className}`}
            data-mmcode-layout="root"
        >
            <div
                className={`flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--mm-border)] bg-[var(--mm-bg-main)] ${
                    isMaximized ? "rounded-none shadow-none" : "rounded-[var(--mm-window-radius)] shadow-[var(--mm-main-window-shadow)]"
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
                    leftWidth={resolvedLeftWidth}
                />

                <div
                    className="relative flex min-h-0 w-full flex-1"
                    data-mmcode-region="body"
                >
                    {leftCollapsed ? (
                        <FloatingToggleButton
                            side="left"
                            collapsed={leftCollapsed}
                            onClick={onCollapseLeft}
                        />
                    ) : null}
                    <FloatingToggleButton
                        side="right"
                        collapsed={rightCollapsed}
                        onClick={onCollapseRight}
                    />

                    {/* 左侧栏 */}
                    <aside
                        className={`pi-motion-rail flex shrink-0 flex-col overflow-hidden border-r border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] ${isResizingLeft ? "" : "animate-layout"}`}
                        style={{ width: leftCollapsed ? 0 : resolvedLeftWidth, opacity: leftCollapsed ? 0 : 1 }}
                        data-mmcode-region="left"
                        data-collapsed={leftCollapsed ? "true" : "false"}
                        data-resizing={isResizingLeft ? "true" : "false"}
                        aria-hidden={leftCollapsed}
                        aria-label="primary navigation"
                    >
                        <div className="pi-motion-rail-content min-h-0 min-w-0 flex-1 overflow-y-auto" style={{ minWidth: leftCollapsed ? 0 : undefined }}>
                            {leftSlot}
                        </div>
                    </aside>
                    {!leftCollapsed && onLeftWidthChange ? (
                        <div
                            role="separator"
                            aria-label="调整左侧栏宽度"
                            aria-orientation="vertical"
                            tabIndex={0}
                            onPointerDown={handleLeftResizePointerDown}
                            onMouseDown={handleLeftResizeMouseDown}
                            className="absolute bottom-0 top-0 z-50 w-2 cursor-col-resize"
                            style={{ left: resolvedLeftWidth - 3 }}
                        >
                            <span className="mx-auto block h-full w-px bg-transparent transition-colors hover:bg-[var(--mm-border-strong)]" aria-hidden />
                        </div>
                    ) : null}

                    <main
                        className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--mm-bg-main)] ${leftCollapsed ? "pl-10" : ""}`}
                        data-mmcode-region="center"
                        aria-label="main content"
                    >
                        {centerSlot}
                        <div
                            id="pi-global-composer-root"
                            className="pointer-events-auto relative z-30 w-full shrink-0"
                            aria-live="polite"
                        />
                    </main>

                    {renderRightFloating ? (
                        <aside
                            className={`pi-motion-floating-rail absolute right-3 z-[60] flex w-[var(--mm-width-sidebar-right)] flex-col ${
                                rightFloatingChrome
                                    ? "overflow-hidden rounded-[8px] border border-[var(--mm-border)] bg-[var(--mm-bg-main)] shadow-[0_18px_48px_rgba(15,23,42,0.13)]"
                                    : "pointer-events-none overflow-visible"
                            }`}
                            style={{ top: rightFloatingTopOffset, bottom: rightFloatingBottomOffset }}
                            data-mmcode-region="right-floating"
                            data-motion-state={rightFloatingMotionState}
                            aria-hidden={rightFloatingMotionState === "exit"}
                            aria-label="context panel"
                        >
                            <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${rightFloatingChrome ? "" : "pointer-events-auto"}`}>
                                {rightSlot}
                            </div>
                        </aside>
                    ) : null}

                </div>
            </div>
        </div>
    );
}
