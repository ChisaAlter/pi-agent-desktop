// 设置 UI 共享原子 — 从 SettingsContent.tsx 抽出, 供各 tab 子组件复用.

import React from 'react';

export function CloseIcon(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18 18 6M6 6l12 12" />
        </svg>
    );
}

export function SectionTitle({ title, description }: { title: string; description?: string }): React.JSX.Element {
    return (
        <div className="mb-2">
            <h3 className="m-0 text-[12px] font-medium text-[var(--mm-text-primary)]">{title}</h3>
            {description && <p className="m-0 mt-0.5 text-[9px] leading-3 text-[var(--mm-text-tertiary)]">{description}</p>}
        </div>
    );
}

export function FieldRow({
    label,
    description,
    children,
}: {
    label: string;
    description?: string;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="grid grid-cols-[minmax(160px,220px)_1fr] items-center gap-6 border-b border-[var(--mm-border)] py-4 last:border-b-0">
            <div>
                <label className="block text-sm font-medium text-[var(--mm-text-primary)]">{label}</label>
                {description && <p className="m-0 mt-1 text-xs leading-5 text-[var(--mm-text-tertiary)]">{description}</p>}
            </div>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

export function SwitchControl({
    checked,
    label,
    onChange,
}: {
    checked: boolean;
    label: string;
    onChange: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={onChange}
            className={`settings-pressable relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-[transform,background-color] duration-150 ease-out ${checked ? 'bg-[#1f1f1f]' : 'bg-[#d9d9d4]'}`}
        >
            <span
                aria-hidden="true"
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--mm-bg-panel)] shadow-sm transition-transform duration-200 ease-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    );
}
