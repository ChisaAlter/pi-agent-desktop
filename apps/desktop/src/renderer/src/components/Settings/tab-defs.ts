// Settings tab 类型定义 — 供 SettingsContent / SettingsNav 共享.

export type SettingsTab = 'model' | 'piagent' | 'permissions' | 'usage' | 'longHorizon' | 'appearance' | 'general' | 'shortcuts' | 'config' | 'about' | 'herdr';

export interface SettingsSearchEntry {
    anchor: string;
    label: string;
    description?: string;
    keywords?: ReadonlyArray<string>;
}

export interface SettingsTabDefinition {
    id: SettingsTab;
    sectionId: 'common' | 'advanced' | 'maintenance' | 'agents';
    label: string;
    caption: string;
    pageTitle: string;
    pageDescription: string;
    searchEntries: ReadonlyArray<SettingsSearchEntry>;
}

export interface SettingsNavSection {
    id: 'common' | 'advanced' | 'maintenance' | 'agents';
    label: string;
    tabs: ReadonlyArray<SettingsTabDefinition>;
}

export interface SettingsSearchResult {
    id: string;
    tabId: SettingsTab;
    anchor: string;
    pageLabel: string;
    pageCaption: string;
    label: string;
    description?: string;
}

export function isSettingsTab(value: unknown): value is SettingsTab {
    return value === 'model' ||
        value === 'piagent' ||
        value === 'permissions' ||
        value === 'usage' ||
        value === 'longHorizon' ||
        value === 'appearance' ||
        value === 'general' ||
        value === 'shortcuts' ||
        value === 'config' ||
        value === 'about' ||
        value === 'herdr';
}
