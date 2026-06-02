// ErrorBoundary (M5 Task M5-4)
// 兜底任何 React 渲染错误, 显示 fallback UI 而不是白屏
// v1.0.6: reportError 走 logger 通道 (Sentry 接入留给 v1.0.7+)
// v1.0.7: fallback UI 文案走 t() (ErrorBoundary 自身不在 Provider 内, 用 useI18n 包装默认 fallback)

import React from "react";
import { logger } from "../../utils/logger";
import { useI18n } from "../../i18n";

interface Props {
    children: React.ReactNode;
    /** 自定义 fallback */
    fallback?: (err: Error, reset: () => void) => React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * M7: 错误上报入口 (单点).
 * 暴露为独立函数便于在 componentDidCatch 之外 (例如事件处理器、
 * async 边界) 也能复用同一通道.
 *
 * @param error 抛出的错误
 * @param info  React 提供的 componentStack (或其它上下文)
 */
export function reportError(error: Error, info?: React.ErrorInfo): void {
    // 这里走 logger (主进程 electron-log) 而非 console, 这样错误在生产也能落盘.
    // 后续接 Sentry 就在这里加 Sentry.captureException.
    logger.error("[ErrorBoundary] Caught:", error, info ?? {});
}

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        reportError(error, info);
    }

    reset = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): React.ReactNode {
        if (this.state.hasError && this.state.error) {
            if (this.props.fallback) {
                return this.props.fallback(this.state.error, this.reset);
            }
            return <DefaultErrorFallback error={this.state.error} onReset={this.reset} />;
        }
        return this.props.children;
    }
}

function DefaultErrorFallback({ error, onReset }: { error: Error; onReset: () => void }): React.JSX.Element {
    const { t } = useI18n();
    return (
        <div className="flex items-center justify-center h-screen bg-[#f5f5f5] p-4">
            <div className="bg-white rounded-2xl p-8 max-w-md shadow-lg">
                <div className="text-4xl mb-3">😵</div>
                <h1 className="text-lg font-semibold text-[#1a1a1a] mb-2">
                    {t("errorBoundary.title")}
                </h1>
                <p className="text-sm text-[#666] mb-4">
                    {t("errorBoundary.description")}
                </p>
                <pre className="text-xs text-[#ef4444] bg-red-50 border border-red-200 rounded p-3 overflow-auto max-h-40 mb-4 font-mono whitespace-pre-wrap break-all">
                    {error.message}
                </pre>
                <div className="flex gap-2">
                    <button
                        onClick={onReset}
                        className="px-4 py-2 bg-[#1a1a1a] text-white rounded text-sm hover:bg-[#333] transition-colors"
                    >
                        {t("errorBoundary.retry")}
                    </button>
                    <button
                        onClick={() => location.reload()}
                        className="px-4 py-2 border border-[#e5e5e5] text-[#666] rounded text-sm hover:bg-[#f5f5f5] transition-colors"
                    >
                        {t("errorBoundary.reload")}
                    </button>
                </div>
            </div>
        </div>
    );
}
