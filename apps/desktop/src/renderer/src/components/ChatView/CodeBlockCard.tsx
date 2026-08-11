// 代码块卡片 — Cindy CodeBlockPre 同构
// 圆角卡片 + 边框 + 底色(明暗 token) + 折行(不横滚) + 右上 hover 复制按钮。
// 复制从 <pre> 的 innerText 读取, 流式中也能复制到最新内容。

import React, { useRef, useState } from "react";
import { useI18n } from "../../i18n";

interface CodeBlockCardProps {
    /** 语言标识(来自 rehype-highlight 的 language-* class, 可能为空)。 */
    lang?: string;
    /** <pre> 的 className(含 hljs 高亮 class 与 language-* class)。 */
    className?: string;
    children?: React.ReactNode;
    /** 是否正在流式(流式中不高亮, 由 rehype-highlight 对闭合围栏自动处理)。 */
    isStreaming?: boolean;
}

export const CodeBlockCard = React.memo(function CodeBlockCard({
    lang,
    className,
    children,
    isStreaming = false,
}: CodeBlockCardProps): React.JSX.Element {
    const { t } = useI18n();
    const preRef = useRef<HTMLPreElement>(null);
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        return () => {
            if (timerRef.current !== null) clearTimeout(timerRef.current);
        };
    }, []);

    const handleCopy = async (): Promise<void> => {
        // innerText 在 jsdom 下支持有限, 回退 textContent。
        const text = preRef.current?.innerText ?? preRef.current?.textContent ?? "";
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 1500);
        } catch {
            // 剪贴板不可用时静默失败(与 MessageBubble 的复制行为一致)
        }
    };

    return (
        <div className="group relative my-3" data-streaming={isStreaming ? "true" : "false"}>
            {lang && (
                <div className="markdown-code-header">
                    <span className="markdown-code-lang">{lang}</span>
                </div>
            )}
            <pre
                ref={preRef}
                className={`markdown-code-pre ${className ?? ""}`}
                data-lang={lang ?? ""}
            >
                <code className={className ?? ""}>{children}</code>
            </pre>
            <button
                type="button"
                onClick={() => void handleCopy()}
                aria-label={copied ? t("codeBlock.copied") : t("codeBlock.copy")}
                title={copied ? t("codeBlock.copied") : t("codeBlock.copy")}
                className="markdown-code-copy"
            >
                {copied ? (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                )}
            </button>
        </div>
    );
});
