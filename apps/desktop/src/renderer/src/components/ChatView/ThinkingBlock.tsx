// 可折叠的思考过程显示组件 — Cindy ThinkingCard 式
// 默认折叠(含流式) + 展开状态 localStorage 持久化 + 流式计时 + Collapse 动效。
// 思考内容以纯文本 + 轻量行内强调渲染(ThinkingText)。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { readBoolFlag, writeBoolFlag } from '../../utils/first-launch';
import { useI18n } from '../../i18n';

interface ThinkingBlockProps {
    /** 累积的思考文本 */
    content: string;
    /** 合并的思考段数 */
    count?: number;
    /** 是否仍在流式接收 */
    isStreaming?: boolean;
    /** 展开状态持久化 key(消息 id, 唯一稳定)。缺省则不持久化。 */
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

/** 轻量行内强调: **粗体** / *斜体* / `code` → 元素。
 *  用带状态的扫描器而不是正则:未闭合强调符(流式中思考内容)不崩、不丢文本,
 *  闭合符到达后正确包裹 —— 与 repairStreamingMarkdown 的保守边界一致。 */
export function ThinkingText({ content }: { content: string }): React.JSX.Element {
    const parts = useMemo(() => {
        const out: React.ReactNode[] = [];
        let i = 0;
        let plain = "";
        const flushPlain = (): void => {
            if (plain) {
                out.push(plain);
                plain = "";
            }
        };

        while (i < content.length) {
            // 反引号 code(优先, 内容里星号不参与强调配对)
            if (content[i] === "`") {
                const end = content.indexOf("`", i + 1);
                if (end === -1) {
                    // 未闭合 inline code: 保持字面量, 不吞后续内容
                    plain += content[i];
                    i += 1;
                    continue;
                }
                flushPlain();
                out.push(<code key={out.length} className="markdown-inline-code">{content.slice(i + 1, end)}</code>);
                i = end + 1;
                continue;
            }
            // 加粗 **...**
            if (content.startsWith("**", i)) {
                const end = content.indexOf("**", i + 2);
                if (end === -1) {
                    plain += content[i];
                    i += 1;
                    continue;
                }
                flushPlain();
                out.push(<strong key={out.length}>{content.slice(i + 2, end)}</strong>);
                i = end + 2;
                continue;
            }
            // 斜体 *...*(不成对 ** 时才当作斜体开符)
            if (content[i] === "*" && content[i + 1] !== "*") {
                const end = content.indexOf("*", i + 1);
                if (end === -1 || content[end + 1] === "*") {
                    plain += content[i];
                    i += 1;
                    continue;
                }
                flushPlain();
                out.push(<em key={out.length}>{content.slice(i + 1, end)}</em>);
                i = end + 1;
                continue;
            }
            plain += content[i];
            i += 1;
        }
        flushPlain();
        return out;
    }, [content]);
    return <>{parts}</>;
}

/** 高度过渡折叠容器(展开/收起带动画; 收起动画结束后卸载, 折叠时 DOM 干净)。 */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }): React.JSX.Element | null {
    const [mounted, setMounted] = useState(open);
    const [opening, setOpening] = useState(false);
    const prevOpenRef = useRef(open);

    useEffect(() => {
        const wasOpen = prevOpenRef.current;
        prevOpenRef.current = open;
        if (open && !wasOpen) {
            // 刚展开: 先挂载(0fr), 下一帧置 opening 触发 0fr→1fr 过渡。
            setMounted(true);
            setOpening(false);
            const raf = requestAnimationFrame(() => setOpening(true));
            return () => cancelAnimationFrame(raf);
        }
        if (!open) {
            setOpening(false);
            // 收起动画(1fr→0fr, 200ms)完成后卸载, 折叠时 DOM 不残留内容。
            const timer = setTimeout(() => setMounted(false), 220);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [open]);

    if (!mounted) return null;
    return (
        <div
            className="pi-motion-thinking-content overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
            data-motion="thinking-content"
            data-open={opening ? "true" : "false"}
            style={{ display: "grid", gridTemplateRows: opening ? "1fr" : "0fr" }}
        >
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    );
}

export function ThinkingBlock({
    content,
    count = 1,
    isStreaming = false,
    persistKey,
}: ThinkingBlockProps): React.JSX.Element | null {
    const { t } = useI18n();
    // 展开状态持久化: key 固定(消息 id), 跨渲染存活。
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
    const durationText = formatDuration(elapsedMs);
    const summary = isStreaming
        ? t('thinkingBlock.thinkingInProgress', { duration: durationText })
        : t('thinkingBlock.thinkingCountChars', { count: Math.max(1, count), chars: content.length });
    const ariaLabel = isExpanded ? t('thinkingBlock.collapse') : summary;

    return (
        <div className="pi-motion-thinking-shell my-1" data-motion="thinking-shell">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={isExpanded}
                aria-label={ariaLabel}
                className="flex w-full items-center justify-between py-1 text-left text-[var(--mm-text-tertiary)] transition-colors duration-150 hover:text-[var(--mm-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
            >
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-xs">{summary}</span>
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

            {/* 展开内容(高度过渡) */}
            <Collapse open={isExpanded}>
                <div className="border-l border-[var(--mm-border)] py-2 pl-3">
                    <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--mm-text-tertiary)]">
                        <ThinkingText content={content} />
                        {isStreaming && (
                            <span className="ml-1 inline-flex align-text-bottom">
                                <StreamingIndicator />
                            </span>
                        )}
                    </div>
                </div>
            </Collapse>
        </div>
    );
}
