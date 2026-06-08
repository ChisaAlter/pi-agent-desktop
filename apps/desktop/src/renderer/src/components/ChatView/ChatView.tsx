// 聊天主区域 - 空态 + 消息列表 + 输入框
// v1.0.4: 用户可见文案走 t()

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { usePiStream } from '../../hooks/usePiStream';
import { useSessionStore } from '../../stores/session-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { usePiStatusStore } from '../../stores/pi-status-store';
import { useAgentStore } from '../../stores/agent-store';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { useI18n } from '../../i18n';
import { PlanCardView } from './PlanCard';

interface ChatViewProps {
    /** v1.0.14: 外部注入的预填文本(由 App.tsx 监听 'chatpanel:prefill' 事件传来,用于跨组件切到 chat 时把 prompt 灌进 ChatInput) */
    prefillText?: string | null;
    /** prefill 已被 ChatInput 消费后回调 */
    onPrefillConsumed?: () => void;
}

export function ChatView({ prefillText, onPrefillConsumed }: ChatViewProps = {}): React.JSX.Element {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentId = useAgentStore((state) => state.currentAgentId);
  const {
    isStreaming,
    isConnected,
    streamingMessageId,
    startStreaming,
    stopStreaming,
    clearError,
    error: streamError,
  } = usePiStream(agentId);
  const { getCurrentWorkspace } = useWorkspaceStore();
  const {
    init: initAgents,
    getCurrentAgent,
    getCurrentMessages,
    sendPrompt: sendAgentPrompt,
    stopAgent,
  } = useAgentStore();
  const { getCurrentSession, createSession } = useSessionStore();
  const { install, isOperating, progress } = usePiStatusStore();
  const { t } = useI18n();

  const currentSession = getCurrentSession();
  const currentWorkspace = getCurrentWorkspace();
  const currentAgent = getCurrentAgent();
  const agentMessages = getCurrentMessages();
  const hasAgent = Boolean(currentAgent);
  const messages = useMemo(() => hasAgent
    ? agentMessages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" || message.role === "system" || message.role === "user" ? message.role : "system",
        content: message.content,
        timestamp: new Date(message.createdAt),
        thinking: message.thinking,
      }))
    : currentSession?.messages || [], [agentMessages, currentSession?.messages, hasAgent]);
  const isAgentStreaming = currentAgent?.status === "running" || currentAgent?.status === "starting";
  const processing = hasAgent ? isAgentStreaming : isStreaming;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    void initAgents();
  }, [initAgents]);

  useEffect(() => {
    if (!currentSession && currentWorkspace) {
      createSession(currentWorkspace.id);
    }
  }, [currentSession, currentWorkspace, createSession]);


  useEffect(() => {
    clearError();
  }, [currentSession?.id, clearError]);

  const handleSend = async (message: string) => {
    if (!currentWorkspace) return;
    if (currentAgent) {
      await sendAgentPrompt(message);
      return;
    }
    await startStreaming(currentWorkspace.id, message);
  };

  const handleStop = async () => {
    if (currentAgent) {
      await stopAgent(currentAgent.id);
      return;
    }
    await stopStreaming();
  };

  // 外部预填文本，光标停在末尾方便用户继续。
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>({ text: '', nonce: 0 });
  // v1.0.14: 外部传进来的 prefillText(走 'chatpanel:prefill' 事件)
  //  - 用 Date.now() 做 nonce 保证 effect 重跑
  //  - 消费后回调 onPrefillConsumed 让 App 清 state
  useEffect(() => {
    if (typeof prefillText === 'string' && prefillText.length > 0) {
      setPrefill({ text: prefillText, nonce: Date.now() });
      onPrefillConsumed?.();
    }
  }, [prefillText, onPrefillConsumed]);

  return (
    <div className="flex-1 flex flex-col h-full">
      {messages.length > 0 && (
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="mx-auto flex w-full max-w-[770px] items-center gap-2 text-sm text-[#333]">
            <svg className="h-4 w-4 text-[#9a9a9a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            <span className="truncate font-medium">{currentAgent?.title || currentSession?.title || "未命名会话"}</span>
            <svg className="h-3 w-3 text-[#aaa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      )}
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* 欢迎屏幕 */
          <div className="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
            {/* Logo */}
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1f1f1f]">
              <span className="text-white font-bold text-2xl">π</span>
            </div>

            {/* 标题 */}
            <h2 className="text-xl font-normal text-[#1a1a1a] mb-2">
              {t('chatView.welcome.title')}
            </h2>

            {/* 副标题 */}
            <p className="text-sm text-[#666] max-w-md mb-8">
              {t('chatView.welcome.subtitle')}
            </p>

            <div className="w-full max-w-[900px]">
              <ChatInput
                isConnected={isConnected}
                isProcessing={processing}
                onSend={handleSend}
                onStop={handleStop}
                workspaceId={currentWorkspace?.id}
                workspacePath={currentWorkspace?.path}
                prefill={prefill.text}
                prefillKey={prefill.nonce}
                onPrefillConsumed={() => setPrefill((p) => ({ ...p, text: '' }))}
              />
            </div>

            {/* 错误提示 — 强 CTA：未装 Pi CLI 时引导用户立即安装 */}
            {!isConnected && (
              <div
                className="mt-6 max-w-md w-full inline-flex flex-col gap-3 px-4 py-4 bg-[#fef2f2] border border-[#fecaca] rounded-lg text-left"
                role="alert"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#ef4444] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-sm text-[#ef4444] font-medium">
                    {t('chatView.piCliMissing.title')}
                  </span>
                </div>
                <p className="text-xs text-[#666]">
                  {t('chatView.piCliMissing.description')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void install()}
                    disabled={isOperating}
                    className="flex-1 px-4 py-2 bg-[#ef4444] text-white rounded-md hover:bg-[#dc2626] transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {isOperating
                      ? progress?.percent != null
                        ? t('chatView.piCliMissing.installingProgress', { percent: progress.percent })
                        : t('chatView.piCliMissing.installingEllipsis')
                      : t('chatView.piCliMissing.install')}
                  </button>
                  <button
                    onClick={() => window.open("https://github.com/badlogic/pi-mono", "_blank")}
                    className="px-4 py-2 bg-white border border-[#fecaca] text-[#666] rounded-md hover:bg-[#fef2f2] transition-colors text-sm"
                  >
                    {t('chatView.piCliMissing.viewDocs')}
                  </button>
                </div>
              </div>
            )}

            {/* Chat send 失败的错误 — 重试按钮 */}
            {isConnected && streamError && (
              <div
                className="mt-6 max-w-md w-full inline-flex flex-col gap-3 px-4 py-4 bg-[#fef2f2] border border-[#fecaca] rounded-lg text-left"
                role="alert"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#ef4444] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-sm text-[#ef4444] font-medium">
                    {t('chatView.sendFailed.title')}
                  </span>
                </div>
                <p className="text-xs text-[#666] break-all font-mono">{streamError}</p>
                <button
                  onClick={clearError}
                  className="px-4 py-2 bg-[#1a1a1a] text-white rounded-md hover:bg-[#333] transition-colors text-sm font-medium self-start"
                >
                  {t('chatView.sendFailed.retry')}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* 消息列表 */
          <div
            className="mx-auto max-w-[740px] space-y-5 px-0 py-5"
            role="log"
            aria-live="polite"
            aria-label={t('chatView.messagesAria')}
            aria-busy={processing}
          >
            <PlanCardView workspaceId={currentWorkspace?.id} onExecute={handleSend} />

            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={!hasAgent && isStreaming && message.id === streamingMessageId}
              />
            ))}

            {/* 流式处理中指示器（仅在没有 assistant 消息占位符时显示） */}
            {processing && (!streamingMessageId || hasAgent) && (
              <div
                className="flex justify-start"
                role="status"
                aria-label={t('chatView.streamIndicator')}
                aria-busy="true"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" aria-hidden="true" />
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} aria-hidden="true" />
                      <div className="w-2 h-2 bg-[#999] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} aria-hidden="true" />
                      <button
                        type="button"
                        onClick={handleStop}
                        className="ml-3 text-xs text-[#666] hover:text-[#1a1a1a] transition-colors"
                        aria-label={t('chatView.stopGeneration')}
                      >
                        {t('chatView.stop')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {streamError && (
              <div
                className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-left"
                role="alert"
              >
                <div className="mb-1 text-sm font-medium text-[#ef4444]">
                  {t('chatView.sendFailed.title')}
                </div>
                <p className="break-all font-mono text-xs text-[#666]">{streamError}</p>
                <button
                  type="button"
                  onClick={clearError}
                  className="mt-2 rounded-md bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#333]"
                >
                  {t('chatView.sendFailed.retry')}
                </button>
              </div>
            )}

            {/* 回到顶部按钮 */}
            {messages.length > 5 && (
              <button
                type="button"
                onClick={() => {
                  const container = messagesEndRef.current?.parentElement;
                  container?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-[#e5e5e5] shadow-sm text-[#666] hover:text-[#1a1a1a] transition-all"
                aria-label="回到顶部"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <ChatInput
          isConnected={isConnected}
          isProcessing={processing}
          onSend={handleSend}
          onStop={handleStop}
          workspaceId={currentWorkspace?.id}
          workspacePath={currentWorkspace?.path}
          prefill={prefill.text}
          prefillKey={prefill.nonce}
          onPrefillConsumed={() => setPrefill((p) => ({ ...p, text: '' }))}
        />
      )}
    </div>
  );
}

