import React, { useRef, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { SEARCH_FOCUS_CLEAR_DELAY_MS } from './search-focus';
import type { Message as ChatMessage } from '@shared';

import type { GeneratedUiSendRequest } from './GeneratedUiForm';
interface VirtualizedMessageListProps {
    messages: ChatMessage[];
    isStreaming: boolean;
    streamingMessageId: string | null;
    focusMessageId?: string | null;
    onFocusHandled?: () => void;
    onPlanAction?: (message: ChatMessage, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string) => Promise<void>;
    onGeneratedUiSend?: (request: GeneratedUiSendRequest) => Promise<void>;
    generatedUiDisabled?: boolean;
    /** 真正滚动的容器 (ChatView 的 chat-scroll-region)。虚拟器以它为 scrollElement,
     *  自身不再包一层 overflow 容器 — 嵌套滚动容器会使 maxHeight:100% 失效、
     *  虚拟化被完全抵消(所有消息都渲染成 DOM, 滚动卡顿)。 */
    scrollElementRef: React.RefObject<HTMLDivElement | null>;
}

const ESTIMATED_ROW_HEIGHT = 120;

export const VirtualizedMessageList = React.memo(function VirtualizedMessageList({
    messages,
    isStreaming,
    streamingMessageId,
    focusMessageId,
    onFocusHandled,
    onPlanAction,
    onGeneratedUiSend,
    generatedUiDisabled,
    scrollElementRef,
}: VirtualizedMessageListProps): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null);
    // 持有 focus scroll 的 setTimeout id, unmount 或新 focus 触发时清理, 避免泄漏 / setState-after-unmount
    const timersRef = useRef<number[]>([]);
    // 虚拟容器位于外层 wrapper 内部, 与滚动元素顶部存在 padding 偏移;
    // 用 scrollMargin 校正, 否则虚拟器的滚动位置换算会错位。
    const [scrollMargin, setScrollMargin] = useState(0);

    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: useCallback(() => ESTIMATED_ROW_HEIGHT, []),
        overscan: 5,
        scrollMargin,
    });

    // 挂载时测量虚拟容器相对滚动元素内容顶部的偏移(与当前 scrollTop 无关)。
    useLayoutEffect(() => {
        const scrollEl = scrollElementRef.current;
        const container = containerRef.current;
        if (!scrollEl || !container) return;
        const margin =
            container.getBoundingClientRect().top -
            scrollEl.getBoundingClientRect().top +
            scrollEl.scrollTop;
        setScrollMargin(Math.max(0, Math.round(margin)));
    }, [scrollElementRef]);

    useEffect(() => {
        if (!focusMessageId) return;
        const index = messages.findIndex((message) => message.id === focusMessageId);
        if (index < 0) return;
        virtualizer.scrollToIndex(index, { align: 'center' });
        // 清理上一轮未触发的 timer, 避免快速连续 focus 时残留回调错位
        timersRef.current.forEach((id) => window.clearTimeout(id));
        timersRef.current = [];
        const outer = window.setTimeout(() => {
            const target = containerRef.current?.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`);
            target?.scrollIntoView({ block: 'center' });
            const inner = window.setTimeout(() => {
                onFocusHandled?.();
            }, SEARCH_FOCUS_CLEAR_DELAY_MS);
            timersRef.current.push(inner);
        }, 0);
        timersRef.current.push(outer);
    }, [focusMessageId, messages, onFocusHandled, virtualizer]);

    // unmount 时清掉残留 timer, 防止 setState-after-unmount
    useEffect(() => {
        return () => {
            timersRef.current.forEach((id) => window.clearTimeout(id));
            timersRef.current = [];
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
            {virtualizer.getVirtualItems().map((virtualItem) => {
                const message = messages[virtualItem.index];
                return (
                    <div
                        key={message.id}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualItem.start}px)`,
                        }}
                    >
                        <div className="py-2.5">
                            <MessageBubble
                                message={message}
                                isStreaming={isStreaming && message.id === streamingMessageId}
                                isSearchTarget={focusMessageId === message.id}
                                onPlanAction={onPlanAction}
                                onGeneratedUiSend={onGeneratedUiSend}
                                generatedUiDisabled={generatedUiDisabled}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
});
