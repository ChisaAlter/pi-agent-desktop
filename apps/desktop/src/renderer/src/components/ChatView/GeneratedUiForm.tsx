import React, { useMemo, useState } from "react";
import type { GeneratedUiFormField, GeneratedUiSectionV2 } from "@shared";

export interface GeneratedUiSendRequest {
  transportContent: string;
  visibleContent: string;
}

interface GeneratedUiFormProps {
  cardId: string;
  cardTitle?: string;
  section: Extract<GeneratedUiSectionV2, { kind: "form" }>;
  disabled?: boolean;
  onSend?: (request: GeneratedUiSendRequest) => Promise<void>;
}

type FieldValue = string | number | boolean | string[];
type FormValues = Record<string, FieldValue>;

export function initialFieldValue(field: GeneratedUiFormField): FieldValue {
  if (field.kind === "checkbox") return field.defaultValue ?? false;
  if (field.kind === "multi-select") return field.defaultValue ?? [];
  if (field.kind === "number") return field.defaultValue ?? "";
  return field.defaultValue ?? "";
}

export function isEmptyFieldValue(value: FieldValue): boolean {
  return value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

export function GeneratedUiForm({ cardId, cardTitle, section, disabled, onSend }: GeneratedUiFormProps): React.JSX.Element {
  const initialValues = useMemo(() => Object.fromEntries(section.fields.map((field) => [field.id, initialFieldValue(field)])) as FormValues, [section.fields]);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update = (id: string, value: FieldValue): void => {
    setValues((current) => ({ ...current, [id]: value }));
    setErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    const nextErrors: Record<string, string> = {};
    for (const field of section.fields) {
      const value = values[field.id] ?? initialFieldValue(field);
      if (field.required && isEmptyFieldValue(value)) nextErrors[field.id] = "此项为必填";
      if (field.kind === "number" && value !== "") {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) nextErrors[field.id] = "请输入有效数字";
        else if (field.min !== undefined && numeric < field.min) nextErrors[field.id] = `不能小于 ${field.min}`;
        else if (field.max !== undefined && numeric > field.max) nextErrors[field.id] = `不能大于 ${field.max}`;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!onSend) {
      setSubmitError("当前会话无法接收表单结果");
      return;
    }
    const normalized = Object.fromEntries(section.fields.map((field) => {
      const value = values[field.id] ?? initialFieldValue(field);
      return [field.id, field.kind === "number" && value !== "" ? Number(value) : value];
    }));
    const visibleLines = section.fields.map((field) => {
      const value = normalized[field.id];
      const display = Array.isArray(value) ? value.join("、") : typeof value === "boolean" ? (value ? "是" : "否") : String(value ?? "");
      return `${field.label}: ${display || "未填写"}`;
    });
    const transportContent = [
      `<generated_ui_response card_id="${cardId}" form_id="${section.id}">`,
      section.submitPrompt ?? "Continue using the submitted Generated UI form values.",
      JSON.stringify({ values: normalized }),
      "</generated_ui_response>",
    ].join("\n");
    const visibleContent = [`已提交「${cardTitle ?? "表单"}」`, ...visibleLines.map((line) => `- ${line}`)].join("\n");
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSend({ transportContent, visibleContent });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4">
      {section.fields.map((field) => {
        const value = values[field.id] ?? initialFieldValue(field);
        const describedBy = field.description || errors[field.id] ? `${cardId}-${section.id}-${field.id}-help` : undefined;
        return (
          <fieldset key={field.id} className="m-0 min-w-0 border-0 p-0" disabled={disabled || submitting}>
            {field.kind !== "checkbox" ? (
              <label className="mb-1.5 block text-xs font-medium text-[var(--mm-text-primary)]" htmlFor={`${cardId}-${section.id}-${field.id}`}>
                {field.label}{field.required ? <span className="ml-1 text-[var(--color-error)]">*</span> : null}
              </label>
            ) : null}
            {field.kind === "textarea" ? (
              <textarea id={`${cardId}-${section.id}-${field.id}`} value={String(value)} placeholder={field.placeholder} aria-describedby={describedBy} onChange={(event) => update(field.id, event.target.value)} className="min-h-24 w-full resize-y rounded-[6px] border border-[var(--mm-border-strong)] bg-[var(--mm-bg-main)] px-3 py-2.5 text-xs outline-none transition-colors focus:border-[var(--mm-accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]" />
            ) : field.kind === "text" || field.kind === "number" ? (
              <input id={`${cardId}-${section.id}-${field.id}`} type={field.kind} value={String(value)} min={field.kind === "number" ? field.min : undefined} max={field.kind === "number" ? field.max : undefined} step={field.kind === "number" ? field.step : undefined} placeholder={field.kind === "text" ? field.placeholder : undefined} aria-describedby={describedBy} onChange={(event) => update(field.id, event.target.value)} className="h-10 w-full rounded-[6px] border border-[var(--mm-border-strong)] bg-[var(--mm-bg-main)] px-3 text-xs outline-none transition-colors focus:border-[var(--mm-accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]" />
            ) : field.kind === "select" ? (
              <select id={`${cardId}-${section.id}-${field.id}`} value={String(value)} aria-describedby={describedBy} onChange={(event) => update(field.id, event.target.value)} className="h-10 w-full rounded-[6px] border border-[var(--mm-border-strong)] bg-[var(--mm-bg-main)] px-3 text-xs outline-none transition-colors focus:border-[var(--mm-accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">
                <option value="">请选择</option>
                {field.options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            ) : field.kind === "checkbox" ? (
              <label className="flex items-start gap-2 text-xs text-[var(--mm-text-secondary)]">
                <input id={`${cardId}-${section.id}-${field.id}`} type="checkbox" checked={Boolean(value)} aria-describedby={describedBy} onChange={(event) => update(field.id, event.target.checked)} className="mt-0.5" />
                <span>{field.description ?? field.label}{field.required ? <span className="ml-1 text-[var(--color-error)]">*</span> : null}</span>
              </label>
            ) : field.kind === "radio" || field.kind === "multi-select" ? (
              <div className="space-y-1.5" id={`${cardId}-${section.id}-${field.id}`}>
                {field.options.map((item) => {
                  const selected = field.kind === "multi-select" ? (value as string[]).includes(item.value) : value === item.value;
                  return (
                    <label key={item.value} className="flex items-start gap-2 text-xs text-[var(--mm-text-secondary)]">
                      <input
                        type={field.kind === "radio" ? "radio" : "checkbox"}
                        name={`${cardId}-${section.id}-${field.id}`}
                        checked={selected}
                        onChange={(event) => {
                          if (field.kind === "multi-select") {
                            const current = value as string[];
                            update(field.id, event.target.checked ? [...current, item.value] : current.filter((entry) => entry !== item.value));
                          } else update(field.id, item.value);
                        }}
                      />
                      <span>{item.label}{item.description ? <span className="ml-1 text-[var(--mm-text-tertiary)]">{item.description}</span> : null}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {(field.description && field.kind !== "checkbox") || errors[field.id] ? (
              <p id={describedBy} className={`m-0 mt-1 text-[11px] ${errors[field.id] ? "text-[var(--color-error)]" : "text-[var(--mm-text-tertiary)]"}`}>{errors[field.id] ?? field.description}</p>
            ) : null}
          </fieldset>
        );
      })}
      <div className="mt-5 flex items-center gap-2 border-t border-[var(--mm-border)] pt-4" data-generated-ui-form-actions>
        <button type="submit" disabled={disabled || submitting} className="h-9 rounded-[6px] bg-[var(--mm-bg-active)] px-4 text-xs font-medium text-[var(--mm-text-on-active)] shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? "提交中..." : section.submitLabel ?? "提交"}
        </button>
        {submitError ? <span role="alert" className="text-[11px] text-[var(--color-error)]">{submitError}</span> : null}
      </div>
    </form>
  );
}
