// Thread List Component

import React from 'react';
import { useThreadStore, type Thread } from '../../stores/thread-store';
import { useWorkspaceStore } from '../../stores/workspace-store';

interface ThreadListProps {
  isCollapsed: boolean;
}

function StatusIndicator({ status }: { status: Thread['status'] }) {
  switch (status) {
    case 'idle':
      return <span className="inline-block w-2 h-2 rounded-full bg-[#999999]" />;
    case 'running':
      return (
        <span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b] animate-spin" style={{ animationDuration: '1.5s' }}>
          <span className="block w-2 h-2 rounded-full bg-[#f59e0b] opacity-75" style={{ transform: 'scale(0.6)' }} />
        </span>
      );
    case 'completed':
      return <span className="inline-block w-2 h-2 rounded-full bg-[#10b981]" />;
    case 'failed':
      return <span className="inline-block w-2 h-2 rounded-full bg-[#ef4444]" />;
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(date).toLocaleDateString();
}

export function ThreadList({ isCollapsed }: ThreadListProps): React.JSX.Element {
  const {
    currentThreadId,
    setCurrentThread,
    createThread,
    deleteThread,
    getThreadsByWorkspace,
  } = useThreadStore();
  const { currentWorkspaceId } = useWorkspaceStore();

  const workspaceThreads = currentWorkspaceId
    ? getThreadsByWorkspace(currentWorkspaceId)
    : [];

  const handleNewThread = (mode: 'local' | 'worktree' = 'local') => {
    if (!currentWorkspaceId) return;
    createThread(currentWorkspaceId, mode);
  };

  const handleDeleteThread = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    deleteThread(threadId);
  };

  return (
    <div className="space-y-1">
      {workspaceThreads.map((thread) => (
        <div
          key={thread.id}
          onClick={() => setCurrentThread(thread.id)}
          className={`group p-2 rounded-lg cursor-pointer transition-colors ${
            thread.id === currentThreadId
              ? 'bg-[#f0f0f0] text-[#1a1a1a]'
              : 'hover:bg-[#f0f0f0] text-[#1a1a1a]'
          }`}
        >
          {isCollapsed ? (
            <div className="w-8 h-8 bg-[#f0f0f0] rounded-lg flex items-center justify-center">
              <StatusIndicator status={thread.status} />
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <StatusIndicator status={thread.status} />
                  <span className="font-medium truncate text-sm">{thread.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      thread.mode === 'worktree'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {thread.mode}
                  </span>
                  <span className="text-xs text-[#999999]">
                    {formatRelativeTime(thread.updatedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[#999999]">
                  <span>💬 {thread.messageCount}</span>
                  <span>📁 {thread.fileChanges}</span>
                </div>
              </div>

              <button
                onClick={(e) => handleDeleteThread(e, thread.id)}
                className="ml-2 p-1 hover:bg-red-100 hover:text-red-600 rounded transition-all opacity-0 group-hover:opacity-100 text-xs shrink-0"
                title="删除线程"
              >
                🗑️
              </button>
            </div>
          )}
        </div>
      ))}

      {workspaceThreads.length === 0 && !isCollapsed && (
        <div className="text-center text-[#999999] text-sm py-4">
          暂无线程
        </div>
      )}

      {!isCollapsed && (
        <div className="flex gap-1 pt-1">
          <button
            onClick={() => handleNewThread('local')}
            className="flex-1 p-2 text-[#999999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors text-sm text-center"
            title="本地模式线程"
          >
            + 本地线程
          </button>
          <button
            onClick={() => handleNewThread('worktree')}
            className="flex-1 p-2 text-[#999999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors text-sm text-center"
            title="Worktree 模式线程"
          >
            + Worktree
          </button>
        </div>
      )}
    </div>
  );
}
