// Session Store - Manages chat sessions and messages
// v1.0.5: 内部类型保持本地 (Date) 避免下游连锁改; input/output 仍是 unknown 收窄
// v1.0.6: console 换 logger

import { create } from 'zustand';
import { logger } from '../utils/logger';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** AI 思考过程（流式事件中的 thinking_delta 累积） */
  thinking?: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface Session {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];
}

interface SessionState {
  sessions: Session[];
  currentSessionId: string | null;
  
  // Actions
  createSession: (workspaceId: string) => Session;
  renameSession: (sessionId: string, newTitle: string) => void;
  deleteSession: (sessionId: string) => void;
  setCurrentSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  addToolCall: (sessionId: string, messageId: string, toolCall: ToolCall) => void;
  updateToolCall: (sessionId: string, messageId: string, toolCallId: string, updates: Partial<ToolCall>) => void;
  /** 添加流式完成的消息（来自 usePiStream） */
  addStreamingMessage: (sessionId: string, message: Message) => void;
  /** 更新流式内容（实时追加 thinking / text） */
  updateStreamingContent: (sessionId: string, messageId: string, content: Partial<Message>) => void;
  loadSessions: () => Promise<void>;
  getCurrentSession: () => Session | null;
  getSessionMessages: (sessionId: string) => Message[];
}

function summarizeTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.slice(0, 28) || "未命名会话";
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Load sessions from main process on init
  const loadSessions = async () => {
    try {
      if (window.piAPI) {
        const sessionList = await window.piAPI.listSessions();
        const sessions = sessionList.map(s => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
          messages: []
        }));
        set({ sessions, currentSessionId: sessions[sessions.length - 1]?.id || null });
      }
    } catch (e) {
      logger.error('[session-store] Failed to load sessions:', e);
    }
  };
  loadSessions();

  return {
  sessions: [],
  currentSessionId: null,
  loadSessions,

  createSession: (workspaceId: string) => {
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSession: Session = {
      id,
      title: "未命名会话",
      workspaceId,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: []
    };

    set(state => ({
      sessions: [...state.sessions, newSession],
      currentSessionId: newSession.id
    }));

    // Sync to main process
    if (window.piAPI) {
      window.piAPI.createSession(workspaceId, newSession.title, id).catch((e) =>
        logger.error('[session-store] createSession failed:', e)
      );
    }

    return newSession;
  },

  deleteSession: (sessionId: string) => {
    set(state => {
      const newSessions = state.sessions.filter(s => s.id !== sessionId);
      const newCurrentId = state.currentSessionId === sessionId
        ? (newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null)
        : state.currentSessionId;

      return {
        sessions: newSessions,
        currentSessionId: newCurrentId
      };
    });

    // Sync to main process
    if (window.piAPI) {
      window.piAPI.deleteSession(sessionId).catch((e) =>
        logger.error('[session-store] deleteSession failed:', e)
      );
    }
  },

  renameSession: (sessionId: string, newTitle: string) => {
    const trimmed = (newTitle ?? '').trim();
    if (!trimmed) {
      logger.warn('[session-store] renameSession ignored empty title for', sessionId);
      return;
    }

    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId
          ? { ...s, title: trimmed, updatedAt: new Date() }
          : s
      )
    }));

    // Sync to main process (fire-and-forget; local state already updated)
    if (window.piAPI?.renameSession) {
      window.piAPI.renameSession(sessionId, trimmed).catch((e) =>
        logger.error('[session-store] renameSession failed:', e)
      );
    }
  },
  
  setCurrentSession: (sessionId: string) => {
    set({ currentSessionId: sessionId });
  },
  
  addMessage: (sessionId: string, message: Message) => {
    set(state => ({
      sessions: state.sessions.map(session => 
        session.id === sessionId
          ? {
              ...session,
              title:
                message.role === "user" && session.messages.length === 0 && session.title === "未命名会话"
                  ? summarizeTitle(message.content)
                  : session.title,
              messages: [...session.messages, message],
              updatedAt: new Date()
            }
          : session
      )
    }));
    const updated = get().sessions.find((session) => session.id === sessionId);
    if (message.role === "user" && updated?.messages.length === 1 && updated.title !== "未命名会话") {
      window.piAPI?.renameSession(sessionId, updated.title).catch((e) =>
        logger.error('[session-store] auto renameSession failed:', e)
      );
    }
  },
  
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => {
    set(state => ({
      sessions: state.sessions.map(session => 
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map(msg => 
                msg.id === messageId ? { ...msg, ...updates } : msg
              ),
              updatedAt: new Date()
            }
          : session
      )
    }));
  },
  
  addToolCall: (sessionId: string, messageId: string, toolCall: ToolCall) => {
    set(state => ({
      sessions: state.sessions.map(session => 
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map(msg => 
                msg.id === messageId
                  ? { ...msg, toolCalls: [...(msg.toolCalls || []), toolCall] }
                  : msg
              ),
              updatedAt: new Date()
            }
          : session
      )
    }));
  },
  
  updateToolCall: (sessionId: string, messageId: string, toolCallId: string, updates: Partial<ToolCall>) => {
    set(state => ({
      sessions: state.sessions.map(session => 
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map(msg => 
                msg.id === messageId
                  ? {
                      ...msg,
                      toolCalls: (msg.toolCalls || []).map(tc => 
                        tc.id === toolCallId ? { ...tc, ...updates } : tc
                      )
                    }
                  : msg
              ),
              updatedAt: new Date()
            }
          : session
      )
    }));
  },
  
  getCurrentSession: () => {
    const state = get();
    return state.sessions.find(s => s.id === state.currentSessionId) || null;
  },
  
  getSessionMessages: (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    return session?.messages || [];
  },

  addStreamingMessage: (sessionId: string, message: Message) => {
    // 等价于 addMessage，但语义上区分流式完成的消息
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId
          ? {
              ...session,
              messages: [...session.messages, message],
              updatedAt: new Date()
            }
          : session
      )
    }));
  },

  updateStreamingContent: (sessionId: string, messageId: string, content: Partial<Message>) => {
    // 等价于 updateMessage，但语义上区分流式内容更新
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map(msg =>
                msg.id === messageId ? { ...msg, ...content } : msg
              ),
              updatedAt: new Date()
            }
          : session
      )
    }));
  }
  };
});
