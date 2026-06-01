// SkillCreateDropdown (M3 Task M3-6)
// + 创建按钮的下拉菜单, 3 选项 (用 Pi 构建 / 编写技能 / 从 GitHub 导入)

import React, { useState, useRef, useEffect } from "react";

interface SkillCreateDropdownProps {
    onBuildWithPi?: () => void;
    onWriteDirect?: () => void;
    onImportFromGitHub?: () => void;
}

export function SkillCreateDropdown({
    onBuildWithPi,
    onWriteDirect,
    onImportFromGitHub,
}: SkillCreateDropdownProps): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] text-white text-sm rounded hover:bg-[#333] transition-colors"
            >
                <span>+ 创建</span>
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-[#e5e5e5] rounded-lg shadow-lg z-10 py-1">
                    <button
                        onClick={() => {
                            setOpen(false);
                            onBuildWithPi?.();
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors flex items-start gap-2"
                    >
                        <span className="text-lg">💬</span>
                        <div>
                            <div className="text-sm font-medium text-[#1a1a1a]">用 Pi 构建</div>
                            <div className="text-xs text-[#666]">通过对话构建出色的技能</div>
                        </div>
                    </button>
                    <button
                        onClick={() => {
                            setOpen(false);
                            onWriteDirect?.();
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors flex items-start gap-2"
                    >
                        <span className="text-lg">✏️</span>
                        <div>
                            <div className="text-sm font-medium text-[#1a1a1a]">编写技能</div>
                            <div className="text-xs text-[#666]">直接编写你的指令</div>
                        </div>
                    </button>
                    <button
                        onClick={() => {
                            setOpen(false);
                            onImportFromGitHub?.();
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors flex items-start gap-2"
                    >
                        <span className="text-lg inline-flex items-center justify-center w-5 h-5">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                            </svg>
                        </span>
                        <div>
                            <div className="text-sm font-medium text-[#1a1a1a]">从 Github 导入</div>
                            <div className="text-xs text-[#666]">粘贴仓库链接以开始</div>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
}
