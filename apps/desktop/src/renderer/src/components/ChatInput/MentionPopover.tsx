import React, { useEffect, useState } from "react";
import { fuzzyScore } from "../../utils/fuzzy-match";

interface MentionPopoverProps {
    query: string;
    workspacePath: string;
    onSelect: (filePath: string) => void;
    onClose: () => void;
}

export function MentionPopover({ query, workspacePath, onSelect, onClose }: MentionPopoverProps): React.ReactElement {
    const [results, setResults] = useState<string[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);

    useEffect(() => {
        if (!window.piAPI?.filesList) {
            setResults([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(() => {
            window.piAPI.filesList(workspacePath, query).then((all) => {
                if (cancelled) return;
                const scored = all
                    .map((f) => ({ f, s: fuzzyScore(f, query) }))
                    .filter((x) => x.s > 0)
                    .sort((a, b) => b.s - a.s)
                    .slice(0, 8)
                    .map((x) => x.f);
                setResults(scored);
                setActiveIdx(0);
            });
        }, 100); // debounce
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, workspacePath]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            // 忽略 input/textarea 里的按键 (textarea 自己处理)
            if (target.tagName === "INPUT") return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[activeIdx]) {
                e.preventDefault();
                onSelect(results[activeIdx]);
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [results, activeIdx, onSelect, onClose]);

    if (results.length === 0) {
        return (
            <div className="absolute bottom-full mb-2 left-0 bg-white border border-[#e5e5e5] rounded-lg shadow-xl p-3 text-xs text-[#999] min-w-[280px]">
                {query ? "没有匹配的文件" : "输入文件名搜索…"}
            </div>
        );
    }

    return (
        <div className="absolute bottom-full mb-2 left-0 bg-white border border-[#e5e5e5] rounded-lg shadow-xl p-1 min-w-[320px] max-h-[300px] overflow-auto">
            {results.map((f, i) => (
                <button
                    key={f}
                    onClick={() => onSelect(f)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                        i === activeIdx ? "bg-[#f0f0f0]" : "hover:bg-[#f5f5f5]"
                    }`}
                >
                    <span className="text-[#999]">📄</span>
                    <span className="truncate text-[#1a1a1a]">{f}</span>
                </button>
            ))}
        </div>
    );
}
