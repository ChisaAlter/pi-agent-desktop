import React, { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import type { Message as ChatMessage } from '@shared';

interface VirtualizedMessageListProps {
    messages: ChatMessage[];
    isStreaming: boolean;
    streamingMessageId: string | null;
    onPlanAction?: (message: ChatMessage, action: "execute" | "refine" | "cancel" | "pause" | "resume", text?: string) => Promise<void>;
}

const ESTIMATED_ROW_HEIGHT = 120;

export const VirtualizedMessageList = React.memo(function VirtualizedMessageList({
    messages,
    isStreaming,
    streamingMessageId,
    onPlanAction,
}: VirtualizedMessageListProps): React.JSX.Element {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => ESTIMATED_ROW_HEIGHT, []),
        overscan: 5,
    });

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