// MarkdownRenderer (M7-4, 流式全量解析版)
// 全量流式 markdown 渲染: 流式中也走 ReactMarkdown 全量解析(标题/列表/代码块
// 卡片在生成过程中即成型), 配合:
//   - useStreamingThrottle: 100ms 节流(流式期间不每帧全量解析)
//   - repairStreamingMarkdown: 未闭合语法临时修复(仅流式, 终稿用原文)
//   - rehypeStreamWordFade: 词级淡入(默认关, 见 settings streamFadeEnabled)
//   - normalizeMathDelimiters: \(..\) / \[..\] → $..$ / $$..$$
// 安全: 不启用 rehypeRaw — 助手/模型内容受外部影响, 渲染原始 HTML 会引入 XSS.
//   CSP (script-src 'self') 已兜底拦截内联脚本, 这里移除 rehypeRaw 做纵深防御.
//   危险协议(javascript:/data:)由默认 urlTransform 拦截。

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CodeBlockCard } from "./CodeBlockCard";
import { repairStreamingMarkdown } from "./repairStreamingMarkdown";
import {
    createWordFadeState,
    markSettledFromAnimationEnd,
    rehypeStreamWordFade,
    type WordFadeState,
} from "./rehypeStreamWordFade";
import { useSettingsStore } from "../../stores/settings-store";

interface MarkdownRendererProps {
    content: string;
    isStreaming?: boolean;
}

/** 流式中 100ms 节流 + 流结束立即 flush 最终值(Cindy useStreamingThrottle 同构)。 */
function useStreamingThrottle(value: string, enabled: boolean, intervalMs = 100): string {
    const [throttled, setThrottled] = useState(value);
    const latestRef = useRef(value);
    const lastEmitRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        latestRef.current = value;

        if (!enabled) {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            // Stream just ended — flush whatever the most recent value is so
            // the final frame is never the last throttled snapshot.
            if (throttled !== value) setThrottled(value);
            return;
        }

        const now = performance.now();
        const elapsed = now - lastEmitRef.current;
        if (elapsed >= intervalMs) {
            lastEmitRef.current = now;
            setThrottled(value);
            return;
        }
        if (timerRef.current === null) {
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                lastEmitRef.current = performance.now();
                setThrottled(latestRef.current);
            }, intervalMs - elapsed);
        }
    }, [value, enabled, intervalMs, throttled]);

    useEffect(() => {
        return () => {
            if (timerRef.current !== null) clearTimeout(timerRef.current);
        };
    }, []);

    return throttled;
}

/** \(..\) → $..$、\[..\] → $$..$$(remark-math 只认 dollar 定界符)。 */
export function normalizeMathDelimiters(markdown: string): string {
    // 跳过围栏(``` / ~~~)内部, 避免改到代码里的 LaTeX 字符串。
    const lines = markdown.split(/\r?\n/);
    const out: string[] = [];
    let fence: string | null = null;
    for (const line of lines) {
        const fm = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fm) {
            const marker = fm[1];
            if (!fence) {
                fence = marker;
            } else if (marker[0] === fence[0] && marker.length >= fence.length) {
                fence = null;
            }
            out.push(line);
            continue;
        }
        if (fence) {
            out.push(line);
            continue;
        }
        // 行内 \(...\) → $...$(避开反斜杠转义)。
        const inline = line.replace(/(?<!\\)\\\(([^`\r\n$\\]+?)(?<!\\)\\\)/g, (m, math: string) => (
            math.trim() ? `$${math}$` : m
        ));
        // 整行 \[...\] → $$...$$。
        const display = inline.replace(
            /^(\s*)\\\[([\s\S]*?)\\\](\s*)$/,
            (_m, lead: string, math: string, trail: string) => (
                math.trim() ? `${lead}$$$$\n${lead}${math.trim()}\n${lead}$$$${trail}` : _m
            ),
        );
        out.push(display);
    }
    return out.join("\n");
}

/** 本地路径/文件名判断(与 CommandCard.extractOutputPaths 同源)。 */
const LOCAL_PATH_RE = /(?:[A-Za-z]:[\\/][^\s"'`<>]+|(?:[\w.-]+[\\/])+[\w.@()[\]-]+\.[A-Za-z0-9_+-]{1,12})/;

function isLocalPath(href: string): boolean {
    return LOCAL_PATH_RE.test(href) && !href.startsWith("http");
}

/**
 * urlTransform: 放行 http(s)/mailto + 本地路径(C:\ 绝对路径 / 相对路径),
 * 其余 scheme(javascript:/data:/vbscript: 等)一律置空 —— 与默认行为一致,
 * 但本地路径不被丢弃(Cindy trustedUrlTransform 同款思路)。
 */
const ALLOWED_URL_SCHEME_RE = /^(https?:|mailto:|file:)/i;
const WINDOWS_ABS_RE = /^[A-Za-z]:[\\/]/;

function safeUrlTransform(url: string): string {
    if (!url) return "";
    if (ALLOWED_URL_SCHEME_RE.test(url)) return url;
    if (WINDOWS_ABS_RE.test(url)) return url; // 本地绝对路径
    if (/^[./~]/.test(url) || url.startsWith("\\")) return url; // 相对/家目录
    if (/^(?:[A-Za-z]:[\\/])/.test(url)) return url;
    if (/^[^:]+$/.test(url)) return url; // 无 scheme(相对链接)
    return ""; // javascript: / data: / vbscript: 等危险 scheme
}

/** 触发工作区文件打开(App.tsx 已监听 workspace:open-file)。 */
function dispatchOpenFile(path: string): void {
    window.dispatchEvent(new CustomEvent("workspace:open-file", { detail: { path } }));
}

/** 行内 code: 内容像文件路径 → 可点打开。 */
function InlineCode({ children, ...props }: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
    const text = useMemo(() => {
        let acc = "";
        React.Children.forEach(children, (c) => {
            if (typeof c === "string") acc += c;
        });
        return acc.trim();
    }, [children]);
    const clickable = isLocalPath(text);
    if (!clickable) {
        return <code className="markdown-inline-code" {...props}>{children}</code>;
    }
    return (
        <code
            className="markdown-inline-code markdown-path-link"
            title={text}
            onClick={(e) => {
                e.preventDefault();
                dispatchOpenFile(text);
            }}
        >
            {children}
        </code>
    );
}

/** 链接: 本地路径 → 打开文件; 外链 → 默认(新窗口, urlTransform 已拦截危险协议)。 */
function MarkdownLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element {
    const path = href && isLocalPath(href) ? href : null;
    if (path) {
        return (
            <a
                href={href}
                {...props}
                onClick={(e) => {
                    e.preventDefault();
                    dispatchOpenFile(path);
                }}
            >
                {children}
            </a>
        );
    }
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
        </a>
    );
}

// 模块级组件表(引用稳定, 避免 react-markdown 每 tick 重建 components)。
// code 渲染器需要 isStreaming, 因此放在实例级(见下方 components useMemo)。
const baseComponents: Components = {
    pre({ children }) {
        // 剥掉默认 <pre>, 由 CodeBlockCard 接管(避免双重 <pre> 嵌套)。
        return <>{children}</>;
    },
    code({ className, children, ...props }) {
        return <InlineCode className={className} {...props}>{children}</InlineCode>;
    },
    table({ children, ...props }) {
        return (
            <div className="markdown-table-wrap">
                <table {...props}>{children}</table>
            </div>
        );
    },
    th({ children, ...props }) {
        return <th className="markdown-th" {...props}>{children}</th>;
    },
    td({ children, ...props }) {
        return <td className="markdown-td" {...props}>{children}</td>;
    },
    p({ children, ...props }) {
        return <p className="markdown-p" {...props}>{children}</p>;
    },
    ul({ children, ...props }) {
        return <ul className="markdown-ul" {...props}>{children}</ul>;
    },
    ol({ children, ...props }) {
        return <ol className="markdown-ol" {...props}>{children}</ol>;
    },
    li({ children, ...props }) {
        return <li className="markdown-li" {...props}>{children}</li>;
    },
    h1({ children, ...props }) { return <h1 className="markdown-h1" {...props}>{children}</h1>; },
    h2({ children, ...props }) { return <h2 className="markdown-h2" {...props}>{children}</h2>; },
    h3({ children, ...props }) { return <h3 className="markdown-h3" {...props}>{children}</h3>; },
    h4({ children, ...props }) { return <h4 className="markdown-h4" {...props}>{children}</h4>; },
    h5({ children, ...props }) { return <h5 className="markdown-h5" {...props}>{children}</h5>; },
    h6({ children, ...props }) { return <h6 className="markdown-h6" {...props}>{children}</h6>; },
    blockquote({ children, ...props }) {
        return <blockquote className="markdown-blockquote" {...props}>{children}</blockquote>;
    },
    strong({ children, ...props }) {
        return <strong {...props}>{children}</strong>;
    },
    a({ href, children, ...props }) {
        return <MarkdownLink href={href} {...props}>{children}</MarkdownLink>;
    },
    img({ src, alt, ...props }) {
        return <img src={src} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    hr() {
        return <hr className="markdown-hr" />;
    },
};

const REMARK_PLUGINS = [
    remarkGfm,
    remarkMath,
];

const REHYPE_PLUGINS = [
    [rehypeKatex, { strict: "ignore", throwOnError: false }],
    rehypeHighlight,
];

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
    content,
    isStreaming = false,
}: MarkdownRendererProps): React.JSX.Element {
    // 流式动效总开关(默认关) + reduced-motion: 三条件 AND 才启用词级淡入。
    const reducedMotion = useMemo(
        () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        [],
    );
    const streamFadeEnabled = useSettingsStore((s) => s.settings.streamFadeEnabled === true);
    const streamFade = isStreaming && !reducedMotion && streamFadeEnabled;

    // 流式 100ms 节流: 流式期间不每帧全量解析 markdown。
    const throttledContent = useStreamingThrottle(content, isStreaming);
    // 未闭合语法修复: 仅流式 + 动效开启时(与动效配套, 消除结构翻转源); 终稿恒用原文。
    const repairedContent = useMemo(
        () => (streamFade ? repairStreamingMarkdown(throttledContent) : throttledContent),
        [streamFade, throttledContent],
    );
    const renderedContent = useMemo(
        () => normalizeMathDelimiters(repairedContent),
        [repairedContent],
    );

    // 词级淡入插件: 状态按渲染器实例持有, 流式结束回落常量链。
    const wordFade = useMemo<{ state: WordFadeState; plugins: unknown[] } | null>(() => {
        if (!streamFade) return null;
        const state = createWordFadeState();
        return {
            state,
            plugins: [...REHYPE_PLUGINS, [rehypeStreamWordFade, state]],
        };
    }, [streamFade]);
    const rehypePlugins = wordFade?.plugins ?? REHYPE_PLUGINS;
    const handleWordFadeAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
        if (wordFade) markSettledFromAnimationEnd(wordFade.state, event.nativeEvent);
    }, [wordFade]);

    // 实例级 code 渲染器(需要 isStreaming 决定代码块是否走卡片)。
    const components = useMemo<Components>(() => ({
        ...baseComponents,
        code({ className, children, ...props }) {
            const langMatch = (className ?? "").match(/(?:^|\s)language-([^\s]+)/);
            const lang = langMatch?.[1]?.toLowerCase() ?? "";
            const raw = String(React.Children.toArray(children).join(""));
            const isBlock = Boolean(className?.includes("language-")) || raw.includes("\n");
            if (isBlock) {
                // 代码块: 交 CodeBlockCard 渲染。rehype-highlight 已注入 hljs class,
                // 流式中围栏未闭合时不高亮(闭合后自动高亮)。
                return (
                    <CodeBlockCard lang={lang || "text"} className={className} isStreaming={isStreaming}>
                        {children}
                    </CodeBlockCard>
                );
            }
            return <InlineCode className={className} {...props}>{children}</InlineCode>;
        },
    }), [isStreaming]);

    return (
        <div
            className="markdown-body max-w-none select-text"
            data-streaming={isStreaming ? "true" : "false"}
            onAnimationEnd={handleWordFadeAnimationEnd}
        >
            <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS as never}
                rehypePlugins={rehypePlugins as never}
                components={components}
                urlTransform={safeUrlTransform}
            >
                {renderedContent}
            </ReactMarkdown>
        </div>
    );
});
