// MarkdownRenderer (M7-4)
// 轻量 markdown 渲染: 用 react-markdown + rehype-highlight
// 支持代码块高亮 (M2 装的依赖)

import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

interface MarkdownRendererProps {
    content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): React.ReactElement {
    return (
        <div className="prose prose-sm max-w-none">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
        </div>
    );
}
