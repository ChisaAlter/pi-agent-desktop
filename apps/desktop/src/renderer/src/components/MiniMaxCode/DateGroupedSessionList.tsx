import React, { useMemo, useState } from "react";
import { useSessionStore, type Session } from "../../stores/session-store";
import { formatRelative } from "../../utils/format";
import { useI18n } from "../../i18n";
import { sessionActivityTime, sessionDepth } from "../../utils/session-grouping";

export interface DateGroupedSessionListProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  onDeleteSession: (id: string) => void;
}

function IconMessage(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h8M8 14h5m8-2a8 8 0 11-3.3-6.48L21 5l-1.05 3.15A7.96 7.96 0 0121 12z" />
    </svg>
  );
}

function SmallActionButton({
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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--mm-text-tertiary)] opacity-0 transition hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:opacity-100 group-hover:opacity-100"
    >
      {children}
    </button>
  );
}

function ArchiveIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M9 11h6" />
    </svg>
  );
}

function DeleteIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 7h12m-9 0V5h6v2m-7 3v8m4-8v8m4-8v8M8 7l1 13h6l1-13" />
    </svg>
  );
}

function RestoreIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 12a9 9 0 1 0 3-6.7M3 5v5h5" />
    </svg>
  );
}

interface SessionRowProps {
  session: Session;
  active: boolean;
  depth: number;
  relativeTime: string;
  archived: boolean;
  onSelect: () => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function SessionRow({
  session,
  active,
  depth,
  relativeTime,
  archived,
  onSelect,
  onArchive,
  onDelete,
  t,
}: SessionRowProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const title = session.title || t("sidebar.sessions.unnamed");
  const baseClasses =
    "flex w-full items-center gap-2 rounded-[var(--mm-radius-sm)] py-0 pr-2 text-[13px] leading-relaxed transition-colors focus:outline-none";
  const stateClasses = active
    ? "border-l-2 border-l-[var(--mm-bg-active)] bg-[var(--mm-bg-selected)] font-medium text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-selected)]"
    : "border-l-2 border-l-transparent bg-transparent font-normal text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]";

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

  return (
    <div className="group flex items-center gap-1" style={{ paddingLeft: 8 + depth * 14 }}>
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
        <span className="shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">{relativeTime}</span>
      </button>
      <div className="flex items-center">
        {archived ? (
          <SmallActionButton label={`${t("sidebar.sessions.restore")} ${title}`} onClick={() => onArchive(false)}>
            <RestoreIcon />
          </SmallActionButton>
        ) : (
          <>
            <SmallActionButton label={`${t("sidebar.sessions.archive")} ${title}`} onClick={() => onArchive(true)}>
              <ArchiveIcon />
            </SmallActionButton>
            <SmallActionButton label={`${t("sidebar.sessions.delete")} ${title}`} onClick={() => setConfirming(true)}>
              <DeleteIcon />
            </SmallActionButton>
          </>
        )}
      </div>
    </div>
  );
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
  onDeleteSession,
}: DateGroupedSessionListProps): React.JSX.Element {
  const sessions = useSessionStore((state) => state.sessions);
  const { t } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set([t("sidebar.sessions.dateGroup.today")]),
  );
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const activeSessions = useMemo(() => sessions.filter((s) => !s.archived), [sessions]);
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
    return (
      <div className="flex flex-col gap-2" aria-label={t("sidebar.sessions.empty")}>
        <span className="sr-only">{t("sidebar.sessions.empty")}</span>
        <div className="px-2 py-3 text-[11px] leading-5 text-[#888888]">
          还没有会话。发送第一条消息后会出现在这里。
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
                  relativeTime={formatRelative(sessionActivityTime(session), t)}
                  archived={false}
                  onSelect={() => onSelectSession(session.id)}
                  onArchive={(archived) => onArchiveSession(session.id, archived)}
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
                relativeTime={formatRelative(sessionActivityTime(session), t)}
                archived={true}
                onSelect={() => {
                  onArchiveSession(session.id, false);
                  onSelectSession(session.id);
                }}
                onArchive={(archived) => onArchiveSession(session.id, archived)}
                onDelete={() => onDeleteSession(session.id)}
                t={t}
              />
            ))}
        </div>
      )}
    </div>
  );
}
