// Settings tab 类型定义 — 供 SettingsContent / SettingsNav 共享.

export type SettingsTab = 'model' | 'piagent' | 'permissions' | 'appearance' | 'general' | 'shortcuts' | 'config' | 'about';

export function isSettingsTab(value: unknown): value is SettingsTab {
    return value === 'model' ||
        value === 'piagent' ||
        value === 'permissions' ||
        value === 'appearance' ||
        value === 'general' ||
        value === 'shortcuts' ||
        value === 'config' ||
        value === 'about';
}
