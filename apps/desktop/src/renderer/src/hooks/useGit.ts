// useGit Hook (M7-3 重写 — 内部保持 workspacePath)
// 包装 window.piAPI.git* — branch / status / diff / log / add / commit
// 不再自己 execSync, 全部走 main process IPC
//
// 用法: const git = useGit(workspacePath); 然后 git.refresh() 不需要参数

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isIpcError } from "@shared";
import type { BranchInfo, CommitInfo } from "../types";
import type { GitChangedFile } from "@shared";

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
    unstage: (files: string[]) => Promise<void>;
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
    checkout: (branch: string) => Promise<BranchInfo[]>;
    createBranch: (branchName: string) => Promise<BranchInfo[]>;
    getOriginalContent: (filePath: string) => Promise<string>;
    getChangedFiles: () => Promise<GitChangedFile[]>;
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

    // Revision guard: increments on each refresh call. After Promise.all
    // resolves, if the ref no longer matches our snapshot, a newer refresh
    // has superseded us — discard the stale result to avoid clobbering state.
    const revisionRef = useRef(0);

    const refresh = useCallback(async () => {
        if (!window.piAPI || !path) return;
        const myRevision = ++revisionRef.current;
        setIsLoading(true);
        setError(null);
        try {
            const [s, b, l] = await Promise.all([
                window.piAPI.getGitStatus(path),
                window.piAPI.gitBranches(path).catch(() => [] as BranchInfo[]),
                window.piAPI.gitLog(path, 20).catch(() => [] as CommitInfo[]),
            ]);
            if (revisionRef.current !== myRevision) return; // stale, discard
            if (isIpcError(s)) throw new Error(s.fallback);
            setStatus(s ?? null);
            setBranches(isIpcError(b) ? [] : b);
            setLog(isIpcError(l) ? [] : l);
        } catch (err) {
            if (revisionRef.current !== myRevision) return; // stale, discard
            setError(err instanceof Error ? err.message : String(err));
            setStatus(null);
        } finally {
            if (revisionRef.current === myRevision) {
                setIsLoading(false);
            }
        }
    }, [path]);

    const diff = useCallback(async (filePath?: string) => {
        if (!window.piAPI || !path) return "";
        const result = await window.piAPI.gitDiff(path, filePath);
        if (isIpcError(result)) throw new Error(result.fallback);
        return result;
    }, [path]);

    const add = useCallback(async (files: string[]) => {
        if (!window.piAPI || !path) return;
        const result = await window.piAPI.gitAdd(path, files);
        if (isIpcError(result)) throw new Error(result.fallback);
        await refresh();
    }, [path, refresh]);

    const unstage = useCallback(async (files: string[]) => {
        if (!window.piAPI?.gitUnstage || !path) return;
        const result = await window.piAPI.gitUnstage(path, files);
        if (isIpcError(result)) throw new Error(result.fallback);
        await refresh();
    }, [path, refresh]);

    const commit = useCallback(async (message: string) => {
        if (!window.piAPI || !path) throw new Error("无 workspacePath");
        const hash = await window.piAPI.gitCommit(path, message);
        if (isIpcError(hash)) throw new Error(hash.fallback);
        await refresh();
        return hash;
    }, [path, refresh]);

    const undo = useCallback(async (filePath: string) => {
        if (!window.piAPI || !path) return;
        const result = await window.piAPI.gitUndo(path, filePath);
        if (isIpcError(result)) throw new Error(result.fallback);
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
        if (isIpcError(s)) throw new Error(s.fallback);
        if (s) setStatus(s as GitStatus);
        return s as GitStatus | undefined;
    }, [path]);
    const loadDiff = diff;
    const loadStagedDiff = useCallback(async () => {
        if (!window.piAPI || !path) return "";
        const result = await window.piAPI.gitDiffStaged(path);
        if (isIpcError(result)) throw new Error(result.fallback);
        return result;
    }, [path]);
    const stageFiles = add;
    const loadBranches = useCallback(async () => {
        if (!window.piAPI || !path) return [];
        const bs = await window.piAPI.gitBranches(path);
        if (isIpcError(bs)) throw new Error(bs.fallback);
        setBranches(bs);
        return bs;
    }, [path]);
    const loadCommits = useCallback(async (count = 20) => {
        if (!window.piAPI || !path) return [];
        const cs = await window.piAPI.gitLog(path, count);
        if (isIpcError(cs)) throw new Error(cs.fallback);
        setLog(cs);
        return cs;
    }, [path]);
    const checkout = useCallback(async (branch: string) => {
        if (!window.piAPI?.gitCheckout || !path) return [];
        const result = await window.piAPI.gitCheckout(path, branch);
        if (isIpcError(result)) throw new Error(result.fallback);
        setBranches(result);
        await refresh();
        return result;
    }, [path, refresh]);
    const createBranch = useCallback(async (branchName: string) => {
        if (!window.piAPI?.gitCreateBranch || !path) return [];
        const result = await window.piAPI.gitCreateBranch(path, branchName);
        if (isIpcError(result)) throw new Error(result.fallback);
        setBranches(result);
        await refresh();
        return result;
    }, [path, refresh]);
    const getOriginalContent = useCallback(async (filePath: string) => {
        if (!window.piAPI?.gitOriginalContent || !path) return "";
        const result = await window.piAPI.gitOriginalContent(path, filePath);
        if (isIpcError(result)) throw new Error(result.fallback);
        return result;
    }, [path]);
    const getChangedFiles = useCallback(async () => {
        if (!window.piAPI?.gitChangedFiles || !path) return [];
        const result = await window.piAPI.gitChangedFiles(path);
        if (isIpcError(result)) throw new Error(result.fallback);
        return result;
    }, [path]);
    const getBranchDisplay = useCallback(() => status?.branch ?? "main", [status]);
    const getChangeCount = useCallback(() => {
        if (!status) return 0;
        return status.modified.length + status.added.length + status.deleted.length + status.untracked.length;
    }, [status]);
    const getStatusColor = useCallback(() => "text-[#10b981]", []);

    return useMemo(() => ({
        status, branches, log, isLoading, error, refresh, diff, add, unstage, commit, undo,
        commits, stagedDiff, refreshStatus, loadDiff, loadStagedDiff, stageFiles,
        loadBranches, loadCommits, checkout, createBranch, getOriginalContent, getChangedFiles,
        getBranchDisplay, getChangeCount, getStatusColor,
    }), [
        add,
        branches,
        checkout,
        commit,
        commits,
        createBranch,
        diff,
        error,
        getBranchDisplay,
        getChangeCount,
        getChangedFiles,
        getOriginalContent,
        getStatusColor,
        isLoading,
        loadBranches,
        loadCommits,
        loadDiff,
        loadStagedDiff,
        log,
        refresh,
        refreshStatus,
        stagedDiff,
        stageFiles,
        status,
        undo,
        unstage,
    ]);
}
