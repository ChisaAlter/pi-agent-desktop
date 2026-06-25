import React, { useRef, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import type { Message as ChatMessage } from '@shared';

interface VirtualizedMessageListProps {
    messages: ChatMessage[];
    isStreaming: boolean;
    streamingMessageId: string | null;
    jumpTarget?: { messageId: string; nonce: number } | null;
    highlightedMessageId?: string | null;
    onPlanAction?: (message: ChatMessage, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string) => Promise<void>;
}

const ESTIMATED_ROW_HEIGHT = 120;

export const VirtualizedMessageList = React.memo(function VirtualizedMessageList({
    messages,
    isStreaming,
    streamingMessageId,
    jumpTarget,
    highlightedMessageId,
    onPlanAction,
}: VirtualizedMessageListProps): React.JSX.Element {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => ESTIMATED_ROW_HEIGHT, []),
        overscan: 5,
    });

    useEffect(() => {
        if (!jumpTarget) return;
        const index = messages.findIndex((message) => message.id === jumpTarget.messageId);
        if (index < 0) return;
        virtualizer.scrollToIndex(index, { align: 'center' });
        window.requestAnimationFrame(() => {
            const element = parentRef.current?.querySelector<HTMLElement>(`[data-message-id="${jumpTarget.messageId}"]`);
            element?.scrollIntoView({ block: 'center' });
        });
    }, [jumpTarget, messages, virtualizer]);

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
                            data-message-id={message.id}
                            ref={virtualizer.measureElement}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualItem.start}px)`,
                            }}
                            className={highlightedMessageId === message.id ? "rounded-xl bg-[#fff7cc]" : undefined}
                        >
                            <div className="py-2.5">
                                <MessageBubble
                                    message={message}
                                    isStreaming={isStreaming && message.id === streamingMessageId}
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
