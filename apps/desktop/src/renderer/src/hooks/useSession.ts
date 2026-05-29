// useSession Hook - Session management utilities

import { useCallback } from 'react';
import { useSessionStore, Session, Message } from '../stores/session-store';

interface UseSessionReturn {
  sessions: Session[];
  currentSession: Session | null;
  currentSessionId: string | null;
  createSession: () => Session;
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
  
  const formatTimestamp = useCallback((date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
  }, []);
  
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