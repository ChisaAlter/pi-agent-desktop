// 消息气泡 - 用户消息右侧，AI 消息左侧（黑色头像）
// v1.0.4: author 走 t()

import React from 'react';
import { Message } from '../../stores/session-store';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CommandCard } from './CommandCard';
import { ThinkingBlock } from './ThinkingBlock';
import { useI18n } from '../../i18n';

interface MessageBubbleProps {
  message: Message;
  /** 是否仍在流式接收中 */
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps): React.JSX.Element {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const timeText = new Date(message.timestamp).toLocaleTimeString();
  const authorLabel = isUser ? t('messageBubble.userAuthor') : t('messageBubble.piAuthor');
  const articleLabel = `${authorLabel} · ${timeText}`;

  return (
    <article
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      role="article"
      aria-label={articleLabel}
      aria-busy={isStreaming}
    >
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* 头像 */}
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              isUser
                ? 'bg-[#1a1a1a]'
                : 'bg-[#1a1a1a]'
            }`}
            aria-hidden="true"
          >
            <span className="text-white text-xs font-bold">
              {isUser ? 'U' : 'π'}
            </span>
          </div>

          {/* 消息内容 */}
          <div className={`rounded-2xl ${
            isUser
              ? 'bg-[#1a1a1a] text-white px-4 py-3'
              : 'bg-white border border-[#e5e5e5] text-[#1a1a1a] px-4 py-3'
          }`}>
            {isUser ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
            ) : (
              <>
                {/* 思考过程（可折叠） */}
                {message.thinking && (
                  <ThinkingBlock
                    content={message.thinking}
                    isStreaming={isStreaming && !message.content}
                  />
                )}

                {/* 正文内容 */}
                {message.content && (
                  <div className="text-sm leading-relaxed">
                    <MarkdownRenderer content={message.content} />
                  </div>
                )}

                {/* 流式状态下显示打字光标（尚无内容时） */}
                {isStreaming && !message.content && !message.thinking && (
                  <div className="flex items-center gap-2 py-1" aria-hidden="true">
                    <span className="inline-block w-0.5 h-4 bg-[#1a1a1a] animate-pulse" />
                  </div>
                )}
              </>
            )}

            {/* 工具调用 */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className={`space-y-2 ${isUser ? 'mt-3' : 'mt-4'}`}>
                {message.toolCalls.map((toolCall) => (
                  <CommandCard key={toolCall.id} toolCall={toolCall} />
                ))}
              </div>
            )}

            {/* 时间戳 */}
            <div
              className={`text-xs mt-2 ${isUser ? 'text-white/70' : 'text-[#999]'}`}
            >
              <time dateTime={new Date(message.timestamp).toISOString()}>{timeText}</time>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
