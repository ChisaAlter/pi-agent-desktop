import { useEffect, useState } from "react";

export interface FileReview {
    changeId: string;
    toolCallId: string;
    filePath: string;
    diff: string;
    newContent: string;
    timestamp: number;
}

interface EditReviewListProps {
    workspacePath: string;
    onApprove?: (changeId: string) => void;
}

declare global {
    interface Window {
        piAPI?: {
            onApprovalReview: (cb: (review: FileReview) => void) => () => void;
            onApprovalDeferred: (cb: (deferred: { changeId: string; toolCallId: string; filePath: string; op: string; timestamp: number }) => void) => () => void;
            gitUndo: (workspacePath: string, filePath: string) => Promise<void>;
        };
    }
}

export function EditReviewList({ workspacePath, onApprove }: EditReviewListProps): JSX.Element {
    const [deferred, setDeferred] = useState<Map<string, { filePath: string; op: string; timestamp: number }>>(new Map());
    const [reviews, setReviews] = useState<Map<string, FileReview>>(new Map());

    useEffect(() => {
        if (!window.piAPI?.onApprovalDeferred) return;
        const unsub = window.piAPI.onApprovalDeferred((d) => {
            setDeferred((m) => {
                const next = new Map(m);
                next.set(d.changeId, { filePath: d.filePath, op: d.op, timestamp: d.timestamp });
                return next;
            });
        });
        return unsub;
    }, []);

    useEffect(() => {
        if (!window.piAPI?.onApprovalReview) return;
        const unsub = window.piAPI.onApprovalReview((r) => {
            setReviews((m) => {
                const next = new Map(m);
                next.set(r.changeId, r);
                return next;
            });
        });
        return unsub;
    }, []);

    const approve = (changeId: string) => {
        setDeferred((m) => {
            const next = new Map(m);
            next.delete(changeId);
            return next;
        });
        setReviews((m) => {
            const next = new Map(m);
            next.delete(changeId);
            return next;
        });
        onApprove?.(changeId);
    };

    const undo = async (changeId: string) => {
        const review = reviews.get(changeId);
        if (!review) return;
        try {
            await window.piAPI?.gitUndo(workspacePath, review.filePath);
        } catch (err) {
            console.error("[EditReviewList] git undo failed:", err);
        }
        approve(changeId);
    };

    const allIds = new Set([...deferred.keys(), ...reviews.keys()]);
    if (allIds.size === 0) {
        return (
            <div className="p-3 text-xs text-[#999]">
                文件改动会显示在这里
            </div>
        );
    }

    return (
        <div className="p-2 space-y-2">
            {[...allIds].map((changeId) => {
                const review = reviews.get(changeId);
                const def = deferred.get(changeId);
                if (!def) return null;

                return (
                    <div key={changeId} className="bg-white border border-[#e5e5e5] rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium text-[#1a1a1a] truncate" title={def.filePath}>
                                📄 {def.filePath}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[#999] uppercase">{def.op}</span>
                                {review ? (
                                    <>
                                        <button
                                            onClick={() => undo(changeId)}
                                            className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded transition-all"
                                        >
                                            撤销
                                        </button>
                                        <button
                                            onClick={() => approve(changeId)}
                                            className="text-xs px-2 py-1 text-[#666] hover:bg-gray-100 rounded transition-all"
                                        >
                                            接受
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-xs text-[#999]">运行中…</span>
                                )}
                            </div>
                        </div>
                        {review && (
                            <pre className="bg-gray-50 rounded p-2 text-[10px] text-[#1a1a1a] overflow-auto max-h-40 font-mono whitespace-pre">
                                {review.diff}
                            </pre>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
