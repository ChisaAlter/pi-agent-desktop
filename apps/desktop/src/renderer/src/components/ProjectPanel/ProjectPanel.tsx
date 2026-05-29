// 左侧面板 - 220px 宽，项目和对话列表

import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useSessionStore } from '../../stores/session-store';
import { usePluginStore } from '../../stores/plugin-store';

interface ProjectPanelProps {
  activePanel: 'chat' | 'search' | 'plugins' | 'automation' | 'settings';
}

export const ProjectPanel: React.FC<ProjectPanelProps> = ({ activePanel }) => {
  const { getCurrentWorkspace } = useWorkspaceStore();
  const { sessions, currentSessionId, createSession, setCurrentSession } = useSessionStore();
  const { skills, plugins, isLoading, refresh } = usePluginStore();
  const currentWorkspace = getCurrentWorkspace();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (activePanel === 'plugins') {
      refresh();
    }
  }, [activePanel, refresh]);

  const filteredSessions = sessions.filter(session =>
    session.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNewSession = () => {
    const workspaceId = currentWorkspace?.id || 'default';
    const newSession = createSession(workspaceId);
    setCurrentSession(newSession.id);
  };

  const renderContent = () => {
    switch (activePanel) {
      case 'chat':
        return (
          <>
            {/* 搜索框 */}
            <div className="p-3">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#999]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="搜索对话..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-sm text-[#1a1a1a] placeholder:text-[#999] focus:outline-none focus:border-[#1a1a1a]"
                />
              </div>
            </div>

            {/* 项目列表 */}
            <div className="px-3 mb-2">
              <div className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2">
                项目
              </div>
              <div className="bg-[#f0f0f0] rounded-lg p-3">
                <div className="text-sm font-medium text-[#1a1a1a] mb-1">
                  {currentWorkspace?.name || '默认工作区'}
                </div>
                <div className="text-xs text-[#999] truncate">
                  {currentWorkspace?.path || 'C:\\Users\\48818\\CodeBuddy\\pi-desktop'}
                </div>
              </div>
            </div>

            {/* 对话列表 */}
            <div className="flex-1 overflow-y-auto px-3">
              <div className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2">
                对话
              </div>
              <div className="space-y-1">
                {filteredSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setCurrentSession(session.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                      currentSessionId === session.id
                        ? 'bg-[#f0f0f0] text-[#1a1a1a]'
                        : 'text-[#666] hover:bg-[#f5f5f5] hover:text-[#1a1a1a]'
                    }`}
                  >
                    <div className="text-sm truncate">{session.title}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 新建对话按钮 */}
            <div className="p-3 border-t border-[#e5e5e5]">
              <button
                onClick={handleNewSession}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-all text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                新建对话
              </button>
            </div>
          </>
        );

      case 'search':
        return (
          <div className="p-4">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#999]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="搜索代码、文件..."
                className="w-full pl-9 pr-3 py-2.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm text-[#1a1a1a] placeholder:text-[#999] focus:outline-none focus:border-[#1a1a1a]"
              />
            </div>
            <div className="mt-4 text-sm text-[#999]">
              输入关键词开始搜索
            </div>
          </div>
        );

      case 'plugins':
        return (
          <div className="flex flex-col h-full">
            {/* 技能列表 */}
            <div className="p-3 border-b border-[#e5e5e5]">
              <div className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2">
                技能 ({skills.length})
              </div>
              {isLoading ? (
                <div className="text-sm text-[#999] py-2">加载中...</div>
              ) : skills.length > 0 ? (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {skills.map((skill) => (
                    <div key={skill.name} className="bg-[#f0f0f0] rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-[#1a1a1a]">{skill.name}</span>
                        <span className={`w-2 h-2 rounded-full ${skill.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                      </div>
                      {skill.description && (
                        <div className="text-xs text-[#666] line-clamp-2">{skill.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[#999] py-2">未发现技能</div>
              )}
            </div>

            {/* 插件列表 */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2">
                插件 ({plugins.length})
              </div>
              {isLoading ? (
                <div className="text-sm text-[#999] py-2">加载中...</div>
              ) : plugins.length > 0 ? (
                <div className="space-y-1">
                  {plugins.map((plugin) => (
                    <div key={plugin.name} className="bg-[#f0f0f0] rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-[#1a1a1a]">{plugin.name}</span>
                        <span className={`w-2 h-2 rounded-full ${plugin.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                      </div>
                      {plugin.description && (
                        <div className="text-xs text-[#666] line-clamp-2">{plugin.description}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#999] bg-[#e5e5e5] px-2 py-0.5 rounded">
                          {plugin.type}
                        </span>
                        {plugin.version && (
                          <span className="text-xs text-[#999]">v{plugin.version}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[#999] py-2">未发现插件</div>
              )}
            </div>

            {/* 刷新按钮 */}
            <div className="p-3 border-t border-[#e5e5e5]">
              <button
                onClick={() => refresh()}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-[#f5f5f5] text-[#666] rounded-lg hover:bg-[#e5e5e5] transition-all text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                刷新
              </button>
            </div>
          </div>
        );

      case 'automation':
        return (
          <div className="flex flex-col items-center justify-center h-full text-[#999] px-4">
            <svg className="w-12 h-12 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-sm">暂无自动化任务</p>
            <p className="text-xs mt-2 opacity-50">自动化功能开发中</p>
          </div>
        );

      case 'settings':
        return (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#666] mb-2">主题</label>
              <select className="w-full px-3 py-2.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]">
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="system">跟随系统</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#666] mb-2">字体大小</label>
              <select className="w-full px-3 py-2.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]">
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#666] mb-2">语言</label>
              <select className="w-full px-3 py-2.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]">
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-full bg-white border-r border-[#e5e5e5] flex flex-col">
      {/* 面板头部 */}
      <div className="p-4 border-b border-[#e5e5e5]">
        <span className="text-sm font-semibold text-[#1a1a1a]">项目</span>
      </div>

      {/* 面板内容 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {renderContent()}
      </div>
    </div>
  );
};
