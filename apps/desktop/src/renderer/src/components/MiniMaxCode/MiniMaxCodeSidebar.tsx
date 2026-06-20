// MiniMaxCodeSidebar — MiniMax Code 参考风格左侧导航栏
//
// 当前只展示会话列表和设置入口,导航功能已移至 TopTabBar。
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

import React from "react";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";
import { ProjectGroupedSessionList } from "./ProjectGroupedSessionList";
import { DateGroupedSessionList } from "./DateGroupedSessionList";

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
}: MiniMaxCodeSidebarProps): React.JSX.Element {
    const { t } = useI18n();
    const currentSessionId = useSessionStore((state) => state.currentSessionId);
    const archiveSession = useSessionStore((state) => state.archiveSession);
    const deleteSession = useSessionStore((state) => state.deleteSession);

    return (
        <div
            className="flex h-full w-full flex-col bg-[linear-gradient(180deg,#f0f0f2_0%,#f0f0f2_32%,#f9efeb_54%,#ececef_78%,#ececef_100%)] text-[var(--mm-text-primary)]"
            data-mmcode-component="sidebar"
        >
            {/* ============== 中间 scroll 区 ============== */}
            <nav
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-3 pt-5"
                aria-label="会话列表"
            >
                {/* 新建对话按钮 */}
                <div className="mx-[11px] flex h-6 items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onSectionChange("new-task")}
                        aria-label={t("sidebar.newConversation")}
                        aria-current={currentSection === "new-task" ? "page" : undefined}
                        className="flex h-6 min-w-0 flex-1 items-center rounded-[2px] border border-[#e7e7e7] bg-[#f4f4f4] px-2 text-left text-[11px] text-[#9a9a9a] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-secondary)] focus:outline-none"
                        data-mmcode-section="new-task"
                    >
                        <span className="truncate">新对话</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onSectionChange("new-task")}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus:outline-none"
                        aria-label="快速新建对话"
                    >
                        <IconPlus />
                    </button>
                </div>

                {/* 会话列表 */}
                <div className="mt-[9px]">
                    {groupMode === "date" ? (
                        <DateGroupedSessionList
                            currentSessionId={currentSessionId}
                            onSelectSession={(id) => onSectionChange(`session:${id}`)}
                            onArchiveSession={archiveSession}
                            onDeleteSession={deleteSession}
                        />
                    ) : (
                        <ProjectGroupedSessionList
                            currentWorkspaceId={currentWorkspaceId ?? null}
                            currentSessionId={currentSessionId}
                            onSelectSession={(id) => onSectionChange(`session:${id}`)}
                            onArchiveSession={archiveSession}
                            onDeleteSession={deleteSession}
                            onSwitchWorkspace={(wid) => useWorkspaceStore.getState().setCurrentWorkspace(wid)}
                        />
                    )}
                </div>
            </nav>

        </div>
    );
}


