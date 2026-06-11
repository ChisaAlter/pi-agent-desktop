import React, { useState, useCallback, useMemo } from "react";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";

interface SearchResult {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  messageContent: string;
  messageRole: string;
  timestamp: Date;
  matchIndex: number;
  matchLength: number;
}

interface SearchHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (sessionId: string, messageId: string) => void;
}

function highlightMatch(text: string, matchIndex: number, matchLength: number): React.JSX.Element {
  const before = text.slice(Math.max(0, matchIndex - 30), matchIndex);
  const match = text.slice(matchIndex, matchIndex + matchLength);
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 30);

  return (
    <span className="text-xs text-[var(--mm-text-secondary)]">
      {before.length > 0 && <span>...{before}</span>}
      <mark className="bg-yellow-200 px-0.5 text-[var(--mm-text-primary)]">{match}</mark>
      {after.length > 0 && <span>{after}...</span>}
    </span>
  );
}

export function SearchHistory({ isOpen, onClose, onNavigate }: SearchHistoryProps): React.JSX.Element | null {
  const { sessions } = useSessionStore();
  const { getCurrentWorkspace } = useWorkspaceStore();
  const currentWorkspace = getCurrentWorkspace();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    if (!query.trim() || !currentWorkspace) return [];

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const workspaceSessions = sessions.filter(
      (s) => s.workspaceId === currentWorkspace.id && !s.archived,
    );

    for (const session of workspaceSessions) {
      for (const message of session.messages) {
        const content = message.content.toLowerCase();
        let matchIndex = content.indexOf(lowerQuery);

        while (matchIndex !== -1 && results.length < 50) {
          results.push({
            sessionId: session.id,
            sessionTitle: session.title,
            messageId: message.id,
            messageContent: message.content,
            messageRole: message.role,
            timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
            matchIndex,
            matchLength: query.length,
          });

          matchIndex = content.indexOf(lowerQuery, matchIndex + 1);
        }
      }
    }

    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 20);
  }, [query, sessions, currentWorkspace]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setSelectedId(result.messageId);
      onNavigate(result.sessionId, result.messageId);
    },
    [onNavigate],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[10vh]">
      <div className="w-full max-w-[600px] overflow-hidden rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--mm-border)] px-4 py-3">
          <svg className="h-4 w-4 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索所有对话..."
            className="flex-1 bg-transparent text-sm text-[var(--mm-text-primary)] outline-none placeholder:text-[var(--mm-text-tertiary)]"
            autoFocus
            aria-label="搜索对话历史"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
            aria-label="关闭搜索"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--mm-text-tertiary)]">
              {query.trim() ? "没有找到匹配的对话" : "输入关键词搜索所有对话"}
            </div>
          ) : (
            <ul className="py-1">
              {searchResults.map((result) => (
                <li key={`${result.sessionId}-${result.messageId}`}>
                  <button
                    type="button"
                    onClick={() => handleSelect(result)}
                    className={`flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors hover:bg-[var(--mm-bg-hover)] ${
                      selectedId === result.messageId ? "bg-[var(--mm-bg-selected)]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-[var(--mm-text-primary)]">
                        {result.sessionTitle}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">
                        {result.messageRole === "user" ? "你" : "AI"}
                      </span>
                    </div>
                    <div className="truncate">
                      {highlightMatch(result.messageContent, result.matchIndex, result.matchLength)}
                    </div>
                    <div className="text-[10px] text-[var(--mm-text-tertiary)]">
                      {result.timestamp.toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--mm-border)] px-4 py-2 text-[10px] text-[var(--mm-text-tertiary)]">
          {searchResults.length > 0 && <span>找到 {searchResults.length} 条结果</span>}
        </div>
      </div>
    </div>
  );
}
