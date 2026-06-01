// 输入区域 - 圆角输入框 + 附件按钮 + 模型选择 + 发送按钮

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings-store';

interface ChatInputProps {
  isConnected: boolean;
  isProcessing: boolean;
  onSend: (message: string) => Promise<void>;
  onStop: () => void;
}

export function ChatInput({ isConnected, isProcessing, onSend, onStop }: ChatInputProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings } = useSettingsStore();
  const [permission] = useState('完全访问权限');

  // 自动调整 textarea 高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const maxHeight = 200; // 最大高度 200px
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const handleSend = async () => {
    if (!inputValue.trim() || isProcessing) return;
    await onSend(inputValue.trim());
    setInputValue('');
    // 发送后重置高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 bg-white border-t border-[#e5e5e5]">
      <div className="max-w-3xl mx-auto">
        {/* 输入框 */}
        <div className="flex gap-3 mb-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? '描述你想要构建或修改的内容...' : 'Pi CLI 未连接，请确保 pi 已安装并添加到系统路径'}
            className="flex-1 px-4 py-3 bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#999] resize-none focus:outline-none focus:border-[#1a1a1a] disabled:opacity-50 min-h-[48px] leading-relaxed"
            rows={1}
            disabled={isProcessing || !isConnected}
          />
          <button
            onClick={isProcessing ? onStop : handleSend}
            disabled={!isProcessing && (!inputValue.trim() || !isConnected)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 self-end ${
              isProcessing
                ? 'bg-[#ef4444] hover:bg-[#dc2626] text-white'
                : 'bg-[#1a1a1a] hover:bg-[#333] text-white disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            {isProcessing ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>

        {/* 控制栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-xs text-[#666] hover:bg-[#f0f0f0] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              附件
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-xs text-[#666] cursor-pointer hover:bg-[#f0f0f0] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>{permission}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 快捷键提示 */}
            <div className="flex items-center gap-1.5 text-xs text-[#999]">
              <kbd className="px-1.5 py-0.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-[10px] font-mono">Enter</kbd>
              <span>发送</span>
              <span className="mx-1 text-[#e5e5e5]">/</span>
              <kbd className="px-1.5 py-0.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-[10px] font-mono">Shift</kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-[10px] font-mono">Enter</kbd>
              <span>换行</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-xs text-[#666] cursor-pointer hover:bg-[#f0f0f0] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>{settings.model}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
