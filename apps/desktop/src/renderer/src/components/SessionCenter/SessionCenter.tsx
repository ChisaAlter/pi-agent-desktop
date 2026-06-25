import React, { useMemo, useState } from "react";
import { useSessionStore, type Session } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { formatRelative } from "../../utils/format";
import { useI18n } from "../../i18n";
import { emitWorkspaceNotice } from "../WorkspaceNoticeBanner/WorkspaceNoticeBanner";
import { isIpcError } from "@shared";
import { SessionExportDialog } from "../SessionExport/SessionExportDialog";
import { sessionMatches, sessionDepth, sessionActivityTime } from "../../utils/session-grouping";

interface SessionCenterProps {
  onOpenChat?: () => void;
}

function findMatchingMessage(session: Session, query: string): Session["messages"][number] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return session.messages.find((message) => {
    const text = `${message.content} ${message.thinking ?? ""}`.toLowerCase();
    return text.includes(q);
  }) ?? null;
}

function compactSnippet(text: string, query: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const q = query.trim().toLowerCase();
  if (!q) return clean.slice(0, 160);
  const index = clean.toLowerCase().indexOf(q);
  if (index < 0) return clean.slice(0, 160);
  const start = Math.max(0, index - 48);
  const end = Math.min(clean.length, index + q.length + 96);
  return `${start > 0 ? "... " : ""}${clean.slice(start, end)}${end < clean.length ? " ..." : ""}`;
}

function countToolCalls(session: Session): number {
  return session.messages.reduce((total, message) => total + (message.toolCalls?.length ?? 0), 0);
}

function countChildren(session: Session, sessions: Session[]): number {
  return sessions.filter((item) => item.parentSessionId === session.id).length;
}

async function selectWorkspaceWithNotice(path: string): Promise<string | null> {
  if (!window.piAPI?.selectWorkspace) return null;
  try {
    const result = await window.piAPI.selectWorkspace(path);
    if (isIpcError(result)) {
      emitWorkspaceNotice({ message: result.fallback, tone: "error" });
      return result.fallback;
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitWorkspaceNotice({ message, tone: "error" });
    return message;
  }
}

export function SessionCenter({ onOpenChat }: SessionCenterProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [tagDraftById, setTagDraftById] = useState<Record<string, string>>({});
  const [titleDraftById, setTitleDraftById] = useState<Record<string, string>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [exportSessionId, setExportSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; undo?: () => void; tone?: "success" | "error" } | null>(null);
  const [continuingKey, setContinuingKey] = useState<string | null>(null);
  const { t } = useI18n();
  const sessions = useSessionStore((state) => state.sessions);
  const sessionsLoading = useSessionStore((state) => state.sessionsLoading);
  const createSession = useSessionStore((state) => state.createSession);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const {
    toggleFavorite,
    setSessionTags,
    archiveSession,
    deleteSession,
    openReadOnlySession,
    continueSession,
    renameSession,
  } = useSessionStore();

  const grouped = useMemo(() => {
    const knownWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const missingWorkspaceSessions = sessions
      .filter((session) => !knownWorkspaceIds.has(session.workspaceId))
      .filter((session) => sessionMatches(session, query));
    const groups = workspaces.map((workspace) => ({
      workspace,
      sessions: (() => {
        const workspaceSessions = sessions
          .filter((session) => session.workspaceId === workspace.id)
          .filter((session) => sessionMatches(session, query));
        const byId = new Map(workspaceSessions.map((session) => [session.id, session]));
        return workspaceSessions.sort((a, b) => {
          if ((a.favorite ?? false) !== (b.favorite ?? false)) return a.favorite ? -1 : 1;
          const depthDelta = sessionDepth(a, byId) - sessionDepth(b, byId);
          if (a.parentSessionId === b.id) return 1;
          if (b.parentSessionId === a.id) return -1;
          if (depthDelta !== 0 && a.parentSessionId === b.parentSessionId) return depthDelta;
          return sessionActivityTime(b).getTime() - sessionActivityTime(a).getTime();
        });
      })(),
    }));
    if (missingWorkspaceSessions.length > 0) {
      groups.push({
        workspace: {
          id: "__missing_workspace__",
          name: "未知工作区",
          path: "",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
        },
        sessions: missingWorkspaceSessions.sort((a, b) => sessionActivityTime(b).getTime() - sessionActivityTime(a).getTime()),
      });
    }
    return groups.filter((group) => group.sessions.length > 0);
  }, [query, sessions, workspaces]);

  const openSession = (session: Session, readOnly: boolean): void => {
    if (readOnly) openReadOnlySession(session.id);
    else useSessionStore.getState().setCurrentSession(session.id);
    const workspace = workspaces.find((item) => item.id === session.workspaceId);
    if (workspace) {
      useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
      void selectWorkspaceWithNotice(workspace.path).then((message) => {
        if (message) setNotice({ message: `打开会话时切换 workspace 失败：${message}`, tone: "error" });
      });
    }
    onOpenChat?.();
  };
  const continueAndOpen = async (session: Session, fromMessageId?: string): Promise<void> => {
    const key = `${session.id}:${fromMessageId ?? "latest"}`;
    if (continuingKey) return;
    setContinuingKey(key);
    setNotice(null);
    try {
      const next = await continueSession(session.id, fromMessageId);
      const workspace = workspaces.find((item) => item.id === next.workspaceId);
      if (workspace) {
        useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
        const message = await selectWorkspaceWithNotice(workspace.path);
        if (message) {
          setNotice({ message: `创建分支后切换 workspace 失败：${message}`, tone: "error" });
        }
      }
      useSessionStore.getState().setCurrentSession(next.id);
      onOpenChat?.();
    } catch (error) {
      setNotice({
        message: `创建会话分支失败：${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    } finally {
      setContinuingKey(null);
    }
  };
  const toggleArchive = (session: Session): void => {
    const nextArchived = !session.archived;
    archiveSession(session.id, nextArchived);
    setNotice({
      message: nextArchived ? `已归档 ${session.title}` : `已恢复 ${session.title}`,
      undo: () => archiveSession(session.id, !nextArchived),
    });
  };
  const requestDelete = (session: Session): void => {
    setPendingDeleteId(session.id);
    setNotice(null);
  };
  const confirmDelete = (session: Session): void => {
    deleteSession(session.id);
    setPendingDeleteId(null);
    setNotice({ message: `已删除 ${session.title}` });
  };
  const titleDraftFor = (session: Session): string => titleDraftById[session.id] ?? session.title;
  const updateTitleDraft = (sessionId: string, title: string): void => {
    setTitleDraftById((state) => ({ ...state, [sessionId]: title }));
  };
  const resetTitleDraft = (session: Session): void => {
    setTitleDraftById((state) => {
      const next = { ...state };
      delete next[session.id];
      return next;
    });
  };
  const commitTitleDraft = (session: Session): void => {
    const draft = titleDraftFor(session);
    const trimmed = draft.trim();
    if (!trimmed) {
      resetTitleDraft(session);
      setNotice({ message: "会话标题不能为空，已恢复原标题。" });
      return;
    }
    resetTitleDraft(session);
    if (trimmed !== session.title) {
      renameSession(session.id, trimmed);
      setNotice({ message: `已重命名为 ${trimmed}` });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--mm-bg-main)] px-6 py-6 text-[var(--mm-text-primary)]">
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-[var(--mm-border)] pb-4">
        <div>
          <h1 className="m-0 text-lg font-semibold">会话中心</h1>
          <p className="m-0 mt-1 text-xs text-[var(--mm-text-secondary)]">
            管理历史任务、标签、收藏和只读恢复，适合回到长任务上下文。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3">
          <span className="text-[12px] text-[var(--mm-text-tertiary)]" aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、消息、标签"
            className="h-9 w-[280px] border-0 bg-transparent text-sm outline-none"
            aria-label="搜索会话"
          />
        </div>
      </div>
      {notice && (
        <div
          className={`mb-4 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-[#fecaca] bg-[#fef2f2] text-[var(--color-error)]"
              : "border-[#dbe8d0] bg-[#f5fbf0] text-[var(--color-success)]"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span className="min-w-0 flex-1 truncate">{notice.message}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => {
                notice.undo?.();
                setNotice(null);
              }}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--color-success)] hover:bg-[#e5f2dc]"
            >
              撤销
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessionsLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]" role="status">
            加载会话中...
          </div>
        ) : grouped.length === 0 && sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[var(--mm-text-secondary)]">
            <span>暂无会话，开始新对话吧</span>
            <button
              type="button"
              onClick={() => {
                const wid = currentWorkspaceId ?? workspaces[0]?.id;
                if (wid) void createSession(wid).then((s) => { useSessionStore.getState().setCurrentSession(s.id); onOpenChat?.(); });
              }}
              disabled={!currentWorkspaceId && workspaces.length === 0}
              className="rounded-md bg-[#1f1f1f] px-4 py-2 text-sm text-white hover:bg-[#333] disabled:opacity-40"
            >
              新建会话
            </button>
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]">
            没有匹配的会话
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ workspace, sessions: workspaceSessions }) => (
              <section key={workspace.id}>
                <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]">
                  {workspace.name}
                </h2>
                <div className="grid gap-2">
                  {workspaceSessions.map((session) => {
                    const tagDraft = tagDraftById[session.id] ?? (session.tags ?? []).join(", ");
                    const byId = new Map(workspaceSessions.map((item) => [item.id, item]));
                    const depth = sessionDepth(session, byId);
                    const parent = session.parentSessionId ? byId.get(session.parentSessionId) : undefined;
                    const matchingMessage = findMatchingMessage(session, query);
                    const toolCount = countToolCalls(session);
                    const childCount = countChildren(session, workspaceSessions);
                    return (
                      <article
                        key={session.id}
                        className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-3 transition-colors hover:border-[var(--mm-border)] hover:bg-[#fffefb]"
                        style={{ marginLeft: depth * 18 }}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(session.id)}
                            className={`h-7 w-7 rounded-md text-sm ${session.favorite ? "bg-[#1f1f1f] text-white" : "border border-[var(--mm-border)] text-[var(--mm-text-tertiary)]"}`}
                            aria-label={session.favorite ? "取消收藏" : "收藏"}
                          >
                            ★
                          </button>
                          <div className="min-w-0 flex-1">
                            <input
                              value={titleDraftFor(session)}
                              onChange={(event) => updateTitleDraft(session.id, event.target.value)}
                              onBlur={() => commitTitleDraft(session)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  commitTitleDraft(session);
                                  event.currentTarget.blur();
                                } else if (event.key === "Escape") {
                                  resetTitleDraft(session);
                                  event.currentTarget.blur();
                                }
                              }}
                              aria-label={`重命名会话 ${session.title}`}
                              className="w-full border-0 bg-transparent p-0 text-sm font-medium outline-none"
                            />
                            <p className="m-0 mt-1 line-clamp-2 text-xs leading-5 text-[var(--mm-text-secondary)]">
                              {session.summary || session.messages.find((message) => message.role === "user")?.content || "暂无摘要"}
                            </p>
                            {matchingMessage && (
                              <div className="mt-2 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-2">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className="text-[10px] uppercase tracking-[0.4px] text-[var(--mm-text-tertiary)]">
                                    匹配消息 · {matchingMessage.role === "user" ? "用户" : "Pi"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void continueAndOpen(session, matchingMessage.id)}
                                    disabled={continuingKey != null}
                                    className="rounded px-1.5 py-0.5 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)] hover:text-[var(--mm-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {continuingKey === `${session.id}:${matchingMessage.id}` ? "继续中" : "从这里继续"}
                                  </button>
                                </div>
                                <p className="m-0 line-clamp-2 text-xs leading-5 text-[var(--mm-text-secondary)]">
                                  {compactSnippet(matchingMessage.content || matchingMessage.thinking || "", query)}
                                </p>
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="rounded bg-[var(--mm-bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-secondary)]">
                                {session.messages.length} messages
                              </span>
                              <span className="rounded bg-[var(--mm-bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-secondary)]">
                                {toolCount} tools
                              </span>
                              {childCount > 0 && (
                                <span className="rounded bg-[#eef3ff] px-1.5 py-0.5 text-[10px] text-[var(--color-info)]">
                                  {childCount} branches
                                </span>
                              )}
                              <input
                                value={tagDraft}
                                onChange={(event) => setTagDraftById((state) => ({ ...state, [session.id]: event.target.value }))}
                                onBlur={() => setSessionTags(session.id, tagDraft.split(","))}
                                placeholder="标签，用逗号分隔"
                                className="h-7 min-w-[180px] rounded-md border border-[var(--mm-border)] px-2 text-xs outline-none focus:border-[#bbb]"
                              />
                              <span className="text-[11px] text-[var(--mm-text-tertiary)]">
                                {formatRelative(sessionActivityTime(session), t)}
                              </span>
                              {session.readOnly && <span className="rounded bg-[var(--mm-bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">只读</span>}
                              {session.archived && <span className="rounded bg-[var(--mm-bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">归档</span>}
                              {session.parentSessionId && (
                                <span className="rounded bg-[#eef3ff] px-1.5 py-0.5 text-[10px] text-[var(--color-info)]">
                                  分支自 {parent?.title ?? "旧会话"}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            <button className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]" onClick={() => openSession(session, false)}>打开</button>
                            <button className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]" onClick={() => openSession(session, true)}>只读</button>
                            <button
                              className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]"
                              disabled={continuingKey != null}
                              onClick={() => void continueAndOpen(session)}
                            >
                              {continuingKey === `${session.id}:latest` ? "继续中" : "继续"}
                            </button>
                            <button className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]" onClick={() => setExportSessionId(session.id)}>导出</button>
                            <button className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]" onClick={() => toggleArchive(session)}>
                              {session.archived ? "恢复" : "归档"}
                            </button>
                            {pendingDeleteId === session.id ? (
                              <>
                                <button className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]" onClick={() => setPendingDeleteId(null)}>取消删除</button>
                                <button className="rounded-md bg-[#b91c1c] px-2 py-1 text-xs text-white hover:bg-[#991b1b]" onClick={() => confirmDelete(session)}>确认删除</button>
                              </>
                            ) : (
                              <button className="rounded-md px-2 py-1 text-xs text-[var(--color-error)] hover:bg-[var(--mm-bg-hover)]" onClick={() => requestDelete(session)}>删除</button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <SessionExportDialog
        isOpen={exportSessionId !== null}
        onClose={() => setExportSessionId(null)}
        sessionId={exportSessionId ?? undefined}
      />
    </div>
  );
}
