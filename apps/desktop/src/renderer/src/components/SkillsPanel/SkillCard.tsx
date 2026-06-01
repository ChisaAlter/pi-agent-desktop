// SkillCard (M3 Task M3-4)
// 单个 skill 卡片 (匹配 Mavis Code 截图风格)

import React from "react";
import type { SkillInfo } from "../../../../main/services/skills/skillhub-adapter";

interface SkillCardProps {
    skill: SkillInfo;
    installed?: boolean;
    onInstall?: () => void;
}

export function SkillCard({ skill, installed, onInstall }: SkillCardProps): React.JSX.Element {
    return (
        <div className="bg-white border border-[#e5e5e5] rounded-xl p-4 flex flex-col gap-2 hover:border-[#999] transition-colors">
            <div className="flex items-start justify-between gap-2">
                <h3
                    className="text-sm font-semibold text-[#1a1a1a] truncate"
                    title={skill.name}
                >
                    {skill.name}
                </h3>
                <span className="text-[10px] text-[#999] font-mono whitespace-nowrap">
                    v{skill.version}
                </span>
            </div>
            <p className="text-xs text-[#666] line-clamp-3 flex-1 min-h-[2.5rem]">
                {skill.description.length > 120
                    ? skill.description.slice(0, 120) + "..."
                    : skill.description}
            </p>
            <div className="flex items-center justify-between gap-2 mt-1">
                <div className="flex items-center gap-2 text-[10px] text-[#999] min-w-0">
                    <span className="truncate">@{skill.slug}</span>
                    {skill.source && (
                        <span className="px-1.5 py-0.5 bg-[#f0f0f0] rounded text-[#666] flex-shrink-0">
                            {skill.source}
                        </span>
                    )}
                </div>
                {installed ? (
                    <span className="text-[10px] text-green-600 font-medium">✓ 已装</span>
                ) : onInstall ? (
                    <button
                        onClick={onInstall}
                        className="text-xs px-3 py-1 bg-[#1a1a1a] text-white rounded hover:bg-[#333] transition-colors"
                    >
                        装
                    </button>
                ) : null}
            </div>
        </div>
    );
}
