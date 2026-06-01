// Code Block Component

import React, { useState } from 'react';

interface CodeBlockProps {
  language: string;
  value: string;
}

export function CodeBlock({ language, value }: CodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  return (
    <div className="relative group my-4 rounded-lg border border-[#e5e5e5] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-[#f5f5f5] px-4 py-2 border-b border-[#e5e5e5]">
        <span className="text-xs text-[#666666]" style={{ fontFamily: 'var(--font-mono)' }}>
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-[#666666] hover:text-[#1a1a1a] transition-colors"
          title={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-[#10b981]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[#10b981]">已复制</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      
      {/* Code */}
      <pre className="bg-[#fafafa] p-4 overflow-x-auto m-0 border-0 rounded-none">
        <code
          className={`language-${language} text-sm`}
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {value}
        </code>
      </pre>
    </div>
  );
}
