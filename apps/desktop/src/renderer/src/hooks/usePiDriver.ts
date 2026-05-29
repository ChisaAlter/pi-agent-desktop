// usePiDriver Hook - Manages Pi CLI interaction

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionStore, Message } from '../stores/session-store';

interface PiDriverStatus {
  isRunning: boolean;
  pid?: number;
  workspacePath: string;
}

interface UsePiDriverReturn {
  isConnected: boolean;
  isProcessing: boolean;
  status: PiDriverStatus | null;
  sendMessage: (content: string) => Promise<void>;
  stopProcessing: () => void;
}

export function usePiDriver(): UsePiDriverReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<PiDriverStatus | null>(null);
  // Store actions are accessed via useSessionStore.getState() in event handlers
  // to avoid stale closure references
  const currentMessageRef = useRef<string | null>(null);
  const contentRef = useRef<string>('');
  
  // Check connection status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        if (window.piAPI) {
          const status = await window.piAPI.getStatus();
          setStatus(status);
          setIsConnected(status.isRunning);
        }
      } catch (error) {
        console.error('Failed to get Pi status:', error);
        setIsConnected(false);
      }
    };
    
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Listen for Pi events
  useEffect(() => {
    if (!window.piAPI) {
      console.warn('[usePiDriver] window.piAPI not available');
      return;
    }
    
    console.log('[usePiDriver] Setting up event listener');
    
    const unsubscribe = window.piAPI.onEvent((event) => {
      console.log('[Pi Event]', event.type, event.type === 'text_delta' ? `len=${(event.text || '').length}` : '');
      
      switch (event.type) {
        case 'text_start':
          // Start of text generation - reset content accumulator
          contentRef.current = '';
          console.log('[Pi Event] text_start received, content reset');
          break;
          
        case 'text_delta': {
          // 使用函数式更新获取最新状态
          const currentSession = useSessionStore.getState().getCurrentSession();
          if (!currentSession || !currentMessageRef.current) {
            console.warn('[Pi Event] text_delta ignored: no session or message ref', { 
              hasSession: !!currentSession, 
              messageRef: currentMessageRef.current 
            });
            return;
          }
          
          // Append text to current message
          contentRef.current += event.text || '';
          console.log('[Pi Event] Updating message content, length:', contentRef.current.length);
          useSessionStore.getState().updateMessage(
            currentSession.id,
            currentMessageRef.current,
            {
              content: contentRef.current
            }
          );
          break;
        }
          
        case 'toolcall_start': {
          // Add tool call to current message
          const toolCallId = Date.now().toString();
          const tcStartSession = useSessionStore.getState().getCurrentSession();
          if (!tcStartSession || !currentMessageRef.current) return;
          const currentMsg = tcStartSession.messages.find(m => m.id === currentMessageRef.current);
          useSessionStore.getState().updateMessage(
            tcStartSession.id,
            currentMessageRef.current,
            {
              toolCalls: [
                ...(currentMsg?.toolCalls || []),
                {
                  id: toolCallId,
                  name: event.tool,
                  input: event.input,
                  status: 'running',
                  startTime: new Date()
                }
              ]
            }
          );
          break;
        }
          
        case 'toolcall_end': {
          // Update tool call status - match by tool name, find last running one
          const tcEndSession = useSessionStore.getState().getCurrentSession();
          if (!tcEndSession || !currentMessageRef.current) return;
          const tcEndMsg = tcEndSession.messages.find(m => m.id === currentMessageRef.current);
          if (tcEndMsg?.toolCalls) {
            // Find the last running tool call matching this tool name (or any running if no name match)
            const matchingToolCall = [...tcEndMsg.toolCalls].reverse().find(tc =>
              tc.status === 'running' && (!event.tool || tc.name === event.tool)
            ) || tcEndMsg.toolCalls.find(tc => tc.status === 'running');
            if (matchingToolCall) {
              useSessionStore.getState().updateMessage(
                tcEndSession.id,
                currentMessageRef.current,
                {
                  toolCalls: tcEndMsg.toolCalls.map(tc => 
                    tc.id === matchingToolCall.id 
                      ? { ...tc, output: event.result, status: 'completed', endTime: new Date() }
                      : tc
                  )
                }
              );
            }
          }
          break;
        }
          
        case 'turn_end':
          console.log('[Pi Event] turn_end received, content length:', contentRef.current.length);
          setIsProcessing(false);
          currentMessageRef.current = null;
          contentRef.current = '';
          break;
          
        case 'error':
          console.error('Pi error:', event.message);
          setIsProcessing(false);
          currentMessageRef.current = null;
          contentRef.current = '';
          break;
      }
    });
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);
  
  const sendMessage = useCallback(async (content: string) => {
    if (!window.piAPI) return;
    
    try {
      setIsProcessing(true);
      
      // Get or create session using latest store state
      let currentSession = useSessionStore.getState().getCurrentSession();
      if (!currentSession) {
        currentSession = useSessionStore.getState().createSession('default');
      }
      
      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date()
      };
      useSessionStore.getState().addMessage(currentSession.id, userMessage);
      
      // Create assistant message placeholder
      const assistantMessageId = (Date.now() + 1).toString();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date()
      };
      useSessionStore.getState().addMessage(currentSession.id, assistantMessage);
      
      // Reset content accumulator before setting message ref
      contentRef.current = '';
      
      // Set message ref AFTER adding to store to avoid race condition
      currentMessageRef.current = assistantMessageId;
      
      // Send to Pi CLI - 不等待完成，让事件监听器处理后续
      // 不传递 sessionId，因为 --print 模式不需要会话
      window.piAPI.sendPrompt(content).catch((error) => {
        console.error('Failed to send message:', error);
        setIsProcessing(false);
        currentMessageRef.current = null;
        contentRef.current = '';
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsProcessing(false);
      currentMessageRef.current = null;
      contentRef.current = '';
    }
  }, []);
  
  const stopProcessing = useCallback(() => {
    if (window.piAPI) {
      window.piAPI.stop();
    }
    setIsProcessing(false);
    currentMessageRef.current = null;
  }, []);
  
  return {
    isConnected,
    isProcessing,
    status,
    sendMessage,
    stopProcessing
  };
}