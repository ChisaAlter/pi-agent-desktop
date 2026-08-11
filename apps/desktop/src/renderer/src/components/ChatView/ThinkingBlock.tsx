// 可折叠的思考过程显示组件 — Cindy ThinkingCard 式
// 默认折叠(含流式) + 展开状态 localStorage 持久化 + 流式计时。
// 思考内容以纯文本 + 轻量行内强调渲染(ThinkingText)。

import React, { useEffect, useMemo, useState } from 'react';
import { readBoolFlag, writeBoolFlag } from '../../utils/first-launch';

interface ThinkingBlockProps {
    /** 累积的思考文本 */
    content: string;
    /** 合并的思考段数 */
    count?: number;
    /** 是否仍在流式接收 */
    isStreaming?: boolean;
    /** 展开状态持久化 key(通常为 startedAt 时间戳)。缺省则不持久化。 */
    persistKey?: string;
}

/** 短时长 `Xs`, 长时长 `Xm Ys`。 */
export function formatDuration(ms: number): string {
    const totalSec = Math.max(1, Math.round(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function StreamingIndicator(): React.JSX.Element {
    return (
        <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-[var(--mm-bg-active)] opacity-25 animate-ping" />
            <span className="pi-motion-running-dot relative h-2.5 w-2.5 rounded-full bg-[var(--mm-bg-active)]" />
        </span>
    );
}

/** 轻量行内强调: **粗体** / *斜体* / `code` → 元素。 */
export function ThinkingText({ content }: { content: string }): React.JSX.Element {
    const parts = useMemo(() => {
        // 按 反引号/加粗/斜体 拆分(保持纯文本安全性, 不解析 HTML)。
        return content
            .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g)
            .map((part, i) => {
                if (part.startsWith('`') && part.endsWith('`')) {
                    return <code key={i} className="markdown-inline-code">{part.slice(1, -1)}</code>;
                }
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i}>{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith('*') && part.endsWith('*')) {
                    return <em key={i}>{part.slice(1, -1)}</em>;
                }
                return part;
            });
    }, [content]);
    return <>{parts}</>;
}

export function ThinkingBlock({
    content,
    count = 1,
    isStreaming = false,
    persistKey,
}: ThinkingBlockProps): React.JSX.Element | null {
    // 展开状态持久化: key 固定(通常为 startedAt 时间戳), 跨渲染存活。
    const storageKey = persistKey ? `thinking:${persistKey}` : null;
    const [isExpanded, setIsExpanded] = useState<boolean>(() => {
        if (!storageKey) return false;
        return readBoolFlag(storageKey, false);
    });

    const toggle = (): void => {
        const next = !isExpanded;
        setIsExpanded(next);
        if (storageKey) writeBoolFlag(storageKey, next);
    };

    // 流式计时: 500ms tick 显示 elapsed。
    const [startedAt] = useState<number>(() => Date.now());
    const [elapsedMs, setElapsedMs] = useState(0);
    useEffect(() => {
        if (!isStreaming) return;
        setElapsedMs(Date.now() - startedAt);
        const id = setInterval(() => {
            setElapsedMs(Date.now() - startedAt);
        }, 500);
        return () => clearInterval(id);
    }, [isStreaming, startedAt]);

    if (!content) return null;
    const summary = isStreaming
        ? `思考中 ${formatDuration(elapsedMs)}`
        : `思考 ${Math.max(1, count)} 次 · ${content.length} 字符`;

    return (
        <div className="pi-motion-thinking-shell my-1" data-motion="thinking-shell">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? '收起思考' : summary}
                className="flex w-full items-center justify-between py-1 text-left text-[var(--mm-text-tertiary)] transition-colors duration-150 hover:text-[var(--mm-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
            >
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-xs">
                        {isStreaming ? `思考中 ${formatDuration(elapsedMs)}` : `思考 ${Math.max(1, count)} 次`}
                        {!isStreaming && ` · ${content.length} 字符`}
                    </span>
                    {isStreaming && <StreamingIndicator />}
                </div>

                <div className="flex items-center gap-2">
                    <svg
                        className={`h-3 w-3 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
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
                        <ThinkingText content={content} />
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
