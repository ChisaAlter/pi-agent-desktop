// Session List Component

import React from 'react';
import { useSession } from '../../hooks/useSession';

interface SessionListProps {
  isCollapsed: boolean;
}

export function SessionList({ isCollapsed }: SessionListProps): React.JSX.Element {
  const { 
    sessions, 
    currentSessionId, 
    switchSession, 
    deleteSession, 
    createSession,
    getSessionTitle,
    formatTimestamp 
  } = useSession();
  
  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm('Delete this session?')) {
      deleteSession(sessionId);
    }
  };
  
  return (
    <div className="space-y-1">
      {sessions.map((session) => (
        <div
          key={session.id}
          onClick={() => switchSession(session.id)}
          className={`p-2 rounded-lg cursor-pointer transition-colors group ${
            session.id === currentSessionId
              ? 'bg-[#f0f0f0] text-[#1a1a1a]'
              : 'hover:bg-[#f0f0f0] text-[#1a1a1a]'
          }`}
        >
          {isCollapsed ? (
            <div className="w-8 h-8 bg-[#f0f0f0] rounded-lg flex items-center justify-center">
              <span className="text-sm">💬</span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{getSessionTitle(session)}</div>
                <div className="text-xs text-[#999999]">
                  {formatTimestamp(new Date(session.updatedAt))}
                </div>
              </div>
              
              <button
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500 rounded transition-all"
              >
                <span className="text-xs">🗑️</span>
              </button>
            </div>
          )}
        </div>
      ))}
      
      {!isCollapsed && (
        <button
          onClick={() => createSession()}
          className="w-full p-2 text-[#999999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors text-sm"
        >
          + New Session
        </button>
      )}
    </div>
  );
}