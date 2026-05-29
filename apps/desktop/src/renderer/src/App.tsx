// Pi Desktop - Codex 浅灰白色主题

import React, { useState, useEffect } from 'react';
import { ChatView } from './components/ChatView/ChatView';
import { IconBar } from './components/IconBar/IconBar';
import { ProjectPanel } from './components/ProjectPanel/ProjectPanel';
import { FloatingPanel } from './components/FloatingPanel/FloatingPanel';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { ResizablePanel } from './components/ResizablePanel';
import { useWorkspaceStore } from './stores/workspace-store';
import { useSettingsStore } from './stores/settings-store';
import { usePiDriver } from './hooks/usePiDriver';

function App(): React.JSX.Element {
  const [activePanel, setActivePanel] = useState<'chat' | 'search' | 'plugins' | 'automation' | 'settings'>('chat');
  const [showFloatingPanel, setShowFloatingPanel] = useState(true);
  const { getCurrentWorkspace } = useWorkspaceStore();
  const { isConnected } = usePiDriver();
  const { loadPiConfig, openSettings } = useSettingsStore();
  const currentWorkspace = getCurrentWorkspace();

  useEffect(() => {
    loadPiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen bg-[#f5f5f5] text-[#1a1a1a]">
      {/* 左侧图标栏 - 48px 固定宽度 */}
      <IconBar activePanel={activePanel} onPanelChange={setActivePanel} />

      {/* 左侧面板 - 可拖动调整宽度 */}
      <ResizablePanel defaultWidth={220} minWidth={180} maxWidth={400} side="left">
        <ProjectPanel activePanel={activePanel} />
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
            <button
              onClick={() => setShowFloatingPanel(!showFloatingPanel)}
              className={`px-3 py-1.5 rounded text-xs transition-all ${
                showFloatingPanel
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]'
              }`}
            >
              进度面板
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
        <div className="flex-1 overflow-hidden">
          <ChatView />
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

      {/* 右侧悬浮面板 - 浮动显示 */}
      <FloatingPanel
        isVisible={showFloatingPanel}
        onToggle={() => setShowFloatingPanel(false)}
      />

      {/* 设置弹窗 */}
      <SettingsPanel />
    </div>
  );
}

export default App;
