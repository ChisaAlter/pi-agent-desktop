// 设置面板 - Codex 浅色主题

import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings-store';

export function SettingsPanel(): React.JSX.Element {
  const { settings, isOpen, closeSettings, updateSettings, resetSettings, piModels } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<'general' | 'model' | 'piagent' | 'about'>('general');
  const [piFullConfig, setPiFullConfig] = useState<any>(null);

  useEffect(() => {
    if (isOpen && window.piAPI?.getFullConfig) {
      window.piAPI.getFullConfig().then(setPiFullConfig).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return <></>;
  
  const tabs = [
    { id: 'general' as const, label: '通用' },
    { id: 'model' as const, label: '模型' },
    { id: 'piagent' as const, label: 'Pi Agent' },
    { id: 'about' as const, label: '关于' }
  ];
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e5e5]">
          <h2 className="text-lg font-semibold text-[#1a1a1a]">设置</h2>
          <button
            onClick={closeSettings}
            className="p-2 hover:bg-[#f0f0f0] rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 text-[#666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex flex-1 overflow-hidden">
          {/* 侧边栏 */}
          <div className="w-48 border-r border-[#e5e5e5] p-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#666] hover:bg-[#f0f0f0]'
                }`}
              >
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          
          {/* 内容 */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <h3 className="text-base font-medium text-[#1a1a1a]">通用设置</h3>
                
                {/* 主题 */}
                <div>
                  <label className="block text-sm text-[#666] mb-2">主题</label>
                  <select
                    value={settings.theme}
                    onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' })}
                    className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </div>
                
                {/* 字体大小 */}
                <div>
                  <label className="block text-sm text-[#666] mb-2">
                    字体大小：{settings.fontSize}px
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="20"
                    value={settings.fontSize}
                    onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}
                    className="w-full"
                  />
                </div>
                
                {/* 自动保存 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#666]">自动保存</span>
                  <button
                    onClick={() => updateSettings({ autoSave: !settings.autoSave })}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      settings.autoSave ? 'bg-[#1a1a1a]' : 'bg-[#e5e5e5]'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      settings.autoSave ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                
                {/* 显示行号 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#666]">显示行号</span>
                  <button
                    onClick={() => updateSettings({ showLineNumbers: !settings.showLineNumbers })}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      settings.showLineNumbers ? 'bg-[#1a1a1a]' : 'bg-[#e5e5e5]'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      settings.showLineNumbers ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                
                {/* 自动换行 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#666]">自动换行</span>
                  <button
                    onClick={() => updateSettings({ wordWrap: !settings.wordWrap })}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      settings.wordWrap ? 'bg-[#1a1a1a]' : 'bg-[#e5e5e5]'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      settings.wordWrap ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            )}
            
            {activeTab === 'model' && (
              <div className="space-y-6">
                <h3 className="text-base font-medium text-[#1a1a1a]">模型设置</h3>
                
                {/* 当前模型 */}
                <div>
                  <label className="block text-sm text-[#666] mb-2">当前模型</label>
                  <select
                    value={settings.model}
                    onChange={(e) => updateSettings({ model: e.target.value })}
                    className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                  >
                    {piModels ? (
                      piModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.providerName})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="mimo-v2.5-pro">mimo-v2.5-pro</option>
                        <option value="gpt-4">GPT-4</option>
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                      </>
                    )}
                  </select>
                </div>
                
                {/* 温度 */}
                <div>
                  <label className="block text-sm text-[#666] mb-2">
                    温度：{settings.temperature}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={settings.temperature}
                    onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
                
                {/* 最大 Token */}
                <div>
                  <label className="block text-sm text-[#666] mb-2">最大 Token</label>
                  <input
                    type="number"
                    value={settings.maxTokens}
                    onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
                    className="w-full bg-[#f5f5f5] text-[#1a1a1a] rounded-lg px-3 py-2.5 border border-[#e5e5e5] focus:outline-none focus:border-[#1a1a1a]"
                  />
                </div>
              </div>
            )}
            
            {activeTab === 'piagent' && (
              <div className="space-y-6">
                <h3 className="text-base font-medium text-[#1a1a1a]">Pi Agent 配置</h3>
                
                {piFullConfig ? (
                  <>
                    {/* 配置目录 */}
                    <div>
                      <label className="block text-sm text-[#666] mb-2">配置目录</label>
                      <div className="bg-[#f5f5f5] rounded-lg p-3 font-mono text-sm text-[#1a1a1a] break-all">
                        {piFullConfig.configPath}
                      </div>
                    </div>
                    
                    {/* 默认配置 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-[#666] mb-2">默认 Provider</label>
                        <div className="bg-[#f5f5f5] rounded-lg p-3 text-sm text-[#1a1a1a]">
                          {piFullConfig.defaultProvider || '未设置'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-[#666] mb-2">默认模型</label>
                        <div className="bg-[#f5f5f5] rounded-lg p-3 text-sm text-[#1a1a1a]">
                          {piFullConfig.defaultModel || '未设置'}
                        </div>
                      </div>
                    </div>
                    
                    {/* Provider 列表 */}
                    <div>
                      <label className="block text-sm text-[#666] mb-2">
                        已配置的 Provider ({piFullConfig.providers.length})
                      </label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {piFullConfig.providers.map((provider: any) => (
                          <div key={provider.id} className="bg-[#f5f5f5] rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-[#1a1a1a]">{provider.name}</span>
                              <span className="text-xs text-[#999]">{provider.modelCount} 个模型</span>
                            </div>
                            {provider.baseUrl && (
                              <div className="text-xs text-[#666] font-mono truncate">{provider.baseUrl}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#999]">加载 Pi Agent 配置中...</div>
                )}
              </div>
            )}
            
            {activeTab === 'about' && (
              <div className="space-y-4">
                <h3 className="text-base font-medium text-[#1a1a1a]">关于 Pi 桌面</h3>
                <div className="text-sm text-[#666]">
                  <p>版本：0.2.0</p>
                  <p className="mt-2">
                    Pi 桌面是一款 Windows 桌面应用程序，为 Pi Agent 提供
                    图形化界面，方便与 Pi CLI 交互。
                  </p>
                  <p className="mt-2">
                    基于 Electron + React + TypeScript 构建。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* 底部 */}
        <div className="flex items-center justify-between p-4 border-t border-[#e5e5e5]">
          <button
            onClick={resetSettings}
            className="px-4 py-2 text-sm text-[#666] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors"
          >
            恢复默认
          </button>
          <button
            onClick={closeSettings}
            className="px-4 py-2 text-sm bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}