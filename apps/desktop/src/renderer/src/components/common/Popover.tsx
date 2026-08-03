// Popover — 简单 click-to-toggle 下拉
// 用途:v1.0.13 给 ChatInput 3 个假按钮(权限/模型/...) 替换为真下拉
// 设计:不复制 UI,只复用 MiniMaxCode 风格 token(白底 + 阴影 + 圆角 8px + 1px 边框)
// 行为:
//  - trigger 点击切换 open
//  - 点 outside 关闭
//  - ESC 关闭
//  - portal 到 body,bypass 父容器 overflow:hidden
//  - 简单 absolute 定位:trigger 下方,左对齐(start) 或右对齐(end)
// 生产约束:
//  - 必须渲染为单一布局节点(不能用 fragment),否则 flex/grid 子项宽度会断,导致模型名硬裁切

import React, { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState, isValidElement } from "react";
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
    /** 根节点 className — 参与 flex/grid 布局时必填(如 min-w-0 flex-1) */
    className?: string;
}

interface Position {
    top: number;
    left: number;
    maxHeight: number;
    viewportWidth: number;
}

type TriggerElementProps = {
    onClick?: (e: React.MouseEvent) => void;
    ref?: React.Ref<HTMLElement>;
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
    if (!ref) return;
    if (typeof ref === "function") {
        ref(value);
        return;
    }
    (ref as React.MutableRefObject<T | null>).current = value;
}

export function Popover({
    trigger,
    children,
    align = "start",
    contentClassName = "",
    className = "",
}: PopoverProps): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<Position | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const presence = useMotionPresence(open, 100);

    const updatePosition = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const margin = 8;
        const gap = 8;
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

    const handleTriggerClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (open) {
                setOpen(false);
            } else {
                updatePosition();
                setOpen(true);
            }
        },
        [open, updatePosition],
    );

    useLayoutEffect(() => {
        if (!open) return;
        updatePosition();
        const id = requestAnimationFrame(() => {
            updatePosition();
        });
        return () => cancelAnimationFrame(id);
    }, [open, updatePosition]);

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

    const triggerWithRef = isValidElement(trigger)
        ? cloneElement(trigger as React.ReactElement<TriggerElementProps>, {
              ref: (el: HTMLElement | null) => {
                  triggerRef.current = el;
                  assignRef((trigger as React.ReactElement<TriggerElementProps>).props.ref, el);
              },
              onClick: (e: React.MouseEvent) => {
                  (trigger as React.ReactElement<TriggerElementProps>).props.onClick?.(e);
                  if (e.defaultPrevented) return;
                  handleTriggerClick(e);
              },
          })
        : trigger;

    const content = (
        <div
            ref={contentRef}
            role="menu"
            data-pi-popover-surface
            data-motion-state={presence.state}
            className={`pi-motion-popover fixed z-[200] min-w-[180px] overflow-y-auto rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-popover)] py-1 shadow-[0_14px_36px_rgba(20,20,18,0.14),0_2px_8px_rgba(20,20,18,0.06)] ${contentClassName}`}
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
        <div className={className || undefined} data-pi-popover-root>
            {triggerWithRef}
            {presence.rendered && typeof document !== "undefined" && createPortal(content, document.body)}
        </div>
    );
}
