// 可折叠的思考过程显示组件

import React, { useState } from 'react';

interface ThinkingBlockProps {
  /** 累积的思考文本 */
  content: string;
  /** 合并的思考段数 */
  count?: number;
  /** 是否仍在流式接收 */
  isStreaming?: boolean;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
}

export function ThinkingBlock({
  content,
  count = 1,
  isStreaming = false,
  defaultExpanded = false,
}: ThinkingBlockProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!content) return <></>;

  return (
    <div className="my-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-1 text-left text-[#a0a0a0] transition-colors duration-150 hover:text-[#777]"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs">
            {isStreaming ? '思考中' : `思考 ${Math.max(1, count)} 次`}
            {!isStreaming && ` · ${content.length} 字符`}
          </span>
          {isStreaming && <span className="inline-block h-3 w-0.5 animate-pulse bg-[#999]" />}
        </div>

        <div className="flex items-center gap-2">
          <svg
            className={`h-3 w-3 transition-transform duration-150 ${
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
        <div className="border-l border-[#e5e5e2] py-2 pl-3">
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-[#777]">
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
