import React, { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";

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

export function WorkspaceSwitcher(): React.JSX.Element {
    const { t } = useI18n();
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
    const [open, setOpen] = useState(false);
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

    return (
        <div className="relative flex items-center" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={open}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                title={current?.path ?? t("sidebar.workspaceNone")}
            >
                <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                    <IconFolder />
                </span>
                <span className="max-w-[140px] truncate">{current?.name ?? t("sidebar.workspaceNone")}</span>
                <IconChevronDown />
            </button>
            {open && workspaces.length > 0 && (
                <ul
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] py-1 shadow-lg"
                >
                    {workspaces.map((ws) => (
                        <li key={ws.id}>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setCurrentWorkspace(ws.id);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--mm-bg-hover)] ${
                                    ws.id === currentWorkspaceId
                                        ? "font-medium text-[var(--mm-text-primary)]"
                                        : "text-[var(--mm-text-secondary)]"
                                }`}
                            >
                                <span className="truncate">{ws.name}</span>
                                {ws.id === currentWorkspaceId && (
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mm-bg-active)]" aria-hidden="true" />
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}