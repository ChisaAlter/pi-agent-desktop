// 独立设置窗口 — 不含模态 chrome, 自带 I18nProvider 和主题初始化.

import React, { useEffect } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { I18nProvider } from './i18n';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { SettingsContent } from './components/Settings/SettingsContent';
import { MiniMaxCodeTitleBar } from './components/MiniMaxCode/MiniMaxCodeTitleBar';
import { applyTheme, watchSystemTheme, type Theme } from './utils/theme';

function SettingsShell(): React.JSX.Element {
    const { settings, loadPiConfig } = useSettingsStore();
    const [isMaximized, setIsMaximized] = React.useState(false);

    useEffect(() => {
        const theme = (settings.theme as Theme) || 'system';
        applyTheme(theme);

        if (theme === 'system') {
            const unwatch = watchSystemTheme(() => {
                applyTheme('system');
            });
            return unwatch;
        }
        return;
    }, [settings.theme]);

    useEffect(() => {
        void loadPiConfig();
    }, [loadPiConfig]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.piAPI) return;
        void window.piAPI.windowIsMaximized?.().then(setIsMaximized).catch(() => undefined);
        const unsub = window.piAPI.onWindowMaximizeChanged?.((max) => setIsMaximized(max));
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    return (
        <div
            className="flex h-screen w-screen overflow-hidden bg-transparent p-0 text-[var(--mm-text-primary)]"
            style={{ "--mm-height-titlebar": "34px" } as React.CSSProperties}
        >
            <div
                className={`flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--mm-border)] bg-[var(--mm-bg-main)] ${
                    isMaximized ? 'rounded-none shadow-none' : 'rounded-[var(--mm-window-radius)] shadow-[var(--mm-window-shadow)]'
                }`}
                data-mmcode-layout="window-frame"
                data-mm-window-kind="settings"
            >
                <MiniMaxCodeTitleBar title="系统设置" variant="settings" className="settings-window-titlebar" />
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <SettingsContent />
                </div>
            </div>
        </div>
    );
}

export default function SettingsWindow(): React.JSX.Element {
    return (
        <I18nProvider>
            <ErrorBoundary>
                <SettingsShell />
            </ErrorBoundary>
        </I18nProvider>
    );
}
