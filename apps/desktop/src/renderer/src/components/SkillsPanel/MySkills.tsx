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
    } = useSkillsStore();
    const [query, setQuery] = useState("");

    useEffect(() => {
        refreshInstalled();
    }, [refreshInstalled]);

    const filtered = installed
        .map((s) => ({ s, score: fuzzyScore(s.slug, query) }))
        .filter((x) => query === "" || x.score > 0)
        .sort((a, b) => b.score - a.score);

    if (skillhubAvailable === false) {
        return (
            <div className="p-8 text-center text-sm text-[#666]">
                SkillHub CLI 未安装
            </div>
        );
    }

    return (
        <div className="p-4">
            <div className="mb-4">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="过滤已装技能..."
                    className="w-full px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-sm text-[#1a1a1a] placeholder:text-[#999] focus:outline-none focus:border-[#1a1a1a]"
                />
            </div>

            {installedLoading ? (
                <div className="text-center text-sm text-[#999] py-8">加载中...</div>
            ) : filtered.length === 0 ? (
                <div className="text-center text-sm text-[#999] py-8">
                    {query ? "无匹配" : "还没装任何技能, 去市场看看"}
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(({ s }) => (
                        <div
                            key={s.slug}
                            className="flex items-center justify-between gap-3 px-3 py-2 bg-[#fafafa] border border-[#e5e5e5] rounded-lg"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: s.enabled ? "#10b981" : "#999" }}
                                />
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-[#1a1a1a] truncate">
                                        {s.slug}
                                    </div>
                                    <div className="text-xs text-[#999]">
                                        {s.enabled ? "已启用" : "已禁用"}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => toggleSkill(s.slug, !s.enabled)}
                                    className="text-xs px-3 py-1 text-[#666] hover:bg-[#e5e5e5] rounded transition-colors"
                                >
                                    {s.enabled ? "禁用" : "启用"}
                                </button>
                                <button
                                    onClick={() => {
                                        if (confirm(`确认卸载技能 ${s.slug}?`)) {
                                            uninstallSkill(s.slug);
                                        }
                                    }}
                                    className="text-xs px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                                >
                                    卸载
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
