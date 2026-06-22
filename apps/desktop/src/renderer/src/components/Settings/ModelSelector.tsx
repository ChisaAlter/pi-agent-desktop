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
      <h3 className="text-md font-medium text-[var(--mm-text-primary)]">Pi 模型配置</h3>

      {models.length === 0 ? (
        <div className="py-4 text-center text-sm text-[var(--mm-text-secondary)]">
          未检测到 Pi 配置。请确保 <code className="text-yellow-400">~/.pi/agent/models.json</code> 存在。
        </div>
      ) : (
        <>
          {/* 模型选择 */}
          <div>
            <label className="mb-2 block text-sm text-[var(--mm-text-secondary)]">选择模型</label>
            <div className="space-y-2">
              {models.map((model) => (
                <div
                  key={model.id}
                  onClick={() => updateSettings({ model: model.id, provider: model.provider })}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    settings.model === model.id
                      ? 'border border-[var(--mm-accent-blue)] bg-[var(--settings-bg-active)]'
                      : 'border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] hover:border-[var(--mm-border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-[var(--mm-text-primary)]">{model.name}</div>
                      <div className="mt-0.5 text-xs text-[var(--mm-text-secondary)]">{model.description}</div>
                    </div>
                    <div className="ml-2 shrink-0 text-xs text-[var(--mm-text-tertiary)]">{model.providerName || model.provider}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      
      {/* Temperature */}
      <div>
        <label className="mb-2 block text-sm text-[var(--mm-text-secondary)]">
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
        <div className="mt-1 flex justify-between text-xs text-[var(--mm-text-tertiary)]">
          <span>精确</span>
          <span>创意</span>
        </div>
      </div>
      
      {/* Max Tokens */}
      <div>
        <label className="mb-2 block text-sm text-[var(--mm-text-secondary)]">最大 Token 数</label>
        <select
          value={settings.maxTokens}
          onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
          className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-[var(--mm-text-primary)]"
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
        <div className="rounded-lg bg-[var(--mm-bg-panel)] p-3">
          <div className="text-sm text-[var(--mm-text-secondary)]">
            <div className="mb-1 font-medium text-[var(--mm-text-primary)]">当前模型：{selectedModel.name}</div>
            <div>服务商：{selectedModel.providerName || selectedModel.provider}</div>
            {selectedModel.maxTokens && <div>最大 Token：{selectedModel.maxTokens.toLocaleString()}</div>}
            <div>温度参数：{settings.temperature}</div>
          </div>
        </div>
      )}
    </div>
  );
}
