// SkillsPanel (M3 Task M3-4)
// 容器: tab 切换 (市场 / 我的) + 搜索 + 创建按钮

import React, { useEffect, useState } from "react";
import { SkillsMarketplace } from "./SkillsMarketplace";
import { MySkills } from "./MySkills";
import { SkillCreateDropdown } from "./SkillCreateDropdown";
import { useSkillsStore } from "../../stores/skills-store";

type Tab = "market" | "mine";

export function SkillsPanel(): React.JSX.Element {
    const [tab, setTab] = useState<Tab>("market");
    const [githubDialog, setGithubDialog] = useState<{ open: boolean; url: string }>({
        open: false,
        url: "",
    });
    const { marketQuery, setMarketQuery } = useSkillsStore();

    // 子组件(MySkills) 可通过自定义事件请求切 tab
    useEffect(() => {
        const onSetTab = (e: Event) => {
            const detail = (e as CustomEvent<"market" | "mine">).detail;
            if (detail === "market" || detail === "mine") {
                setTab(detail);
            }
        };
        window.addEventListener("skills-panel:set-tab", onSetTab);
        return () => window.removeEventListener("skills-panel:set-tab", onSetTab);
    }, []);

    return (
        <div className="flex flex-col h-full bg-white" role="region" aria-label="技能面板">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e5e5e5]">
                <div className="flex items-center gap-1" role="tablist" aria-label="技能面板分类">
                    {([["market", "市场"], ["mine", "我的"]] as const).map(([id, label]) => {
                        const isActive = tab === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                aria-controls={`skills-tabpanel-${id}`}
                                id={`skills-tab-${id}`}
                                onClick={() => setTab(id)}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    isActive
                                        ? "bg-[#1a1a1a] text-white"
                                        : "text-[#666] hover:bg-[#f5f5f5]"
                                }`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
                <div className="flex-1" />
                {tab === "market" && (
                    <input
                        type="text"
                        placeholder="搜索技能..."
                        value={marketQuery}
                        onChange={(e) => setMarketQuery(e.target.value)}
                        aria-label="搜索技能"
                        className="pl-3 pr-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-sm text-[#1a1a1a] placeholder:text-[#999] focus:outline-none focus:border-[#1a1a1a] w-64"
                    />
                )}
                <SkillCreateDropdown
                    onBuildWithPi={() => alert("M3.1 实装: 打开 chat 预填 '帮我写一个 skill...'")}
                    onWriteDirect={() => alert("M3.1 实装: 打开 Monaco 编辑器")}
                    onImportFromGitHub={() => {
                        const url = prompt("粘 GitHub 仓库 URL (e.g. https://github.com/user/repo):");
                        if (url) setGithubDialog({ open: true, url });
                    }}
                />
            </div>

            <div
                className="flex-1 overflow-auto"
                role="tabpanel"
                id={`skills-tabpanel-${tab}`}
                aria-labelledby={`skills-tab-${tab}`}
            >
                {tab === "market" ? <SkillsMarketplace /> : <MySkills />}
            </div>

            {githubDialog.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div
                        className="bg-white rounded-2xl p-6 max-w-md shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-label="从 GitHub 导入"
                    >
                        <h3 className="text-lg font-semibold mb-2">从 GitHub 导入</h3>
                        <p className="text-sm text-[#666] mb-3 break-all">{githubDialog.url}</p>
                        <p className="text-xs text-[#999]">
                            M3 暂未实装自动导入. 请用 git clone 仓库到 skills/ 目录.
                        </p>
                        <button
                            type="button"
                            onClick={() => setGithubDialog({ open: false, url: "" })}
                            className="mt-4 px-4 py-2 bg-[#1a1a1a] text-white rounded"
                            aria-label="关闭"
                        >
                            关闭
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
