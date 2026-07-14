import React, { useEffect, useMemo, useState } from "react";
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
  onSwitchWorkspace: (workspaceId: string) => void;
  hideEmptyState?: boolean;
}

interface GroupHeaderProps {
  workspace: Workspace;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onSwitch: () => void;
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

function GroupHeader({ workspace, count, expanded, onToggle, onSwitch }: GroupHeaderProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        onSwitch();
        onToggle();
      }}
      aria-expanded={expanded}
      title={workspace.path}
      className="group flex h-9 w-full items-center gap-2 rounded-[var(--mm-radius-sm)] px-2 text-[12px] font-medium text-[var(--mm-text-primary)] transition-[color,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--mm-text-secondary)] active:scale-[0.96] motion-reduce:transition-none focus:outline-none"
    >
      <span className="text-[var(--mm-text-secondary)] transition-colors group-hover:text-[var(--mm-text-primary)]">
        <FolderIcon />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
      <span className="shrink-0 text-[10px] font-normal tabular-nums text-[var(--mm-text-tertiary)]">{count}</span>
      <span className="text-[var(--mm-text-tertiary)]">
        <ChevronIcon expanded={expanded} />
      </span>
    </button>
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
  onSwitchWorkspace,
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
              count={groupSessions.length}
              expanded={expanded}
              onToggle={() => toggleGroup(workspace.id)}
              onSwitch={() => onSwitchWorkspace(workspace.id)}
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
            className="flex h-8 w-full items-center gap-2 rounded-[var(--mm-radius-sm)] px-3 text-[12px] font-medium text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none"
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
