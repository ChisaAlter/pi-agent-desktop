// MiniMaxCodeTitleBar — 32px 顶部标题栏(1:1 还原 MiniMax Code 风格)
//
// 设计目标:
//  - 完全接管窗口拖拽 + min/max/close(配合 main 端 frame:false / titleBarStyle:hiddenInset)
//  - 跨平台:
//      macOS (darwin)    → 左侧 80px 留白给 traffic lights,中间 drag region,无按钮
//      Windows / Linux   → 全宽 drag region,右侧 min / max / close 3 个按钮
//  - 颜色/尺寸走 --mm-* token
//  - 不持有任何业务状态,所有操作直接转发到 window.piAPI.window*
//  - 状态:
//      isMaximized (boolean) 通过 onWindowMaximizeChanged 订阅,
//      用于切换 maximize / unmaximize 按钮的 icon
//
// a11y:
//  - drag region 容器加 role="banner" + aria-label
//  - 3 个按钮加 aria-label;按下/悬停颜色对比 4.5:1
//  - 按钮不能响应拖拽(WebkitAppRegion: no-drag)

import React, { useEffect, useState } from "react";

const TITLE_BAR_HEIGHT = 32;
// macOS 上 traffic lights 大约占左侧 80px,renderer 让出这块空间避免点击冲突
const MAC_TRAFFIC_LIGHT_RESERVE = 80;

export interface MiniMaxCodeTitleBarProps {
    /** 可选: 居中显示的标题(Mac 不显示) */
    title?: string;
    className?: string;
}

// ----------------------------------------------------------------------
// 按钮 SVG icons
// ----------------------------------------------------------------------

const MinimizeIcon: React.FC = () => (
    <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth={1}
        aria-hidden="true"
    >
        <line x1="2" y1="6" x2="10" y2="6" />
    </svg>
);

const MaximizeIcon: React.FC = () => (
    <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth={1}
        aria-hidden="true"
    >
        <rect x="2.5" y="2.5" width="7" height="7" />
    </svg>
);

const UnmaximizeIcon: React.FC = () => (
    <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth={1}
        aria-hidden="true"
    >
        <rect x="3.5" y="3.5" width="5" height="5" />
        <path d="M5.5 3.5 V2 H10 V6.5 H8.5" />
    </svg>
);

const CloseIcon: React.FC = () => (
    <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth={1}
        aria-hidden="true"
    >
        <line x1="2" y1="2" x2="10" y2="10" />
        <line x1="10" y1="2" x2="2" y2="10" />
    </svg>
);

const TitleBarButton: React.FC<{
    onClick: () => void;
    ariaLabel: string;
    children: React.ReactNode;
    className?: string;
}> = ({ onClick, ariaLabel, children, className = "" }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        // 让按钮本身不参与拖拽
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={`flex h-8 w-12 items-center justify-center text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:bg-[var(--mm-bg-hover)] ${className}`}
    >
        {children}
    </button>
);

/**
 * MiniMax Code 风格 32px 顶部标题栏
 *
 * 用法:
 * ```tsx
 * <div className="flex h-screen flex-col">
 *   <MiniMaxCodeTitleBar />
 *   <div className="flex-1">...</div>
 * </div>
 * ```
 */
export function MiniMaxCodeTitleBar({
    title,
    className = "",
}: MiniMaxCodeTitleBarProps): React.JSX.Element {
    const [isMaximized, setIsMaximized] = useState(false);
    // SSR-safe 平台检测:用 typeof window 守卫,nodeAPI 仅在 renderer 进程存在
    const [platform, setPlatform] = useState<NodeJS.Platform | "browser">(
        "browser",
    );

    useEffect(() => {
        if (typeof window === "undefined" || !window.nodeAPI) return;
        setPlatform(window.nodeAPI.platform);
        // 初始状态
        void window.piAPI?.windowIsMaximized().then(setIsMaximized);
        const unsub = window.piAPI?.onWindowMaximizeChanged((max) =>
            setIsMaximized(max),
        );
        return () => {
            if (typeof unsub === "function") unsub();
        };
    }, []);

    const isMac = platform === "darwin";
    const leftPad = isMac ? MAC_TRAFFIC_LIGHT_RESERVE : 10;

    return (
        <div
            // drag region:整个标题栏可拖动
            style={
                {
                    WebkitAppRegion: "drag",
                    height: TITLE_BAR_HEIGHT,
                } as React.CSSProperties
            }
            className={`flex w-full shrink-0 items-center border-b border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] select-none ${className}`}
            data-mmcode-region="titlebar"
            role="banner"
            aria-label="window title bar"
        >
            {/* 左侧留白(macOS 让出 traffic lights 区域) */}
            <div
                style={{ width: isMac ? leftPad : "var(--mm-width-sidebar-left)", flexShrink: 0 }}
                className="flex h-full items-center gap-2 px-2"
                data-mmcode-region="titlebar-left"
            >
                {!isMac && (
                    <>
                        <div
                            className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-[var(--mm-bg-active)] text-[9px] font-bold leading-none text-[var(--mm-text-on-active)]"
                            aria-hidden="true"
                        >
                            π
                        </div>
                        <span className="truncate text-[12px] text-[var(--mm-text-primary)]">
                            {title}
                        </span>
                    </>
                )}
            </div>

            {/* 中间 drag region(可放 title 文案) */}
            <div
                className="flex flex-1 items-center justify-center min-w-0"
                data-mmcode-region="titlebar-center"
            >
            </div>

            {/* 右侧:Windows/Linux 显示 3 个按钮;macOS 不显示(系统已有 traffic lights) */}
            <div
                className="flex h-full items-center"
                style={
                    isMac
                        ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
                        : undefined
                }
                data-mmcode-region="titlebar-right"
            >
                {!isMac && (
                    <>
                        <TitleBarButton
                            ariaLabel="最小化窗口"
                            onClick={() => {
                                void window.piAPI?.windowMinimize();
                            }}
                        >
                            <MinimizeIcon />
                        </TitleBarButton>
                        <TitleBarButton
                            ariaLabel={isMaximized ? "取消最大化" : "最大化"}
                            onClick={() => {
                                void window.piAPI?.windowToggleMaximize();
                            }}
                        >
                            {isMaximized ? <UnmaximizeIcon /> : <MaximizeIcon />}
                        </TitleBarButton>
                        <TitleBarButton
                            ariaLabel="关闭窗口"
                            onClick={() => {
                                void window.piAPI?.windowClose();
                            }}
                            className="hover:!bg-[#e81123] hover:!text-white"
                        >
                            <CloseIcon />
                        </TitleBarButton>
                    </>
                )}
            </div>
        </div>
    );
}
