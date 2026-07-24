// MySkills (M3 Task M3-5)
// 我的 tab: 已装技能, 启/禁/卸载

import React, { useEffect, useState } from "react";
import { useSkillsStore } from "../../stores/skills-store";
import { fuzzyScore } from "../../../../main/utils/fuzzy-match";

export function MySkills(): React.JSX.Element {
    const {
        installed,
        installedLoading,
        refreshInstalled,
        toggleSkill,
        uninstallSkill,
        skillhubAvailable,
        checkAvailability,
        error,
    } = useSkillsStore();
    const [query, setQuery] = useState("");
    const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);

    useEffect(() => {
        refreshInstalled();
    }, [refreshInstalled]);

    const filtered = installed
        .map((s) => ({ s, score: fuzzyScore(s.slug, query) }))
        .filter((x) => query === "" || x.score > 0)
        .sort((a, b) => b.score - a.score);

    if (skillhubAvailable === false) {
        return (
            <div className="p-8 text-center text-sm text-[var(--mm-text-secondary)]">
                <p className="mb-2">SkillHub CLI 未安装</p>
                <code className="block text-xs bg-[var(--mm-bg-sidebar)] p-2 rounded mb-3">
                    curl -fsSL https://skillhub.cn/install/install.sh | bash
                </code>
                <button
                    type="button"
                    onClick={() => {
                        void checkAvailability();
                        void refreshInstalled();
                    }}
                    className="px-3 py-1.5 bg-[#1a1a1a] text-white text-xs rounded hover:bg-[#333] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                    重新检测
                </button>
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* 加载错误 banner — 重试按钮 */}
            {error && !installedLoading && (
                <div
                    className="mb-4 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg flex items-center justify-between gap-3"
                    role="alert"
                >
                    <div className="min-w-0">
                        <p className="text-sm text-[var(--color-error)] font-medium">加载失败</p>
                        <p className="text-xs text-[var(--mm-text-secondary)] truncate font-mono">{error}</p>
                    </div>
                    <button
                    type="button"
                        onClick={() => void refreshInstalled()}
                        className="px-3 py-1.5 bg-[var(--color-error)] text-white text-xs rounded hover:bg-[var(--color-error)] transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
                    >
                        重试
                    </button>
                </div>
            )}

            <div className="mb-4">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="过滤已装技能..."
                    className="w-full px-3 py-1.5 bg-[var(--mm-bg-sidebar)] border border-[var(--mm-border)] rounded text-sm text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus:border-[#1a1a1a] focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                />
            </div>

            {installedLoading ? (
                <div className="text-center text-sm text-[var(--mm-text-tertiary)] py-8" role="status">
                    加载中...
                </div>
            ) : filtered.length === 0 ? (
                <div
                    className="flex flex-col items-center justify-center text-center py-12"
                    role="status"
                >
                    <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <p className="text-sm text-[var(--mm-text-primary)] mb-1 font-medium">
                        暂无已安装 skill
                    </p>
                    <p className="text-xs text-[var(--mm-text-tertiary)] mb-3">
                        打开 SkillHub 市场选一个
                    </p>
                    <button
                    type="button"
                        onClick={() => {
                            // 通过自定义事件让 SkillsPanel 切到"市场" tab
                            window.dispatchEvent(
                                new CustomEvent("skills-panel:set-tab", { detail: "market" })
                            );
                        }}
                        className="px-3 py-1.5 bg-[#1a1a1a] text-white text-xs rounded hover:bg-[#333] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    >
                        打开 SkillHub 市场
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(({ s }) => (
                        <div
                            key={s.slug}
                            className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--mm-bg-panel)] border border-[var(--mm-border)] rounded-lg"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: s.enabled ? "#10b981" : "#999" }}
                                />
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-[var(--mm-text-primary)] truncate">
                                        {s.slug}
                                    </div>
                                    <div className="text-xs text-[var(--mm-text-tertiary)]">
                                        {s.enabled ? "已启用" : "已禁用"}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                    type="button"
                                    onClick={() => toggleSkill(s.slug, !s.enabled)}
                                    className="text-xs px-3 py-1 text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]"
                                >
                                    {s.enabled ? "禁用" : "启用"}
                                </button>
                                <button
                    type="button"
                                    onClick={() => setPendingUninstall(s.slug)}
                                    className="text-xs px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
                                >
                                    卸载
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {pendingUninstall && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
                    <div
                        className="w-[360px] rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-5 shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-label="确认卸载技能"
                    >
                        <h3 className="text-base font-semibold text-[var(--mm-text-primary)]">卸载技能</h3>
                        <p className="mt-2 text-sm leading-6 text-[var(--mm-text-secondary)]">
                            确认卸载 <span className="font-mono text-[var(--mm-text-primary)]">{pendingUninstall}</span> 吗？
                        </p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPendingUninstall(null)}
                                className="rounded-lg px-3 py-1.5 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const slug = pendingUninstall;
                                    setPendingUninstall(null);
                                    void uninstallSkill(slug);
                                }}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
                            >
                                卸载
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
