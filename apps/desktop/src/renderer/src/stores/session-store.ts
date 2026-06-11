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
import { isIpcError, type Message, type SessionUsageSnapshot, type ToolCall, type ToolPermissions } from '@shared';
import { addToast } from './toast-store';

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
  archived?: boolean;
  favorite?: boolean;
  tags?: string[];
  readOnly?: boolean;
  lastOpenedAt?: Date;
  summary?: string;
  lastOutputPaths?: string[];
  usage?: SessionUsageSnapshot;
  toolPermissions?: ToolPermissions;
  parentSessionId?: string;
  forkedFromMessageId?: string;
  forkedAt?: Date;
}

interface SessionState {
  sessions: Session[];
  currentSessionId: string | null;
  sessionsLoading: boolean;

  // 2026-06-06 hotfix: 持久化错误计数(给 PersistenceBanner 用)
  persistErrorCount: number;
  lastPersistError: string | null;

  // Actions
  createSession: (workspaceId: string) => Promise<Session>;
  renameSession: (sessionId: string, newTitle: string) => void;
  deleteSession: (sessionId: string) => void;
  archiveSession: (sessionId: string, archived: boolean) => void;
  updateSessionMetadata: (
    sessionId: string,
    updates: Pick<
      Partial<Session>,
      | "summary"
      | "lastOutputPaths"
      | "favorite"
      | "tags"
      | "archived"
      | "readOnly"
      | "lastOpenedAt"
      | "usage"
      | "toolPermissions"
      | "parentSessionId"
      | "forkedFromMessageId"
      | "forkedAt"
    >,
  ) => void;
  toggleFavorite: (sessionId: string) => void;
  setSessionTags: (sessionId: string, tags: string[]) => void;
  openReadOnlySession: (sessionId: string) => void;
  continueSession: (sessionId: string, fromMessageId?: string) => Promise<Session>;
  updateSessionUsage: (sessionId: string, usage: SessionUsageSnapshot) => void;
  updateSessionToolPermissions: (sessionId: string, permissions: ToolPermissions) => void;
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

function recordPersistFailure(err: unknown): void {
  const state = useSessionStore.getState();
  const counter = { count: state.persistErrorCount, last: state.lastPersistError };
  notePersistFailure(err, counter);
  useSessionStore.setState({ persistErrorCount: counter.count, lastPersistError: counter.last });
  addToast(counter.last ?? "数据持久化失败", "error");
}

function observePersistResult(promise: Promise<unknown>): void {
  promise
    .then((result) => {
      if (result && isIpcError(result)) {
        recordPersistFailure(result.fallback);
      }
    })
    .catch(recordPersistFailure);
}

function getPiAPI(): Window["piAPI"] | undefined {
  return typeof window !== "undefined" ? window.piAPI : undefined;
}

function getSessionActivityTime(session: Session): number {
  return (session.lastOpenedAt ?? session.updatedAt ?? session.createdAt).getTime();
}

function pickMostRecentSessionId(sessions: Session[]): string | null {
  return sessions
    .slice()
    .sort((a, b) => getSessionActivityTime(b) - getSessionActivityTime(a))[0]?.id ?? null;
}

function cloneMessageForFork(message: Message): Message {
  return {
    ...message,
    timestamp:
      message.timestamp instanceof Date
        ? new Date(message.timestamp)
        : new Date(typeof message.timestamp === "number" ? message.timestamp : String(message.timestamp)),
    toolCalls: message.toolCalls?.map((tc) => ({
      ...tc,
      startTime:
        tc.startTime instanceof Date
          ? new Date(tc.startTime)
          : tc.startTime == null
            ? undefined
            : new Date(typeof tc.startTime === "number" ? tc.startTime : String(tc.startTime)),
      endTime:
        tc.endTime instanceof Date
          ? new Date(tc.endTime)
          : tc.endTime == null
            ? undefined
            : new Date(typeof tc.endTime === "number" ? tc.endTime : String(tc.endTime)),
    })),
    customCard: message.customCard ? { ...message.customCard } : undefined,
  };
}

function reviveSession(raw: Session | import("@shared").Session): Session {
  return {
    ...raw,
    createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt),
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt),
    lastOpenedAt: raw.lastOpenedAt == null
      ? undefined
      : raw.lastOpenedAt instanceof Date
        ? raw.lastOpenedAt
        : new Date(raw.lastOpenedAt),
    forkedAt: raw.forkedAt == null
      ? undefined
      : raw.forkedAt instanceof Date
        ? raw.forkedAt
        : new Date(raw.forkedAt),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    favorite: raw.favorite ?? false,
    readOnly: raw.readOnly ?? false,
    messages: (raw.messages ?? []).map((message) => ({
      ...message,
      timestamp:
        message.timestamp instanceof Date
          ? message.timestamp
          : new Date(typeof message.timestamp === "number" ? message.timestamp : String(message.timestamp)),
      toolCalls: message.toolCalls?.map((tc) => ({
        ...tc,
        startTime:
          tc.startTime instanceof Date
            ? tc.startTime
            : tc.startTime == null
              ? undefined
              : new Date(typeof tc.startTime === "number" ? tc.startTime : String(tc.startTime)),
        endTime:
          tc.endTime instanceof Date
            ? tc.endTime
            : tc.endTime == null
              ? undefined
              : new Date(typeof tc.endTime === "number" ? tc.endTime : String(tc.endTime)),
      })),
    })),
  };
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Load sessions from main process on init
  const loadSessions = async () => {
    set({ sessionsLoading: true });
    try {
      const piAPI = getPiAPI();
      if (piAPI) {
        const sessionList = await piAPI.listSessions();
        const sessions = sessionList.map(reviveSession);
        const currentSession = sessions
          .slice()
          .sort((a, b) => getSessionActivityTime(b) - getSessionActivityTime(a))[0];
        set({
          sessions,
          currentSessionId: currentSession?.id || null,
          sessionsLoading: false,
        });
      } else {
        set({ sessionsLoading: false });
      }
    } catch (e) {
      logger.error("[session-store] Failed to load sessions:", e);
      addToast("会话加载失败", "error");
      set({ sessionsLoading: false });
    }
  };
  loadSessions();

  return {
  sessions: [],
  currentSessionId: null,
  sessionsLoading: true,
  persistErrorCount: 0,
  lastPersistError: null,
  loadSessions,

  createSession: async (workspaceId: string) => {
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let newSession: Session = {
      id,
      title: "未命名会话",
      workspaceId,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
      favorite: false,
      tags: [],
      readOnly: false,
      lastOpenedAt: new Date(),
    };

    const piAPI = getPiAPI();
    if (piAPI) {
      const persisted = await piAPI.createSession(workspaceId, newSession.title, id);
      if (isIpcError(persisted)) {
        logger.error('[session-store] createSession failed:', persisted.fallback);
        throw new Error(persisted.fallback);
      }
      newSession = reviveSession(persisted);
    }

    set(state => ({
      sessions: state.sessions.some((session) => session.id === newSession.id)
        ? state.sessions.map((session) => session.id === newSession.id ? newSession : session)
        : [...state.sessions, newSession],
      currentSessionId: newSession.id
    }));

    return newSession;
  },

  deleteSession: (sessionId: string) => {
    set(state => {
      const newSessions = state.sessions.filter(s => s.id !== sessionId);
      const newCurrentId = state.currentSessionId === sessionId
        ? pickMostRecentSessionId(newSessions.filter((session) => !session.archived))
        : state.currentSessionId;

      return {
        sessions: newSessions,
        currentSessionId: newCurrentId
      };
    });

    // Sync to main process
    const piAPI = getPiAPI();
    if (piAPI?.deleteSession) {
      observePersistResult(piAPI.deleteSession(sessionId));
    }
  },

  archiveSession: (sessionId: string, archived: boolean) => {
    set(state => {
      const sessions = state.sessions.map(s =>
        s.id === sessionId ? { ...s, archived, updatedAt: new Date() } : s
      );
      const visibleSessions = sessions.filter((s) => !s.archived);
      const currentSessionId =
        archived && state.currentSessionId === sessionId
          ? pickMostRecentSessionId(visibleSessions)
          : state.currentSessionId;
      return { sessions, currentSessionId };
    });

    const piAPI = getPiAPI();
    if (piAPI?.archiveSession) {
      observePersistResult(piAPI.archiveSession(sessionId, archived));
    }
  },

  updateSessionMetadata: (sessionId, updates) => {
    const serializedUpdates = {
      ...updates,
      lastOpenedAt: updates.lastOpenedAt instanceof Date
        ? updates.lastOpenedAt.getTime()
        : updates.lastOpenedAt,
      forkedAt: updates.forkedAt instanceof Date
        ? updates.forkedAt.getTime()
        : updates.forkedAt,
    };
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, ...updates, updatedAt: new Date() } : s
      ),
    }));
    const piAPI = getPiAPI();
    if (piAPI?.updateSessionMetadata) {
      observePersistResult(piAPI.updateSessionMetadata(sessionId, serializedUpdates));
    }
  },

  toggleFavorite: (sessionId) => {
    const target = get().sessions.find((session) => session.id === sessionId);
    get().updateSessionMetadata(sessionId, { favorite: !(target?.favorite ?? false) });
  },

  setSessionTags: (sessionId, tags) => {
    const clean = tags.map((tag) => tag.trim()).filter(Boolean);
    get().updateSessionMetadata(sessionId, { tags: [...new Set(clean)] });
  },

  openReadOnlySession: (sessionId) => {
    const openedAt = new Date();
    const exists = get().sessions.some((session) => session.id === sessionId);
    if (!exists) {
      logger.warn("[session-store] openReadOnlySession ignored missing session", sessionId);
      return;
    }
    set(state => ({
      currentSessionId: sessionId,
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, readOnly: true, lastOpenedAt: openedAt } : s
      ),
    }));
    const piAPI = getPiAPI();
    if (piAPI?.updateSessionMetadata) {
      observePersistResult(piAPI.updateSessionMetadata(sessionId, { readOnly: true, lastOpenedAt: openedAt.getTime() }));
    }
  },

  continueSession: async (sessionId, fromMessageId) => {
    const source = get().sessions.find((session) => session.id === sessionId);
    if (!source) throw new Error(`Session not found: ${sessionId}`);
    const forkIndex = fromMessageId
      ? source.messages.findIndex((message) => message.id === fromMessageId)
      : source.messages.length - 1;
    if (fromMessageId && forkIndex < 0) {
      throw new Error(`Message not found: ${fromMessageId} in session ${sessionId}`);
    }
    const copiedMessages = forkIndex >= 0
      ? source.messages.slice(0, forkIndex + 1).map(cloneMessageForFork)
      : [];
    const next = await get().createSession(source.workspaceId);
    get().renameSession(next.id, `${source.title} 继续`);
    get().updateSessionMetadata(next.id, {
      summary: source.summary || `Continued from ${source.title}`,
      toolPermissions: source.toolPermissions,
      parentSessionId: source.id,
      forkedFromMessageId: fromMessageId,
      forkedAt: new Date(),
    });
    for (const message of copiedMessages) {
      get().addMessage(next.id, message);
    }
    return get().sessions.find((session) => session.id === next.id) ?? next;
  },

  updateSessionUsage: (sessionId, usage) => {
    get().updateSessionMetadata(sessionId, { usage });
  },

  updateSessionToolPermissions: (sessionId, permissions) => {
    get().updateSessionMetadata(sessionId, { toolPermissions: permissions });
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
    const piAPI = getPiAPI();
    if (piAPI?.renameSession) {
      observePersistResult(piAPI.renameSession(sessionId, trimmed));
    }
  },

  setCurrentSession: (sessionId: string) => {
    const openedAt = new Date();
    const exists = get().sessions.some((session) => session.id === sessionId);
    if (!exists) {
      logger.warn("[session-store] setCurrentSession ignored missing session", sessionId);
      return;
    }
    set(state => ({
      currentSessionId: sessionId,
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, readOnly: false, lastOpenedAt: openedAt } : s
      ),
    }));
    const piAPI = getPiAPI();
    if (piAPI?.updateSessionMetadata) {
      observePersistResult(piAPI.updateSessionMetadata(sessionId, { readOnly: false, lastOpenedAt: openedAt.getTime() }));
    }
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
      const renamePromise = getPiAPI()?.renameSession(sessionId, updated.title);
      if (renamePromise) observePersistResult(renamePromise);
    }

    // 2026-06-06 hotfix: fire-and-forget 持久化新 message
    const piAPI = getPiAPI();
    if (persist && piAPI?.appendMessage) {
      observePersistResult(piAPI.appendMessage(sessionId, serializeMessageForIpc(message) as Message));
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
    const piAPI = getPiAPI();
    if (persist && piAPI?.updateMessage) {
      observePersistResult(piAPI.updateMessage(sessionId, messageId, serializeUpdatesForIpc(updates) as Partial<Message>));
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
      const piAPI = getPiAPI();
      if (message && piAPI?.updateMessage) {
        observePersistResult(piAPI.updateMessage(
          sessionId,
          messageId,
          serializeUpdatesForIpc({ toolCalls: message.toolCalls } as Partial<Message>),
        ));
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
    const piAPI = getPiAPI();
    if (persist && piAPI?.updateToolCall) {
      observePersistResult(piAPI.updateToolCall(
        sessionId,
        messageId,
        toolCallId,
        serializeUpdatesForIpc(updates),
      ));
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
    const piAPI = getPiAPI();
    if (persist && piAPI?.appendMessage) {
      observePersistResult(piAPI.appendMessage(sessionId, serializeMessageForIpc(message) as Message));
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
    const piAPI = getPiAPI();
    if (persist && piAPI?.updateMessage) {
      observePersistResult(piAPI.updateMessage(
        sessionId,
        messageId,
        serializeUpdatesForIpc(content),
      ));
    }
  },

  clearPersistErrors: () => {
    set({ persistErrorCount: 0, lastPersistError: null });
  }
  };
});
