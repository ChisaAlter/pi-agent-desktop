// 消息气泡 - 用户消息右侧，AI 消息左侧（黑色头像）

import React from 'react';
import { Message } from '../../stores/session-store';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CommandCard } from './CommandCard';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* 头像 */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            isUser 
              ? 'bg-[#1a1a1a]' 
              : 'bg-[#1a1a1a]'
          }`}>
            <span className="text-white text-xs font-bold">
              {isUser ? 'U' : 'π'}
            </span>
          </div>
          
          {/* 消息内容 */}
          <div className={`rounded-2xl px-4 py-3 ${
            isUser 
              ? 'bg-[#1a1a1a] text-white' 
              : 'bg-white border border-[#e5e5e5] text-[#1a1a1a]'
          }`}>
            {isUser ? (
              <div className="whitespace-pre-wrap text-sm">{message.content}</div>
            ) : (
              <div className="text-sm">
                <MarkdownRenderer content={message.content} />
              </div>
            )}
            
            {/* 工具调用 */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-3 space-y-2">
                {message.toolCalls.map((toolCall) => (
                  <CommandCard key={toolCall.id} toolCall={toolCall} />
                ))}
              </div>
            )}
            
            {/* 时间戳 */}
            <div className={`text-xs mt-2 ${isUser ? 'text-white/70' : 'text-[#999]'}`}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
