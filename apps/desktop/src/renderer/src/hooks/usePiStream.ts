// usePiStream Hook - 管理 Pi 流式状态
//
// 监听 Pi CLI 的结构化 JSON 事件，累积 thinking/text 内容，
// 管理工具调用状态机，并在 turn_end 时将结果打包为完整消息。
//
// 如果 onPiJsonEvent API 不可用，优雅降级到旧的 onEvent API。
//
// 文件变更审批: 拦截 write/edit 工具调用，创建审批条目，
// 当 autoApprove 为 false 时等待用户审批后再继续。

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionStore, Message, ToolCall } from '../stores/session-store';
import { useApprovalStore, generateWriteDiff, generateEditDiff } from '../stores/approval-store';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface ToolCallState {
  id: string;
  name: string;
  args: any;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
  startTime: Date;
  endTime?: Date;
  /** 关联的审批 change ID (仅 write/edit) */
  approvalChangeId?: string;
}

export interface PiStreamState {
  isStreaming: boolean;
  /** 当前累积的思考内容 */
  currentThinking: string;
  /** 当前累积的文本内容 */
  currentText: string;
  /** 当前轮次的工具调用 */
  toolCalls: Map<string, ToolCallState>;
  /** 错误信息 */
  error: string | null;
  /** 是否已连接到 Pi CLI */
  isConnected: boolean;
  /** 当前流式消息 ID（用于实时更新 UI） */
  streamingMessageId: string | null;
}

export interface UsePiStreamReturn extends PiStreamState {
  /** 发送消息并开始流式接收 */
  startStreaming: (content: string) => Promise<void>;
  /** 停止当前流式处理 */
  stopStreaming: () => void;
}

// ── 结构化 JSON 事件类型（onPiJsonEvent 通道） ───────────────────────────────

interface PiJsonEvent {
  type: string;
  subtype?: string;
  [key: string]: any;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePiStream(): UsePiStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentThinking, setCurrentThinking] = useState('');
  const [currentText, setCurrentText] = useState('');
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  // Refs 用于事件回调中访问最新值，避免 stale closure
  const thinkingRef = useRef('');
  const textRef = useRef('');
  const toolCallsRef = useRef(new Map<string, ToolCallState>());
  const messageRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ── 连接状态检查 ──────────────────────────────────────────────────────────

  useEffect(() => {
    const checkStatus = async () => {
      try {
        if (window.piAPI) {
          const status = await window.piAPI.getStatus();
          setIsConnected(status.installed);
        }
      } catch {
        setIsConnected(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── 事件监听（优先 onPiJsonEvent，降级到 onEvent） ─────────────────────────

  useEffect(() => {
    if (!window.piAPI) return;

    // 检查是否有 onPiJsonEvent API
    const hasJsonEvent = typeof (window.piAPI as any).onPiJsonEvent === 'function';

    if (hasJsonEvent) {
      console.log('[usePiStream] Using onPiJsonEvent (structured events)');
      const unsubscribe = (window.piAPI as any).onPiJsonEvent((event: PiJsonEvent) => {
        handleJsonEvent(event);
      });
      return () => { if (unsubscribe) unsubscribe(); };
    }

    // 降级：使用旧的 onEvent API
    console.log('[usePiStream] Falling back to onEvent (legacy)');
    const unsubscribe = window.piAPI.onEvent((event: any) => {
      handleLegacyEvent(event);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  // ── 文件变更审批辅助 ──────────────────────────────────────────────────────

  /**
   * 如果是 write/edit 工具调用，创建审批条目并生成 diff。
   * 返回 approvalChangeId (如果有)。
   */
  const handleFileChangeApproval = useCallback((toolCallId: string, toolName: string, args: any): string | undefined => {
    if (toolName !== 'write' && toolName !== 'edit') return undefined;

    const approvalStore = useApprovalStore.getState();
    const filePath: string = args?.file_path || args?.path || args?.filePath || '';

    if (!filePath) {
      console.warn('[usePiStream] write/edit tool call without file path:', args);
      return undefined;
    }

    let diff: string | undefined;

    if (toolName === 'write') {
      const newContent: string = args?.content || args?.file_text || '';
      // TODO: 读取原始文件内容 (需要 main process 支持)
      // 目前用 undefined 表示新文件或未知原始内容
      diff = generateWriteDiff(filePath, undefined, newContent);
    } else if (toolName === 'edit') {
      const oldString: string = args?.old_string || args?.oldString || '';
      const newString: string = args?.new_string || args?.newString || '';
      diff = generateEditDiff(filePath, oldString, newString);
    }

    const changeId = approvalStore.addChange({
      toolCallId,
      toolName: toolName as 'write' | 'edit',
      filePath,
      newContent: toolName === 'write' ? (args?.content || args?.file_text) : undefined,
      oldString: toolName === 'edit' ? (args?.old_string || args?.oldString) : undefined,
      newString: toolName === 'edit' ? (args?.new_string || args?.newString) : undefined,
      diff,
    });

    console.log(`[usePiStream] Created approval change ${changeId} for ${toolName} on ${filePath}`);

    // 如果不是自动审批，等待用户审批
    // 注意: 这不会阻塞 Pi CLI 的实际执行（需要 main process 支持）
    // 但会记录审批状态供 UI 使用
    if (!approvalStore.autoApprove) {
      approvalStore.waitForApproval(changeId).then((approved) => {
        console.log(`[usePiStream] Change ${changeId} ${approved ? 'approved' : 'rejected'}`);
      });
    }

    return changeId;
  }, []);

  // ── 结构化 JSON 事件处理 ─────────────────────────────────────────────────

  const handleJsonEvent = useCallback((event: PiJsonEvent) => {
    console.log('[usePiStream:json]', event.type, event.subtype || '');

    switch (event.type) {
      case 'message_update': {
        const subtype = event.subtype || '';
        if (subtype === 'thinking_delta') {
          // 累积思考内容
          thinkingRef.current += event.delta || event.text || '';
          setCurrentThinking(thinkingRef.current);
        } else if (subtype === 'text_delta') {
          // 累积文本内容
          textRef.current += event.delta || event.text || '';
          setCurrentText(textRef.current);
          // 实时更新 store 中的消息
          updateStreamingMessage();
        } else if (subtype === 'toolcall_start') {
          addToolCall(event);
        } else if (subtype === 'toolcall_end') {
          completeToolCall(event);
        }
        break;
      }

      case 'tool_execution_start': {
        addToolCall(event);
        break;
      }

      case 'tool_execution_end': {
        completeToolCall(event);
        break;
      }

      case 'turn_end': {
        finalizeStreaming();
        break;
      }

      case 'error': {
        setError(event.message || 'Unknown error');
        setIsStreaming(false);
        resetRefs();
        break;
      }
    }
  }, []);

  // ── 旧版事件处理（降级模式） ─────────────────────────────────────────────

  const handleLegacyEvent = useCallback((event: any) => {
    console.log('[usePiStream:legacy]', event.type);

    switch (event.type) {
      case 'text_start':
        // 重置内容累积器
        textRef.current = '';
        break;

      case 'text_delta': {
        textRef.current += event.text || '';
        setCurrentText(textRef.current);
        updateStreamingMessage();
        break;
      }

      case 'toolcall_start': {
        addToolCall({
          id: event.id || `tc_${Date.now()}`,
          name: event.tool || event.name || 'unknown',
          args: event.input || event.args,
        });
        break;
      }

      case 'toolcall_end': {
        completeToolCall({
          id: event.id,
          name: event.tool || event.name,
          result: event.result,
          status: 'completed',
        });
        break;
      }

      case 'turn_end': {
        finalizeStreaming();
        break;
      }

      case 'error': {
        setError(event.message || 'Unknown error');
        setIsStreaming(false);
        resetRefs();
        break;
      }
    }
  }, []);

  // ── 工具调用管理 ──────────────────────────────────────────────────────────

  const addToolCall = useCallback((event: any) => {
    const id = event.id || `tc_${Date.now()}`;
    const name = event.name || event.tool || 'unknown';
    const args = event.args || event.input;

    // 拦截 write/edit 工具调用，创建审批条目
    const approvalChangeId = handleFileChangeApproval(id, name, args);

    const newCall: ToolCallState = {
      id,
      name,
      args,
      status: 'running',
      startTime: new Date(),
      approvalChangeId,
    };
    const updated = new Map(toolCallsRef.current);
    updated.set(id, newCall);
    toolCallsRef.current = updated;
    setToolCalls(new Map(updated));
  }, [handleFileChangeApproval]);

  const completeToolCall = useCallback((event: any) => {
    const updated = new Map(toolCallsRef.current);

    // 尝试按 ID 匹配，否则找最后一个 running 的
    let target: ToolCallState | undefined;
    if (event.id && updated.has(event.id)) {
      target = updated.get(event.id);
    } else {
      // 找最后一个 running 状态的同名工具调用
      for (const tc of [...updated.values()].reverse()) {
        if (tc.status === 'running' && (!event.name || !event.tool || tc.name === (event.name || event.tool))) {
          target = tc;
          break;
        }
      }
    }

    if (target) {
      updated.set(target.id, {
        ...target,
        status: event.status || 'completed',
        result: event.result || event.output,
        endTime: new Date(),
      });
      toolCallsRef.current = updated;
      setToolCalls(new Map(updated));
    }
  }, []);

  // ── 实时更新 store 中的流式消息 ──────────────────────────────────────────

  const updateStreamingMessage = useCallback(() => {
    const msgId = messageRef.current;
    const sId = sessionIdRef.current;
    if (!msgId || !sId) return;

    const store = useSessionStore.getState();
    const tcArray: ToolCall[] = [];
    for (const tc of toolCallsRef.current.values()) {
      tcArray.push({
        id: tc.id,
        name: tc.name,
        input: tc.args,
        output: tc.result,
        status: tc.status,
        startTime: tc.startTime,
        endTime: tc.endTime,
      });
    }

    store.updateMessage(sId, msgId, {
      content: textRef.current,
      thinking: thinkingRef.current || undefined,
      toolCalls: tcArray.length > 0 ? tcArray : undefined,
    });
  }, []);

  // ── 流式完成：打包消息 ────────────────────────────────────────────────────

  const finalizeStreaming = useCallback(() => {
    const msgId = messageRef.current;
    const sId = sessionIdRef.current;

    if (msgId && sId) {
      // 最终更新一次消息（确保内容完整）
      updateStreamingMessage();
    }

    setIsStreaming(false);
    setStreamingMessageId(null);
    resetRefs();
  }, [updateStreamingMessage]);

  // ── 重置 refs ────────────────────────────────────────────────────────────

  const resetRefs = useCallback(() => {
    thinkingRef.current = '';
    textRef.current = '';
    toolCallsRef.current = new Map();
    messageRef.current = null;
    sessionIdRef.current = null;
    // 重置 state（延迟，避免与 finalize 中的更新冲突）
    setTimeout(() => {
      setCurrentThinking('');
      setCurrentText('');
      setToolCalls(new Map());
    }, 50);
  }, []);

  // ── 发送消息 ─────────────────────────────────────────────────────────────

  const startStreaming = useCallback(async (content: string) => {
    if (!window.piAPI) return;

    try {
      setIsStreaming(true);
      setError(null);
      setCurrentThinking('');
      setCurrentText('');
      setToolCalls(new Map());
      thinkingRef.current = '';
      textRef.current = '';
      toolCallsRef.current = new Map();

      // 获取或创建 session
      let currentSession = useSessionStore.getState().getCurrentSession();
      if (!currentSession) {
        currentSession = useSessionStore.getState().createSession('default');
      }
      sessionIdRef.current = currentSession.id;

      // 添加用户消息
      const userMessage: Message = {
        id: `user_${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
      };
      useSessionStore.getState().addMessage(currentSession.id, userMessage);

      // 创建 assistant 消息占位符
      const assistantMessageId = `assistant_${Date.now()}`;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };
      useSessionStore.getState().addMessage(currentSession.id, assistantMessage);
      messageRef.current = assistantMessageId;
      setStreamingMessageId(assistantMessageId);

      // 发送到 Pi CLI
      window.piAPI.sendPrompt(content).catch((err) => {
        console.error('[usePiStream] sendPrompt error:', err);
        setError(err.message || '发送失败');
        setIsStreaming(false);
        resetRefs();
      });
    } catch (err: any) {
      console.error('[usePiStream] startStreaming error:', err);
      setError(err.message || '发送失败');
      setIsStreaming(false);
      resetRefs();
    }
  }, [resetRefs]);

  // ── 停止流式处理 ──────────────────────────────────────────────────────────

  const stopStreaming = useCallback(() => {
    if (window.piAPI) {
      window.piAPI.stop();
    }
    setIsStreaming(false);
    setStreamingMessageId(null);
    resetRefs();
  }, [resetRefs]);

  return {
    isStreaming,
    currentThinking,
    currentText,
    toolCalls,
    error,
    isConnected,
    streamingMessageId,
    startStreaming,
    stopStreaming,
  };
}
