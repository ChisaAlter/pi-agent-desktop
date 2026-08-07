// useMentions: detect @ file references and fuzzy-match file list

import React, { useState, useCallback, useRef, useEffect } from "react";
import { findActiveMention, resolveMention, type MentionMatch } from "../utils/mention-parser";
import { fuzzyScore } from "../utils/fuzzy-match";
import { isIpcError, type FileEntry } from "@shared";

export interface MentionCandidate {
    path: string;
    /** 模糊匹配得分 */
    score: number;
}

export interface UseMentionsReturn {
    /** 当前激活的 @mention (null = 无) */
    activeMention: MentionMatch | null;
    /** 候选文件列表 (已排序, 最匹配优先) */
    candidates: MentionCandidate[];
    /** 当前高亮候选索引 (0-based) */
    highlightIndex: number;
    /** 设置高亮索引 (接受数值或函数) */
    setHighlightIndex: React.Dispatch<React.SetStateAction<number>>;
    /** 选中一个候选: 返回替换后的完整文本 (含 @filepath + 尾空格) */
    selectCandidate: (candidate: MentionCandidate) => string;
    /** 关闭候选弹出 */
    close: () => void;
}

export function useMentions(
    text: string,
    cursorPosition: number,
    workspacePath: string | undefined,
): UseMentionsReturn {
    const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
    const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestGenerationRef = useRef(0);

    // 检测 @mention 并搜索文件
    useEffect(() => {
        const requestGeneration = ++requestGenerationRef.current;
        const mention = findActiveMention(text, cursorPosition);

        if (!mention || !workspacePath) {
            setActiveMention(null);
            setCandidates([]);
            return;
        }

        setActiveMention(mention);

        // 取消之前的防抖
        if (debounceRef.current) clearTimeout(debounceRef.current);

        // 防抖 120ms, 避免每键都调 IPC
        debounceRef.current = setTimeout(async () => {
            try {
                const result = await window.piAPI?.filesList(workspacePath, mention.query);
                if (requestGeneration !== requestGenerationRef.current) return;
                if (!result || isIpcError(result)) {
                    setCandidates([]);
                    return;
                }
                const files = result as FileEntry[];
                // 模糊排序, 取前 15
                const scored = files
                    .map((f: FileEntry) => ({
                        path: f.path,
                        score: fuzzyScore(f.path, mention.query),
                    }))
                    .filter((c: MentionCandidate) => c.score > 0)
                    .sort((a: MentionCandidate, b: MentionCandidate) => b.score - a.score)
                    .slice(0, 15);
                setCandidates(scored);
                setHighlightIndex(0);
            } catch {
                if (requestGeneration !== requestGenerationRef.current) return;
                setCandidates([]);
            }
        }, 120);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [text, cursorPosition, workspacePath]);

    const selectCandidate = useCallback(
        (candidate: MentionCandidate): string => {
            if (!activeMention) return text;
            // resolveMention 替换 @query → @filepath, 再加个尾空格方便继续输入
            const replaced = resolveMention(text, activeMention, candidate.path);
            return replaced + " ";
        },
        [text, activeMention],
    );

    const close = useCallback(() => {
        requestGenerationRef.current += 1;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setActiveMention(null);
        setCandidates([]);
        setHighlightIndex(0);
    }, []);

    return {
        activeMention,
        candidates,
        highlightIndex,
        setHighlightIndex,
        selectCandidate,
        close,
    };
}
