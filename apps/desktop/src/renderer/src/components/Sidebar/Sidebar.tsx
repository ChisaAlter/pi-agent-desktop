// Sidebar Component

import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useSessionStore } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';

export function Sidebar(): React.JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'workspaces' | 'sessions'>('workspaces');
  const { workspaces, currentWorkspaceId, setCurrentWorkspace, addWorkspace } = useWorkspaceStore();
  const { sessions, currentSessionId, setCurrentSession, createSession, deleteSession } = useSessionStore();
  const { openSettings } = useSettingsStore();

  // Load workspaces from main process on mount
  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        if (window.piAPI) {
          const wsList = await window.piAPI.listWorkspaces();
          // Sync with store if empty
          if (workspaces.length === 0 && wsList.length > 0) {
            // We can't directly set the store, but we can add each workspace
            // Since the store already has a default, we'll skip this for now
            // and rely on the store's default
          }
        }
      } catch (error) {
        console.error('Failed to load workspaces:', error);
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
    <aside className={`${isCollapsed ? 'w-16' : 'w-64'} bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-300`}>
      {/* Header */}
      <div className="h-14 border-b border-gray-700 flex items-center justify-between px-4">
        {!isCollapsed && (
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Pi</span>
            </div>
            <span className="font-semibold">Pi 桌面</span>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
        >
          {isCollapsed ? '→' : '←'}
        </button>
      </div>

      {/* Tabs */}
      {!isCollapsed && (
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('workspaces')}
            className={`flex-1 py-2 px-4 text-sm font-medium ${
              activeTab === 'workspaces'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            工作区
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex-1 py-2 px-4 text-sm font-medium ${
              activeTab === 'sessions'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            会话
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'workspaces' ? (
          <div className="space-y-1">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                onClick={() => handleSelectWorkspace(workspace.id)}
                className={`p-2 rounded-lg cursor-pointer ${
                  workspace.id === currentWorkspaceId
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-700 text-gray-300'
                }`}
              >
                {isCollapsed ? (
                  <div className="w-8 h-8 bg-gray-600 rounded-lg flex items-center justify-center">
                    <span className="text-sm font-medium">
                      {workspace.name.charAt(0)}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium">{workspace.name}</div>
                    <div className="text-xs opacity-70 truncate">{workspace.path}</div>
                  </div>
                )}
              </div>
            ))}

            {!isCollapsed && (
              <button
                onClick={handleNewWorkspace}
                className="w-full p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors text-sm text-left"
              >
                + 新建工作区
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {currentWorkspaceSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setCurrentSession(session.id)}
                className={`group p-2 rounded-lg cursor-pointer ${
                  session.id === currentSessionId
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-700 text-gray-300'
                }`}
              >
                {isCollapsed ? (
                  <div className="w-8 h-8 bg-gray-600 rounded-lg flex items-center justify-center">
                    <span className="text-sm">💬</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{session.title}</div>
                      <div className="text-xs opacity-70">{formatTime(session.updatedAt)}</div>
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
              <div className="text-center text-gray-500 text-sm py-4">
                暂无会话
              </div>
            )}

            {!isCollapsed && (
              <button
                onClick={handleNewSession}
                className="w-full p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors text-sm text-left"
              >
                + 新会话
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {!isCollapsed && (
        <div className="border-t border-gray-700 p-4">
          <button
            onClick={openSettings}
            className="w-full py-2 px-4 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
          >
            设置
          </button>
        </div>
      )}
    </aside>
  );
}