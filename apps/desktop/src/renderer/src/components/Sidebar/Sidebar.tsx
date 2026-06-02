// Sidebar Component

import React, { useState, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useSessionStore } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';
import { logger } from '../../utils/logger';
import { ThreadList } from './ThreadList';

export function Sidebar(): React.JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'workspaces' | 'sessions' | 'threads'>('workspaces');
  const { workspaces, currentWorkspaceId, setCurrentWorkspace, addWorkspace } = useWorkspaceStore();
  const { sessions, currentSessionId, setCurrentSession, createSession, deleteSession } = useSessionStore();
  const { openSettings } = useSettingsStore();

  // Load workspaces from main process on mount
  // mount-only: 用 ref 持有 store workspaces 引用避开 deps 警告
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        if (window.piAPI) {
          const wsList = await window.piAPI.listWorkspaces();
          // Sync with store if empty
          if (workspacesRef.current.length === 0 && wsList.length > 0) {
            // We can't 直接 set the store, but we can add each workspace
            // Since the store already has a default, we'll skip this for now
            // and rely on the store's default
          }
        }
      } catch (error) {
        logger.error('[Sidebar] Failed to load workspaces:', error);
      }
    };
    loadWorkspaces();
  }, []);

  const handleNewWorkspace = async () => {
    try {
      if (window.piAPI) {
        const path = await window.piAPI.selectDirectory();
        if (path) {
          const name = path.split(/[\\/]/).pop() || 'New Workspace';
          const ws = await window.piAPI.createWorkspace(name, path);
          addWorkspace(ws.name, ws.path);
          await window.piAPI.selectWorkspace(path);
        }
      }
    } catch (error) {
      console.error('Failed to create workspace:', error);
    }
  };

  const handleSelectWorkspace = async (workspaceId: string) => {
    setCurrentWorkspace(workspaceId);
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (workspace && window.piAPI) {
      await window.piAPI.selectWorkspace(workspace.path);
    }
  };

  const handleNewSession = () => {
    const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
    if (currentWorkspace) {
      createSession(currentWorkspace.id);
    }
  };

  const formatTime = (date: Date) => {
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
  };

  const currentWorkspaceSessions = sessions.filter(s => s.workspaceId === currentWorkspaceId);

  return (
    <aside className={`${isCollapsed ? 'w-16' : 'w-64'} bg-white border-r border-[#e5e5e5] flex flex-col transition-all duration-300`}>
      {/* Header */}
      <div className="h-14 border-b border-[#e5e5e5] flex items-center justify-between px-4">
        {!isCollapsed && (
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-[#1a1a1a] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Pi</span>
            </div>
            <span className="font-semibold text-[#1a1a1a]">Pi 桌面</span>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-[#f0f0f0] rounded-lg transition-colors text-[#666666]"
        >
          {isCollapsed ? '→' : '←'}
        </button>
      </div>

      {/* Tabs */}
      {!isCollapsed && (
        <div className="flex border-b border-[#e5e5e5] overflow-x-auto">
          <button
            onClick={() => setActiveTab('workspaces')}
            className={`flex-1 py-2 px-4 text-sm font-medium ${
              activeTab === 'workspaces'
                ? 'text-[#1a1a1a] border-b-2 border-[#1a1a1a]'
                : 'text-[#999999] hover:text-[#1a1a1a]'
            }`}
          >
            工作区
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex-1 py-2 px-4 text-sm font-medium ${
              activeTab === 'sessions'
                ? 'text-[#1a1a1a] border-b-2 border-[#1a1a1a]'
                : 'text-[#999999] hover:text-[#1a1a1a]'
            }`}
          >
            会话
          </button>
          <button
            onClick={() => setActiveTab('threads')}
            className={`flex-1 py-2 px-4 text-sm font-medium ${
              activeTab === 'threads'
                ? 'text-[#1a1a1a] border-b-2 border-[#1a1a1a]'
                : 'text-[#999999] hover:text-[#1a1a1a]'
            }`}
          >
            线程
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'workspaces' && (
          <div className="space-y-1">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                onClick={() => handleSelectWorkspace(workspace.id)}
                className={`p-2 rounded-lg cursor-pointer ${
                  workspace.id === currentWorkspaceId
                    ? 'bg-[#f0f0f0] text-[#1a1a1a]'
                    : 'hover:bg-[#f0f0f0] text-[#1a1a1a]'
                }`}
              >
                {isCollapsed ? (
                  <div className="w-8 h-8 bg-[#f0f0f0] rounded-lg flex items-center justify-center">
                    <span className="text-sm font-medium">
                      {workspace.name.charAt(0)}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium">{workspace.name}</div>
                    <div className="text-xs text-[#999999] truncate">{workspace.path}</div>
                  </div>
                )}
              </div>
            ))}

            {!isCollapsed && (
              <button
                onClick={handleNewWorkspace}
                className="w-full p-2 text-[#999999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors text-sm text-left"
              >
                + 新建工作区
              </button>
            )}
          </div>
        )}
        {activeTab === 'sessions' && (
          <div className="space-y-1">
            {currentWorkspaceSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setCurrentSession(session.id)}
                className={`group p-2 rounded-lg cursor-pointer ${
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
                      <div className="font-medium truncate">{session.title}</div>
                      <div className="text-xs text-[#999999]">{formatTime(session.updatedAt)}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                      className="ml-2 p-1 hover:bg-red-600 rounded text-xs opacity-0 group-hover:opacity-100"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            ))}

            {currentWorkspaceSessions.length === 0 && !isCollapsed && (
              <div className="text-center text-[#999999] text-sm py-4">
                暂无会话
              </div>
            )}

            {!isCollapsed && (
              <button
                onClick={handleNewSession}
                className="w-full p-2 text-[#999999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors text-sm text-left"
              >
                + 新会话
              </button>
            )}
          </div>
        )}
        {activeTab === 'threads' && (
          <ThreadList isCollapsed={isCollapsed} />
        )}
      </div>

      {/* Footer */}
      {!isCollapsed && (
        <div className="border-t border-[#e5e5e5] p-4">
          <button
            onClick={openSettings}
            className="w-full py-2 px-4 bg-[#f0f0f0] text-[#1a1a1a] rounded-lg hover:bg-[#e5e5e5] transition-colors text-sm"
          >
            设置
          </button>
        </div>
      )}
    </aside>
  );
}