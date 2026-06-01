// useGit Hook (M7-3 重写 — 内部保持 workspacePath)
// 包装 window.piAPI.git* — branch / status / diff / log / add / commit
// 不再自己 execSync, 全部走 main process IPC
//
// 用法: const git = useGit(workspacePath); 然后 git.refresh() 不需要参数

import { useCallback, useEffect, useState } from "react";
import type { BranchInfo, CommitInfo } from "../types";

export interface GitStatus {
    branch: string;
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
    ahead: number;
    behind: number;
}

export interface UseGitReturn {
    status: GitStatus | null;
    branches: BranchInfo[];
    log: CommitInfo[];
    isLoading: boolean;
    error: string | null;
    /** 重新拉所有数据 */
    refresh: () => Promise<void>;
    /** 拿 diff */
    diff: (filePath?: string) => Promise<string>;
    add: (files: string[]) => Promise<void>;
    commit: (message: string) => Promise<string>;
    undo: (filePath: string) => Promise<void>;
    // compat aliases for old GitPanel
    commits: CommitInfo[];
    stagedDiff: string;
    refreshStatus: () => Promise<GitStatus | undefined>;
    loadDiff: (filePath?: string) => Promise<string>;
    loadStagedDiff: () => Promise<string>;
    stageFiles: (files: string[]) => Promise<void>;
    loadBranches: () => Promise<BranchInfo[]>;
    loadCommits: (count?: number) => Promise<CommitInfo[]>;
    getBranchDisplay: () => string;
    getChangeCount: () => number;
    getStatusColor: () => string;
}

export function useGit(workspacePath?: string): UseGitReturn {
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [branches, setBranches] = useState<BranchInfo[]>([]);
    const [log, setLog] = useState<CommitInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const path = workspacePath ?? "";

    const refresh = useCallback(async () => {
        if (!window.piAPI || !path) return;
        setIsLoading(true);
        setError(null);
        try {
            const [s, b, l] = await Promise.all([
                window.piAPI.getGitStatus(path),
                window.piAPI.gitBranches(path).catch(() => [] as BranchInfo[]),
                window.piAPI.gitLog(path, 20).catch(() => [] as CommitInfo[]),
            ]);
            setStatus(s);
            setBranches(b);
            setLog(l);
        } catch (err) {
            setError(String(err));
            setStatus(null);
        } finally {
            setIsLoading(false);
        }
    }, [path]);

    const diff = useCallback(async (filePath?: string) => {
        if (!window.piAPI || !path) return "";
        return window.piAPI.gitDiff(path, filePath);
    }, [path]);

    const add = useCallback(async (files: string[]) => {
        if (!window.piAPI || !path) return;
        await window.piAPI.gitAdd(path, files);
        await refresh();
    }, [path, refresh]);

    const commit = useCallback(async (message: string) => {
        if (!window.piAPI || !path) throw new Error("无 workspacePath");
        const hash = await window.piAPI.gitCommit(path, message);
        await refresh();
        return hash;
    }, [path, refresh]);

    const undo = useCallback(async (filePath: string) => {
        if (!window.piAPI || !path) return;
        await window.piAPI.gitUndo(path, filePath);
        await refresh();
    }, [path, refresh]);

    // 自动 refresh
    useEffect(() => {
        if (path) void refresh();
    }, [path, refresh]);

    // compat aliases
    const commits = log;
    const stagedDiff = "";
    const refreshStatus = useCallback(async (): Promise<GitStatus | undefined> => {
        if (!window.piAPI || !path) return undefined;
        const s = await window.piAPI.getGitStatus(path);
        if (s) setStatus(s as GitStatus);
        return s as GitStatus | undefined;
    }, [path]);
    const loadDiff = diff;
    const loadStagedDiff = useCallback(async () => {
        if (!window.piAPI || !path) return "";
        return window.piAPI.gitDiffStaged(path);
    }, [path]);
    const stageFiles = add;
    const loadBranches = useCallback(async () => {
        if (!window.piAPI || !path) return [];
        const bs = await window.piAPI.gitBranches(path);
        setBranches(bs);
        return bs;
    }, [path]);
    const loadCommits = useCallback(async (count = 20) => {
        if (!window.piAPI || !path) return [];
        const cs = await window.piAPI.gitLog(path, count);
        setLog(cs);
        return cs;
    }, [path]);
    const getBranchDisplay = useCallback(() => status?.branch ?? "main", [status]);
    const getChangeCount = useCallback(() => {
        if (!status) return 0;
        return status.modified.length + status.added.length + status.deleted.length + status.untracked.length;
    }, [status]);
    const getStatusColor = useCallback(() => "text-[#10b981]", []);

    return {
        status, branches, log, isLoading, error, refresh, diff, add, commit, undo,
        commits, stagedDiff, refreshStatus, loadDiff, loadStagedDiff, stageFiles,
        loadBranches, loadCommits, getBranchDisplay, getChangeCount, getStatusColor,
    };
}
