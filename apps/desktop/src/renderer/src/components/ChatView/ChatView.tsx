// 聊天主区域 - 欢迎屏幕 + 消息列表 + 输入框

import React, { useRef, useEffect } from 'react';
import { usePiDriver } from '../../hooks/usePiDriver';
import { useSessionStore } from '../../stores/session-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

export function ChatView(): React.JSX.Element {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isConnected, isProcessing, sendMessage, stopProcessing } = usePiDriver();
  const { getCurrentSession, createSession } = useSessionStore();
  const { getCurrentWorkspace } = useWorkspaceStore();

  const currentSession = getCurrentSession();
  const currentWorkspace = getCurrentWorkspace();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  useEffect(() => {
    if (!currentSession && currentWorkspace) {
      createSession(currentWorkspace.id);
    }
  }, [currentSession, currentWorkspace, createSession]);

  const handleSend = async (message: string) => {
    await sendMessage(message);
  };

  const messages = currentSession?.messages || [];

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* 欢迎屏幕 */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16">
            {/* Logo */}
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-6">
              <span className="text-white font-bold text-2xl">π</span>
            </div>

            {/* 标题 */}
            <h2 className="text-xl font-semibold text-[#1a1a1a] mb-2">
              准备好开始了吗？
            </h2>

            {/* 副标题 */}
            <p className="text-sm text-[#666] max-w-md mb-8">
              描述你想要构建或修改的内容，Pi 会为你创建一个独立的工作环境。
            </p>

            {/* 操作卡片 */}
            <div className="flex flex-wrap justify-center gap-3">
              {[
                { icon: '🚀', title: '新建功能', desc: '描述你想要添加的功能' },
                { icon: '🐛', title: '修复问题', desc: '描述你遇到的bug' },
                { icon: '🔍', title: '代码审查', desc: '让AI审查你的代码' },
                { icon: '📖', title: '解释代码', desc: '让AI解释复杂代码' },
              ].map((card, index) => (
                <button
                  key={index}
                  className="w-[180px] p-4 bg-white border border-[#e5e5e5] rounded-xl text-left hover:bg-[#f5f5f5] hover:border-[#d1d5db] transition-all"
                >
                  <div className="text-xl mb-2">{card.icon}</div>
                  <div className="text-sm font-medium text-[#1a1a1a] mb-1">{card.title}</div>
                  <div className="text-xs text-[#999]">{card.desc}</div>
                </button>
              ))}
            </div>

            {/* 错误提示 */}
            {!isConnected && (
              <div className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 bg-[#fef2f2] border border-[#fecaca] rounded-lg">
                <svg className="w-4 h-4 text-[#ef4444]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="text-sm text-[#ef4444]">Pi CLI 未连接。请确保 `pi` 已安装并添加到系统路径。</span>
              </div>
            )}
          </div>
        ) : (
          /* 消息列表 */
          <div className="p-6 space-y-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* 处理中指示器 */}
            {isProcessing && (
              <div className="flex justify-start">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-xs">π</span>
                  </div>
                  <div className="bg-white border border-[#e5e5e5] rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <button
                        onClick={stopProcessing}
                        className="ml-3 text-xs text-[#666] hover:text-[#1a1a1a] transition-colors"
                      >
                        停止
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <ChatInput
        isConnected={isConnected}
        isProcessing={isProcessing}
        onSend={handleSend}
        onStop={stopProcessing}
      />
    </div>
  );
}
