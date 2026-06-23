import type { Session } from "../stores/session-store";
import type { Workspace } from "../stores/workspace-store";

export function sessionMatches(session: Session, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = [
    session.title,
    session.summary,
    ...(session.tags ?? []),
    ...session.messages.map((message) => `${message.content} ${message.thinking ?? ""}`),
  ].join("\n").toLowerCase();
  return text.includes(q);
}

export function sessionDepth(session: Session, byId: Map<string, Session>): number {
  let depth = 0;
  let current = session;
  const seen = new Set<string>();
  while (current.parentSessionId && byId.has(current.parentSessionId) && !seen.has(current.parentSessionId)) {
    seen.add(current.parentSessionId);
    depth += 1;
    current = byId.get(current.parentSessionId)!;
  }
  return Math.min(depth, 4);
}

export function sessionActivityTime(session: Session): Date {
  return session.updatedAt ?? session.createdAt;
}

export function sortSessionsByActivity(sessions: Session[], byId: Map<string, Session>): Session[] {
  return [...sessions].sort((a, b) => {
    if ((a.favorite ?? false) !== (b.favorite ?? false)) return a.favorite ? -1 : 1;
    const depthDelta = sessionDepth(a, byId) - sessionDepth(b, byId);
    if (a.parentSessionId === b.id) return 1;
    if (b.parentSessionId === a.id) return -1;
    if (depthDelta !== 0 && a.parentSessionId === b.parentSessionId) return depthDelta;
    return sessionActivityTime(b).getTime() - sessionActivityTime(a).getTime();
  });
}

export interface SessionGroup {
  workspace: Workspace;
  sessions: Session[];
}

export function groupSessionsByWorkspace(sessions: Session[], workspaces: Workspace[]): SessionGroup[] {
  const sortedWorkspaces = [...workspaces].sort(
    (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
  );
  return sortedWorkspaces
    .map((workspace) => {
      const workspaceSessions = sessions.filter((session) => session.workspaceId === workspace.id);
      const byId = new Map(workspaceSessions.map((session) => [session.id, session]));
      return { workspace, sessions: sortSessionsByActivity(workspaceSessions, byId) };
    })
    .filter((group) => group.sessions.length > 0);
}
