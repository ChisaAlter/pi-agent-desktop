import React, { useState } from "react";
import type { Session } from "../../stores/session-store";

export function IconMessage(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h8M8 14h5m8-2a8 8 0 11-3.3-6.48L21 5l-1.05 3.15A7.96 7.96 0 0121 12z" />
    </svg>
  );
}

export function SmallActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="pointer-events-none flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--mm-text-tertiary)] opacity-0 transition hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
    >
      {children}
    </button>
  );
}

export function ArchiveIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M9 11h6" />
    </svg>
  );
}

export function DeleteIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 7h12m-9 0V5h6v2m-7 3v8m4-8v8m4-8v8M8 7l1 13h6l1-13" />
    </svg>
  );
}

export function RestoreIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 12a9 9 0 1 0 3-6.7M3 5v5h5" />
    </svg>
  );
}

export function PinIcon({ pinned }: { pinned: boolean }): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M14 4l6 6-3 1-4.5 4.5V20l-2 2-3.5-7L0 11.5l2-2h4.5L11 5l3-1z" />
    </svg>
  );
}

export interface SessionRowProps {
  session: Session;
  active: boolean;
  depth: number;
  archived: boolean;
  onSelect: () => void;
  onArchive: (archived: boolean) => void;
  onToggleFavorite: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function SessionRow({
  session,
  active,
  depth,
  archived,
  onSelect,
  onArchive,
  onToggleFavorite,
  onRename,
  onDelete,
  t,
}: SessionRowProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const title = session.title || t("sidebar.sessions.unnamed");
  const baseClasses =
    "flex w-full items-center gap-2 rounded-[var(--mm-radius-sm)] py-0 pr-0 text-[13px] leading-relaxed transition-[background-color,color,box-shadow] focus:outline-none";
  const stateClasses = active
    ? "bg-[var(--mm-bg-selected)] font-medium text-[var(--mm-text-primary)] shadow-[0_4px_14px_rgba(37,99,235,0.16)] hover:bg-[var(--mm-bg-selected)]"
    : "bg-transparent font-normal text-[var(--mm-text-primary)] shadow-none hover:bg-[var(--mm-bg-hover)]";
  const pinLabel = `${session.favorite ? t("sidebar.sessions.unpin") : t("sidebar.sessions.pin")} ${title}`;

  const commitRename = (): void => {
    const trimmed = draftTitle.trim();
    setRenaming(false);
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    } else {
      setDraftTitle(session.title);
    }
  };

  if (confirming) {
    return (
      <div
        className="flex flex-col gap-1.5 rounded-[var(--mm-radius-sm)] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-[12px]"
        role="dialog"
        aria-label={t("sidebar.sessions.deleteConfirm", { name: title })}
      >
        <span className="text-[var(--mm-text-secondary)]">{t("sidebar.sessions.deleteConfirm", { name: title })}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded bg-[var(--color-error)] px-2 py-1 text-[11px] text-white hover:opacity-90"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    );
  }

  if (renaming) {
    return (
      <div className="group relative flex items-center" style={{ paddingLeft: 8 + depth * 14 }}>
        <input
          autoFocus
          value={draftTitle}
          aria-label={`${t("sidebar.sessions.renameSession")} ${title}`}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitRename();
            } else if (event.key === "Escape") {
              setDraftTitle(session.title);
              setRenaming(false);
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-[var(--mm-radius-sm)] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 text-[13px] text-[var(--mm-text-primary)] outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className="group relative flex items-center"
      style={{ paddingLeft: 8 + depth * 14 }}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenuOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setContextMenuOpen(false);
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={title}
        aria-current={active ? "page" : undefined}
        className={`${baseClasses} ${stateClasses} h-9 min-w-0 flex-1 pl-[10px]`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          <IconMessage />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      </button>
      <div
        className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        data-session-actions={session.id}
      >
        {archived ? (
          <SmallActionButton label={`${t("sidebar.sessions.restore")} ${title}`} onClick={() => onArchive(false)}>
            <RestoreIcon />
          </SmallActionButton>
        ) : (
          <>
            <SmallActionButton label={pinLabel} onClick={onToggleFavorite}>
              <PinIcon pinned={session.favorite ?? false} />
            </SmallActionButton>
            <SmallActionButton label={`${t("sidebar.sessions.archive")} ${title}`} onClick={() => onArchive(true)}>
              <ArchiveIcon />
            </SmallActionButton>
          </>
        )}
      </div>
      {contextMenuOpen && (
        <div
          role="menu"
          className="absolute right-1 top-8 z-20 min-w-[132px] rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] py-1 text-[12px] shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setContextMenuOpen(false);
              setDraftTitle(session.title);
              setRenaming(true);
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
          >
            {t("sidebar.sessions.rename")} {title}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setContextMenuOpen(false);
              setConfirming(true);
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[var(--color-error)] hover:bg-[var(--mm-bg-hover)]"
          >
            {t("sidebar.sessions.delete")} {title}
          </button>
        </div>
      )}
    </div>
  );
}
