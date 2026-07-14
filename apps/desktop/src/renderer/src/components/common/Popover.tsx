// Popover — 简单 click-to-toggle 下拉
// 用途:v1.0.13 给 ChatInput 3 个假按钮(权限/模型/...) 替换为真下拉
// 设计:不复制 UI,只复用 MiniMaxCode 风格 token(白底 + 阴影 + 圆角 8px + 1px 边框)
// 行为:
//  - trigger 点击切换 open
//  - 点 outside 关闭
//  - ESC 关闭
//  - portal 到 body,bypass 父容器 overflow:hidden
//  - 简单 absolute 定位:trigger 下方,左对齐(start) 或右对齐(end)

import React, { cloneElement, useCallback, useEffect, useRef, useState, isValidElement } from "react";
import { createPortal } from "react-dom";
import { useMotionPresence } from "../../hooks/useMotionPresence";

export interface PopoverProps {
    /** 触发元素 — 必须是能接受 ref 的 React 元素(button/div) */
    trigger: React.ReactNode;
    /** 下拉内容 */
    children: React.ReactNode | ((close: () => void) => React.ReactNode);
    /** 水平对齐:start(左对齐 trigger) | end(右对齐 trigger) */
    align?: "start" | "end";
    /** 内容区附加 className */
    contentClassName?: string;
}

interface Position {
    top: number;
    left: number;
    maxHeight: number;
    viewportWidth: number;
}

export function Popover({
    trigger,
    children,
    align = "start",
    contentClassName = "",
}: PopoverProps): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<Position | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const presence = useMotionPresence(open, 100);

    // 计算位置:trigger 下方,左/右对齐
    // v1.0.13:viewport 适配 — 优先下方,空间不够翻上方;content 自身 max-height 限
    // v1.0.14-fix: 优先读取 content 真实高度,estimatedHeight 降到 140;保持同步+异步双算
    const updatePosition = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const margin = 8;
        const gap = 8;
        // 优先用已渲染 content 的真实高度,未渲染时用 140 保守估算(3 个菜单项约 100px)
        const actualHeight = contentRef.current?.offsetHeight ?? 0;
        const estimatedHeight = actualHeight > 0 ? actualHeight : 140;
        const spaceBelow = Math.max(0, vh - rect.bottom - gap - margin);
        const spaceAbove = Math.max(0, rect.top - gap - margin);
        const openBelow = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove;
        const maxHeight = openBelow ? spaceBelow : spaceAbove;
        const top = openBelow
            ? rect.bottom + gap
            : Math.max(margin, rect.top - gap - Math.min(estimatedHeight, maxHeight));
        const left = align === "end" ? rect.right : rect.left;
        setPos({ top, left, maxHeight, viewportWidth: vw });
    }, [align]);

    // 点击 trigger 切换
    const handleTriggerClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (open) {
                setOpen(false);
            } else {
                updatePosition(); // 同步给初始位置(兼容 jsdom)
                setOpen(true);
            }
        },
        [open, updatePosition],
    );

    // 真实浏览器:content mount 后用真实高度精算;jsdom 里 rAF 不执行,依赖上面同步初始值
    useEffect(() => {
        if (!open) return;
        const id = requestAnimationFrame(() => {
            updatePosition();
        });
        return () => cancelAnimationFrame(id);
    }, [open, updatePosition]);

    // 点 outside / ESC 关闭
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            const t = e.target as Node | null;
            if (!t) return;
            if (contentRef.current?.contains(t)) return;
            if (triggerRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    // 外部滚动/resize 时关掉；下拉自身滚动不能关闭，否则长菜单无法滑动。
    useEffect(() => {
        if (!open) return;
        let canCloseOnScroll = false;
        const armScrollClose = requestAnimationFrame(() => {
            canCloseOnScroll = true;
        });
        const close = (): void => setOpen(false);
        const closeOnExternalScroll = (e: Event): void => {
            if (!canCloseOnScroll) return;
            const target = e.target as Node | null;
            if (target && contentRef.current?.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener("resize", close);
        window.addEventListener("scroll", closeOnExternalScroll, true);
        return () => {
            cancelAnimationFrame(armScrollClose);
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", closeOnExternalScroll, true);
        };
    }, [open]);

    // 注入 ref + onClick 到 trigger
    const triggerWithRef = isValidElement(trigger)
        ? cloneElement(trigger as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void; ref?: React.Ref<HTMLElement> }>, {
              ref: (el: HTMLElement | null) => {
                  triggerRef.current = el;
              },
              onClick: handleTriggerClick,
          })
        : trigger;

    const content = (
        <div
            ref={contentRef}
            role="menu"
            data-pi-popover-surface
            data-motion-state={presence.state}
            className={`pi-motion-popover fixed z-[60] min-w-[180px] overflow-y-auto rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-popover)] py-1 shadow-[0_14px_36px_rgba(20,20,18,0.14),0_2px_8px_rgba(20,20,18,0.06)] ${contentClassName}`}
            style={
                pos
                    ? {
                          top: pos.top,
                          maxHeight: pos.maxHeight,
                          ...(align === "end" ? { right: pos.viewportWidth - pos.left } : { left: pos.left }),
                      }
                    : { visibility: "hidden" }
            }
        >
            {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
    );

    return (
        <>
            {triggerWithRef}
            {presence.rendered && typeof document !== "undefined" && createPortal(content, document.body)}
        </>
    );
}
