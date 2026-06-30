import React, { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore, type Workspace } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";
import { groupSessionsByWorkspace, sessionDepth } from "../../utils/session-grouping";
import { SessionRow } from "./SessionRow";

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

function GroupHeader({ workspace, count, expanded, onToggle, onSwitch }: GroupHeaderProps): React.JSX.Element {
  return (
    <div className="group flex items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={workspace.path}
        className="flex h-8 w-full items-center gap-2 rounded-[var(--mm-radius-sm)] px-3 text-[12px] font-medium text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none"
      >
        <span className="text-[10px] text-[var(--mm-text-tertiary)]" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onSwitch(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onSwitch(); } }}
          className="min-w-0 flex-1 truncate text-left hover:underline"
        >
          {workspace.name}
        </span>
        <span className="ml-auto shrink-0 rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
          {count}
        </span>
      </button>
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
            {expanded &&
              groupSessions.map((session) => (
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
                />
              ))}
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
            <span className="text-[10px] text-[var(--mm-text-tertiary)]" aria-hidden="true">
              {archivedExpanded ? "▾" : "▸"}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{t("sidebar.sessions.archived")}</span>
            <span className="ml-auto shrink-0 rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
              {archivedSessions.length}
            </span>
          </button>
          {archivedExpanded &&
            archivedSessions.map((session) => (
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
      )}
    </div>
  );
}
