// Session Store - Manages chat sessions and messages

import { create } from 'zustand';

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
  input: any;
  output?: any;
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
  getCurrentSession: () => Session | null;
  getSessionMessages: (sessionId: string) => Message[];
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
      console.error('Failed to load sessions:', e);
    }
  };
  loadSessions();

  return {
  sessions: [],
  currentSessionId: null,

  createSession: (workspaceId: string) => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: `Session ${get().sessions.length + 1}`,
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
      window.piAPI.createSession(workspaceId, newSession.title).catch(console.error);
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
      window.piAPI.deleteSession(sessionId).catch(console.error);
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
              messages: [...session.messages, message],
              updatedAt: new Date()
            }
          : session
      )
    }));
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