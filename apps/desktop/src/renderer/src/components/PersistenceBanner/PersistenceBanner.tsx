// 2026-06-06 hotfix: 持久化失败提示 banner
// 当 session-store.persistErrorCount > 0 时显示, 提示用户会话数据可能没完整落盘
// 用户点 ✕ 调 clearPersistErrors 重置计数

import { useSessionStore } from "../../stores/session-store";

export function PersistenceBanner(): React.JSX.Element | null {
    const persistErrorCount = useSessionStore((s) => s.persistErrorCount);
    const lastPersistError = useSessionStore((s) => s.lastPersistError);
    const clearPersistErrors = useSessionStore((s) => s.clearPersistErrors);

    if (persistErrorCount === 0) return null;

    return (
        <div
            role="alert"
            data-persistence-banner="error"
            className="pointer-events-auto fixed inset-x-4 top-8 z-[95] mx-auto flex max-w-[960px] items-center gap-3 rounded-[10px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-2 text-sm text-[var(--mm-text-primary)] shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
        >
            <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z"
                />
            </svg>
            <span className="flex-1 truncate">
                会话数据持久化失败 {persistErrorCount} 次
                {lastPersistError ? ` — ${lastPersistError}` : ""}
            </span>
            <button
                type="button"
                onClick={() => clearPersistErrors()}
                className="shrink-0 rounded-[var(--mm-radius-sm)] px-2 py-1 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                aria-label="关闭持久化失败提示"
            >
                ✕
            </button>
        </div>
    );
}
