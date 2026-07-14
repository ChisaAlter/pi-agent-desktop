// MiniMaxCodeSidebar — MiniMax Code 参考风格左侧导航栏
//
// 当前只展示会话列表和设置入口,导航功能已移至 TopTabBar。
//
// 视觉规格:
//  - 字号: 主 13px / 次 12px / 分组标题 11px letter-spacing 0.5px 浅灰
//  - 行高 32px,左右 padding 12px
//  - hover 浅灰 --mm-bg-hover (#f0f0f0)
//  - 分组切换: 浅灰容器 + 柔和分段高亮,避免重黑块
//  - icon 用 inline SVG stroke 1.5;**不**用 emoji, **不**用 lucide-react
//    (项目无 lucide-react 依赖,见 IconBar.tsx 同款约定)
//  - 所有颜色/尺寸走 --mm-*,不硬编码
//
// Props:
//  - currentSection: 当前激活项的 section id
//  - onSectionChange: 点击某项时回调,父级决定路由/视图切换
//  - groupMode: 会话列表分组模式 (date/workspace)
//  - onGroupModeChange: 切换分组模式回调
//
// A11y:
//  - 每个可点击项是 <button> + aria-label,激活态用 aria-current="page"
//  - 分组列表用 <nav role="navigation"> 包裹,加 aria-label
//  - 装饰性图标 aria-hidden="true",不污染辅助阅读
//
// 不持有路由状态: 父级通过 currentSection/onSectionChange 控制激活。

import React, { useEffect, useMemo, useState } from "react";
import { useSessionStore, type Session } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";
import { ProjectGroupedSessionList } from "./ProjectGroupedSessionList";
import { DateGroupedSessionList } from "./DateGroupedSessionList";
import { sessionActivityTime, sessionDepth } from "../../utils/session-grouping";
import { SessionRow } from "./SessionRow";
import { MINIMAX_CHROME_ICON_BUTTON_CLASSNAME } from "./chromeButton";

// ----------------------------------------------------------------------
// 类型
// ----------------------------------------------------------------------

export interface MiniMaxCodeSidebarProps {
    /** 当前激活的 section id */
    currentSection: string;
    /** 当前 workspace;历史列表只显示这个 workspace 的会话 */
    currentWorkspaceId?: string | null;
    /** pi-agent 运行状态，用于左下角状态条 */
    piAgentStatus?: "online" | "offline" | "checking";
    /** 点击某项时回调,父级决定路由切换 */
    onSectionChange: (section: string) => void;
    /** 会话列表分组模式 */
    groupMode?: "date" | "workspace";
    /** 切换分组模式回调 */
    onGroupModeChange?: (mode: "date" | "workspace") => void;
    /** 折叠左侧栏 */
    onToggleCollapse?: () => void;
}

// ----------------------------------------------------------------------
// Icons (inline SVG, stroke 1.5, 14x14 视觉)
// 选用 lucide-react 风格的 outline icon,内联避免新增依赖。
// ----------------------------------------------------------------------

function IconPlus(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v14m-7-7h14" />
        </svg>
    );
}

function IconSidebarCollapse(): React.JSX.Element {
    return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <line x1="6" y1="3" x2="6" y2="13" />
        </svg>
    );
}

interface GroupModeSwitchProps {
    mode: "date" | "workspace";
    onChange?: (mode: "date" | "workspace") => void;
    t: (key: string) => string;
}

function GroupModeSwitch({ mode, onChange, t }: GroupModeSwitchProps): React.JSX.Element {
    const buttonClass = (active: boolean): string =>
        `relative z-10 h-8 min-w-0 flex-1 rounded-lg px-3 text-[12px] font-medium transition-[color,transform] duration-[var(--motion-panel)] focus:outline-none active:scale-[0.96] motion-reduce:transition-none ${
            active
                ? "text-[var(--mm-text-primary)] shadow-[0_0_0_rgba(0,0,0,0)]"
                : "bg-transparent text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
        }`;

    return (
        <div className="flex shrink-0 flex-col gap-1.5">
            <div className="px-1 text-[11px] font-medium text-[var(--mm-text-tertiary)]">
                {t("sidebar.groupModeLabel")}
            </div>
            <div
                role="group"
                aria-label={t("sidebar.groupModeAria")}
                data-mmcode-group-switch="soft-segmented"
                className="relative grid grid-cols-2 items-center gap-1 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] p-1 shadow-[0_10px_26px_rgba(15,23,42,0.05)]"
            >
                <span
                    aria-hidden="true"
                    className={`absolute bottom-1 top-1 w-[calc(50%-6px)] rounded-lg bg-[var(--mm-bg-panel)] shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition-transform duration-[var(--motion-panel)] ease-[var(--motion-ease)] motion-reduce:transition-none ${
                        mode === "date" ? "translate-x-1" : "translate-x-[calc(100%+8px)]"
                    }`}
                />
                <button
                    type="button"
                    aria-label={t("sidebar.groupByDate")}
                    title={t("sidebar.groupByDate")}
                    aria-pressed={mode === "date"}
                    onClick={() => onChange?.("date")}
                    className={buttonClass(mode === "date")}
                >
                    <span className="truncate">{t("sidebar.groupByDateShort")}</span>
                </button>
                <button
                    type="button"
                    aria-label={t("sidebar.groupByWorkspace")}
                    title={t("sidebar.groupByWorkspace")}
                    aria-pressed={mode === "workspace"}
                    onClick={() => onChange?.("workspace")}
                    className={buttonClass(mode === "workspace")}
                >
                    <span className="truncate">{t("sidebar.groupByWorkspaceShort")}</span>
                </button>
            </div>
        </div>
    );
}

function AnimatedGroupList({ mode, children }: { mode: "date" | "workspace"; children: React.ReactNode }): React.JSX.Element {
    const [entered, setEntered] = useState(false);

    useEffect(() => {
        setEntered(false);
        const frame = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(frame);
    }, [mode]);

    return (
        <div
            className={`transition-[opacity,transform] duration-[var(--motion-panel)] ease-[var(--motion-ease)] motion-reduce:transition-none ${
                entered ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
        >
            {children}
        </div>
    );
}

interface PinnedSessionListProps {
    currentSessionId: string | null;
    onSelectSession: (id: string) => void;
    onArchiveSession: (id: string, archived: boolean) => void;
    onToggleFavorite: (id: string) => void;
    onRenameSession: (id: string, title: string) => void;
    onDeleteSession: (id: string) => void;
    t: (key: string, opts?: Record<string, unknown>) => string;
}

function PinnedSessionList({
    currentSessionId,
    onSelectSession,
    onArchiveSession,
    onToggleFavorite,
    onRenameSession,
    onDeleteSession,
    t,
}: PinnedSessionListProps): React.JSX.Element | null {
    const sessions = useSessionStore((state) => state.sessions);
    const pinnedSessions = useMemo(
        () =>
            sessions
                .filter((session) => session.favorite && !session.archived)
                .sort((a, b) => sessionActivityTime(b).getTime() - sessionActivityTime(a).getTime()),
        [sessions],
    );
    const byIdAll = useMemo(() => new Map<string, Session>(sessions.map((session) => [session.id, session])), [sessions]);

    if (pinnedSessions.length === 0) return null;

    return (
        <section className="flex flex-col gap-0.5" role="region" aria-label={t("sidebar.sessions.pinned")}>
            <div className="flex h-7 items-center gap-2 px-3 text-[11px] font-medium text-[var(--mm-text-tertiary)]">
                <span className="min-w-0 flex-1 truncate">{t("sidebar.sessions.pinned")}</span>
                <span className="rounded bg-[var(--mm-bg-hover)] px-1.5 py-0.5 text-[10px]">{pinnedSessions.length}</span>
            </div>
            {pinnedSessions.map((session) => (
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
        </section>
    );
}

// ----------------------------------------------------------------------
// 主组件
// ----------------------------------------------------------------------

/**
 * MiniMax Code 风格左侧导航栏.
 *
 * 排版结构:
 *   - 顶部 logo
 *   - 新建对话按钮 + 分组模式切换
 *   - 中间 scroll 区: 会话历史列表
 *   - 底部设置按钮
 *
 * 设计约束:
 *   - 所有颜色/字号/圆角走 --mm-* token
 *   - 不持有业务状态,父级通过 currentSection/onSectionChange 控制激活
 *   - 极简 a11y: button + aria-label + aria-current
 */
export function MiniMaxCodeSidebar({
    currentSection,
    currentWorkspaceId,
    onSectionChange,
    groupMode = "date",
    onGroupModeChange,
    onToggleCollapse,
}: MiniMaxCodeSidebarProps): React.JSX.Element {
    const { t } = useI18n();
    const currentSessionId = useSessionStore((state) => state.currentSessionId);
    const sessions = useSessionStore((state) => state.sessions);
    const archiveSession = useSessionStore((state) => state.archiveSession);
    const renameSession = useSessionStore((state) => state.renameSession);
    const toggleFavorite = useSessionStore((state) => state.toggleFavorite);
    const deleteSession = useSessionStore((state) => state.deleteSession);
    const hasPinnedSessions = useMemo(
        () => sessions.some((session) => session.favorite && !session.archived),
        [sessions],
    );

    return (
        <div
            className="pi-sidebar-surface flex h-full w-full flex-col bg-[linear-gradient(180deg,#f0f0f2_0%,#f0f0f2_32%,#f9efeb_54%,#ececef_78%,#ececef_100%)] text-[var(--mm-text-primary)]"
            data-mmcode-component="sidebar"
        >
            {/* ============== 中间 scroll 区 ============== */}
            <nav
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-3 pt-0"
                aria-label={t("sidebar.sessions.listAria")}
            >
                <div className="flex min-h-[42px] shrink-0 items-center">
                    <div className="flex h-7 w-full items-center gap-2">
                        {onToggleCollapse && (
                            <button
                                type="button"
                                onClick={onToggleCollapse}
                                aria-label="折叠左侧栏"
                                title="折叠左侧栏"
                                className={MINIMAX_CHROME_ICON_BUTTON_CLASSNAME}
                            >
                                <IconSidebarCollapse />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => onSectionChange("new-task")}
                            aria-label={t("sidebar.newConversation")}
                            aria-current={currentSection === "new-task" ? "page" : undefined}
                            className="flex h-7 min-w-0 flex-1 items-center rounded-[2px] border border-[var(--mm-border)] bg-[var(--mm-bg-control)] px-2 text-left text-[11px] text-[var(--mm-text-tertiary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-secondary)] focus:outline-none"
                            data-mmcode-section="new-task"
                        >
                            <span className="truncate">{t("sidebar.newConversation")}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onSectionChange("new-task")}
                            className={MINIMAX_CHROME_ICON_BUTTON_CLASSNAME}
                            aria-label={t("sidebar.quickNewConversation")}
                        >
                            <IconPlus />
                        </button>
                    </div>
                </div>

                <div className="mt-[3px] flex flex-col gap-2">
                    <PinnedSessionList
                        currentSessionId={currentSessionId}
                        onSelectSession={(id) => onSectionChange(`session:${id}`)}
                        onArchiveSession={archiveSession}
                        onToggleFavorite={toggleFavorite}
                        onRenameSession={renameSession}
                        onDeleteSession={deleteSession}
                        t={t}
                    />
                    <GroupModeSwitch mode={groupMode} onChange={onGroupModeChange} t={t} />
                    <AnimatedGroupList mode={groupMode}>
                        {groupMode === "date" ? (
                            <DateGroupedSessionList
                                currentSessionId={currentSessionId}
                                onSelectSession={(id) => onSectionChange(`session:${id}`)}
                                onArchiveSession={archiveSession}
                                onToggleFavorite={toggleFavorite}
                                onRenameSession={renameSession}
                                onDeleteSession={deleteSession}
                                hideEmptyState={hasPinnedSessions}
                            />
                        ) : (
                            <ProjectGroupedSessionList
                                currentWorkspaceId={currentWorkspaceId ?? null}
                                currentSessionId={currentSessionId}
                                onSelectSession={(id) => onSectionChange(`session:${id}`)}
                                onArchiveSession={archiveSession}
                                onToggleFavorite={toggleFavorite}
                                onRenameSession={renameSession}
                                onDeleteSession={deleteSession}
                                onSwitchWorkspace={(wid) => useWorkspaceStore.getState().setCurrentWorkspace(wid)}
                                hideEmptyState={hasPinnedSessions}
                            />
                        )}
                    </AnimatedGroupList>
                </div>
            </nav>

        </div>
    );
}


