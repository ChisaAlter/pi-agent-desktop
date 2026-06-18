// Settings tab 类型定义 — 供 SettingsContent / SettingsNav 共享.

export type SettingsTab = 'appearance' | 'model' | 'piagent' | 'config' | 'general' | 'shortcuts' | 'about';

export function isSettingsTab(value: unknown): value is SettingsTab {
    return value === 'appearance' ||
        value === 'model' ||
        value === 'piagent' ||
        value === 'config' ||
        value === 'general' ||
        value === 'shortcuts' ||
        value === 'about';
}