// Provider Configuration Component

import React, { useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';

export function ProviderConfig(): React.JSX.Element {
  const { settings, updateSettings, piModels } = useSettingsStore();
  const [showApiKey, setShowApiKey] = useState(false);

  // 从 Pi 配置中提取 service provider 列表
  const piProviders = piModels
    ? [...new Map(piModels.map((m) => [m.provider, { id: m.provider, name: m.providerName || m.provider, description: `${piModels.filter(x => x.provider === m.provider).length} 个模型` }])).values()]
    : [];

  const providers = piProviders.length > 0 ? piProviders : [
    { id: 'openai', name: 'OpenAI', description: 'GPT 系列模型' },
    { id: 'anthropic', name: 'Anthropic', description: 'Claude 系列模型' },
    { id: 'azure', name: 'Azure OpenAI', description: 'Azure 托管模型' },
    { id: 'local', name: '本地', description: '本地部署模型' }
  ];
  
  return (
    <div className="space-y-4">
      <h3 className="text-md font-medium text-white">服务商配置</h3>

      {/* 服务商选择 */}
      <div>
        <label className="block text-sm text-gray-300 mb-2">选择服务商</label>
        <div className="space-y-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              onClick={() => updateSettings({ provider: provider.id })}
              className={`p-3 rounded-lg cursor-pointer transition-colors ${
                settings.provider === provider.id
                  ? 'bg-blue-600 border border-blue-500'
                  : 'bg-gray-700 border border-gray-600 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-white">{provider.name}</div>
                  <div className="text-xs text-gray-300">{provider.description}</div>
                </div>
                {settings.provider === provider.id && (
                  <span className="text-white">✓</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* API Key */}
      <div>
        <label className="block text-sm text-gray-300 mb-2">API 密钥</label>
        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={settings.apiKey || ''}
            onChange={(e) => updateSettings({ apiKey: e.target.value })}
            placeholder="请输入您的 API 密钥"
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 pr-10"
          />
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-600 rounded"
          >
            {showApiKey ? '🙈' : '👁️'}
          </button>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          您的 API 密钥仅存储在本地，不会对外共享。
        </div>
      </div>
      
      {/* Endpoint URL (for Azure) */}
      {settings.provider === 'azure' && (
        <div>
          <label className="block text-sm text-gray-300 mb-2">服务端点 URL</label>
          <input
            type="text"
            placeholder="https://your-resource.openai.azure.com"
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2"
          />
        </div>
      )}
      
      {/* Local Model Path */}
      {settings.provider === 'local' && (
        <div>
          <label className="block text-sm text-gray-300 mb-2">模型路径</label>
          <input
            type="text"
            placeholder="/path/to/model"
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2"
          />
        </div>
      )}
      
      {/* Test Connection */}
      <button
        className="w-full py-2 px-4 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
      >
        测试连接
      </button>
    </div>
  );
}