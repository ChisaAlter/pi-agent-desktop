import React, { useEffect, useMemo, useState } from "react";
import { useSessionStore, type Session } from "../../stores/session-store";
import { useI18n } from "../../i18n";
import { sessionActivityTime, sessionDepth } from "../../utils/session-grouping";
import { SessionRow } from "./SessionRow";

export interface DateGroupedSessionListProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  onToggleFavorite?: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  hideEmptyState?: boolean;
}

interface DateGroup {
  label: string;
  sessions: Session[];
}

function getDateGroupLabel(date: Date, t: (key: string) => string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t("sidebar.sessions.dateGroup.today");
  if (diffDays === 1) return t("sidebar.sessions.dateGroup.yesterday");
  if (diffDays <= 7) return t("sidebar.sessions.dateGroup.thisWeek");
  if (diffDays <= 30) return t("sidebar.sessions.dateGroup.thisMonth");
  return t("sidebar.sessions.dateGroup.earlier");
}

function groupSessionsByDate(sessions: Session[], t: (key: string) => string): DateGroup[] {
  const groups = new Map<string, Session[]>();

  for (const session of sessions) {
    const date = sessionActivityTime(session);
    const label = getDateGroupLabel(date, t);
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(session);
  }

  // Sort sessions within each group by activity time (newest first)
  for (const group of groups.values()) {
    group.sort((a, b) => sessionActivityTime(b).getTime() - sessionActivityTime(a).getTime());
  }

  // Return groups in order: today, yesterday, thisWeek, thisMonth, earlier
  const order = [
    t("sidebar.sessions.dateGroup.today"),
    t("sidebar.sessions.dateGroup.yesterday"),
    t("sidebar.sessions.dateGroup.thisWeek"),
    t("sidebar.sessions.dateGroup.thisMonth"),
    t("sidebar.sessions.dateGroup.earlier"),
  ];

  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
}

export function DateGroupedSessionList({
  currentSessionId,
  onSelectSession,
  onArchiveSession,
  onToggleFavorite = () => undefined,
  onRenameSession = () => undefined,
  onDeleteSession,
  hideEmptyState = false,
}: DateGroupedSessionListProps): React.JSX.Element {
  const sessions = useSessionStore((state) => state.sessions);
  const { t } = useI18n();

  // Recompute default expanded groups when language changes so the "today"
  // label tracks the active locale.
  const initialGroups = useMemo(() => new Set<string>([t("sidebar.sessions.dateGroup.today")]), [t]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(initialGroups);

  useEffect(() => {
    setExpandedGroups(initialGroups);
  }, [initialGroups]);

  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const activeSessions = useMemo(() => sessions.filter((s) => !s.archived && !s.favorite), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((s) => s.archived), [sessions]);

  const groups = useMemo(() => groupSessionsByDate(activeSessions, t), [activeSessions, t]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const byIdAll = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  if (groups.length === 0 && archivedSessions.length === 0) {
    if (hideEmptyState) return <></>;
    return (
      <div className="flex flex-col gap-2" aria-label={t("sidebar.sessions.empty")}>
        <span className="sr-only">{t("sidebar.sessions.empty")}</span>
        <div className="px-2 py-3 text-[11px] leading-5 text-[#888888]">
          {t("sidebar.sessions.empty")} {t("sidebar.sessions.emptyHint")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ label, sessions: groupSessions }) => {
        const expanded = expandedGroups.has(label);
        return (
          <div key={label} className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => toggleGroup(label)}
              aria-expanded={expanded}
              className="flex h-8 w-full items-center gap-2 rounded-[var(--mm-radius-sm)] px-3 text-[12px] font-medium text-[var(--mm-text-primary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none"
            >
              <span className="text-[10px] text-[var(--mm-text-tertiary)]" aria-hidden="true">
                {expanded ? "▾" : "▸"}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <span className="ml-auto shrink-0 rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">
                {groupSessions.length}
              </span>
            </button>
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
