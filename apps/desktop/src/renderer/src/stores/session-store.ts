// Session Store - Manages chat sessions and messages
// v1.0.5: 内部类型保持本地 (Date) 避免下游连锁改; input/output 仍是 unknown 收窄
// v1.0.6: console 换 logger
// v1.0.17 (2026-06-06 hotfix): 移除 loadSessions 的 `messages: []` 硬编码,改成从主进程
//   拉真实数据 + Date 还原 + 老数据 migration。所有 action (addMessage/updateMessage/
//   addToolCall/updateToolCall) 内存 set 后 fire-and-forget 调 IPC 同步到主进程。
//   写失败累加到 persistErrorCount,供 PersistenceBanner 提示。
//   流式消息路径由 usePiStream (T6) 接管 debounce。

import { create } from 'zustand';
import { logger } from '../utils/logger';
import { isIpcError, type Message, type ToolCall } from '@shared';

// 2026-06-06 hotfix: 用 @shared 提供的 Message/ToolCall 类型,不再本地 duplicate
// 主进程 store 里的 timestamp/startTime/endTime 是 string(JSON 反序列化后), 内存里
// 业务代码用 .getTime() 等 Date API;需要展示时 MessageBubble 等组件负责还原(见各组件)。
//
// re-export 给其他模块,避免大批量改 import 路径
export type { Message, ToolCall };

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

  // 2026-06-06 hotfix: 持久化错误计数(给 PersistenceBanner 用)
  persistErrorCount: number;
  lastPersistError: string | null;

  // Actions
  createSession: (workspaceId: string) => Session;
  renameSession: (sessionId: string, newTitle: string) => void;
  deleteSession: (sessionId: string) => void;
  setCurrentSession: (sessionId: string) => void;
  /**
   * 2026-06-06 hotfix: actions 接受 opts.persist 跳过 fire-and-forget IPC。
   * usePiStream 高频路径传 false,自己 debounce + flush。
   */
  addMessage: (sessionId: string, message: Message, opts?: { persist?: boolean }) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updates: Partial<Message>,
    opts?: { persist?: boolean },
  ) => void;
  addToolCall: (
    sessionId: string,
    messageId: string,
    toolCall: ToolCall,
    opts?: { persist?: boolean },
  ) => void;
  updateToolCall: (
    sessionId: string,
    messageId: string,
    toolCallId: string,
    updates: Partial<ToolCall>,
    opts?: { persist?: boolean },
  ) => void;
  /** 添加流式完成的消息（来自 usePiStream） */
  addStreamingMessage: (
    sessionId: string,
    message: Message,
    opts?: { persist?: boolean },
  ) => void;
  /** 更新流式内容（实时追加 thinking / text） */
  updateStreamingContent: (
    sessionId: string,
    messageId: string,
    content: Partial<Message>,
    opts?: { persist?: boolean },
  ) => void;
  loadSessions: () => Promise<void>;
  getCurrentSession: () => Session | null;
  getSessionMessages: (sessionId: string) => Message[];
  /** 2026-06-06 hotfix: 清掉错误计数(banner 关闭) */
  clearPersistErrors: () => void;
}

function summarizeTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.slice(0, 28) || "未命名会话";
}

// 2026-06-06 hotfix: 序列化 message 准备过 IPC
//  - Date → ISO string(主进程 zod 接受 string | Date | number)
//  - toolCalls 内的 Date 同理(startTime/endTime)
function serializeMessageForIpc(message: Message): Message {
  return {
    ...message,
    timestamp: (
      message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : String(message.timestamp)
    ) as unknown as Date,
    toolCalls: message.toolCalls?.map((tc) => ({
      ...tc,
      startTime: (
        tc.startTime instanceof Date ? tc.startTime.toISOString() : String(tc.startTime)
      ) as unknown as Date,
      endTime: tc.endTime
        ? ((tc.endTime instanceof Date ? tc.endTime.toISOString() : String(tc.endTime)) as unknown as Date)
        : undefined,
    })),
  };
}

function serializeUpdatesForIpc<T>(updates: T): T {
  // 浅序列化:不深递归(只处理 message/toolCall 顶层的 Date 字段)
  const result: Record<string, unknown> = { ...(updates as Record<string, unknown>) };
  if ("timestamp" in result && result.timestamp instanceof Date) {
    result.timestamp = (result.timestamp as Date).toISOString();
  }
  if ("startTime" in result && result.startTime instanceof Date) {
    result.startTime = (result.startTime as Date).toISOString();
  }
  if ("endTime" in result && result.endTime instanceof Date) {
    result.endTime = (result.endTime as Date).toISOString();
  }
  if ("toolCalls" in result && Array.isArray(result.toolCalls)) {
    result.toolCalls = (result.toolCalls as ToolCall[]).map((tc) => ({
      ...tc,
      startTime: (
        tc.startTime instanceof Date ? tc.startTime.toISOString() : String(tc.startTime)
      ) as unknown as Date,
      endTime: tc.endTime
        ? ((tc.endTime instanceof Date ? tc.endTime.toISOString() : String(tc.endTime)) as unknown as Date)
        : undefined,
    }));
  }
  return result as T;
}

// 2026-06-06 hotfix: 处理 IPC 错误时,递增计数 + 记录最后错误
function notePersistFailure(err: unknown, counter: { count: number; last: string | null }): void {
  const msg = err instanceof Error ? err.message : String(err);
  counter.count += 1;
  counter.last = msg;
  logger.error("[session-store] persist failed:", msg);
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Load sessions from main process on init
  const loadSessions = async () => {
    try {
      if (window.piAPI) {
        const sessionList = await window.piAPI.listSessions();
        // 2026-06-06 hotfix: 用服务端真实 messages,做 Date 还原 + 老数据 migration
        const sessions = sessionList.map((s) => {
          // 老数据(没有 messages 字段)→ 补 []
          const rawMessages = (s as unknown as { messages?: unknown }).messages;
          const messages: Message[] = Array.isArray(rawMessages)
            ? (rawMessages as Array<Record<string, unknown>>).map((m) => {
                const ts = m.timestamp;
                const tcs = m.toolCalls as Array<Record<string, unknown>> | undefined;
                return {
                  ...(m as unknown as Message),
                  timestamp:
                    ts instanceof Date
                      ? ts
                      : new Date(typeof ts === "number" ? ts : String(ts)),
                  toolCalls: tcs?.map((tc) => {
                    const st = tc.startTime;
                    const et = tc.endTime;
                    return {
                      ...(tc as unknown as ToolCall),
                      startTime:
                        st instanceof Date
                          ? st
                          : new Date(typeof st === "number" ? st : String(st)),
                      endTime:
                        et instanceof Date
                          ? et
                          : et === null || et === undefined
                            ? undefined
                            : new Date(typeof et === "number" ? et : String(et)),
                    };
                  }),
                };
              })
            : [];
          return {
            ...s,
            createdAt: new Date(s.createdAt),
            updatedAt: new Date(s.updatedAt),
            messages,
          };
        });
        set({
          sessions,
          currentSessionId: sessions[sessions.length - 1]?.id || null,
        });
      }
    } catch (e) {
      logger.error("[session-store] Failed to load sessions:", e);
    }
  };
  loadSessions();

  return {
  sessions: [],
  currentSessionId: null,
  persistErrorCount: 0,
  lastPersistError: null,
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

  addMessage: (sessionId: string, message: Message, opts?: { persist?: boolean }) => {
    const persist = opts?.persist !== false; // 默认 true
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

    // 2026-06-06 hotfix: fire-and-forget 持久化新 message
    if (persist && window.piAPI?.appendMessage) {
      window.piAPI.appendMessage(sessionId, serializeMessageForIpc(message) as Message)
        .then((r) => {
          if (r && isIpcError(r)) {
            const counter = { count: get().persistErrorCount, last: get().lastPersistError };
            notePersistFailure(r.fallback, counter);
            set({ persistErrorCount: counter.count, lastPersistError: counter.last });
          }
        })
        .catch((e) => {
          const counter = { count: get().persistErrorCount, last: get().lastPersistError };
          notePersistFailure(e, counter);
          set({ persistErrorCount: counter.count, lastPersistError: counter.last });
        });
    }
  },

  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>, opts?: { persist?: boolean }) => {
    const persist = opts?.persist !== false; // 默认 true
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

    // 2026-06-06 hotfix: fire-and-forget 持久化 update
    // 注:usePiStream (T6) 会接管高频流式 update 的 debounce,这里先直接调
    if (persist && window.piAPI?.updateMessage) {
      window.piAPI.updateMessage(sessionId, messageId, serializeUpdatesForIpc(updates) as Partial<Message>)
        .then((r) => {
          if (r && isIpcError(r)) {
            const counter = { count: get().persistErrorCount, last: get().lastPersistError };
            notePersistFailure(r.fallback, counter);
            set({ persistErrorCount: counter.count, lastPersistError: counter.last });
          }
        })
        .catch((e) => {
          const counter = { count: get().persistErrorCount, last: get().lastPersistError };
          notePersistFailure(e, counter);
          set({ persistErrorCount: counter.count, lastPersistError: counter.last });
        });
    }
  },

  addToolCall: (sessionId: string, messageId: string, toolCall: ToolCall, opts?: { persist?: boolean }) => {
    const persist = opts?.persist !== false; // 默认 true
    set(state => {
      // 找到该 message 当前 toolCalls,把新 toolCall append
      const session = state.sessions.find(s => s.id === sessionId);
      const message = session?.messages.find(m => m.id === messageId);
      const next = [...(message?.toolCalls ?? []), toolCall];

      return {
        sessions: state.sessions.map(s =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map(m =>
                  m.id === messageId
                    ? { ...m, toolCalls: next, updatedAt: new Date() }
                    : m
                ),
                updatedAt: new Date()
              }
            : s
        )
      };
    });

    // 2026-06-06 hotfix: 持久化整个 toolCalls 数组(updateMessage 路径)
    if (persist) {
      const session = get().sessions.find(s => s.id === sessionId);
      const message = session?.messages.find(m => m.id === messageId);
      if (message && window.piAPI?.updateMessage) {
        window.piAPI.updateMessage(
          sessionId,
          messageId,
          serializeUpdatesForIpc({ toolCalls: message.toolCalls } as Partial<Message>),
        )
          .then((r) => {
            if (r && isIpcError(r)) {
              const counter = { count: get().persistErrorCount, last: get().lastPersistError };
              notePersistFailure(r.fallback, counter);
              set({ persistErrorCount: counter.count, lastPersistError: counter.last });
            }
          })
          .catch((e) => {
            const counter = { count: get().persistErrorCount, last: get().lastPersistError };
            notePersistFailure(e, counter);
            set({ persistErrorCount: counter.count, lastPersistError: counter.last });
          });
      }
    }
  },

  updateToolCall: (sessionId: string, messageId: string, toolCallId: string, updates: Partial<ToolCall>, opts?: { persist?: boolean }) => {
    const persist = opts?.persist !== false; // 默认 true
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

    // 2026-06-06 hotfix: 持久化单个 tool call update
    if (persist && window.piAPI?.updateToolCall) {
      window.piAPI.updateToolCall(
        sessionId,
        messageId,
        toolCallId,
        serializeUpdatesForIpc(updates),
      )
        .then((r) => {
          if (r && isIpcError(r)) {
            const counter = { count: get().persistErrorCount, last: get().lastPersistError };
            notePersistFailure(r.fallback, counter);
            set({ persistErrorCount: counter.count, lastPersistError: counter.last });
          }
        })
        .catch((e) => {
          const counter = { count: get().persistErrorCount, last: get().lastPersistError };
          notePersistFailure(e, counter);
          set({ persistErrorCount: counter.count, lastPersistError: counter.last });
        });
    }
  },

  getCurrentSession: () => {
    const state = get();
    return state.sessions.find(s => s.id === state.currentSessionId) || null;
  },

  getSessionMessages: (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    return session?.messages || [];
  },

  addStreamingMessage: (sessionId: string, message: Message, opts?: { persist?: boolean }) => {
    // 等价于 addMessage，但语义上区分流式完成的消息
    const persist = opts?.persist !== false; // 默认 true
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

    // 2026-06-06 hotfix: 跟 addMessage 一致, fire-and-forget
    if (persist && window.piAPI?.appendMessage) {
      window.piAPI.appendMessage(sessionId, serializeMessageForIpc(message) as Message)
        .then((r) => {
          if (r && isIpcError(r)) {
            const counter = { count: get().persistErrorCount, last: get().lastPersistError };
            notePersistFailure(r.fallback, counter);
            set({ persistErrorCount: counter.count, lastPersistError: counter.last });
          }
        })
        .catch((e) => {
          const counter = { count: get().persistErrorCount, last: get().lastPersistError };
          notePersistFailure(e, counter);
          set({ persistErrorCount: counter.count, lastPersistError: counter.last });
        });
    }
  },

  updateStreamingContent: (sessionId: string, messageId: string, content: Partial<Message>, opts?: { persist?: boolean }) => {
    // 等价于 updateMessage，但语义上区分流式内容更新
    const persist = opts?.persist !== false; // 默认 true
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

    // 2026-06-06 hotfix: 高频流式 update — T6 会用 debounce 接管
    // 这里仍直接调,但 usePiStream 走 T6 改的 flush 路径,只 flush 一次
    if (persist && window.piAPI?.updateMessage) {
      window.piAPI.updateMessage(
        sessionId,
        messageId,
        serializeUpdatesForIpc(content),
      )
        .then((r) => {
          if (r && isIpcError(r)) {
            const counter = { count: get().persistErrorCount, last: get().lastPersistError };
            notePersistFailure(r.fallback, counter);
            set({ persistErrorCount: counter.count, lastPersistError: counter.last });
          }
        })
        .catch((e) => {
          const counter = { count: get().persistErrorCount, last: get().lastPersistError };
          notePersistFailure(e, counter);
          set({ persistErrorCount: counter.count, lastPersistError: counter.last });
        });
    }
  },

  clearPersistErrors: () => {
    set({ persistErrorCount: 0, lastPersistError: null });
  }
  };
});
