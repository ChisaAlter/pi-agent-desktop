// 可折叠的思考过程显示组件

import React, { useState } from 'react';

interface ThinkingBlockProps {
  /** 累积的思考文本 */
  content: string;
  /** 是否仍在流式接收 */
  isStreaming?: boolean;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
}

export function ThinkingBlock({
  content,
  isStreaming = false,
  defaultExpanded = false,
}: ThinkingBlockProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!content) return <></>;

  return (
    <div className="bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg overflow-hidden my-2">
      {/* 折叠头 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#ebebeb] transition-colors duration-150"
      >
        <div className="flex items-center gap-2">
          {/* 思考图标 */}
          <svg
            className="w-4 h-4 text-[#666666]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <span className="text-sm font-medium text-[#666666]">
            {isStreaming ? 'AI 正在思考...' : '思考过程'}
          </span>
          {isStreaming && !isExpanded && (
            <span className="inline-block w-0.5 h-3.5 bg-[#1a1a1a] animate-pulse ml-0.5" />
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isExpanded && content.length > 0 && (
            <span className="text-xs text-[#999999]">
              {content.length} 字符
            </span>
          )}
          <svg
            className={`w-3 h-3 text-[#999999] transition-transform duration-150 ${
              isExpanded ? 'rotate-90' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </button>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="border-t border-[#e5e5e5] px-3 py-3">
          <div className="text-sm text-[#666666] italic whitespace-pre-wrap leading-relaxed">
            {content}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-[#1a1a1a] animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
