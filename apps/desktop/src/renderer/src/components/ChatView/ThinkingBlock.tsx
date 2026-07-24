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

function StreamingIndicator(): React.JSX.Element {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
      <span className="absolute inset-0 rounded-full bg-[var(--mm-bg-active)] opacity-25 animate-ping" />
      <span className="pi-motion-running-dot relative h-2.5 w-2.5 rounded-full bg-[var(--mm-bg-active)]" />
    </span>
  );
}

export function ThinkingBlock({
  content,
  count = 1,
  isStreaming = false,
  defaultExpanded = false,
}: ThinkingBlockProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!content) return <></>;
  const label = isExpanded ? '收起思考' : '展开思考';

  return (
    <div className="pi-motion-thinking-shell my-1" data-motion="thinking-shell">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={`${label}，${isStreaming ? '思考中' : `思考 ${Math.max(1, count)} 次 · ${content.length} 字符`}`}
        className="flex w-full items-center justify-between py-1 text-left text-[var(--mm-text-tertiary)] transition-colors duration-150 hover:text-[var(--mm-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs">
            {isStreaming ? '思考中' : `思考 ${Math.max(1, count)} 次`}
            {!isStreaming && ` · ${content.length} 字符`}
          </span>
          {isStreaming && <StreamingIndicator />}
        </div>

        <div className="flex items-center gap-2">
          <svg
            className={`h-3 w-3 transition-transform duration-150 ${
              isExpanded ? 'rotate-90' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
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
        <div className="pi-motion-thinking-content border-l border-[var(--mm-border)] py-2 pl-3" data-motion="thinking-content">
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--mm-text-tertiary)]">
            {content}
            {isStreaming && (
              <span className="ml-1 inline-flex align-text-bottom">
                <StreamingIndicator />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
