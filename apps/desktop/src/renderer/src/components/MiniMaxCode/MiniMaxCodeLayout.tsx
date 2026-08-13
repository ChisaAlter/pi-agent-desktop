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
// v2.1: 左收起按钮浮在中间工作区左上角(不占整高槽位);折叠后侧栏不占位(无 border/灰色竖条)

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
    /** 标题栏与 body 之间的状态条 slot（HerdrStatusBar 等全宽条） */
    statusBarSlot?: React.ReactNode;
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
    statusBarSlot,
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
    const leftWidthRef = useRef(clampLeftWidth(leftWidth));
    const leftAsideRef = useRef<HTMLElement | null>(null);
    const leftResizeFrameRef = useRef<number | null>(null);
    const pendingLeftWidthRef = useRef<number | null>(null);
    const resolvedLeftWidth = clampLeftWidth(leftWidth);
    leftWidthRef.current = resolvedLeftWidth;
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
        const applyDomWidth = (width: number): number => {
            const next = clampLeftWidth(width);
            leftWidthRef.current = next;
            if (leftAsideRef.current) {
                leftAsideRef.current.style.width = `${next}px`;
                leftAsideRef.current.style.opacity = "1";
            }
            const titlebarLeft = document.querySelector<HTMLElement>('[data-mmcode-region="titlebar-left"]');
            if (titlebarLeft) {
                titlebarLeft.style.width = `${next}px`;
            }
            const separator = document.querySelector<HTMLElement>('[data-mmcode-region="left-resize-handle"]');
            if (separator) {
                separator.style.left = `${next - 3}px`;
            }
            return next;
        };
        const flushPending = (): void => {
            leftResizeFrameRef.current = null;
            const pending = pendingLeftWidthRef.current;
            if (pending === null) return;
            pendingLeftWidthRef.current = null;
            applyDomWidth(pending);
        };
        const handlePointerMove = (event: PointerEvent): void => {
            const state = resizeStateRef.current;
            if (!state) return;
            pendingLeftWidthRef.current = clampLeftWidth(state.startWidth + event.clientX - state.startX);
            if (leftResizeFrameRef.current !== null) return;
            if (typeof window.requestAnimationFrame !== "function") {
                flushPending();
                return;
            }
            leftResizeFrameRef.current = window.requestAnimationFrame(flushPending);
        };
        const handleEnd = (): void => {
            if (!resizeStateRef.current) {
                setIsResizingLeft(false);
                return;
            }
            if (leftResizeFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
                window.cancelAnimationFrame(leftResizeFrameRef.current);
                leftResizeFrameRef.current = null;
            }
            if (pendingLeftWidthRef.current !== null) {
                applyDomWidth(pendingLeftWidthRef.current);
                pendingLeftWidthRef.current = null;
            }
            const finalWidth = leftWidthRef.current;
            resizeStateRef.current = null;
            setIsResizingLeft(false);
            // Commit React + localStorage once on pointerup only.
            onLeftWidthChange?.(finalWidth);
        };
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handleEnd);
        window.addEventListener("pointercancel", handleEnd);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handleEnd);
            window.removeEventListener("pointercancel", handleEnd);
            if (leftResizeFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
                window.cancelAnimationFrame(leftResizeFrameRef.current);
            }
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
            startWidth: leftWidthRef.current,
        };
        setIsResizingLeft(true);
    };

    const handleLeftResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
        if (!onLeftWidthChange) return;
        event.preventDefault();
        startLeftResize(event.clientX);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handleLeftResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (!onLeftWidthChange) return;
        const step = event.shiftKey ? 24 : 10;
        let nextWidth: number | null = null;
        if (event.key === "ArrowLeft") nextWidth = resolvedLeftWidth - step;
        if (event.key === "ArrowRight") nextWidth = resolvedLeftWidth + step;
        if (event.key === "Home") nextWidth = MIN_LEFT_WIDTH;
        if (event.key === "End") nextWidth = MAX_LEFT_WIDTH;
        if (nextWidth === null) return;
        event.preventDefault();
        onLeftWidthChange(clampLeftWidth(nextWidth));
    };

    return (
        <div
            className={`flex h-screen w-screen overflow-hidden bg-transparent p-0 text-[var(--mm-text-primary)] ${className}`}
            data-mmcode-layout="root"
        >
            {/*
              Titlebar must NOT sit inside an overflow-hidden / transform stacking
              context. Chromium's -webkit-app-region:drag hit-testing on Windows
              often drops the first press when the drag surface is clipped by a
              rounded overflow parent — making window move feel "dead" on first click.
            */}
            <div
                className={`flex min-h-0 flex-1 flex-col border border-[var(--mm-border)] bg-[var(--mm-bg-main)] ${
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

                {statusBarSlot}

                <div
                    className={`relative flex min-h-0 w-full flex-1 overflow-hidden ${
                        isMaximized ? "" : "rounded-b-[var(--mm-window-radius)]"
                    }`}
                    data-mmcode-region="body"
                >
                    <FloatingToggleButton
                        side="right"
                        collapsed={rightCollapsed}
                        onClick={onCollapseRight}
                    />

                    {/* 左侧栏 */}
                    <aside
                        ref={leftAsideRef}
                        className={`pi-motion-rail flex shrink-0 flex-col overflow-hidden bg-[var(--mm-bg-sidebar)] ${isResizingLeft ? "" : "animate-layout"} ${
                            leftCollapsed ? "border-r-0" : "border-r border-[var(--mm-border)]"
                        }`}
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
                            aria-valuemin={MIN_LEFT_WIDTH}
                            aria-valuemax={MAX_LEFT_WIDTH}
                            aria-valuenow={resolvedLeftWidth}
                            tabIndex={0}
                            onPointerDown={handleLeftResizePointerDown}
                            onKeyDown={handleLeftResizeKeyDown}
                            className="absolute bottom-0 top-0 z-50 w-2 touch-none cursor-col-resize"
                            style={{ left: resolvedLeftWidth - 3 }}
                            data-mmcode-region="left-resize-handle"
                        >
                            <span className="mx-auto block h-full w-px bg-transparent transition-colors hover:bg-[var(--mm-border-strong)]" aria-hidden />
                        </div>
                    ) : null}

                    <main
                        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--mm-bg-main)]"
                        data-mmcode-region="center"
                        aria-label="main content"
                    >
                        {/* 左收起按钮浮在中间工作区左上角:不占整高槽位,由各面板顶栏自行让出间距 */}
                        {onCollapseLeft ? (
                            <FloatingToggleButton
                                side="left"
                                collapsed={leftCollapsed}
                                onClick={onCollapseLeft}
                            />
                        ) : null}
                        {centerSlot}
                        <div
                            id="pi-global-composer-root"
                            className="pointer-events-auto relative z-30 w-full shrink-0 bg-[var(--mm-bg-input)] isolate"
                            aria-live="polite"
                        />
                    </main>

                    {renderRightFloating ? (
                        <aside
                            className={`pi-motion-floating-rail absolute right-3 z-[60] flex flex-col ${
                                rightFloatingChrome
                                    ? "w-[var(--mm-width-sidebar-right)] overflow-hidden rounded-[8px] border border-[var(--mm-border)] bg-[var(--mm-bg-main)] shadow-[0_18px_48px_rgba(15,23,42,0.13)]"
                                    : "pointer-events-none w-[300px] overflow-visible"
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
