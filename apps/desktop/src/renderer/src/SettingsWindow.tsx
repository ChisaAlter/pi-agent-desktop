// 独立设置窗口 — 不含模态 chrome, 自带 I18nProvider 和主题初始化.

import React, { useEffect } from 'react';
import type { SettingsWindowTab } from '@shared';
import { useSettingsStore } from './stores/settings-store';
import { I18nProvider, useI18n } from './i18n';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { SettingsContent } from './components/Settings/SettingsContent';
import { MiniMaxCodeTitleBar } from './components/MiniMaxCode/MiniMaxCodeTitleBar';
import { applyTheme, watchSystemTheme, type Theme } from './utils/theme';

function SettingsShell(): React.JSX.Element {
    const { settings, loadPiConfig, flushPendingSettingsWrite } = useSettingsStore();
    const { t } = useI18n();
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
        let active = true;
        const selectTab = (tab: SettingsWindowTab): void => {
            window.dispatchEvent(new CustomEvent("settings:select-tab", { detail: { tab } }));
        };
        const unsubscribe = window.piAPI?.onSettingsTabSelected?.(selectTab);
        const ready = window.piAPI?.settingsWindowReady?.();
        if (ready) {
            void ready.then((tab) => {
                if (active && tab) selectTab(tab);
            }).catch(() => undefined);
        }
        return () => {
            active = false;
            if (typeof unsubscribe === "function") unsubscribe();
        };
    }, []);

    // 设置窗口是独立 renderer 进程, store 默认态是 defaultSettings; 不调 init() 会导致
    // longHorizon 等无 localStorage 缓存的字段始终显示默认值 (Goal 开关跨重启回退 bug).
    useEffect(() => {
        useSettingsStore.getState().init();
        return () => useSettingsStore.getState().dispose();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.piAPI) return;
        void window.piAPI.windowIsMaximized?.().then(setIsMaximized).catch(() => undefined);
        const unsub = window.piAPI.onWindowMaximizeChanged?.((max) => setIsMaximized(max));
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    const handleCloseWindow = React.useCallback(() => {
        void flushPendingSettingsWrite().catch(() => undefined);
        void window.piAPI?.windowClose?.();
    }, [flushPendingSettingsWrite]);

    return (
        <div
            className="flex h-screen w-screen overflow-hidden bg-transparent p-0 text-[var(--mm-text-primary)]"
            style={{ "--mm-height-titlebar": "34px" } as React.CSSProperties}
        >
            <div
                className={`settings-window-enter flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--mm-border)] bg-[var(--mm-bg-main)] ${
                    isMaximized ? 'rounded-none shadow-none' : 'rounded-[var(--mm-window-radius)] shadow-[var(--mm-window-shadow)]'
                }`}
                data-testid="settings-window-frame"
                data-settings-window-motion="enter"
                data-mmcode-layout="window-frame"
                data-mm-window-kind="settings"
            >
                <MiniMaxCodeTitleBar title={t('settings.title')} variant="settings" className="settings-window-titlebar" onClose={handleCloseWindow} />
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
