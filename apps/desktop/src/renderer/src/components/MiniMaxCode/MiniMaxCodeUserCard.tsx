// MiniMaxCodeUserCard — MiniMax Code 风格侧栏底部用户卡片
//
// 1:1 还原目标 UI 截图中的底部固定卡片:
//   ┌────────────────────────────────┐
//   │ (●) Ayase                      │
//   │     Plus Plan                  │
//   └────────────────────────────────┘
//
// 视觉规格(来自任务说明 + 截图):
//  - 32px 圆形头像占位 (#e5e5e5 灰底)
//  - 12px 字号,左侧文字左对齐
//  - 名字用 --mm-text-primary,计划用 --mm-text-tertiary
//  - 卡片本体不设独立背景,贴底 flex 排版(由父级侧栏的 bg 控制)
//  - 极简占位: 无菜单弹出 / 无 hover 高亮(本期只是 1:1 视觉对齐,后续接账户菜单)
//
// 调用方: MiniMaxCodeSidebar
// 设计 Token 约定: 所有颜色/尺寸走 --mm-*,不硬编码。

import React from "react";

export interface MiniMaxCodeUserCardProps {
    /** 用户名,默认 "Ayase" */
    userName?: string;
    /** 计划标签,默认 "Plus Plan" */
    planLabel?: string;
}

/**
 * 底部固定用户卡片(侧栏底部贴底).
 *
 * 设计约束:
 *  - 头像 32x32 圆形占位 (--mm-avatar-bg)
 *  - 文字 12px 字号,两行竖排,左侧对齐(用户名主色,计划弱化色)
 *  - 占位实现,本期不接 i18n 也不接账户菜单 — 留给后续任务
 */
export function MiniMaxCodeUserCard({
    userName = "Ayase",
    planLabel = "Plus Plan",
}: MiniMaxCodeUserCardProps = {}): React.JSX.Element {
    return (
        <div
            className="flex w-full items-center gap-2 px-3 py-2"
            data-mmcode-component="user-card"
        >
            {/* 32px 圆形头像占位(灰色) */}
            <div
                className="h-8 w-8 shrink-0 rounded-full"
                style={{ backgroundColor: "var(--mm-avatar-bg, #e5e5e5)" }}
                aria-hidden="true"
            />
            {/* 左侧文字块: 名字 + 计划 */}
            <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
                <span className="truncate text-[12px] font-medium text-[var(--mm-text-primary)]">
                    {userName}
                </span>
                <span className="truncate text-[12px] text-[var(--mm-text-tertiary)]">
                    {planLabel}
                </span>
            </div>
        </div>
    );
}
