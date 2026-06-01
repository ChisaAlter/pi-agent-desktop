// Pi Desktop - Codex 浅灰白色主题

import React, { useState, useEffect } from 'react';
import { ChatView } from './components/ChatView/ChatView';
import { IconBar } from './components/IconBar/IconBar';
import { ProjectPanel } from './components/ProjectPanel/ProjectPanel';
import { TaskSidebar } from './components/FloatingPanel/TaskSidebar';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { GitPanel } from './components/GitPanel/GitPanel';
import { ResizablePanel } from './components/ResizablePanel';
import { useWorkspaceStore } from './stores/workspace-store';
import { useSettingsStore } from './stores/settings-store';
import { useGit } from './hooks/useGit';
import { TerminalPanel } from './components/Terminal';
import { ApprovalPanel } from './components/ApprovalPanel';
import { useApprovalStore } from './stores/approval-store';
import { GatewayPanel } from './components/GatewayPanel';
import { useGatewayStore } from './stores/gateway-store';

function App(): React.JSX.Element {
  const [activePanel, setActivePanel] = useState<'chat' | 'search' | 'plugins' | 'automation' | 'settings'>('chat');
  const [showTaskSidebar, setShowTaskSidebar] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showApprovalPanel, setShowApprovalPanel] = useState(false);
  const [showGatewayPanel, setShowGatewayPanel] = useState(false);
  const { getCurrentWorkspace } = useWorkspaceStore();
  const [isConnected, setIsConnected] = useState(false);
  const { loadPiConfig, openSettings } = useSettingsStore();
  const currentWorkspace = getCurrentWorkspace();
  const { status: gitStatus, getBranchDisplay, getChangeCount } = useGit();

  // 审批变更计数 (用于 badge)
  const approvalChanges = useApprovalStore((s) => s.changes);
  const pendingApprovalCount = approvalChanges.filter((c) => c.status === 'pending').length;

  // 网关新消息计数 (用于 badge)
  const gatewayNewCount = useGatewayStore((s) => s.newMessageCount);

  // 独立检查连接状态（避免与 ChatView 中的 usePiStream 重复创建事件监听）
  useEffect(() => {
    const checkStatus = async () => {
      try {
        if (window.piAPI) {
          const status = await window.piAPI.getStatus();
          setIsConnected(status.installed);
        }
      } catch {
        setIsConnected(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30000); // 30s 轮询足够
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadPiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 快捷键 Ctrl+` 切换终端
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        setShowTerminal(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const changes = getChangeCount();

  return (
    <div className="flex h-screen bg-[#f5f5f5] text-[#1a1a1a]">
      {/* 左侧图标栏 - 48px 固定宽度 */}
      <IconBar activePanel={activePanel} onPanelChange={setActivePanel} />

      {/* 左侧面板 - 可拖动调整宽度 */}
      <ResizablePanel defaultWidth={220} minWidth={180} maxWidth={400} side="left">
        <ProjectPanel activePanel={activePanel} onSendToPi={(msg) => {
          // Send message to Pi via chat
          if (window.piAPI) {
            window.piAPI.sendPrompt(msg);
          }
        }} />
      </ResizablePanel>

      {/* 主聊天区域 - 自适应 */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* 顶部标题栏 */}
        <header className="h-12 bg-white border-b border-[#e5e5e5] flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-medium">
              {activePanel === 'chat' && '聊天'}
              {activePanel === 'search' && '搜索'}
              {activePanel === 'plugins' && '插件'}
              {activePanel === 'automation' && '自动化'}
              {activePanel === 'settings' && '设置'}
            </h1>
            <span className="text-xs text-[#999]">
              {currentWorkspace?.name || '默认工作区'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 审批按钮 */}
            <button
              onClick={() => setShowApprovalPanel(!showApprovalPanel)}
              className={`relative px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                showApprovalPanel
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]'
              }`}
              title="文件变更审批"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              审批
              {/* 红点提示 */}
              {pendingApprovalCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white bg-[#ef4444] px-1">
                  {pendingApprovalCount}
                </span>
              )}
            </button>
            {/* 网关按钮 */}
            <button
              onClick={() => setShowGatewayPanel(!showGatewayPanel)}
              className={`relative px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                showGatewayPanel
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]'
              }`}
              title="消息网关"
            >
              <span className="text-sm">🌐</span>
              网关
              {/* 新消息红点提示 */}
              {gatewayNewCount > 0 && !showGatewayPanel && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white bg-[#ef4444] px-1">
                  {gatewayNewCount > 99 ? '99+' : gatewayNewCount}
                </span>
              )}
            </button>
            {/* Git 按钮 */}
            {gitStatus && (
              <button
                onClick={() => setShowGitPanel(!showGitPanel)}
                className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                  showGitPanel
                    ? 'bg-[#1a1a1a] text-white'
                    : 'bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]'
                }`}
                title="Git"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <span className="font-mono">{getBranchDisplay()}</span>
                {changes > 0 && (
                  <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-medium ${
                    showGitPanel ? 'bg-white text-[#1a1a1a]' : 'bg-[#1a1a1a] text-white'
                  }`}>
                    {changes}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`px-3 py-1.5 rounded text-xs transition-all ${
                showTerminal
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]'
              }`}
              title="终端"
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                终端
              </span>
            </button>
            <button
              onClick={() => setShowTaskSidebar(!showTaskSidebar)}
              className={`px-3 py-1.5 rounded text-xs transition-all ${
                showTaskSidebar
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]'
              }`}
            >
              任务面板
            </button>
            <button
              onClick={openSettings}
              className="px-3 py-1.5 bg-white border border-[#e5e5e5] rounded text-xs text-[#666] hover:bg-[#f0f0f0] transition-all"
            >
              设置
            </button>
          </div>
        </header>

        {/* 聊天内容 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
            <ChatView />
          </div>

          {/* 终端面板 - 可折叠 */}
          <TerminalPanel
            isOpen={showTerminal}
            onToggle={() => setShowTerminal(false)}
          />
        </div>

        {/* 状态栏 */}
        <footer className="h-7 bg-white border-t border-[#e5e5e5] flex items-center justify-between px-4 text-xs text-[#999]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#10b981]' : 'bg-[#ef4444]'}`} />
              <span>{isConnected ? '已连接' : '未连接'}</span>
            </span>
            <span>{currentWorkspace?.path || ''}</span>
          </div>
          <div>
            <span>Pi Desktop v0.2.0</span>
          </div>
        </footer>
      </main>

      {/* Git 面板 */}
      {showGitPanel && (
        <ResizablePanel defaultWidth={340} minWidth={280} maxWidth={500} side="right">
          <div className="h-full bg-white border-l border-[#e5e5e5]">
            <GitPanel />
          </div>
        </ResizablePanel>
      )}

      {/* 审批面板 */}
      <ApprovalPanel
        isOpen={showApprovalPanel}
        onToggle={() => setShowApprovalPanel(false)}
      />

      {/* 网关面板 */}
      <GatewayPanel
        isOpen={showGatewayPanel}
        onToggle={() => setShowGatewayPanel(false)}
      />

      {/* 右侧任务侧边栏 */}
      <TaskSidebar
        isVisible={showTaskSidebar}
        onToggle={() => setShowTaskSidebar(false)}
      />

      {/* 设置弹窗 */}
      <SettingsPanel />
    </div>
  );
}

export default App;
