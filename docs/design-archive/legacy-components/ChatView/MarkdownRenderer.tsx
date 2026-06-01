// Markdown Renderer Component

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { CodeBlock } from './CodeBlock';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): React.JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={{
          code(props: any) {
            const { node, className, children, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            // Check if this is inline code (parent is not <pre>)
            const isInline = node?.parentElement?.tagName !== 'PRE';
            
            if (!isInline && language) {
              return (
                <CodeBlock
                  language={language}
                  value={String(children).replace(/\n$/, '')}
                />
              );
            }
            
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          a({ node, children, ...props }) {
            return (
              <a
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}