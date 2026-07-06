import React, { useRef, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { SEARCH_FOCUS_CLEAR_DELAY_MS } from './search-focus';
import type { Message as ChatMessage } from '@shared';

interface VirtualizedMessageListProps {
    messages: ChatMessage[];
    isStreaming: boolean;
    streamingMessageId: string | null;
    focusMessageId?: string | null;
    onFocusHandled?: () => void;
    onPlanAction?: (message: ChatMessage, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string) => Promise<void>;
}

const ESTIMATED_ROW_HEIGHT = 120;

export const VirtualizedMessageList = React.memo(function VirtualizedMessageList({
    messages,
    isStreaming,
    streamingMessageId,
    focusMessageId,
    onFocusHandled,
    onPlanAction,
}: VirtualizedMessageListProps): React.JSX.Element {
    const parentRef = useRef<HTMLDivElement>(null);
    // 持有 focus scroll 的 setTimeout id, unmount 或新 focus 触发时清理, 避免泄漏 / setState-after-unmount
    const timersRef = useRef<number[]>([]);

    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => ESTIMATED_ROW_HEIGHT, []),
        overscan: 5,
    });

    useEffect(() => {
        if (!focusMessageId) return;
        const index = messages.findIndex((message) => message.id === focusMessageId);
        if (index < 0) return;
        virtualizer.scrollToIndex(index, { align: 'center' });
        // 清理上一轮未触发的 timer, 避免快速连续 focus 时残留回调错位
        timersRef.current.forEach((id) => window.clearTimeout(id));
        timersRef.current = [];
        const outer = window.setTimeout(() => {
            const target = parentRef.current?.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`);
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
        <div ref={parentRef} className="flex-1 overflow-y-auto" style={{ maxHeight: '100%' }}>
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
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
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});
