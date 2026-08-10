import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "../../stores/session-store";

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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--mm-text-primary)] transition-[background-color,color,transform] duration-75 hover:bg-[var(--mm-bg-hover)] active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
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
  baseIndent?: number;
}

function SessionRowImpl({
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
  baseIndent = 8,
}: SessionRowProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  // Explicit hover/focus state so only one row shows actions at a time
  // (CSS group-hover can stick across adjacent rows while the pointer is between them).
  const [actionsVisible, setActionsVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Right-click menu is portaled to <body> with fixed coordinates so the
  // overflow-hidden/scroll containers in the sidebar cannot clip it.
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const MENU_GAP = 4;
  const MENU_MARGIN = 8;
  const MENU_ESTIMATED_HEIGHT = 72;

  const computeMenuPos = (anchor: DOMRect, height: number): { top: number; right: number } => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - anchor.bottom - MENU_GAP - MENU_MARGIN;
    const openBelow = spaceBelow >= height;
    return {
      // Flip above the row when it sits near the bottom edge of the viewport.
      top: openBelow
        ? anchor.bottom + MENU_GAP
        : Math.max(MENU_MARGIN, anchor.top - MENU_GAP - height),
      right: Math.max(MENU_MARGIN, vw - anchor.right + MENU_GAP),
    };
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const anchor = event.currentTarget.getBoundingClientRect();
    setMenuAnchor(anchor);
    setMenuPos(computeMenuPos(anchor, MENU_ESTIMATED_HEIGHT));
    setContextMenuOpen(true);
  };

  // Reposition once the portal is mounted so the flip decision uses the real
  // menu height instead of the estimate.
  useLayoutEffect(() => {
    if (!contextMenuOpen || !menuAnchor) return;
    const height = menuRef.current?.offsetHeight || MENU_ESTIMATED_HEIGHT;
    setMenuPos(computeMenuPos(menuAnchor, height));
  }, [contextMenuOpen, menuAnchor]);

  useEffect(() => {
    if (!contextMenuOpen) return;

    const closeIfOutside = (event: MouseEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setContextMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setContextMenuOpen(false);
    };
    const closeMenu = (): void => setContextMenuOpen(false);

    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeMenu);
    // The fixed menu no longer tracks the row inside the scroll containers,
    // so close on scroll/resize instead of letting it detach.
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);

    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenuOpen]);

  const title = session.title || t("sidebar.sessions.unnamed");
  const baseClasses =
    "flex w-full items-center gap-2 rounded-[var(--mm-radius-sm)] py-0 pr-0 text-[13px] leading-relaxed transition-[background-color,color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]";
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
            className="rounded px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded bg-[var(--color-error)] px-2 py-1 text-[11px] text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    );
  }

  if (renaming) {
    return (
      <div className="group relative flex items-center" style={{ paddingLeft: baseIndent + depth * 14 }}>
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
          className="h-9 min-w-0 flex-1 rounded-[var(--mm-radius-sm)] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 text-[13px] text-[var(--mm-text-primary)] outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
        />
      </div>
    );
  }

  // Put indent on the button itself so the selected blue pill spans the full row
  // width — no empty gutter sitting in front of the highlight.
  const titlePadLeft = Math.max(baseIndent, 10) + Math.max(0, depth) * 14;

  return (
    <div
      className="pi-motion-list-item-enter relative flex items-center"
      data-session-row={session.id}
      data-active={active ? "true" : "false"}
      onMouseEnter={() => setActionsVisible(true)}
      onMouseLeave={() => setActionsVisible(false)}
      onFocusCapture={() => setActionsVisible(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setActionsVisible(false);
      }}
      onContextMenu={openContextMenu}
      onKeyDown={(event) => {
        if (event.key === "Escape") setContextMenuOpen(false);
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={title}
        aria-current={active ? "page" : undefined}
        className={`${baseClasses} ${stateClasses} h-9 min-w-0 flex-1`}
        style={{ paddingLeft: titlePadLeft }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      </button>
      {/* State-driven visibility: only the hovered/focused row shows actions. */}
      <div
        className={`absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-0.5 shadow-[0_4px_12px_rgba(15,23,42,0.16)] transition-opacity duration-75 ${
          actionsVisible
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        data-session-actions={session.id}
        data-visible={actionsVisible ? "true" : "false"}
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
      {contextMenuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[200] min-w-[104px] rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] py-1 text-[12px] shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
            style={menuPos ? { top: menuPos.top, right: menuPos.right } : undefined}
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
              className="flex w-full items-center px-3 py-1.5 text-left text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
            >
              {t("sidebar.sessions.rename")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setContextMenuOpen(false);
                setConfirming(true);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[var(--color-error)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
            >
              {t("sidebar.sessions.delete")}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function sessionRowPropsEqual(prev: SessionRowProps, next: SessionRowProps): boolean {
  return (
    prev.active === next.active
    && prev.depth === next.depth
    && prev.archived === next.archived
    && prev.baseIndent === next.baseIndent
    && prev.t === next.t
    && prev.onSelect === next.onSelect
    && prev.onArchive === next.onArchive
    && prev.onToggleFavorite === next.onToggleFavorite
    && prev.onRename === next.onRename
    && prev.onDelete === next.onDelete
    && prev.session.id === next.session.id
    && prev.session.title === next.session.title
    && prev.session.favorite === next.session.favorite
    && prev.session.archived === next.session.archived
    && prev.session.workspaceId === next.session.workspaceId
    && +new Date(prev.session.updatedAt) === +new Date(next.session.updatedAt)
  );
}

export const SessionRow = React.memo(SessionRowImpl, sessionRowPropsEqual);
