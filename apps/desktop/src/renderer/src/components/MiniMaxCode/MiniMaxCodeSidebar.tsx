// MiniMaxCodeSidebar — MiniMax Code 参考风格左侧导航栏
//
// 当前只展示真实可用入口: 新建任务、搜索、会话中心、插件、Git、设置，以及当前
// workspace 的真实任务历史。没有对应 Pi CLI/API 的入口不渲染。
//
// 视觉规格:
//  - 字号: 主 13px / 次 12px / 分组标题 11px letter-spacing 0.5px 浅灰
//  - 行高 32px,左右 padding 12px
//  - hover 浅灰 --mm-bg-hover (#f0f0f0)
//  - 激活态: 黑底白字 (--mm-bg-active + --mm-text-on-active),圆角 6px
//  - icon 用 inline SVG stroke 1.5;**不**用 emoji, **不**用 lucide-react
//    (项目无 lucide-react 依赖,见 IconBar.tsx 同款约定)
//  - 所有颜色/尺寸走 --mm-*,不硬编码
//
// Props:
//  - currentSection: 当前激活项的 section id
//  - onSectionChange: 点击某项时回调,父级决定路由/视图切换(本期 T5 集成时接入)
//
// A11y:
//  - 每个可点击项是 <button> + aria-label,激活态用 aria-current="page"
//  - 分组列表用 <nav role="navigation"> 包裹,加 aria-label
//  - 装饰性图标 aria-hidden="true",不污染辅助阅读
//
// 不持有路由状态: 父级通过 currentSection/onSectionChange 控制激活。

import React from "react";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { RecentWorkspaces } from "../RecentWorkspaces/RecentWorkspaces";

// ----------------------------------------------------------------------
// 类型
// ----------------------------------------------------------------------

export interface MiniMaxCodeSection {
    /** 唯一 id(传给 onSectionChange) */
    id: string;
    /** 显示文案 */
    label: string;
    /** inline SVG icon (16x16 推荐) */
    icon: React.ReactNode;
}

export interface MiniMaxCodeSidebarGroup {
    /** 分组标题(可空,但当前所有 4 个分组都有标题) */
    title: string;
    /** 分组下的列表项 */
    items: MiniMaxCodeSection[];
}

export interface MiniMaxCodeSidebarProps {
    /** 当前激活的 section id */
    currentSection: string;
    /** 当前 workspace;历史列表只显示这个 workspace 的会话 */
    currentWorkspaceId?: string | null;
    /** pi-agent 运行状态，用于左下角状态条 */
    piAgentStatus?: "online" | "offline" | "checking";
    /** 点击某项时回调,父级决定路由切换 */
    onSectionChange: (section: string) => void;
}

// ----------------------------------------------------------------------
// Icons (inline SVG, stroke 1.5, 14x14 视觉)
// 选用 lucide-react 风格的 outline icon,内联避免新增依赖。
// ----------------------------------------------------------------------

function IconPlus(): React.JSX.Element {
    return (
        <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 5v14m-7-7h14"
            />
        </svg>
    );
}

function IconPuzzle(): React.JSX.Element {
    return (
        <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
            />
        </svg>
    );
}

function IconSearch(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m21 21-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" />
        </svg>
    );
}

function IconMessage(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h8M8 14h5m8-2a8 8 0 11-3.3-6.48L21 5l-1.05 3.15A7.96 7.96 0 0121 12z" />
        </svg>
    );
}

function IconGit(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 0v6m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10-6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 0c0 3.5-10 2.5-10 6" />
        </svg>
    );
}

function IconFiles(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    );
}


function IconSettings(): React.JSX.Element {
    return (
        <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
        </svg>
    );
}

// v1.0.14: 删 IconFolder / IconMessage — 之前给"对项目的看法" / "了解项目"硬编码
// 历史项用,这 2 项已删,icon 也跟着删。后续 v1.1 接真历史 task 时再加回来。

// ----------------------------------------------------------------------
// 静态配置 (本期纯占位,后续可改由 props/数据驱动)
// ----------------------------------------------------------------------

const MAIN_SECTIONS: MiniMaxCodeSection[] = [
    { id: "new-task", label: "新建任务", icon: <IconPlus /> },
    { id: "search", label: "搜索", icon: <IconSearch /> },
    { id: "sessions", label: "会话中心", icon: <IconMessage /> },
    { id: "files", label: "文件", icon: <IconFiles /> },
    { id: "skills", label: "插件", icon: <IconPuzzle /> },
    { id: "git", label: "Git", icon: <IconGit /> },
    { id: "settings", label: "设置", icon: <IconSettings /> },
];

const GROUPED_SECTIONS: MiniMaxCodeSidebarGroup[] = [
    // 等接入真实数据后再恢复额外分组。
];

// ----------------------------------------------------------------------
// 子组件: 导航项 (主操作 + 分组项复用)
// ----------------------------------------------------------------------

interface NavItemProps {
    section: MiniMaxCodeSection;
    active: boolean;
    onClick: () => void;
    trailing?: React.ReactNode;
}

function NavItem({ section, active, onClick, trailing }: NavItemProps): React.JSX.Element {
    // 激活态: 浅灰底 + 2px 左侧色条(--mm-bg-active = #1a1a1a 黑) + font-medium
    //   3 重视觉信号,确保在 sidebar 浅灰底上肉眼能立刻看出
    //   (历史 bug: 早期只靠 bg-[--mm-bg-selected] (#efefef) vs sidebar (#f7f7f7)
    //    亮度差仅 3%, 用户反映"点了没反应"——其实是切了但看不出来)
    // hover: 轻灰背景
    // 行高 32px,左右 padding 12px(用 pl-[10px] 补偿 2px 左边条,active/inactive 宽度一致)
    const baseClasses =
        "flex w-full items-center gap-3 rounded-[var(--mm-radius-sm)] py-0 pl-[10px] pr-3 text-[13px] leading-relaxed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-bg-active)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--mm-bg-sidebar)]";
    const heightClasses = "h-10";
    // border-l-2 + border-l-transparent 占位 (inactive 时透明, 仍占 2px 宽度, 不抖动)
    const stateClasses = active
        ? "border-l-2 border-l-[var(--mm-bg-active)] bg-[var(--mm-bg-selected)] font-medium text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-selected)]"
        : "border-l-2 border-l-transparent bg-transparent font-normal text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]";

    return (
        <div className="group flex items-center gap-1">
            <button
                type="button"
                onClick={onClick}
                aria-label={section.label}
                aria-current={active ? "page" : undefined}
                className={`${baseClasses} ${heightClasses} ${stateClasses} min-w-0 flex-1`}
                data-mmcode-section={section.id}
            >
                <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center"
                    aria-hidden="true"
                >
                    {section.icon}
                </span>
                <span className="truncate text-left">{section.label}</span>
            </button>
            {trailing}
        </div>
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

// ----------------------------------------------------------------------
// 主组件
// ----------------------------------------------------------------------

/**
 * MiniMax Code 风格左侧导航栏(1:1 还原目标 UI 截图).
 *
 * 排版结构:
 *   - 顶部 logo (12x12 圆角黑底,内嵌 "M")
 *   - 主操作列表(无分组标题,4 个一级入口)
 *   - 中间 scroll 区: 当前 workspace 的真实会话历史
 *
 * 设计约束:
 *   - 所有颜色/字号/圆角走 --mm-* token
 *   - 不持有业务状态,父级通过 currentSection/onSectionChange 控制激活
 *   - 极简 a11y: button + aria-label + aria-current
 */
export function MiniMaxCodeSidebar({
    currentSection,
    currentWorkspaceId,
    piAgentStatus = "checking",
    onSectionChange,
}: MiniMaxCodeSidebarProps): React.JSX.Element {
    const sessions = useSessionStore((state) => state.sessions);
    const currentSessionId = useSessionStore((state) => state.currentSessionId);
    const archiveSession = useSessionStore((state) => state.archiveSession);
    const deleteSession = useSessionStore((state) => state.deleteSession);
    const historyItems = sessions
        .filter((session) => !session.archived)
        .filter((session) => !currentWorkspaceId || session.workspaceId === currentWorkspaceId)
        .slice()
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const archivedItems = sessions
        .filter((session) => session.archived)
        .filter((session) => !currentWorkspaceId || session.workspaceId === currentWorkspaceId)
        .slice()
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const agentOnline = piAgentStatus === "online";
    const agentChecking = piAgentStatus === "checking";
    const agentStatusLabel = agentChecking ? "pi-agent 检测中" : agentOnline ? "pi-agent 在线" : "pi-agent 不在线";
    const agentDotClass = agentChecking
        ? "bg-[var(--mm-text-tertiary)]"
        : agentOnline
            ? "bg-[var(--color-success)]"
            : "bg-[var(--color-error)]";

    return (
        <div
            className="flex h-full w-full flex-col bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-primary)]"
            data-mmcode-component="sidebar"
        >
            {/* ============== 顶部折叠占位 (固定,不滚动) ============== */}
            <div
                className="flex h-14 shrink-0 items-center gap-2 px-3"
                data-mmcode-region="logo"
            >
                <div
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--mm-radius-md)] bg-[var(--mm-bg-active)] text-[13px] font-semibold text-[var(--mm-text-on-active)]"
                    aria-hidden="true"
                >
                    π
                </div>
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">Pi Agent</div>
                    <div className="truncate text-[11px] text-[var(--mm-text-tertiary)]">桌面工作台</div>
                </div>
            </div>

            {/* ============== 中间 scroll 区 ============== */}
            {/* v1.0.16: aria-label 改回 "主导航" — 兼容 a11y.spec.ts 等老测试 selector
                (v1.0.16 sweep 删了 IconBar/ 整个目录,新 MiniMaxCodeSidebar 接管导航;
                原 IconBar 用 aria-label="主导航",新 Sidebar 一开始用 "MiniMax Code primary navigation"
                导致 a11y.spec.ts 找主导航 15s timeout fail, 改回 "主导航" 修复回归) */}
            <nav
                className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-2 pb-4 pt-2"
                aria-label="主导航"
            >
                {/* 主操作分组(无标题) */}
                <div className="flex flex-col gap-1">
                    <h2 className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]">
                        工作区
                    </h2>
                    {MAIN_SECTIONS.map((section) => (
                        <NavItem
                            key={section.id}
                            section={section}
                            active={currentSection === section.id}
                            onClick={() => onSectionChange(section.id)}
                        />
                    ))}
                </div>

                {historyItems.length > 0 ? (
                    <div className="flex flex-col gap-1">
                        <h3 className="px-3 pt-3 pb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]">
                            任务历史 <span className="font-normal normal-case tracking-normal">({historyItems.length})</span>
                        </h3>
                        {historyItems.map((session) => (
                            <NavItem
                                key={session.id}
                                section={{
                                    id: `session:${session.id}`,
                                    label: session.title || "未命名会话",
                                    icon: <IconMessage />,
                                }}
                                active={currentSection === "chat" && session.id === currentSessionId}
                                onClick={() => onSectionChange(`session:${session.id}`)}
                                trailing={
                                    <div className="flex items-center">
                                        <SmallActionButton
                                            label={`归档 ${session.title || "未命名会话"}`}
                                            onClick={() => archiveSession(session.id, true)}
                                        >
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M9 11h6" />
                                            </svg>
                                        </SmallActionButton>
                                        <SmallActionButton
                                            label={`删除 ${session.title || "未命名会话"}`}
                                            onClick={() => deleteSession(session.id)}
                                        >
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 7h12m-9 0V5h6v2m-7 3v8m4-8v8m4-8v8M8 7l1 13h6l1-13" />
                                            </svg>
                                        </SmallActionButton>
                                    </div>
                                }
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-[var(--mm-border)] px-3 py-3 text-[11px] leading-5 text-[var(--mm-text-tertiary)]">
                        还没有当前工作区的历史任务。
                    </div>
                )}

                {archivedItems.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <h3 className="px-3 pt-3 pb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]">
                            已归档 <span className="font-normal normal-case tracking-normal">({archivedItems.length})</span>
                        </h3>
                        {archivedItems.map((session) => (
                            <NavItem
                                key={session.id}
                                section={{
                                    id: `session:${session.id}`,
                                    label: session.title || "未命名会话",
                                    icon: <IconMessage />,
                                }}
                                active={false}
                                onClick={() => {
                                    archiveSession(session.id, false);
                                    onSectionChange(`session:${session.id}`);
                                }}
                                trailing={
                                    <SmallActionButton
                                        label={`恢复 ${session.title || "未命名会话"}`}
                                        onClick={() => archiveSession(session.id, false)}
                                    >
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 12a9 9 0 1 0 3-6.7M3 5v5h5" />
                                        </svg>
                                    </SmallActionButton>
                                }
                            />
                        ))}
                    </div>
                )}

                {/* 空分组已移除，等接入真实数据后再恢复 */}
                <RecentWorkspaces
                    className="px-3 pb-3"
                    onSelect={(workspace) => {
                        useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
                    }}
                />
                {GROUPED_SECTIONS.length > 0 && GROUPED_SECTIONS.map((group) => (
                    <div key={group.title} className="flex flex-col gap-1">
                        <h3
                            className="px-3 pt-3 pb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]"
                            data-mmcode-group-title={group.title}
                        >
                            {group.title}
                        </h3>
                        {group.items.length === 0 ? (
                            <p
                                className="px-3 text-[11px] leading-[20px] text-[var(--mm-text-tertiary)]"
                                data-mmcode-group-empty={group.title}
                            >
                                （暂无）
                            </p>
                        ) : (
                            <div className="flex flex-col gap-1">
                                {group.items.map((item) => (
                                    <NavItem
                                        key={item.id}
                                        section={item}
                                        active={currentSection === item.id}
                                        onClick={() => onSectionChange(item.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </nav>

            <div className="shrink-0 border-t border-[var(--mm-border)] px-3 py-3">
                <div
                    className="flex h-9 items-center gap-2 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 text-[12px] text-[var(--mm-text-secondary)]"
                    role="status"
                    aria-label={agentStatusLabel}
                    title={agentStatusLabel}
                >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${agentDotClass}`} aria-hidden="true" />
                    <span className="truncate">{agentStatusLabel}</span>
                </div>
            </div>
        </div>
    );
}


