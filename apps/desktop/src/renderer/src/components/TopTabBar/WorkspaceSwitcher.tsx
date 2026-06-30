import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";
import { isIpcError } from "@shared";

function IconChevronDown(): React.JSX.Element {
    return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
    );
}

function IconFolder(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    );
}

function IconSearch(): React.JSX.Element {
    return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
        </svg>
    );
}

function IconPlus(): React.JSX.Element {
    return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 5v14m-7-7h14" />
        </svg>
    );
}

function basename(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export interface WorkspaceSwitcherProps {
    variant?: "topbar" | "strip" | "inline";
    align?: "left" | "right";
}

export function WorkspaceSwitcher({ variant = "topbar", align = "left" }: WorkspaceSwitcherProps): React.JSX.Element {
    const { t } = useI18n();
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
    const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
    const createEmptyWorkspace = useWorkspaceStore((s) => s.createEmptyWorkspace);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClickOutside = (e: MouseEvent): void => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, [open]);

    const current = workspaces.find((w) => w.id === currentWorkspaceId);
    const filteredWorkspaces = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return workspaces;
        return workspaces.filter((workspace) =>
            `${workspace.name} ${workspace.path}`.toLowerCase().includes(normalized),
        );
    }, [query, workspaces]);

    const clearCurrentSessionSelection = (): void => {
        useSessionStore.setState({ currentSessionId: null });
    };

    const triggerClass = variant === "strip"
        ? "flex h-7 max-w-[240px] items-center gap-1.5 rounded-md border border-transparent px-1.5 text-[12px] leading-none text-[var(--mm-text-secondary)] transition-colors hover:border-[var(--mm-border)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
        : variant === "inline"
          ? "flex min-h-6 max-w-full items-center gap-1.5 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-[11px] text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          : "flex h-[24px] items-center gap-1 rounded-[4px] px-1.5 text-[11px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]";
    const menuAlignClass = align === "right" ? "right-0" : "left-0";

    const selectWorkspace = async (workspaceId: string): Promise<void> => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (!workspace) return;
        setError(null);
        setCurrentWorkspace(workspace.id);
        if (workspace.id !== currentWorkspaceId) {
            clearCurrentSessionSelection();
        }
        setOpen(false);
        try {
            const result = await window.piAPI?.selectWorkspace?.(workspace.path);
            if (isIpcError(result)) setError(result.fallback);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const addExistingFolder = async (): Promise<void> => {
        setError(null);
        try {
            const selected = await window.piAPI?.selectDirectory?.();
            if (!selected) return;
            if (isIpcError(selected)) {
                setError(selected.fallback);
                return;
            }
            const workspace = await createWorkspace(basename(selected), selected);
            if (!workspace) return;
            clearCurrentSessionSelection();
            setOpen(false);
            const result = await window.piAPI?.selectWorkspace?.(workspace.path);
            if (isIpcError(result)) setError(result.fallback);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const addBlankWorkspace = async (): Promise<void> => {
        setError(null);
        const name = window.prompt(t("workspaceSwitcher.promptName"), "NewProject")?.trim();
        if (!name) return;
        try {
            const parentPath = await window.piAPI?.selectDirectory?.();
            if (!parentPath) return;
            if (isIpcError(parentPath)) {
                setError(parentPath.fallback);
                return;
            }
            const workspace = await createEmptyWorkspace(name, parentPath);
            if (!workspace) return;
            clearCurrentSessionSelection();
            setOpen(false);
            const result = await window.piAPI?.selectWorkspace?.(workspace.path);
            if (isIpcError(result)) setError(result.fallback);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <div className="relative flex items-center" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={t("workspaceSwitcher.switchAria", { name: current?.name ?? t("sidebar.workspaceNone") })}
                className={triggerClass}
                title={current?.path ?? t("sidebar.workspaceNone")}
            >
                <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                    <IconFolder />
                </span>
                {variant === "strip" && <span className="shrink-0 text-[var(--mm-text-secondary)]">{t("workspaceSwitcher.prefix")}</span>}
                <span className={variant === "topbar" ? "max-w-[48px] truncate" : "min-w-0 max-w-[150px] truncate"}>
                    {current?.name ?? t("sidebar.workspaceNone")}
                </span>
                <IconChevronDown />
            </button>
            {open && (
                <div
                    role="menu"
                    className={`absolute ${menuAlignClass} top-full z-50 mt-1 w-[260px] overflow-hidden rounded-[10px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-[0_18px_44px_rgba(20,31,50,0.14)]`}
                >
                    <div className="flex items-center gap-2 border-b border-[var(--mm-border)] px-3 py-2 text-[var(--mm-text-tertiary)]">
                        <IconSearch />
                        <input
                            type="search"
                            aria-label={t("workspaceSwitcher.search")}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t("workspaceSwitcher.search")}
                            className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] outline-none"
                            autoFocus
                        />
                    </div>
                    <div className="max-h-[184px] overflow-y-auto py-1">
                        {filteredWorkspaces.length > 0 ? filteredWorkspaces.map((ws) => (
                            <button
                                key={ws.id}
                                type="button"
                                role="menuitem"
                                onClick={() => void selectWorkspace(ws.id)}
                                className={`flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--mm-bg-hover)] ${
                                    ws.id === currentWorkspaceId
                                        ? "font-medium text-[var(--mm-text-primary)]"
                                        : "text-[var(--mm-text-secondary)]"
                                }`}
                            >
                                <IconFolder />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{ws.name}</span>
                                    <span className="block truncate font-mono text-[10px] text-[var(--mm-text-tertiary)]">{ws.path}</span>
                                </span>
                                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${ws.id === currentWorkspaceId ? "bg-[var(--mm-accent-blue)]" : "bg-transparent"}`} aria-hidden="true" />
                            </button>
                        )) : (
                            <div className="px-3 py-4 text-[12px] text-[var(--mm-text-tertiary)]">{t("workspaceSwitcher.noMatches")}</div>
                        )}
                    </div>
                    <div className="border-t border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] p-1">
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => void addBlankWorkspace()}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                        >
                            <IconPlus />
                            <span>{t("workspaceSwitcher.newBlankProject")}</span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => void addExistingFolder()}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                        >
                            <IconFolder />
                            <span>{t("workspaceSwitcher.useExistingFolder")}</span>
                        </button>
                    </div>
                    {error && <div className="border-t border-[var(--mm-border)] px-3 py-2 text-[11px] text-[var(--color-error)]">{error}</div>}
                </div>
            )}
        </div>
    );
}
