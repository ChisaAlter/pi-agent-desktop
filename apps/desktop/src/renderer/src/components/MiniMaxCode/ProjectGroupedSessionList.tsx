import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore, type Workspace } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";
import { groupSessionsByWorkspace, sessionDepth } from "../../utils/session-grouping";
import { SessionRow } from "./SessionRow";
import { AnimatedCollapse } from "./AnimatedCollapse";

export interface ProjectGroupedSessionListProps {
  currentWorkspaceId: string | null;
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  onToggleFavorite?: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  /** Remove the workspace from the app without deleting its files on disk. */
  onRemoveWorkspace?: (workspaceId: string) => void;
  /** Create a new conversation under the given workspace (switch first, then new-task). */
  onNewConversationInWorkspace?: (workspaceId: string) => void;
  hideEmptyState?: boolean;
}

interface GroupHeaderProps {
  workspace: Workspace;
  expanded: boolean;
  onToggle: () => void;
  onNewConversation?: () => void;
  onRemove?: () => void;
  newConversationLabel: string;
  removeLabel: string;
  removeConfirmTitle: string;
  removeConfirmDescription: string;
  cancelLabel: string;
  confirmLabel: string;
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3.75 6.75A1.75 1.75 0 0 1 5.5 5h4l2 2h7A1.75 1.75 0 0 1 20.25 8.75v8.5A1.75 1.75 0 0 1 18.5 19h-13a1.75 1.75 0 0 1-1.75-1.75V6.75Z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--motion-panel)] ease-[var(--motion-ease)] motion-reduce:transition-none ${expanded ? "rotate-90" : "rotate-0"}`}
      fill="none"
      viewBox="0 0 16 16"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m6 3.5 4 4.5-4 4.5" />
    </svg>
  );
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14m-7-7h14" />
    </svg>
  );
}

function GroupHeader({
  workspace,
  expanded,
  onToggle,
  onNewConversation,
  onRemove,
  newConversationLabel,
  removeLabel,
  removeConfirmTitle,
  removeConfirmDescription,
  cancelLabel,
  confirmLabel,
}: GroupHeaderProps): React.JSX.Element {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const MENU_GAP = 4;
  const MENU_MARGIN = 8;
  const MENU_ESTIMATED_HEIGHT = 42;

  const computeMenuPos = (anchor: DOMRect, height: number): { top: number; right: number } => {
    const spaceBelow = window.innerHeight - anchor.bottom - MENU_GAP - MENU_MARGIN;
    const openBelow = spaceBelow >= height;
    return {
      top: openBelow
        ? anchor.bottom + MENU_GAP
        : Math.max(MENU_MARGIN, anchor.top - MENU_GAP - height),
      right: Math.max(MENU_MARGIN, window.innerWidth - anchor.right + MENU_GAP),
    };
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!onRemove) return;
    event.preventDefault();
    const anchor = event.currentTarget.getBoundingClientRect();
    setMenuAnchor(anchor);
    setMenuPos(computeMenuPos(anchor, MENU_ESTIMATED_HEIGHT));
    setContextMenuOpen(true);
  };

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

  if (confirming) {
    return (
      <div
        className="flex flex-col gap-1.5 rounded-[var(--mm-radius-sm)] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-[12px]"
        role="dialog"
        aria-label={removeConfirmTitle}
      >
        <strong className="font-medium text-[var(--mm-text-primary)]">{removeConfirmTitle}</strong>
        <span className="text-[var(--mm-text-secondary)]">{removeConfirmDescription}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onRemove?.();
            }}
            className="rounded bg-[var(--color-error)] px-2 py-1 text-[11px] text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative flex h-9 w-full items-center gap-1 rounded-[var(--mm-radius-sm)] px-1"
      onContextMenu={openContextMenu}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={workspace.path}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--mm-radius-sm)] px-1 text-[12px] font-medium text-[var(--mm-text-primary)] transition-[color,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--mm-text-primary)] active:scale-[0.98] motion-reduce:transition-none focus:outline-none focus-visible:bg-[var(--mm-bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--mm-accent-blue)]"
      >
        <span className="text-[var(--mm-text-secondary)] transition-colors group-hover:text-[var(--mm-text-primary)]">
          <FolderIcon />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
      </button>
      {onNewConversation ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNewConversation();
          }}
          aria-label={newConversationLabel}
          title={newConversationLabel}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--mm-radius-sm)] text-[var(--mm-text-tertiary)] opacity-0 transition-[opacity,background-color,color,transform] duration-100 hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] active:scale-[0.96] group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <PlusIcon />
        </button>
      ) : null}
      {contextMenuOpen && typeof document !== "undefined" && createPortal(
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
              setConfirming(true);
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[var(--color-error)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
          >
            {removeLabel}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ProjectGroupedSessionList({
  currentWorkspaceId,
  currentSessionId,
  onSelectSession,
  onArchiveSession,
  onToggleFavorite = () => undefined,
  onRenameSession = () => undefined,
  onDeleteSession,
  onNewConversationInWorkspace,
  onRemoveWorkspace,
  hideEmptyState = false,
}: ProjectGroupedSessionListProps): React.JSX.Element {
  const sessions = useSessionStore((state) => state.sessions);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const { t } = useI18n();

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(currentWorkspaceId ? [currentWorkspaceId] : []),
  );
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  useEffect(() => {
    if (currentWorkspaceId) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (!next.has(currentWorkspaceId)) next.add(currentWorkspaceId);
        return next;
      });
    }
  }, [currentWorkspaceId]);

  const activeSessions = useMemo(() => sessions.filter((s) => !s.archived && !s.favorite), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((s) => s.archived), [sessions]);

  const groups = useMemo(
    () => groupSessionsByWorkspace(activeSessions, workspaces),
    [activeSessions, workspaces],
  );

  const toggleGroup = (workspaceId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const byIdAll = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  if (groups.length === 0 && archivedSessions.length === 0) {
    if (hideEmptyState) return <></>;
    return (
      <div className="rounded-lg border border-dashed border-[var(--mm-border)] px-3 py-3 text-[11px] leading-5 text-[var(--mm-text-tertiary)]">
        {t("sidebar.sessions.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ workspace, sessions: groupSessions }) => {
        const expanded = expandedGroups.has(workspace.id);
        return (
          <div key={workspace.id} className="flex flex-col gap-0.5">
            <GroupHeader
              workspace={workspace}
              expanded={expanded}
              onToggle={() => toggleGroup(workspace.id)}
              onNewConversation={
                onNewConversationInWorkspace
                  ? () => onNewConversationInWorkspace(workspace.id)
                  : undefined
              }
              onRemove={onRemoveWorkspace ? () => onRemoveWorkspace(workspace.id) : undefined}
              newConversationLabel={t("sidebar.sessions.newInWorkspace", { name: workspace.name })}
              removeLabel={t("sidebar.workspaces.remove")}
              removeConfirmTitle={t("sidebar.workspaces.removeConfirmTitle", { name: workspace.name })}
              removeConfirmDescription={t("sidebar.workspaces.removeConfirmDescription")}
              cancelLabel={t("common.cancel")}
              confirmLabel={t("common.confirm")}
            />
            <AnimatedCollapse expanded={expanded}>
              <div className="flex flex-col gap-0.5 pt-0.5">
                {groupSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={currentSessionId === session.id}
                    depth={sessionDepth(session, byIdAll)}
                    archived={false}
                    onSelect={() => onSelectSession(session.id)}
                    onArchive={(archived) => onArchiveSession(session.id, archived)}
                    onToggleFavorite={() => onToggleFavorite(session.id)}
                    onRename={(title) => onRenameSession(session.id, title)}
                    onDelete={() => onDeleteSession(session.id)}
                    t={t}
                    baseIndent={24}
                  />
                ))}
              </div>
            </AnimatedCollapse>
          </div>
        );
      })}

      {archivedSessions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setArchivedExpanded((v) => !v)}
            aria-expanded={archivedExpanded}
            className="flex h-8 w-full items-center gap-2 rounded-[var(--mm-radius-sm)] px-3 text-[12px] font-medium text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:bg-[var(--mm-bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--mm-accent-blue)]"
          >
            <span className="text-[var(--mm-text-tertiary)]"><ChevronIcon expanded={archivedExpanded} /></span>
            <span className="min-w-0 flex-1 truncate text-left">{t("sidebar.sessions.archived")}</span>
            <span className="ml-auto shrink-0 rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
              {archivedSessions.length}
            </span>
          </button>
          <AnimatedCollapse expanded={archivedExpanded}>
            <div className="flex flex-col gap-0.5">
              {archivedSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={false}
                  depth={0}
                  archived={true}
                  onSelect={() => {
                    onArchiveSession(session.id, false);
                    onSelectSession(session.id);
                  }}
                  onArchive={(archived) => onArchiveSession(session.id, archived)}
                  onToggleFavorite={() => onToggleFavorite(session.id)}
                  onRename={(title) => onRenameSession(session.id, title)}
                  onDelete={() => onDeleteSession(session.id)}
                  t={t}
                />
              ))}
            </div>
          </AnimatedCollapse>
        </div>
      )}
    </div>
  );
}
