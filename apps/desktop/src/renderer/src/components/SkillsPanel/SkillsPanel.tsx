// SkillsPanel (M3 Task M3-4)
// 容器: tab 切换 (市场 / 我的) + 搜索 + 创建按钮
// v1.0.14: 3 个 create dropdown 真接通
//  - "用 Pi 构建": 切到 chat + ChatInput prefill skill 草稿提示
//  - "编写技能": 弹 SKILL.md 模板 modal, 写完后复制到剪贴板(纯文本,不接 IPC 写盘)
//  - "GitHub 导入": 调 piAPI.skillsGithubImport(url),显示主进程返回的说明(目前是 git clone 引导)

import React, { useEffect, useState } from "react";
import { InstalledAddons } from "./InstalledAddons";
import { PiPackagesMarketplace } from "./PiPackagesMarketplace";
import { SkillCreateDropdown } from "./SkillCreateDropdown";
import { usePiPackagesStore } from "../../stores/pi-packages-store";

type Tab = "pi" | "installed";

/** SKILL.md 模板 — 用户在"编写技能"modal 里基于此填写 */
// v1.0.15: 不再用 'TODO: ...' 假占位 — 空字段就空着,让 SKILL.md frontmatter
//          暴露"YAML key 存在但 value 空"的状态,比"假占位"更诚实。
const SKILL_TEMPLATE = (name: string, description: string, body: string): string => {
    const safeName = name.trim();
    const safeDesc = description.trim();
    return `---
name: ${safeName}
description: ${safeDesc}
---

# ${safeName}

## 何时使用

${safeDesc}

## 操作步骤

${body}
`;
};

export function SkillsPanel(): React.JSX.Element {
    const [tab, setTab] = useState<Tab>("pi");
    const [githubDialog, setGithubDialog] = useState<{
        open: boolean;
        url: string;
        result: string;
        importing: boolean;
    }>({
        open: false,
        url: "",
        result: "",
        importing: false,
    });
    const [writeDialog, setWriteDialog] = useState<{
        open: boolean;
        name: string;
        description: string;
        body: string;
        copied: boolean;
        error: string | null;
    }>({ open: false, name: "", description: "", body: "", copied: false, error: null });
    const { query: packageQuery, setQuery: setPackageQuery } = usePiPackagesStore();

    // 子组件(MySkills) 可通过自定义事件请求切 tab
    useEffect(() => {
        const onSetTab = (e: Event) => {
            const detail = (e as CustomEvent<Tab | "market" | "mine">).detail;
            if (detail === "market" || detail === "pi") {
                setTab("pi");
            } else if (detail === "mine") {
                setTab("installed");
            } else if (detail === "installed") {
                setTab(detail);
            }
        };
        window.addEventListener("skills-panel:set-tab", onSetTab);
        return () => window.removeEventListener("skills-panel:set-tab", onSetTab);
    }, []);

    // v1.0.14: "用 Pi 构建" — 切到 chat + ChatInput 预填一段 skill 草稿提示
    const handleBuildWithPi = (): void => {
        window.dispatchEvent(
            new CustomEvent("chatpanel:prefill", {
                detail: {
                    text:
                        "我想创建一个新的 Skill,请你帮我:\n" +
                        "1. 起一个简短的名字 (kebab-case,例如 web-search)\n" +
                        "2. 写一段 description 说明何时该用这个 skill\n" +
                        "3. 列出 3-5 步操作步骤(我会再润色)\n" +
                        "4. 用 YAML frontmatter 给我一份 SKILL.md 草稿\n\n",
                },
            }),
        );
    };

    // v1.0.17: "GitHub 导入" — 真 git clone + 检查 SKILL.md
    const handleImportFromGitHub = async (url: string): Promise<void> => {
        const trimmedUrl = url.trim();
        if (!trimmedUrl) {
            setGithubDialog((d) => ({ ...d, result: "请输入 GitHub 仓库 URL" }));
            return;
        }
        setGithubDialog((d) => ({ ...d, url: trimmedUrl, result: "", importing: true }));
        try {
            const result = await window.piAPI?.skillsGithubImport(trimmedUrl);
            if (result && typeof result === "object" && "success" in result) {
                const r = result as { success: boolean; path?: string; slug?: string; skillMdFound?: boolean };
                if (r.success) {
                    setGithubDialog({
                        open: true,
                        url: trimmedUrl,
                        result: `导入成功! ${r.skillMdFound ? "已检测到 SKILL.md" : "未检测到 SKILL.md (可能需要手动配置)"}\n路径: ${r.path ?? "unknown"}`,
                        importing: false,
                    });
                } else {
                    setGithubDialog({ open: true, url: trimmedUrl, result: `导入失败: ${String((result as { message?: string }).message ?? "未知错误")}`, importing: false });
                }
            } else {
                setGithubDialog({ open: true, url: trimmedUrl, result: String(result ?? "无返回结果"), importing: false });
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setGithubDialog({ open: true, url: trimmedUrl, result: `导入失败: ${msg}`, importing: false });
        }
    };

    // v1.0.14: "编写技能" — 打开写 modal, 让用户填 name + description + body
    const handleWriteDirect = (): void => {
        setWriteDialog({ open: true, name: "", description: "", body: "", copied: false, error: null });
    };

    // v1.0.17: 写盘而非只复制到剪贴板
    const handleSaveSkillMd = async (): Promise<void> => {
        const text = SKILL_TEMPLATE(writeDialog.name, writeDialog.description, writeDialog.body);
        const safeName = writeDialog.name.trim().replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase();
        if (!safeName) {
            setWriteDialog((d) => ({ ...d, error: "请输入有效的技能名称 (只允许字母、数字、连字符和下划线)" }));
            return;
        }
        setWriteDialog((d) => ({ ...d, error: null }));
        try {
            const result = await window.piAPI?.skillsWriteSkill(safeName, text);
            if (result && typeof result === "object" && "success" in result) {
                const r = result as { success: boolean; path?: string };
                if (r.success) {
                    setWriteDialog((d) => ({ ...d, copied: true }));
                    // 3 秒后自动关闭 modal
                    setTimeout(() => setWriteDialog({ open: false, name: "", description: "", body: "", copied: false, error: null }), 3000);
                } else {
                    setWriteDialog((d) => ({ ...d, error: `保存失败: ${String((result as { message?: string }).message ?? "未知错误")}` }));
                }
            }
        } catch (err) {
            // 回退到剪贴板复制
            try {
                await navigator.clipboard.writeText(text);
                setWriteDialog((d) => ({ ...d, copied: true }));
                setTimeout(() => setWriteDialog((d) => ({ ...d, copied: false })), 3000);
            } catch (clipboardErr) {
                const saveMessage = err instanceof Error ? err.message : String(err);
                const clipboardMessage = clipboardErr instanceof Error ? clipboardErr.message : String(clipboardErr);
                setWriteDialog((d) => ({
                    ...d,
                    error: `保存失败，且无法复制到剪贴板。保存错误: ${saveMessage}；复制错误: ${clipboardMessage}`,
                }));
            }
        }
    };

    return (
        <div className="flex flex-col h-full bg-[var(--mm-bg-sidebar)]" role="region" aria-label="插件面板">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--mm-border)]">
                <div className="w-[128px] min-w-0 shrink-0">
                    <h1 className="m-0 truncate text-[14px] font-medium text-[var(--mm-text-primary)]">插件与技能</h1>
                    <p className="m-0 truncate text-[11px] text-[var(--mm-text-tertiary)]">安装 Pi packages，管理本地 skills</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--mm-bg-sidebar)] p-1" role="tablist" aria-label="插件面板分类">
                    {([["pi", "Pi 插件"], ["installed", "已安装"]] as const).map(([id, label]) => {
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
                                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${
                                    isActive
                                        ? "bg-[var(--mm-bg-panel)] text-[var(--mm-text-primary)] shadow-sm"
                                        : "text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
                                }`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
                <div className="min-w-0 flex-1" />
                {tab === "pi" && (
                    <input
                        type="text"
                        placeholder="搜索 Pi 插件..."
                        value={packageQuery}
                        onChange={(e) => setPackageQuery(e.target.value)}
                        aria-label="搜索 Pi 插件"
                        className="min-w-[140px] max-w-[220px] flex-1 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] py-1.5 pl-3 pr-3 text-sm text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:border-[#1a1a1a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    />
                )}
                <SkillCreateDropdown
                    onBuildWithPi={handleBuildWithPi}
                    onWriteDirect={handleWriteDirect}
                    onImportFromGitHub={() => setGithubDialog({ open: true, url: "", result: "", importing: false })}
                />
            </div>

            <div
                className="flex-1 overflow-auto"
                role="tabpanel"
                id={`skills-tabpanel-${tab}`}
                aria-labelledby={`skills-tab-${tab}`}
            >
                {tab === "pi" && <PiPackagesMarketplace />}
                {tab === "installed" && <InstalledAddons />}
            </div>

            {/* GitHub 导入 — 弹 modal 输入 URL 并显示主进程返回 */}
            {githubDialog.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div
                        className="bg-[var(--mm-bg-sidebar)] rounded-2xl p-6 max-w-md shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-label="从 GitHub 导入"
                    >
                        <h3 className="text-lg font-semibold mb-2 text-[var(--mm-text-primary)]">从 GitHub 导入</h3>
                        <label htmlFor="skill-github-url" className="mb-1 block text-xs text-[var(--mm-text-tertiary)]">GitHub 仓库 URL</label>
                        <input
                            id="skill-github-url"
                            type="url"
                            value={githubDialog.url}
                            onChange={(e) => setGithubDialog((d) => ({ ...d, url: e.target.value, result: "" }))}
                            placeholder="https://github.com/user/repo"
                            className="mb-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-hover)] px-3 py-2 text-sm text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        />
                        {githubDialog.result && (
                            <p
                                className={`mb-4 whitespace-pre-wrap rounded border px-3 py-2 text-sm ${
                                    githubDialog.result.includes("失败") || githubDialog.result.includes("请输入")
                                        ? "border-red-200 bg-red-50 text-red-700"
                                        : "border-[#dbe8d0] bg-[#f5fbf0] text-[var(--color-success)]"
                                }`}
                                role="status"
                            >
                                {githubDialog.result}
                            </p>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setGithubDialog({ open: false, url: "", result: "", importing: false })}
                                className="rounded px-3 py-2 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                                aria-label="关闭"
                            >
                                关闭
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleImportFromGitHub(githubDialog.url)}
                                disabled={githubDialog.importing}
                                className="rounded bg-[var(--mm-bg-active)] px-4 py-2 text-sm text-[var(--mm-text-on-active)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2563eb]"
                            >
                                {githubDialog.importing ? "导入中..." : "导入"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 编写技能 — 弹 modal 让用户填 SKILL.md 字段,复制到剪贴板 */}
            {writeDialog.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div
                        className="bg-[var(--mm-bg-sidebar)] rounded-2xl p-6 max-w-2xl w-[90vw] max-h-[85vh] shadow-2xl flex flex-col"
                        role="dialog"
                        aria-modal="true"
                        aria-label="编写技能"
                    >
                        <h3 className="text-lg font-semibold mb-3 text-[var(--mm-text-primary)]">编写技能 (SKILL.md)</h3>
                        <p className="text-xs text-[var(--mm-text-tertiary)] mb-4">
                            填完后点"保存" — 写入 .agents/skills/ 目录下的 SKILL.md 文件。
                        </p>

                        <label className="block text-xs text-[var(--mm-text-secondary)] mb-1">名字 (kebab-case, e.g. web-search)</label>
                        <input
                            type="text"
                            value={writeDialog.name}
                            onChange={(e) => setWriteDialog((d) => ({ ...d, name: e.target.value, error: null }))}
                            placeholder="my-skill"
                            className="w-full mb-3 px-3 py-2 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-sm text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        />

                        <label className="block text-xs text-[var(--mm-text-secondary)] mb-1">何时使用 (description)</label>
                        <textarea
                            value={writeDialog.description}
                            onChange={(e) => setWriteDialog((d) => ({ ...d, description: e.target.value, error: null }))}
                            placeholder="一句话说明 Pi 何时该调这个 skill"
                            rows={2}
                            className="w-full mb-3 px-3 py-2 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-sm font-mono text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        />

                        <label className="block text-xs text-[var(--mm-text-secondary)] mb-1">操作步骤 (body)</label>
                        <textarea
                            value={writeDialog.body}
                            onChange={(e) => setWriteDialog((d) => ({ ...d, body: e.target.value, error: null }))}
                            placeholder="Pi 应该按什么步骤执行"
                            rows={6}
                            className="w-full flex-1 mb-4 px-3 py-2 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-sm font-mono text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        />

                        {writeDialog.error && (
                            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                                {writeDialog.error}
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setWriteDialog({ open: false, name: "", description: "", body: "", copied: false, error: null })}
                                className="rounded px-3 py-1.5 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveSkillMd()}
                                className="rounded bg-[var(--mm-bg-active)] px-4 py-1.5 text-sm text-[var(--mm-text-on-active)] hover:bg-[#333] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2563eb]"
                            >
                                {writeDialog.copied ? "✓ 已保存" : "保存 SKILL.md"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
