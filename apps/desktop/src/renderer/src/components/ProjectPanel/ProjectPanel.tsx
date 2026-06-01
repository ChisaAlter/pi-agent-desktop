// 左侧面板 - 220px 宽，项目信息 + 文件树 + 对话列表

import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useSessionStore } from '../../stores/session-store';
import { usePluginStore } from '../../stores/plugin-store';
import { FileTreeView } from '../FileTree';
import type { ProjectInfo } from '../../types';

interface ProjectPanelProps {
  activePanel: 'chat' | 'search' | 'plugins' | 'automation' | 'settings';
  onSendToPi?: (message: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  node: 'Node.js',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  unknown: '未知',
};

const TYPE_COLORS: Record<string, string> = {
  node: '#3b82f6',
  python: '#3776ab',
  rust: '#f04e23',
  go: '#00add8',
  java: '#ed8b00',
  unknown: '#888',
};

export const ProjectPanel: React.FC<ProjectPanelProps> = ({ activePanel, onSendToPi }) => {
  const { getCurrentWorkspace } = useWorkspaceStore();
  const { sessions, currentSessionId, createSession, setCurrentSession } = useSessionStore();
  const { skills, plugins, isLoading, refresh } = usePluginStore();
  const currentWorkspace = getCurrentWorkspace();
  const [searchQuery, setSearchQuery] = useState('');
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);

  // Detect project when workspace changes
  const detectProjectInfo = useCallback(async () => {
    if (!currentWorkspace?.path) {
      setProjectInfo(null);
      return;
    }
    try {
      const info = await window.piAPI.detectProject(currentWorkspace.path);
      setProjectInfo(info as ProjectInfo);
    } catch (e) {
      console.error('Failed to detect project:', e);
      setProjectInfo(null);
    }
  }, [currentWorkspace?.path]);

  useEffect(() => {
    detectProjectInfo();
  }, [detectProjectInfo]);

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

            {/* 项目信息卡片 */}
            <div className="px-3 mb-2">
              <div className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2">
                项目
              </div>
              <div className="bg-[#f0f0f0] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-[#1a1a1a]">
                    {projectInfo?.name || currentWorkspace?.name || '默认工作区'}
                  </span>
                  {projectInfo && projectInfo.type !== 'unknown' && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white"
                      style={{ backgroundColor: TYPE_COLORS[projectInfo.type] || '#888' }}
                    >
                      {TYPE_LABELS[projectInfo.type] || projectInfo.type}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#999] truncate">
                  {currentWorkspace?.path || '未选择路径'}
                </div>
                {projectInfo && (
                  <div className="flex items-center gap-2 mt-1.5">
                    {projectInfo.packageManager && (
                      <span className="text-[10px] text-[#666] bg-[#e5e5e5] px-1.5 py-0.5 rounded">
                        {projectInfo.packageManager}
                      </span>
                    )}
                    {projectInfo.version && (
                      <span className="text-[10px] text-[#999]">v{projectInfo.version}</span>
                    )}
                    {projectInfo.hasGit && (
                      <span className="text-[10px] text-[#666]">
                        <svg className="w-3 h-3 inline-block mr-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                        </svg>
                        git
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 文件树 */}
            <div className="flex-1 overflow-hidden flex flex-col border-t border-[#e5e5e5]">
              <div className="flex-1 overflow-y-auto">
                <FileTreeView
                  workspacePath={currentWorkspace?.path || null}
                  onSendToPi={onSendToPi}
                />
              </div>
            </div>

            {/* 对话列表 */}
            <div className="border-t border-[#e5e5e5]">
              <div className="px-3 pt-3 pb-1">
                <div className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2">
                  对话
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto px-3">
                <div className="space-y-1">
                  {filteredSessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => setCurrentSession(session.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
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
