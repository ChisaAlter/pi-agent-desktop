import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isIpcError, type GitBranch, type GitStatus } from "@shared";
import { useI18n } from "../../i18n";

interface DiffStats {
  additions: number;
  deletions: number;
}

interface GitRailControlsProps {
  workspacePath?: string;
  git: GitStatus | null;
  diffStats: DiffStats;
  onRefresh: () => Promise<void>;
}

interface PopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  width: number;
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}

function RowIcon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--right-rail-secondary)]" aria-hidden="true">{children}</span>;
}

function RailPopover({ anchorRef, width, ariaLabel, onClose, children }: PopoverProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 12, right: 12 });

  useLayoutEffect(() => {
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: Math.max(12, Math.min(window.innerHeight - 140, rect.top - 48)),
        right: Math.max(12, window.innerWidth - rect.left + 10),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchorRef]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  if (!document.body) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      className="fixed z-[220] max-h-[calc(100vh-24px)] overflow-y-auto rounded-[8px] border border-[var(--right-rail-border)] bg-[var(--right-rail-bg)] text-[14px] leading-5 text-[var(--right-rail-text)] shadow-[0_18px_46px_rgba(0,0,0,0.18)] [font-family:var(--right-rail-font)] tracking-[0]"
      style={{ top: position.top, right: position.right, width }}
    >
      {children}
    </div>,
    document.body,
  );
}

function resultError(result: unknown): string | null {
  return isIpcError(result) ? result.fallback : null;
}

function emitGitChanged(workspacePath: string, reason: "checkout" | "branch" | "commit" | "push"): void {
  window.dispatchEvent(new CustomEvent("workspace:git-changed", { detail: { workspacePath, reason } }));
}

export function GitRailControls({ workspacePath, git, diffStats, onRefresh }: GitRailControlsProps): React.JSX.Element {
  const { t } = useI18n();
  const branchAnchorRef = useRef<HTMLButtonElement>(null);
  const commitAnchorRef = useRef<HTMLButtonElement>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [branchSearch, setBranchSearch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [hasStagedChanges, setHasStagedChanges] = useState(false);
  const [commitBusy, setCommitBusy] = useState<"commit" | "commit-push" | "push" | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const changedPaths = useMemo(() => {
    if (!git) return [];
    return [...new Set([...git.modified, ...git.added, ...git.deleted, ...git.untracked])];
  }, [git]);
  const filteredBranches = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    return branches.filter((branch) => !branch.isRemote && (!query || branch.name.toLowerCase().includes(query)));
  }, [branchSearch, branches]);

  const openChanges = (): void => {
    window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "git" } }));
  };

  const openBranchMenu = async (): Promise<void> => {
    setCommitOpen(false);
    setBranchOpen(true);
    setBranchError(null);
    if (!workspacePath || !window.piAPI?.gitBranches) return;
    setBranchBusy(true);
    try {
      const result = await window.piAPI.gitBranches(workspacePath);
      const failure = resultError(result);
      if (failure) setBranchError(failure);
      else setBranches(result as GitBranch[]);
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchBusy(false);
    }
  };

  const checkoutBranch = async (branchName: string): Promise<void> => {
    if (!workspacePath || !window.piAPI?.gitCheckout || branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      const result = await window.piAPI.gitCheckout(workspacePath, branchName);
      const failure = resultError(result);
      if (failure) {
        setBranchError(failure);
        return;
      }
      setBranches(result as GitBranch[]);
      await onRefresh();
      emitGitChanged(workspacePath, "checkout");
      setBranchOpen(false);
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchBusy(false);
    }
  };

  const createBranch = async (): Promise<void> => {
    const branchName = newBranchName.trim();
    if (!workspacePath || !window.piAPI?.gitCreateBranch || !branchName || branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      const result = await window.piAPI.gitCreateBranch(workspacePath, branchName);
      const failure = resultError(result);
      if (failure) {
        setBranchError(failure);
        return;
      }
      setBranches(result as GitBranch[]);
      setNewBranchName("");
      await onRefresh();
      emitGitChanged(workspacePath, "branch");
      setBranchOpen(false);
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchBusy(false);
    }
  };

  const openCommitMenu = async (): Promise<void> => {
    setBranchOpen(false);
    setCommitOpen(true);
    setCommitError(null);
    if (!workspacePath || !window.piAPI?.gitDiffStaged) return;
    try {
      const result = await window.piAPI.gitDiffStaged(workspacePath);
      const failure = resultError(result);
      if (failure) setCommitError(failure);
      else setHasStagedChanges(Boolean((result as string).trim()));
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    }
  };

  const push = async (): Promise<void> => {
    if (!workspacePath || !window.piAPI?.gitPush) throw new Error(t("rightRail.gitActions.pushUnavailable"));
    const result = await window.piAPI.gitPush(workspacePath);
    const failure = resultError(result);
    if (failure) throw new Error(failure);
  };

  const commit = async (pushAfter: boolean): Promise<void> => {
    if (!workspacePath || !window.piAPI?.gitCommit || commitBusy) return;
    const operation = pushAfter ? "commit-push" : "commit";
    setCommitBusy(operation);
    setCommitError(null);
    try {
      if (includeUnstaged && changedPaths.length > 0) {
        if (!window.piAPI.gitAdd) throw new Error(t("rightRail.gitActions.stageUnavailable"));
        const addResult = await window.piAPI.gitAdd(workspacePath, changedPaths);
        const addFailure = resultError(addResult);
        if (addFailure) throw new Error(addFailure);
      }
      const stagedResult = await window.piAPI.gitDiffStaged(workspacePath);
      const stagedFailure = resultError(stagedResult);
      if (stagedFailure) throw new Error(stagedFailure);
      if (!(stagedResult as string).trim()) throw new Error(t("rightRail.gitActions.nothingToCommit"));
      const message = commitMessage.trim() || t("rightRail.gitActions.generatedMessage", { count: Math.max(1, changedPaths.length) });
      const commitResult = await window.piAPI.gitCommit(workspacePath, message);
      const commitFailure = resultError(commitResult);
      if (commitFailure) throw new Error(commitFailure);
      if (pushAfter) await push();
      setCommitMessage("");
      setHasStagedChanges(false);
      await onRefresh();
      emitGitChanged(workspacePath, pushAfter ? "push" : "commit");
      setCommitOpen(false);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitBusy(null);
    }
  };

  const pushOnly = async (): Promise<void> => {
    if (!workspacePath || commitBusy) return;
    setCommitBusy("push");
    setCommitError(null);
    try {
      await push();
      await onRefresh();
      emitGitChanged(workspacePath, "push");
      setCommitOpen(false);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitBusy(null);
    }
  };

  const canCommit = hasStagedChanges || (includeUnstaged && changedPaths.length > 0);
  const rowClass = "flex min-h-9 w-full min-w-0 items-center gap-3 rounded-[6px] px-2.5 text-left hover:bg-[var(--right-rail-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <>
      <button type="button" onClick={openChanges} className={rowClass} aria-label={t("rightRail.gitActions.openChanges")}>
        <RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="5" y="4" width="14" height="16" rx="2" strokeWidth={1.6} /><path strokeLinecap="round" strokeWidth={1.6} d="M9 9h6M9 13h6" /></svg></RowIcon>
        <span>{t("rightRail.changes")}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[12px]"><span className="text-[var(--color-success)]">+{diffStats.additions}</span><span className="text-[#dc2626]">-{diffStats.deletions}</span></span>
      </button>

      <button ref={branchAnchorRef} type="button" onClick={() => void openBranchMenu()} className={rowClass} aria-haspopup="dialog" aria-expanded={branchOpen} disabled={!git}>
        <RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="6" cy="5" r="2" strokeWidth={1.6} /><circle cx="18" cy="7" r="2" strokeWidth={1.6} /><circle cx="6" cy="19" r="2" strokeWidth={1.6} /><path d="M6 7v10M8 8.5c5 0 4-1.5 8-1.5" strokeWidth={1.6} strokeLinecap="round" /></svg></RowIcon>
        <span className="min-w-0 flex-1 truncate">{git?.branch ?? t("rightRail.noGit")}</span>
        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--right-rail-muted)]" fill="none" viewBox="0 0 16 16" stroke="currentColor"><path d="m4 6 4 4 4-4" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      <button ref={commitAnchorRef} type="button" onClick={() => void openCommitMenu()} className={rowClass} aria-label={t("rightRail.commitOrPushAria")} aria-haspopup="dialog" aria-expanded={commitOpen} disabled={!git}>
        <RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 12h5m8 0h5M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z" strokeWidth={1.6} strokeLinecap="round" /></svg></RowIcon>
        <span>{t("rightRail.commitOrPush")}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--right-rail-muted)]">{git ? `${git.ahead}/${git.behind}` : "-"}</span>
      </button>

      {branchOpen ? (
        <RailPopover anchorRef={branchAnchorRef} width={300} ariaLabel={t("rightRail.gitActions.branchDialog")} onClose={() => setBranchOpen(false)}>
          <div className="p-3">
            <label className="flex h-9 items-center gap-2 rounded-[6px] border border-[var(--right-rail-divider)] px-3 text-[13px] text-[var(--right-rail-secondary)]">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="6" strokeWidth={1.6} /><path d="m16 16 4 4" strokeWidth={1.6} strokeLinecap="round" /></svg>
              <input value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-[var(--right-rail-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]" placeholder={t("rightRail.gitActions.searchBranches")} autoFocus />
            </label>
          </div>
          <div className="px-3 pb-2 text-[12px] text-[var(--right-rail-muted)]">{t("rightRail.gitActions.branches")}</div>
          <div className="max-h-56 overflow-y-auto px-2 pb-2">
            {branchBusy && branches.length === 0 ? <p className="m-0 px-2 py-2 text-[12px] text-[var(--right-rail-muted)]">{t("rightRail.gitActions.loadingBranches")}</p> : null}
            {filteredBranches.map((branch) => (
              <button key={branch.name} type="button" onClick={() => void checkoutBranch(branch.name)} disabled={branchBusy || branch.isCurrent} className="flex min-h-11 w-full items-center gap-2 rounded-[6px] px-2 text-left hover:bg-[var(--right-rail-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] disabled:opacity-100">
                <RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 4v16M6 8h7a4 4 0 0 0 4-4" strokeWidth={1.5} strokeLinecap="round" /></svg></RowIcon>
                <span className="min-w-0 flex-1"><span className="block truncate">{branch.name}</span>{branch.isCurrent && changedPaths.length > 0 ? <span className="block text-[11px] text-[var(--right-rail-muted)]">{t("rightRail.gitActions.uncommittedFiles", { count: changedPaths.length })}</span> : null}</span>
                {branch.isCurrent ? <span aria-label={t("rightRail.gitActions.currentBranch")} className="text-[var(--right-rail-secondary)]">✓</span> : null}
              </button>
            ))}
          </div>
          {branchError ? <p className="m-0 mx-3 mb-2 rounded-[6px] bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">{branchError}</p> : null}
          <div className="border-t border-[var(--right-rail-divider)] p-3">
            <div className="flex gap-2">
              <input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createBranch(); }} className="h-9 min-w-0 flex-1 rounded-[6px] border border-[var(--right-rail-divider)] bg-transparent px-3 text-[13px] outline-none focus:border-[var(--right-rail-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]" placeholder={t("rightRail.gitActions.newBranchName")} />
              <button type="button" onClick={() => void createBranch()} disabled={!newBranchName.trim() || branchBusy} className="h-9 rounded-[6px] bg-[#202020] px-3 text-[12px] text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:opacity-35">{t("rightRail.gitActions.createAndCheckout")}</button>
            </div>
          </div>
        </RailPopover>
      ) : null}

      {commitOpen ? (
        <RailPopover anchorRef={commitAnchorRef} width={420} ariaLabel={t("rightRail.gitActions.commitDialog")} onClose={() => setCommitOpen(false)}>
          <div className="flex items-center justify-between px-4 pt-4 text-[13px] text-[var(--right-rail-muted)]"><span className="flex items-center gap-2"><RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 4v16M6 8h7a4 4 0 0 0 4-4" strokeWidth={1.5} strokeLinecap="round" /></svg></RowIcon>{git?.branch}</span><span><span className="text-[var(--color-success)]">+{diffStats.additions}</span> <span className="text-[#dc2626]">-{diffStats.deletions}</span></span></div>
          <div className="p-4">
            <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} className="h-20 w-full resize-none border-0 bg-transparent p-0 text-[14px] outline-none placeholder:text-[var(--right-rail-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]" placeholder={t("rightRail.gitActions.commitMessagePlaceholder")} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void commit(false); }} autoFocus />
            <label className="mt-3 flex min-h-9 cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={includeUnstaged} onChange={(event) => setIncludeUnstaged(event.target.checked)} className="h-4 w-4 accent-[#202020]" /><span>{t("rightRail.gitActions.includeUnstaged")}</span></label>
          </div>
          {commitError ? <p className="m-0 mx-4 mb-3 rounded-[6px] bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">{commitError}</p> : null}
          <div className="border-t border-[var(--right-rail-divider)] p-1.5">
            <button type="button" aria-label={t("rightRail.gitActions.commit")} onClick={() => void commit(false)} disabled={!canCommit || commitBusy !== null} className="flex h-9 w-full items-center gap-3 rounded-[6px] px-3 text-left hover:bg-[var(--right-rail-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] disabled:opacity-40"><RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 12h5m8 0h5M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z" strokeWidth={1.5} /></svg></RowIcon><span>{commitBusy === "commit" ? t("rightRail.gitActions.committing") : t("rightRail.gitActions.commit")}</span><span className="ml-auto text-[11px] text-[var(--right-rail-muted)]">Ctrl+Enter</span></button>
            <button type="button" aria-label={t("rightRail.gitActions.commitAndPush")} onClick={() => void commit(true)} disabled={!canCommit || commitBusy !== null} className="flex h-9 w-full items-center gap-3 rounded-[6px] px-3 text-left hover:bg-[var(--right-rail-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] disabled:opacity-40"><RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 18V6m0 0-4 4m4-4 4 4M5 18v2h14v-2" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg></RowIcon><span>{commitBusy === "commit-push" ? t("rightRail.gitActions.committingAndPushing") : t("rightRail.gitActions.commitAndPush")}</span></button>
            <button type="button" aria-label={t("rightRail.gitActions.push")} onClick={() => void pushOnly()} disabled={(git?.ahead ?? 0) === 0 || commitBusy !== null} className="flex h-9 w-full items-center gap-3 rounded-[6px] px-3 text-left hover:bg-[var(--right-rail-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] disabled:opacity-30"><RowIcon><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 19V5m0 0-4 4m4-4 4 4" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg></RowIcon><span>{commitBusy === "push" ? t("rightRail.gitActions.pushing") : t("rightRail.gitActions.push")}</span></button>
          </div>
        </RailPopover>
      ) : null}
    </>
  );
}
