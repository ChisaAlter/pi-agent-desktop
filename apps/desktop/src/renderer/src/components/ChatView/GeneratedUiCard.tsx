import React, { Suspense, lazy, useState } from "react";
import { isIpcError, type GeneratedUiAction, type GeneratedUiActionV2, type GeneratedUiCard as GeneratedUiCardData, type GeneratedUiCardV1, type GeneratedUiCardV2, type GeneratedUiListItem, type GeneratedUiTone } from "@shared";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { GeneratedUiForm, type GeneratedUiSendRequest } from "./GeneratedUiForm";
import { GeneratedUiTable } from "./GeneratedUiTable";

const GeneratedUiChart = lazy(() => import("./GeneratedUiChart"));

interface GeneratedUiCardProps {
  card: GeneratedUiCardData;
  badgeLabel?: string;
  disabled?: boolean;
  onSend?: (request: GeneratedUiSendRequest) => Promise<void>;
}

function toneClass(tone?: GeneratedUiTone): string {
  switch (tone) {
    case "success": return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "warning": return "border-amber-200 bg-amber-50 text-amber-800";
    case "danger": return "border-red-200 bg-red-50 text-red-800";
    case "info": return "border-blue-200 bg-blue-50 text-blue-800";
    default: return "border-[var(--mm-border)] bg-transparent text-[var(--mm-text-primary)]";
  }
}

function statusClass(status?: string): string {
  if (status === "completed" || status === "done" || status === "success" || status === "完成") return "bg-emerald-50 text-emerald-700";
  if (status === "running" || status === "progress" || status === "进行中") return "bg-blue-50 text-blue-700";
  if (status === "failed" || status === "error" || status === "失败") return "bg-red-50 text-red-700";
  return "bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-secondary)]";
}

function ListItems({ items, ordered = false }: { items: GeneratedUiListItem[]; ordered?: boolean }): React.JSX.Element {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`m-0 space-y-0 p-0 ${ordered ? "list-none" : "list-none"}`}>
      {items.map((item, index) => (
        <li key={item.id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-2 border-b border-[var(--mm-border)] py-2.5 last:border-b-0">
          <span className="pt-0.5 text-[11px] text-[var(--mm-text-tertiary)]">{ordered ? index + 1 : "•"}</span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-[var(--mm-text-primary)]">{item.label}</div>
            {item.description ? <p className="m-0 mt-0.5 text-[11px] leading-4 text-[var(--mm-text-secondary)]">{item.description}</p> : null}
            {item.path ? <p className="m-0 mt-0.5 break-all font-mono text-[10px] text-[var(--mm-text-tertiary)]">{item.path}</p> : null}
          </div>
          {item.status ? <span className={`self-start rounded px-1.5 py-0.5 text-[10px] ${statusClass(item.status)}`}>{item.status}</span> : null}
        </li>
      ))}
    </Tag>
  );
}

async function runV1Action(action: GeneratedUiAction): Promise<string | null> {
  switch (action.kind) {
    case "open-file": {
      if (!window.piAPI?.openPath) return "系统打开能力不可用";
      const result = await window.piAPI.openPath(action.value);
      if (isIpcError(result)) throw new Error(result.fallback);
      if (typeof result === "string" && result.trim()) throw new Error(result);
      return "已请求系统打开";
    }
    case "copy-text": await navigator.clipboard.writeText(action.value); return "已复制";
    case "switch-view": window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: action.value } })); return null;
    case "refresh": window.dispatchEvent(new CustomEvent("custom-card:refresh", { detail: { id: action.id, value: action.value } })); return null;
    case "slash-command": window.dispatchEvent(new CustomEvent("chatpanel:prefill", { detail: { text: action.value } })); return null;
  }
}

function V1Sections({ card }: { card: GeneratedUiCardV1 }): React.JSX.Element {
  return (
    <div className="divide-y divide-[var(--mm-border)]">
      {card.sections.map((section) => {
        if (section.kind === "summary" || section.kind === "markdown") return <div key={section.id} className="py-4 first:pt-0 last:pb-0"><MarkdownRenderer content={section.content} /></div>;
        if (section.kind === "status_list" || section.kind === "file_list") return <div key={section.id} className="py-2 first:pt-0 last:pb-0"><ListItems items={section.items} /></div>;
        if (section.kind === "steps") return <div key={section.id} className="py-2 first:pt-0 last:pb-0"><ListItems items={section.items} ordered /></div>;
        if (section.kind === "key_value") return <dl key={section.id} className="m-0 divide-y divide-[var(--mm-border)] py-2">{section.items.map((item) => <div key={item.id} className="grid grid-cols-[minmax(90px,0.35fr)_minmax(0,1fr)] gap-3 py-2.5 text-xs"><dt className="text-[var(--mm-text-tertiary)]">{item.key}</dt><dd className="m-0 break-words text-[var(--mm-text-primary)]">{item.value}</dd></div>)}</dl>;
        return <ActionButtons key={section.id} actions={section.actions} runAction={runV1Action} />;
      })}
    </div>
  );
}

function ActionButtons<T extends { id: string; label: string }>({ actions, runAction, disabled }: { actions: T[]; runAction: (action: T) => Promise<string | null>; disabled?: boolean }): React.JSX.Element {
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 py-4 first:pt-0 last:pb-0" data-generated-ui-actions>
      {actions.map((action) => (
        <button key={action.id} type="button" disabled={disabled || active !== null} onClick={() => {
          setActive(action.id);
          setStatus(null);
          void runAction(action).then((message) => { if (message) setStatus({ message, error: false }); }).catch((error: unknown) => setStatus({ message: error instanceof Error ? error.message : String(error), error: true })).finally(() => setActive(null));
        }} className="h-9 rounded-[6px] border border-[var(--mm-border-strong)] bg-[var(--mm-bg-main)] px-3 text-[11px] font-medium text-[var(--mm-text-secondary)] shadow-[0_1px_1px_rgba(15,23,42,0.04)] transition-[background-color,border-color,color] hover:border-[var(--mm-accent-blue)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] disabled:cursor-not-allowed disabled:opacity-50">
          {active === action.id ? "处理中..." : action.label}
        </button>
      ))}
      {status ? <span role={status.error ? "alert" : "status"} className={`text-[11px] ${status.error ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>{status.message}</span> : null}
    </div>
  );
}

function V2Sections({ card, disabled, onSend }: { card: GeneratedUiCardV2; disabled?: boolean; onSend?: (request: GeneratedUiSendRequest) => Promise<void> }): React.JSX.Element {
  const runAction = async (action: GeneratedUiActionV2): Promise<string | null> => {
    switch (action.kind) {
      case "copy-text": await navigator.clipboard.writeText(action.value); return "已复制";
      case "open-file":
      case "open-url": {
        if (!window.piAPI?.openPath) return "系统打开能力不可用";
        const result = await window.piAPI.openPath(action.value);
        if (isIpcError(result)) throw new Error(result.fallback);
        if (typeof result === "string" && result.trim()) throw new Error(result);
        return "已请求系统打开";
      }
      case "switch-view": window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: action.value } })); return null;
      case "prefill-message": window.dispatchEvent(new CustomEvent("chatpanel:prefill", { detail: { text: action.value } })); return null;
      case "send-message": {
        if (!onSend) throw new Error("当前会话无法接收此操作");
        await onSend({
          transportContent: `<generated_ui_action card_id="${card.id}" action_id="${action.id}">\n${action.value}\n</generated_ui_action>`,
          visibleContent: `已选择「${action.label}」`,
        });
        return null;
      }
    }
  };

  return (
    <div className="divide-y divide-[var(--mm-border)]">
      {card.sections.map((section) => {
        switch (section.kind) {
          case "markdown": return <div key={section.id} className="py-4 first:pt-0 last:pb-0"><MarkdownRenderer content={section.content} /></div>;
          case "callout": return <div key={section.id} className={`my-4 rounded-[6px] border px-3 py-3 text-xs ${toneClass(section.tone)}`}>{section.title ? <div className="mb-1 font-medium">{section.title}</div> : null}<MarkdownRenderer content={section.content} /></div>;
          case "metric_grid": return <div key={section.id} className="grid grid-cols-2 gap-x-5 gap-y-4 py-4 sm:grid-cols-3">{section.items.map((item) => <div key={item.id} className="min-w-0 border-l-2 border-[var(--mm-border-strong)] pl-3"><div className="text-[10px] uppercase text-[var(--mm-text-tertiary)]">{item.label}</div><div className="mt-0.5 truncate text-lg font-semibold text-[var(--mm-text-primary)]">{item.value}</div><div className="flex gap-2 text-[10px] text-[var(--mm-text-secondary)]">{item.detail ? <span>{item.detail}</span> : null}{item.trend ? <span>{item.trend}</span> : null}</div></div>)}</div>;
          case "status_list":
          case "file_list": return <div key={section.id} className="py-3"><ListItems items={section.items} /></div>;
          case "steps": return <div key={section.id} className="py-3"><ListItems items={section.items} ordered /></div>;
          case "key_value": return <dl key={section.id} className="m-0 divide-y divide-[var(--mm-border)] py-2">{section.items.map((item) => <div key={item.id} className="grid grid-cols-[minmax(90px,0.35fr)_minmax(0,1fr)] gap-3 py-2.5 text-xs"><dt className="text-[var(--mm-text-tertiary)]">{item.key}</dt><dd className="m-0 break-words">{item.value}</dd></div>)}</dl>;
          case "timeline": return <ol key={section.id} className="m-0 list-none py-4 pl-2">{section.items.map((item, index) => <li key={item.id} className="relative border-l border-[var(--mm-border)] pb-4 pl-4 last:pb-0"><span className="absolute -left-[4px] top-1 h-[7px] w-[7px] rounded-full bg-[var(--mm-bg-active)]" /><div className="flex items-baseline justify-between gap-3"><span className="text-xs font-medium">{item.title}</span>{item.time ? <time className="shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">{item.time}</time> : null}</div>{item.description ? <p className="m-0 mt-1 text-[11px] text-[var(--mm-text-secondary)]">{item.description}</p> : null}{item.status ? <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${statusClass(item.status)}`}>{item.status}</span> : null}<span className="sr-only">{index + 1}</span></li>)}</ol>;
          case "progress": return <div key={section.id} className="space-y-4 py-4">{section.items.map((item) => { const percent = Math.round((item.value / item.max) * 100); return <div key={item.id}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span>{item.label}</span><span className="text-[var(--mm-text-tertiary)]">{percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--mm-border)]"><div className="h-full rounded-full bg-[var(--mm-accent-blue)] transition-[width]" style={{ width: `${percent}%` }} /></div>{item.description ? <p className="m-0 mt-1.5 text-[10px] text-[var(--mm-text-tertiary)]">{item.description}</p> : null}</div>; })}</div>;
          case "table": return <div key={section.id} className="py-4"><GeneratedUiTable section={section} /></div>;
          case "chart": return <div key={section.id} className="py-4"><Suspense fallback={<div className="flex h-[280px] items-center justify-center rounded-[6px] border border-[var(--mm-border)] bg-[var(--mm-bg-main)] text-xs text-[var(--mm-text-tertiary)]">正在加载图表...</div>}><GeneratedUiChart section={section} /></Suspense></div>;
          case "form": return <div key={section.id} className="py-4"><GeneratedUiForm cardId={card.id} cardTitle={card.title} section={section} disabled={disabled} onSend={onSend} /></div>;
          case "action_bar": return <ActionButtons key={section.id} actions={section.actions} runAction={runAction} disabled={disabled} />;
        }
      })}
    </div>
  );
}

export function GeneratedUiCard({ card, badgeLabel, disabled, onSend }: GeneratedUiCardProps): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-[8px] border border-[var(--mm-border-strong)] bg-[var(--mm-bg-input)] shadow-[0_2px_8px_rgba(15,23,42,0.06)]" aria-label={card.title ?? "生成式 UI"} data-generated-ui-card>
      <header className="flex items-start justify-between gap-3 border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-semibold text-[var(--mm-text-primary)]">{card.title || "Pi 生成式界面"}</h3>
          {card.version === "v2" && card.subtitle ? <p className="m-0 mt-0.5 text-[11px] text-[var(--mm-text-secondary)]">{card.subtitle}</p> : null}
        </div>
        <span className="shrink-0 text-[9px] uppercase text-[var(--mm-text-tertiary)]">{badgeLabel || card.version}</span>
      </header>
      <div className="px-4 pb-4 pt-1">
        {card.version === "v1" ? <V1Sections card={card} /> : <V2Sections card={card} disabled={disabled} onSend={onSend} />}
      </div>
    </section>
  );
}
