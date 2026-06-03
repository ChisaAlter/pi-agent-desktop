// SkillsMarketplace (M3 Task M3-4)
// 市场 tab: 搜 SkillHub, 卡片网格, 装按钮
//
// v1.0.x (button-style task):
//  - "重新检测"/"重试"/筛选按钮 统一用 common/Button
//  - 筛选 active 状态用 subtle variant + dark accent 覆盖 (替代硬编码 bg-[#1a1a1a])
//  - 筛选 inactive 用 ghost variant
//
// 注: "装" 按钮在 SkillCard.tsx,搜索 input 在 SkillsPanel.tsx(都不在本文件),
//     按 button-style 任务 "只改 3 个文件" 严格规则,不动它们。

import React, { useEffect, useState } from "react";
import { useSkillsStore } from "../../stores/skills-store";
import { SkillCard } from "./SkillCard";
import { Button } from "../common/Button";
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
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void checkAvailability()}
                >
                    重新检测
                </Button>
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
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void searchMarket()}
                        className="flex-shrink-0"
                    >
                        重试
                    </Button>
                </div>
            )}

            {/* Filter chips — active=subtle+深色, inactive=ghost */}
            <div className="flex items-center gap-2 mb-4">
                {FILTERS.map((f) => {
                    const isActive = activeFilter === f.id;
                    return (
                        <Button
                            key={f.id}
                            variant={isActive ? "subtle" : "ghost"}
                            size="sm"
                            onClick={() => setActiveFilter(f.id)}
                            aria-pressed={isActive}
                            className={
                                isActive
                                    ? "!bg-[var(--color-accent)] !text-white hover:!bg-[#333] !rounded-full"
                                    : "!rounded-full"
                            }
                        >
                            {f.label}
                        </Button>
                    );
                })}
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
