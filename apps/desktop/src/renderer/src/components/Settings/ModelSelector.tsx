// Model Selector Component

import React from 'react';
import { useSettingsStore } from '../../stores/settings-store';

export function ModelSelector(): React.JSX.Element {
  const { settings, updateSettings, piModels } = useSettingsStore();

  // 优先使用从 Pi 配置中读取的模型列表
  const models = piModels && piModels.length > 0 ? piModels : [];
  
  const selectedModel = models.find(m => m.id === settings.model);
  
  return (
    <div className="space-y-4">
      <h3 className="text-md font-medium text-white">Pi 模型配置</h3>

      {models.length === 0 ? (
        <div className="text-sm text-gray-400 py-4 text-center">
          未检测到 Pi 配置。请确保 <code className="text-yellow-400">~/.pi/agent/models.json</code> 存在。
        </div>
      ) : (
        <>
          {/* 模型选择 */}
          <div>
            <label className="block text-sm text-gray-300 mb-2">选择模型</label>
            <div className="space-y-2">
              {models.map((model) => (
                <div
                  key={model.id}
                  onClick={() => updateSettings({ model: model.id, provider: model.provider })}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    settings.model === model.id
                      ? 'bg-blue-600 border border-blue-500'
                      : 'bg-gray-700 border border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">{model.name}</div>
                      <div className="text-xs text-gray-300 mt-0.5">{model.description}</div>
                    </div>
                    <div className="text-xs text-gray-400 ml-2 shrink-0">{(model as any).providerName || model.provider}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      
      {/* Temperature */}
      <div>
        <label className="block text-sm text-gray-300 mb-2">
          温度参数：{settings.temperature}
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
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>精确</span>
          <span>创意</span>
        </div>
      </div>
      
      {/* Max Tokens */}
      <div>
        <label className="block text-sm text-gray-300 mb-2">最大 Token 数</label>
        <select
          value={settings.maxTokens}
          onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2"
        >
          <option value="1024">1,024</option>
          <option value="2048">2,048</option>
          <option value="4096">4,096</option>
          <option value="8192">8,192</option>
          <option value="16384">16,384</option>
        </select>
      </div>
      
      {/* 当前模型信息 */}
      {selectedModel && (
        <div className="bg-gray-700 rounded-lg p-3">
          <div className="text-sm text-gray-300">
            <div className="font-medium text-white mb-1">当前模型：{selectedModel.name}</div>
            <div>服务商：{(selectedModel as any).providerName || selectedModel.provider}</div>
            {selectedModel.maxTokens && <div>最大 Token：{selectedModel.maxTokens.toLocaleString()}</div>}
            <div>温度参数：{settings.temperature}</div>
          </div>
        </div>
      )}
    </div>
  );
}