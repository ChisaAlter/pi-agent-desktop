// useSession Hook - Session management utilities
// v1.0.9: formatTimestamp 走 utils/format.formatRelative 统一入口
// v1.0.10 (M1): 接受 t() 走 i18n

import { useCallback } from 'react';
import { useSessionStore, type Session, type Message } from '../stores/session-store';
import { formatRelative } from '../utils/format';
import { useI18n } from '../i18n';

interface UseSessionReturn {
  sessions: Session[];
  currentSession: Session | null;
  currentSessionId: string | null;
  createSession: () => Promise<Session>;
  deleteSession: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
  addMessage: (message: Message) => void;
  getSessionTitle: (session: Session) => string;
  formatTimestamp: (date: Date) => string;
}

export function useSession(): UseSessionReturn {
  const {
    sessions,
    currentSessionId,
    createSession: storeCreateSession,
    deleteSession,
    setCurrentSession,
    addMessage: storeAddMessage,
    getCurrentSession
  } = useSessionStore();

  const currentSession = getCurrentSession();
  const { t } = useI18n();

  const createSession = useCallback(() => {
    return storeCreateSession('default');
  }, [storeCreateSession]);

  const switchSession = useCallback((sessionId: string) => {
    setCurrentSession(sessionId);
  }, [setCurrentSession]);

  const addMessage = useCallback((message: Message) => {
    if (currentSessionId) {
      storeAddMessage(currentSessionId, message);
    }
  }, [currentSessionId, storeAddMessage]);

  const getSessionTitle = useCallback((session: Session) => {
    if (session.messages.length > 0) {
      const firstUserMessage = session.messages.find(m => m.role === 'user');
      if (firstUserMessage) {
        const title = firstUserMessage.content.substring(0, 30);
        return title.length < firstUserMessage.content.length ? title + '...' : title;
      }
    }
    return session.title;
  }, []);

  // v1.0.9: 走 utils/format.formatRelative, 接受 Date / number / string 任意时间值
  // v1.0.10 (M1): 传 t 走 i18n
  const formatTimestamp = useCallback((date: Date) => {
    return formatRelative(date, t);
  }, [t]);

  return {
    sessions,
    currentSession,
    currentSessionId,
    createSession,
    deleteSession,
    switchSession,
    addMessage,
    getSessionTitle,
    formatTimestamp
  };
}
