import { useEffect, useState } from "react";

interface PendingRequest {
    requestId: string;
    method: string;
    title: string;
    message?: string;
}

declare global {
    interface Window {
        piAPI?: {
            onApprovalRequest: (cb: (req: PendingRequest) => void) => () => void;
            respondApproval: (requestId: string, approved: boolean) => void;
        };
    }
}

export function HighRiskModal(): JSX.Element | null {
    const [queue, setQueue] = useState<PendingRequest[]>([]);
    const [current, setCurrent] = useState<PendingRequest | null>(null);

    useEffect(() => {
        if (!window.piAPI?.onApprovalRequest) return;
        const unsub = window.piAPI.onApprovalRequest((req) => {
            setQueue((q) => [...q, req]);
        });
        return unsub;
    }, []);

    useEffect(() => {
        if (current || queue.length === 0) return;
        const [next, ...rest] = queue;
        setCurrent(next);
        setQueue(rest);
    }, [queue, current]);

    // 全局键盘 Y/N 响应
    useEffect(() => {
        if (!current) return;
        const onKey = (e: KeyboardEvent) => {
            // 忽略输入框里的按键
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
            if (e.key === "y" || e.key === "Y") {
                respond(true);
            } else if (e.key === "n" || e.key === "N" || e.key === "Escape") {
                respond(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current]);

    const respond = (approved: boolean) => {
        if (!current) return;
        window.piAPI?.respondApproval(current.requestId, approved);
        setCurrent(null);
    };

    if (!current) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
        >
            <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
                <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                        <span className="text-2xl">⚠️</span>
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold text-[#1a1a1a]">{current.title}</h2>
                    </div>
                </div>
                {current.message && (
                    <pre className="bg-gray-50 rounded-lg p-3 text-sm text-[#1a1a1a] overflow-auto max-h-48 mb-4 font-mono whitespace-pre-wrap break-all">
                        {current.message}
                    </pre>
                )}
                <p className="text-xs text-[#999] mb-4">
                    按 <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">Y</kbd> 允许，
                    <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">N</kbd> 拒绝
                </p>
                <div className="flex justify-end gap-2">
                    <button
                        onClick={() => respond(false)}
                        className="px-4 py-2 rounded-lg border border-gray-300 text-[#1a1a1a] hover:bg-gray-50 transition-all"
                    >
                        拒绝
                    </button>
                    <button
                        onClick={() => respond(true)}
                        className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all"
                    >
                        允许
                    </button>
                </div>
            </div>
        </div>
    );
}
