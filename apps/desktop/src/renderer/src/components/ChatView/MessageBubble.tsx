// 消息气泡 - 用户消息右侧 pill，AI 消息正文块（无头像）
// v1.0.4: author 走 t()
// v1.0.9: 时间戳走 utils/format.{formatTime, formatIso}, 无效输入不渲染 "Invalid Date"

import React from 'react';
import { Message } from '../../stores/session-store';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CommandCard } from './CommandCard';
import { ThinkingBlock } from './ThinkingBlock';
import { useI18n } from '../../i18n';
import { formatTime, formatIso } from '../../utils/format';

interface MessageBubbleProps {
  message: Message;
  /** 是否仍在流式接收中 */
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps): React.JSX.Element {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const timeText = formatTime(message.timestamp);
  const timeIso = formatIso(message.timestamp);
  const authorLabel = isUser ? t('messageBubble.userAuthor') : t('messageBubble.piAuthor');
  const articleLabel = `${authorLabel} · ${timeText}`;

  return (
    <article
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      role="article"
      aria-label={articleLabel}
      aria-busy={isStreaming}
    >
      <div className={isUser ? 'max-w-[74%]' : 'w-full max-w-full'}>
          {/* 消息内容 */}
          <div className={`${
            isUser
              ? 'rounded-[18px] bg-[#f1f1ef] px-4 py-3 text-[#1f1f1f]'
              : 'text-[#1f1f1f] py-1'
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
              className={`text-xs mt-2 ${isUser ? 'text-[#8a8a8a]' : 'text-[#aaa]'}`}
            >
              <time dateTime={timeIso}>{timeText}</time>
            </div>
          </div>
      </div>
    </article>
  );
}
