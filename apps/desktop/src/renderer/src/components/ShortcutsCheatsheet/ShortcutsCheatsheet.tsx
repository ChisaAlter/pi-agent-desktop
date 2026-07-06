// ShortcutsCheatsheet (M7+ 可用度-C)
// 速查弹窗: 显示所有已注册 shortcut, 按 category 分组
// 唤起: ? 或 Shift+/
// 关闭: Esc / 点击背景 / 点击关闭按钮
// 风格沿用 CommandPalette (dialog + 列表 + 键盘导航)
// v1.0.4: 标题/分组/label 走 t(), category 来自 registry 的 key 翻译

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getEffectiveShortcuts, groupByCategory, type ShortcutDef } from "../../shortcuts/registry";
import { useI18n } from "../../i18n";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export interface ShortcutsCheatsheetProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ShortcutsCheatsheet({
    isOpen,
    onClose,
}: ShortcutsCheatsheetProps): React.ReactElement | null {
    const [activeIdx, setActiveIdx] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    useFocusTrap(dialogRef, isOpen);
    const { t } = useI18n();

    const groups = useMemo(() => (isOpen ? groupByCategory(getEffectiveShortcuts()) : []), [isOpen]);
    // 扁平化, 用于键盘上下导航
    const flat: ShortcutDef[] = useMemo(
        () => groups.flatMap((g) => g.items),
        [groups],
    );

    useEffect(() => {
        if (isOpen) {
            setActiveIdx(0);
            // 模态打开后焦点锁在容器 (用 ref focus 第一项)
            setTimeout(() => containerRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Home") {
                e.preventDefault();
                setActiveIdx(0);
            } else if (e.key === "End") {
                e.preventDefault();
                setActiveIdx(flat.length - 1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isOpen, onClose, flat.length]);

    if (!isOpen) return null;

    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={t("shortcutsCheatsheet.title")}
        >
            <div
                ref={containerRef}
                tabIndex={-1}
                className="bg-[var(--mm-bg-panel)] rounded-2xl shadow-2xl w-[640px] max-h-[70vh] flex flex-col overflow-hidden focus:outline-none"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--mm-border)] flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-[var(--mm-text-primary)]">
                            {t("shortcutsCheatsheet.title")}
                        </h2>
                        <p className="text-xs text-[var(--mm-text-tertiary)] mt-0.5">
                            {t("shortcutsCheatsheet.subtitle", {
                                open: "?",
                                close: "Esc",
                            })}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t("shortcutsCheatsheet.closeAria")}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-sidebar)] hover:text-[var(--mm-text-primary)] transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body: 按 category 分组 */}
                <div className="flex-1 overflow-auto px-5 py-3">
                    {groups.map((g) => (
                        <section key={g.category} className="mb-4 last:mb-0">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--mm-text-tertiary)] mb-1.5">
                                {t(`shortcuts.categories.${g.category}`)}
                            </h3>
                            <ul className="divide-y divide-[#f0f0f0]" role="list">
                                {g.items.map((s) => {
                                    const idx = flat.indexOf(s);
                                    const active = idx === activeIdx;
                                    return (
                                        <li
                                            key={`${s.id}-${s.keys}`}
                                            role="option"
                                            aria-selected={active}
                                            onMouseEnter={() => setActiveIdx(idx)}
                                            className={`flex items-center justify-between py-2 px-2 rounded-md cursor-default transition-colors ${
                                                active ? "bg-[var(--mm-bg-hover)]" : ""
                                            }`}
                                        >
                                            <span className="text-sm text-[var(--mm-text-primary)]">{t(s.labelKey)}</span>
                                            <KeyChip keys={s.keys} />
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-2.5 border-t border-[var(--mm-border)] text-xs text-[var(--mm-text-tertiary)] flex items-center gap-3">
                    <span>
                        <kbd className="px-1 py-0.5 bg-[var(--mm-bg-sidebar)] rounded">↑↓</kbd> {t("shortcutsCheatsheet.footer.navigate")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[var(--mm-bg-sidebar)] rounded">Esc</kbd> {t("shortcutsCheatsheet.footer.close")}
                    </span>
                    <span className="ml-auto">
                        {t("shortcutsCheatsheet.footer.count", { count: flat.length })}
                    </span>
                </div>
            </div>
        </div>
    );
}

function KeyChip({ keys }: { keys: string }): React.ReactElement {
    // "Ctrl+Shift+K" → ["Ctrl", "Shift", "K"]
    const parts = keys.split("+");
    return (
        <span className="flex items-center gap-1">
            {parts.map((p, i) => (
                <React.Fragment key={`${p}-${i}`}>
                    {i > 0 && <span className="text-[#ccc] text-[10px]">+</span>}
                    <kbd className="px-1.5 py-0.5 bg-[var(--mm-bg-sidebar)] border border-[var(--mm-border)] rounded text-[11px] font-mono text-[var(--mm-text-secondary)] min-w-[20px] inline-block text-center">
                        {p}
                    </kbd>
                </React.Fragment>
            ))}
        </span>
    );
}
