// MiniMaxCodeSidebar — MiniMax Code 风格左侧导航栏
//
// 1:1 还原目标 UI 截图的左侧 220px 侧栏:
//   ┌────────────────────────────────────────────┐
//   │ [M]                                         │  <- 顶部 logo (12x12 圆角黑底 + "M" 文字)
//   │ ● 新建任务    (active)                       │  <- 主操作分组(无标题,直接列出)
//   │ ● 技能                                         │
//   │ ● 定时任务                                     │
//   │ ● 手机操控                                     │
//   │ ───────────────                              │  <- 分隔(可选用)
//   │ 定时任务                                      │  <- 分组标题(11px, #999, letter-spacing)
//   │   (无占位项)                                  │
//   │ 任务历史                                      │
//   │   对项目的看法                                 │
//   │   了解项目                                     │
//   │ Agents                                       │
//   │   (无占位项)                                  │
//   │ 已归档                                        │
//   │   (无占位项)                                  │
//   │                                             │
//   │ ──── flex-1 (中间可滚动) ────                │
//   │ (●) Ayase                                   │  <- 底部固定用户卡片
//   │     Plus Plan                                │
//   └────────────────────────────────────────────┘
//
// 视觉规格(任务说明 + 截图):
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
// 不持有任何业务状态: 父级通过 props 决定 currentSection;
// 数据(分组/项目)用本地 const 静态声明,不做异步加载。

import React from "react";
import { MiniMaxCodeUserCard } from "./MiniMaxCodeUserCard";

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
    /** 点击某项时回调,父级决定路由切换 */
    onSectionChange: (section: string) => void;
    /** 用户卡片(可选) */
    userName?: string;
    planLabel?: string;
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

function IconClock(): React.JSX.Element {
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
                d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        </svg>
    );
}

function IconPhone(): React.JSX.Element {
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
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
        </svg>
    );
}

function IconFolder(): React.JSX.Element {
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
                d="M3 7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            />
        </svg>
    );
}

function IconMessage(): React.JSX.Element {
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
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
        </svg>
    );
}

// ----------------------------------------------------------------------
// 静态配置 (本期纯占位,后续可改由 props/数据驱动)
// ----------------------------------------------------------------------

const MAIN_SECTIONS: MiniMaxCodeSection[] = [
    { id: "new-task", label: "新建任务", icon: <IconPlus /> },
    { id: "skills", label: "技能", icon: <IconPuzzle /> },
    { id: "scheduled-tasks", label: "定时任务", icon: <IconClock /> },
    { id: "mobile-control", label: "手机操控", icon: <IconPhone /> },
];

const GROUPED_SECTIONS: MiniMaxCodeSidebarGroup[] = [
    {
        title: "定时任务",
        items: [
            // 当前无占位项,保留空数组 — 标题照常渲染
        ],
    },
    {
        title: "任务历史",
        items: [
            { id: "history-opinion", label: "对项目的看法", icon: <IconFolder /> },
            { id: "history-about", label: "了解项目", icon: <IconMessage /> },
        ],
    },
    {
        title: "Agents",
        items: [
            // 当前无占位项
        ],
    },
    {
        title: "已归档",
        items: [
            // 当前无占位项
        ],
    },
];

// ----------------------------------------------------------------------
// 子组件: 导航项 (主操作 + 分组项复用)
// ----------------------------------------------------------------------

interface NavItemProps {
    section: MiniMaxCodeSection;
    active: boolean;
    onClick: () => void;
}

function NavItem({ section, active, onClick }: NavItemProps): React.JSX.Element {
    // 激活态: 黑底白字 圆角 6px
    // hover: 浅灰 #f0f0f0 (非激活态)
    // 行高 32px,左右 padding 12px
    const baseClasses =
        "flex w-full items-center gap-2.5 rounded-[var(--mm-radius-sm)] px-3 text-[13px] leading-[20px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-bg-active)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--mm-bg-sidebar)]";
    const heightClasses = "h-8";
    const stateClasses = active
        ? "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] hover:bg-[var(--mm-bg-active)]"
        : "bg-transparent text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]";

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={section.label}
            aria-current={active ? "page" : undefined}
            className={`${baseClasses} ${heightClasses} ${stateClasses}`}
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
 *   - 中间 scroll 区: 4 个分组(标题 + 占位项)
 *   - 底部固定: <MiniMaxCodeUserCard />
 *
 * 设计约束:
 *   - 所有颜色/字号/圆角走 --mm-* token
 *   - 不持有业务状态,父级通过 currentSection/onSectionChange 控制激活
 *   - 极简 a11y: button + aria-label + aria-current
 */
export function MiniMaxCodeSidebar({
    currentSection,
    onSectionChange,
    userName = "Ayase",
    planLabel = "Plus Plan",
}: MiniMaxCodeSidebarProps): React.JSX.Element {
    return (
        <div
            className="flex h-full w-full flex-col bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-primary)]"
            data-mmcode-component="sidebar"
        >
            {/* ============== 顶部 logo (固定,不滚动) ============== */}
            <div
                className="flex shrink-0 items-center px-3 pt-3 pb-2"
                data-mmcode-region="logo"
            >
                <div
                    className="flex h-6 w-6 items-center justify-center rounded-[var(--mm-radius-sm)] bg-[var(--mm-bg-active)]"
                    aria-label="MiniMax Code logo"
                >
                    <span
                        className="text-[12px] font-bold leading-none text-[var(--mm-text-on-active)]"
                        aria-hidden="true"
                    >
                        M
                    </span>
                </div>
            </div>

            {/* ============== 中间 scroll 区 ============== */}
            <nav
                className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2"
                aria-label="MiniMax Code primary navigation"
            >
                {/* 主操作分组(无标题) */}
                <div className="flex flex-col gap-0.5">
                    {MAIN_SECTIONS.map((section) => (
                        <NavItem
                            key={section.id}
                            section={section}
                            active={currentSection === section.id}
                            onClick={() => onSectionChange(section.id)}
                        />
                    ))}
                </div>

                {/* 4 个分组(标题 + 占位项) */}
                {GROUPED_SECTIONS.map((group) => (
                    <div key={group.title} className="flex flex-col gap-0.5">
                        <h3
                            className="px-3 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]"
                            data-mmcode-group-title={group.title}
                        >
                            {group.title}
                        </h3>
                        {group.items.length === 0 ? null : (
                            <div className="flex flex-col gap-0.5">
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

            {/* ============== 底部固定用户卡片 ============== */}
            <div
                className="shrink-0 border-t border-transparent"
                data-mmcode-region="user-card"
            >
                <MiniMaxCodeUserCard userName={userName} planLabel={planLabel} />
            </div>
        </div>
    );
}
