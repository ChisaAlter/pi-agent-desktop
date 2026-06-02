// SkillsMarketplace (M3 Task M3-4)
// 市场 tab: 搜 SkillHub, 卡片网格, 装按钮

import React, { useEffect, useState } from "react";
import { useSkillsStore } from "../../stores/skills-store";
import { SkillCard } from "./SkillCard";
import { fuzzyScore } from "../../../../main/utils/fuzzy-match";

const FILTERS = [
    { id: "all", label: "全部" },
    { id: "official", label: "官方" },
    { id: "community", label: "贡献" },
] as const;

type FilterId = typeof FILTERS[number]["id"];

export function SkillsMarketplace(): React.JSX.Element {
    const {
        skillhubAvailable,
        marketQuery,
        marketResults,
        marketLoading,
        installed,
        error,
        searchMarket,
        installSkill,
        checkAvailability,
    } = useSkillsStore();
    const [activeFilter, setActiveFilter] = useState<FilterId>("all");
    const [sort, setSort] = useState<"热门" | "最新">("热门");
    const [installingSlug, setInstallingSlug] = useState<string | null>(null);

    useEffect(() => {
        checkAvailability();
    }, [checkAvailability]);

    useEffect(() => {
        if (marketQuery.trim()) {
            const t = setTimeout(() => {
                void searchMarket();
            }, 300);
            return () => clearTimeout(t);
        }
        return undefined;
    }, [marketQuery, searchMarket]);

    const installedSlugs = new Set(installed.map((i) => i.slug));

    const filtered = marketResults
        .filter((r) => {
            if (activeFilter === "all") return true;
            return r.source === activeFilter;
        })
        .map((r) => ({ r, s: fuzzyScore(r.name + " " + r.description, marketQuery) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);

    // 包装 installSkill — 把单卡 loading 状态绑在 slugs 上
    const handleInstall = async (slug: string) => {
        setInstallingSlug(slug);
        try {
            await installSkill(slug);
        } catch {
            // store 已记录 error，下面用 banner 渲染
        } finally {
            setInstallingSlug(null);
        }
    };

    if (skillhubAvailable === false) {
        return (
            <div className="p-8 text-center text-sm text-[#666]">
                <p className="mb-2">SkillHub CLI 未安装</p>
                <code className="block text-xs bg-[#f5f5f5] p-2 rounded mb-3">
                    curl -fsSL https://skillhub.cn/install/install.sh | bash
                </code>
                <button
                    onClick={() => void checkAvailability()}
                    className="px-3 py-1.5 bg-[#1a1a1a] text-white text-xs rounded hover:bg-[#333] transition-colors"
                >
                    重新检测
                </button>
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* 搜索错误 banner — 重试按钮 */}
            {error && !marketLoading && (
                <div
                    className="mb-4 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg flex items-center justify-between gap-3"
                    role="alert"
                >
                    <div className="min-w-0">
                        <p className="text-sm text-[#ef4444] font-medium">搜索失败</p>
                        <p className="text-xs text-[#666] truncate font-mono">{error}</p>
                    </div>
                    <button
                        onClick={() => void searchMarket()}
                        className="px-3 py-1.5 bg-[#ef4444] text-white text-xs rounded hover:bg-[#dc2626] transition-colors flex-shrink-0"
                    >
                        重试
                    </button>
                </div>
            )}

            {/* Filter chips */}
            <div className="flex items-center gap-2 mb-4">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => setActiveFilter(f.id)}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                            activeFilter === f.id
                                ? "bg-[#1a1a1a] text-white"
                                : "bg-[#f5f5f5] text-[#666] hover:bg-[#e5e5e5]"
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
                <div className="flex-1" />
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as "热门" | "最新")}
                    className="text-xs px-2 py-1 bg-white border border-[#e5e5e5] rounded text-[#666]"
                >
                    <option value="热门">热门</option>
                    <option value="最新">最新</option>
                </select>
            </div>

            {/* Grid */}
            {marketLoading ? (
                <div className="text-center text-sm text-[#999] py-8" role="status">
                    搜索中...
                </div>
            ) : filtered.length === 0 ? (
                <div
                    className="text-center text-sm text-[#999] py-8"
                    role="status"
                >
                    {marketQuery
                        ? "无匹配结果"
                        : "输入关键词搜索 Skills, 或从 GitHub 导入"}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filtered.map((s) => (
                        <SkillCard
                            key={s.slug}
                            skill={s}
                            installed={installedSlugs.has(s.slug)}
                            isInstalling={installingSlug === s.slug}
                            onInstall={() => void handleInstall(s.slug)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
