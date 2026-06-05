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
// v1.0.15: MiniMaxCodeUserCard 已删(死代码) — 之前 sidebar 底部固定一个
// "Ayase / Plus Plan" 用户卡片,现在直接 inline 渲染,避免再维护一个空组件。

import React from "react";

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

function IconGit(): React.JSX.Element {
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
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
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

// v1.0.16: 不再写死 userName/planLabel 默认 ("Ayase" / "Plus Plan") — 之前 v1.0.15
// inline 渲染用户卡片时这么写,被用户截图指出是假数据。改成 sidebar 内部
// 不再渲染 "用户卡片", 底部固定一个设置按钮 (与老 IconBar ⚙️ 图标对应位置),
// 点击调 onSectionChange("settings") → App.tsx 调 openSettings() 打开 SettingsPanel。
// 这次新增一个 settings 主操作图标,放在底部 5 个图标的最后(原 IconBar 设计如此)。
// v1.0.16: 删 "scheduled-tasks" 主操作 + "定时任务" 分组 — Pi CLI 没定时任务 API,
//          整个 AutomationPanel 之前是内存 store 假功能(关 app 全没),已删。
const MAIN_SECTIONS: MiniMaxCodeSection[] = [
    { id: "new-task", label: "新建任务", icon: <IconPlus /> },
    { id: "skills", label: "技能", icon: <IconPuzzle /> },
    { id: "git", label: "Git", icon: <IconGit /> },
    { id: "settings", label: "设置", icon: <IconSettings /> },
];

const GROUPED_SECTIONS: MiniMaxCodeSidebarGroup[] = [
    // v1.0.17: 空分组已删除 — 等接入真实数据后再恢复
    // "任务历史" 将从 Pi SessionManager 获取真实会话列表
    // "Agents" 和 "已归档" 等对应功能实现后再加回
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
    // 激活态: 参考图的浅灰底黑字
    // hover: 轻灰背景
    // 行高 32px,左右 padding 12px
    const baseClasses =
        "flex w-full items-center gap-2.5 rounded-[var(--mm-radius-sm)] px-3 text-[13px] leading-[20px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-bg-active)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--mm-bg-sidebar)]";
    const heightClasses = "h-8";
    const stateClasses = active
        ? "bg-[var(--mm-bg-selected)] text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-selected)]"
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
 *   - 底部固定: 用户卡片 (inline 渲染, v1.0.15 删了 MiniMaxCodeUserCard 死组件)
 *
 * 设计约束:
 *   - 所有颜色/字号/圆角走 --mm-* token
 *   - 不持有业务状态,父级通过 currentSection/onSectionChange 控制激活
 *   - 极简 a11y: button + aria-label + aria-current
 */
export function MiniMaxCodeSidebar({
    currentSection,
    onSectionChange,
}: MiniMaxCodeSidebarProps): React.JSX.Element {
    return (
        <div
            className="flex h-full w-full flex-col bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-primary)]"
            data-mmcode-component="sidebar"
        >
            {/* ============== 顶部折叠占位 (固定,不滚动) ============== */}
            <div
                className="flex h-11 shrink-0 items-center px-3"
                data-mmcode-region="logo"
            >
                <div
                    className="flex h-5 w-5 items-center justify-center rounded-[var(--mm-radius-sm)] text-[var(--mm-text-tertiary)]"
                    aria-hidden="true"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h6v12H4zM14 6h6v12h-6z" />
                    </svg>
                </div>
            </div>

            {/* ============== 中间 scroll 区 ============== */}
            {/* v1.0.16: aria-label 改回 "主导航" — 兼容 a11y.spec.ts 等老测试 selector
                (v1.0.16 sweep 删了 IconBar/ 整个目录,新 MiniMaxCodeSidebar 接管导航;
                原 IconBar 用 aria-label="主导航",新 Sidebar 一开始用 "MiniMax Code primary navigation"
                导致 a11y.spec.ts 找主导航 15s timeout fail, 改回 "主导航" 修复回归) */}
            <nav
                className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2"
                aria-label="主导航"
            >
                {/* 主操作分组(无标题) */}
                <div className="flex flex-col gap-0.5">
                    {MAIN_SECTIONS.map((section) => (
                        <NavItem
                            key={section.id}
                            section={section}
                            active={currentSection === section.id || (section.id === "new-task" && currentSection === "chat")}
                            onClick={() => onSectionChange(section.id)}
                        />
                    ))}
                </div>

                {/* v1.0.17: 空分组已移除，等接入真实数据后再恢复 */}
                {GROUPED_SECTIONS.length > 0 && GROUPED_SECTIONS.map((group) => (
                    <div key={group.title} className="flex flex-col gap-0.5">
                        <h3
                            className="px-3 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]"
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

            {/* v1.0.16: 删底部 "Ayase / Plus Plan" 假用户卡片 — 这个位置原来
                v1.0.x 老 UI 是 IconBar ⚙️ 设置图标。设置入口现在合并到上面 5
                个主操作的第 5 项(settings) — 跟其他主操作一起渲染,无需
                额外底部固定块。 */}
        </div>
    );
}
