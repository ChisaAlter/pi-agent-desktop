import React, { useState, useRef, useEffect } from "react";
import { useSettingsStore, type PiModelInfo } from "../../stores/settings-store";

interface ModelSelectorProps {
  className?: string;
}

export function groupByProvider(models: PiModelInfo[]): Map<string, PiModelInfo[]> {
  const groups = new Map<string, PiModelInfo[]>();
  for (const model of models) {
    const provider = model.providerName || model.provider;
    const list = groups.get(provider) ?? [];
    list.push(model);
    groups.set(provider, list);
  }
  return groups;
}

export function ModelSelector({ className }: ModelSelectorProps): React.JSX.Element | null {
  const { settings, piModels, updateSettings } = useSettingsStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentModel = piModels?.find(
    (m) => m.id === settings.model && m.provider === settings.provider,
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return;
  }, [isOpen]);

  if (!piModels || piModels.length === 0) return null;

  const groups = groupByProvider(piModels);

  return (
    <div ref={dropdownRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
        aria-label="选择模型"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="max-w-[120px] truncate">
          {currentModel ? currentModel.name : "选择模型"}
        </span>
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[240px] overflow-hidden rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-lg"
          role="listbox"
          aria-label="可用模型"
        >
          <div className="max-h-[300px] overflow-y-auto py-1">
            {Array.from(groups.entries()).map(([provider, models]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--mm-text-tertiary)]">
                  {provider}
                </div>
                {models.map((model) => {
                  const isSelected = model.id === settings.model && model.provider === settings.provider;
                  return (
                    <button
                      key={`${model.provider}:${model.id}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        updateSettings({ model: model.id, provider: model.provider });
                        setIsOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] ${
                        isSelected ? "bg-[var(--mm-bg-selected)] text-[var(--mm-text-primary)]" : "text-[var(--mm-text-secondary)]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{model.name}</div>
                        {model.description && (
                          <div className="mt-0.5 truncate text-[10px] text-[var(--mm-text-tertiary)]">
                            {model.description}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <svg className="ml-2 h-4 w-4 shrink-0 text-[var(--mm-text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
