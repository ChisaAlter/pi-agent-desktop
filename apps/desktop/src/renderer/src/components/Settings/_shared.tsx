// 设置 UI 共享原子 — 从 SettingsContent.tsx 抽出, 供各 tab 子组件复用.

import React from 'react';
import type { SettingsTab } from './tab-defs';

export function CloseIcon(): React.JSX.Element {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18 18 6M6 6l12 12" />
        </svg>
    );
}

export function SettingsPage({
    tabId,
    title,
    description,
    actions,
    children,
}: {
    tabId: SettingsTab;
    title: string;
    description?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="settings-tab-panel mx-auto w-full max-w-[960px] px-6 py-8" role="tabpanel" id={`settings-tabpanel-${tabId}`} aria-labelledby={`settings-tab-${tabId}`}>
            <div data-settings-anchor={`page-${tabId}`} className="mb-6 flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-[var(--mm-text-primary)]">{title}</h1>
                    {description && <p className="m-0 mt-2 max-w-[680px] text-[14px] leading-6 text-[var(--mm-text-secondary)]">{description}</p>}
                </div>
                {actions && <div className="shrink-0">{actions}</div>}
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

export function SettingsCard({
    children,
    className = '',
    anchorId,
}: {
    children: React.ReactNode;
    className?: string;
    anchorId?: string;
}): React.JSX.Element {
    return (
        <section
            data-settings-anchor={anchorId}
            className={`rounded-[18px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-5 py-1 shadow-[0_10px_30px_rgba(15,23,42,0.05)] ${className}`.trim()}
        >
            {children}
        </section>
    );
}

export function SectionTitle({
    title,
    description,
    anchorId,
}: {
    title: string;
    description?: string;
    anchorId?: string;
}): React.JSX.Element {
    return (
        <div data-settings-anchor={anchorId} className="mb-3">
            <h3 className="m-0 text-[13px] font-semibold tracking-[0.01em] text-[var(--mm-text-primary)]">{title}</h3>
            {description && <p className="m-0 mt-1 text-[12px] leading-5 text-[var(--mm-text-tertiary)]">{description}</p>}
        </div>
    );
}

export function FieldRow({
    label,
    description,
    anchorId,
    children,
}: {
    label: string;
    description?: string;
    anchorId?: string;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div data-settings-anchor={anchorId} className="grid grid-cols-[minmax(210px,240px)_1fr] items-center gap-6 border-b border-[var(--mm-border)] py-4 last:border-b-0">
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
            className={`settings-pressable relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-[transform,background-color] duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2563eb] ${checked ? 'bg-[var(--mm-accent-blue)]' : 'bg-[var(--settings-border)]'}`}
        >
            <span
                aria-hidden="true"
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--mm-bg-panel)] shadow-sm transition-transform duration-200 ease-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    );
}
