// 左侧图标栏 - 48px 宽，纯图标导航
// 可用度-C: 5 个导航按钮 + 新建对话按钮 加 Tooltip (hover/focus) + title + aria-label
// v1.0.4: 用户可见文案走 t()

import React from 'react';
import { Tooltip } from '../common/Tooltip';
import { useI18n } from '../../i18n';

interface IconBarProps {
  activePanel: 'chat' | 'search' | 'plugins' | 'automation' | 'settings';
  onPanelChange: (panel: 'chat' | 'search' | 'plugins' | 'automation' | 'settings') => void;
}

export const IconBar: React.FC<IconBarProps> = ({ activePanel, onPanelChange }) => {
  const { t } = useI18n();
  const icons: Array<{ id: IconBarProps['activePanel']; icon: React.ReactNode; shortcut?: string }> = [
    {
      id: 'chat',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      shortcut: 'Ctrl+N',
    },
    {
      id: 'search',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
      shortcut: 'Ctrl+K',
    },
    {
      id: 'plugins',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
    },
    {
      id: 'automation',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: 'settings',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      shortcut: 'Ctrl+,',
    },
  ];

  return (
    <nav
      className="w-12 bg-white border-r border-[#e5e5e5] flex flex-col items-center py-3 gap-1"
      role="navigation"
      aria-label={t('iconBar.mainNav')}
    >
      {/* Logo */}
      <div className="w-8 h-8 bg-[#1a1a1a] rounded-lg flex items-center justify-center mb-4" aria-hidden="true">
        <span className="text-white font-bold text-sm">π</span>
      </div>

      {/* 导航图标 */}
      <div className="flex-1 flex flex-col items-center gap-1">
        {icons.map((icon) => {
          const label = t(`iconBar.nav.${icon.id}`);
          const tooltip = icon.shortcut ? `${label} (${icon.shortcut})` : label;
          return (
            <Tooltip key={icon.id} label={tooltip} side="right">
              <button
                type="button"
                onClick={() => onPanelChange(icon.id)}
                aria-label={label}
                aria-current={activePanel === icon.id ? 'page' : undefined}
                title={label}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  activePanel === icon.id
                    ? 'bg-[#e5e5e5] text-[#1a1a1a]'
                    : 'text-[#999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'
                }`}
              >
                {icon.icon}
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* 新建对话按钮 */}
      <Tooltip label={t('iconBar.newChatTooltip')} side="right">
        <button
          type="button"
          onClick={() => onPanelChange('chat')}
          aria-label={t('iconBar.newChat')}
          title={t('iconBar.newChat')}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </Tooltip>
    </nav>
  );
};
