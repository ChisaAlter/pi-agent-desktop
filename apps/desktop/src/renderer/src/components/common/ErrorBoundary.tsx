// ErrorBoundary (M5 Task M5-4)
// 兜底任何 React 渲染错误, 显示 fallback UI 而不是白屏

import React from "react";

interface Props {
    children: React.ReactNode;
    /** 自定义 fallback */
    fallback?: (err: Error, reset: () => void) => React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        // 简单 log 到 console, 实际生产可以接 Sentry 等
        // eslint-disable-next-line no-console
        console.error("[ErrorBoundary] Caught:", error, info);
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
    return (
        <div className="flex items-center justify-center h-screen bg-[#f5f5f5] p-4">
            <div className="bg-white rounded-2xl p-8 max-w-md shadow-lg">
                <div className="text-4xl mb-3">😵</div>
                <h1 className="text-lg font-semibold text-[#1a1a1a] mb-2">出错了</h1>
                <p className="text-sm text-[#666] mb-4">
                    Pi Desktop 遇到了一个未捕获的错误. 详细信息:
                </p>
                <pre className="text-xs text-[#ef4444] bg-red-50 border border-red-200 rounded p-3 overflow-auto max-h-40 mb-4 font-mono whitespace-pre-wrap break-all">
                    {error.message}
                </pre>
                <div className="flex gap-2">
                    <button
                        onClick={onReset}
                        className="px-4 py-2 bg-[#1a1a1a] text-white rounded text-sm hover:bg-[#333] transition-colors"
                    >
                        重试
                    </button>
                    <button
                        onClick={() => location.reload()}
                        className="px-4 py-2 border border-[#e5e5e5] text-[#666] rounded text-sm hover:bg-[#f5f5f5] transition-colors"
                    >
                        刷新页面
                    </button>
                </div>
            </div>
        </div>
    );
}
