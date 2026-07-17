import type {
    CustomMessageCard,
    CustomMessageCardAction,
    CustomMessageCardKind,
    GeneratedUiAction,
    GeneratedUiActionV2,
    GeneratedUiCard,
    GeneratedUiCardV1,
    GeneratedUiCardV2,
    GeneratedUiChartSeries,
    GeneratedUiFormField,
    GeneratedUiKeyValueItem,
    GeneratedUiListItem,
    GeneratedUiMetricItem,
    GeneratedUiOption,
    GeneratedUiPrimitive,
    GeneratedUiProgressItem,
    GeneratedUiSection,
    GeneratedUiSectionV2,
    GeneratedUiTableColumn,
    GeneratedUiTimelineItem,
    GeneratedUiTone,
} from "@shared";

export const GENERATED_UI_LIMITS = {
    maxBytes: 256 * 1024,
    maxSections: 24,
    maxTableRows: 200,
    maxChartPoints: 500,
    maxFormFields: 24,
    maxActions: 8,
    maxItems: 100,
    maxOptions: 50,
} as const;

const LEGACY_CARD_KINDS = new Set<CustomMessageCardKind>([
    "status-list",
    "approval-actions",
    "task-progress",
    "result-summary",
    "file-actions",
]);

const V1_ACTION_KINDS = new Set<GeneratedUiAction["kind"]>([
    "slash-command",
    "open-file",
    "copy-text",
    "switch-view",
    "refresh",
]);
const V2_ACTION_KINDS = new Set<GeneratedUiActionV2["kind"]>([
    "copy-text",
    "open-file",
    "open-url",
    "switch-view",
    "prefill-message",
    "send-message",
]);
const TONES = new Set<GeneratedUiTone>(["neutral", "info", "success", "warning", "danger"]);

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTone(value: unknown): GeneratedUiTone | undefined {
    return typeof value === "string" && TONES.has(value as GeneratedUiTone) ? value as GeneratedUiTone : undefined;
}

function fallbackId(prefix: string, index: number): string {
    return `${prefix}_${index}`;
}

function basename(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function withinPayloadLimit(raw: unknown): boolean {
    try {
        return new TextEncoder().encode(JSON.stringify(raw)).length <= GENERATED_UI_LIMITS.maxBytes;
    } catch {
        return false;
    }
}

function normalizeV1SectionKind(kind: string): GeneratedUiSection["kind"] | null {
    const normalized = kind.trim().toLowerCase().replace(/[\s-]+/g, "_");
    switch (normalized) {
        case "summary": return "summary";
        case "status_list":
        case "status":
        case "statuslist": return "status_list";
        case "steps":
        case "step_list":
        case "progress":
        case "task_progress": return "steps";
        case "key_value":
        case "keyvalue":
        case "facts": return "key_value";
        case "file_list":
        case "filelist":
        case "files": return "file_list";
        case "action_bar":
        case "actions": return "action_bar";
        case "markdown": return "markdown";
        default: return null;
    }
}

function sanitizeV1Action(raw: unknown, index: number): GeneratedUiAction | null {
    const data = asRecord(raw);
    const kind = asString(data.kind);
    const value = asString(data.value);
    if (!kind || !value || !V1_ACTION_KINDS.has(kind as GeneratedUiAction["kind"])) return null;
    return {
        id: asString(data.id) ?? fallbackId("action", index),
        label: asString(data.label) ?? kind,
        kind: kind as GeneratedUiAction["kind"],
        value,
    };
}

function sanitizeListItem(raw: unknown, index: number): GeneratedUiListItem | null {
    const data = asRecord(raw);
    const path = asString(data.path);
    const label = asString(data.label) ?? asString(data.name) ?? (path ? basename(path) : undefined);
    if (!label && !path) return null;
    return {
        id: asString(data.id) ?? fallbackId("item", index),
        label: label ?? path ?? `Item ${index + 1}`,
        status: asString(data.status),
        description: asString(data.description),
        path,
    };
}

function sanitizeKeyValueItem(raw: unknown, index: number): GeneratedUiKeyValueItem | null {
    const data = asRecord(raw);
    const key = asString(data.key) ?? asString(data.label);
    const value = asString(data.value) ?? asString(data.text);
    if (!key || !value) return null;
    return { id: asString(data.id) ?? fallbackId("kv", index), key, value };
}

function sanitizeV1Section(raw: unknown, index: number): GeneratedUiSection | null {
    const data = asRecord(raw);
    const kind = asString(data.kind);
    const normalizedKind = kind ? normalizeV1SectionKind(kind) : null;
    if (!normalizedKind) return null;
    const id = asString(data.id) ?? fallbackId("section", index);

    if (normalizedKind === "summary" || normalizedKind === "markdown") {
        const content = asString(data.content);
        return content ? { id, kind: normalizedKind, content } : null;
    }
    if (normalizedKind === "action_bar") {
        const actions = Array.isArray(data.actions)
            ? data.actions.slice(0, GENERATED_UI_LIMITS.maxActions)
                .map(sanitizeV1Action)
                .filter((action): action is GeneratedUiAction => action !== null)
            : [];
        return actions.length ? { id, kind: normalizedKind, actions } : null;
    }
    if (normalizedKind === "key_value") {
        const items = Array.isArray(data.items)
            ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems)
                .map(sanitizeKeyValueItem)
                .filter((item): item is GeneratedUiKeyValueItem => item !== null)
            : [];
        return items.length ? { id, kind: normalizedKind, items } : null;
    }
    const items = Array.isArray(data.items)
        ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems)
            .map(sanitizeListItem)
            .filter((item): item is GeneratedUiListItem => item !== null)
        : [];
    return items.length ? { id, kind: normalizedKind, items } : null;
}

function sanitizeLegacyCustomCard(raw: unknown): CustomMessageCard {
    const data = asRecord(raw);
    const requestedKind = asString(data.kind) ?? asString(data.customType) ?? "";
    const kind: CustomMessageCard["kind"] = LEGACY_CARD_KINDS.has(requestedKind as CustomMessageCardKind)
        ? requestedKind as CustomMessageCardKind
        : "markdown-fallback";
    const actions = Array.isArray(data.actions)
        ? data.actions.slice(0, GENERATED_UI_LIMITS.maxActions).flatMap((action, index): CustomMessageCardAction[] => {
            const next = sanitizeV1Action(action, index);
            return next ? [next] : [];
        })
        : undefined;
    const items = Array.isArray(data.items)
        ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems).flatMap((item, index) => {
            const next = sanitizeListItem(item, index);
            return next ? [next] : [];
        })
        : undefined;
    return {
        id: asString(data.id) ?? `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        title: asString(data.title),
        content: asString(data.content),
        items,
        actions,
    };
}

export function legacyCustomMessageCardToGeneratedUi(card: CustomMessageCard): GeneratedUiCardV1 {
    const sections: GeneratedUiSection[] = [];
    if (card.content?.trim()) {
        sections.push({
            id: `${card.id}_markdown`,
            kind: card.kind === "result-summary" ? "summary" : "markdown",
            content: card.content.trim(),
        });
    }
    if (card.items?.length) {
        const kind: Extract<GeneratedUiSection["kind"], "status_list" | "steps" | "file_list"> = card.kind === "task-progress"
            ? "steps"
            : card.kind === "file-actions" ? "file_list" : "status_list";
        sections.push({ id: `${card.id}_items`, kind, items: card.items.map((item) => ({ ...item })) });
    }
    if (card.actions?.length) {
        sections.push({ id: `${card.id}_actions`, kind: "action_bar", actions: card.actions.map((action) => ({ ...action })) });
    }
    return { version: "v1", id: card.id, title: card.title, sections };
}

function sanitizePrimitive(value: unknown): GeneratedUiPrimitive | undefined {
    return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
        ? value
        : undefined;
}

function sanitizePrimitiveRecord(raw: unknown): Record<string, GeneratedUiPrimitive> | null {
    const record = asRecord(raw);
    const next: Record<string, GeneratedUiPrimitive> = {};
    for (const [key, value] of Object.entries(record)) {
        const primitive = sanitizePrimitive(value);
        if (primitive !== undefined) next[key] = primitive;
    }
    return Object.keys(next).length ? next : null;
}

function sanitizeV2Action(raw: unknown, index: number): GeneratedUiActionV2 | null {
    const data = asRecord(raw);
    const kind = asString(data.kind);
    const value = asString(data.value);
    if (!kind || !value || !V2_ACTION_KINDS.has(kind as GeneratedUiActionV2["kind"])) return null;
    if (kind === "open-url" && !/^https?:\/\//i.test(value)) return null;
    return {
        id: asString(data.id) ?? fallbackId("action", index),
        label: asString(data.label) ?? kind,
        kind: kind as GeneratedUiActionV2["kind"],
        value,
        tone: asTone(data.tone),
    };
}

function sanitizeOptions(raw: unknown): GeneratedUiOption[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, GENERATED_UI_LIMITS.maxOptions).flatMap((option): GeneratedUiOption[] => {
        const data = asRecord(option);
        const label = asString(data.label);
        const value = asString(data.value);
        return label && value ? [{ label, value, description: asString(data.description) }] : [];
    });
}

function sanitizeFormField(raw: unknown, index: number): GeneratedUiFormField | null {
    const data = asRecord(raw);
    const kind = asString(data.kind);
    const label = asString(data.label);
    if (!kind || !label) return null;
    const base = {
        id: asString(data.id) ?? fallbackId("field", index),
        label,
        description: asString(data.description),
        required: data.required === true,
    };
    if (kind === "text" || kind === "textarea") {
        return { ...base, kind, placeholder: asString(data.placeholder), defaultValue: asString(data.defaultValue) };
    }
    if (kind === "number") {
        return {
            ...base,
            kind,
            min: asFiniteNumber(data.min),
            max: asFiniteNumber(data.max),
            step: asFiniteNumber(data.step),
            defaultValue: asFiniteNumber(data.defaultValue),
        };
    }
    if (kind === "select" || kind === "radio") {
        const options = sanitizeOptions(data.options);
        return options.length ? { ...base, kind, options, defaultValue: asString(data.defaultValue) } : null;
    }
    if (kind === "multi-select") {
        const options = sanitizeOptions(data.options);
        const defaultValue = Array.isArray(data.defaultValue) ? data.defaultValue.flatMap((item) => asString(item) ?? []).slice(0, GENERATED_UI_LIMITS.maxOptions) : undefined;
        return options.length ? { ...base, kind, options, defaultValue } : null;
    }
    if (kind === "checkbox") return { ...base, kind, defaultValue: data.defaultValue === true };
    return null;
}

function sanitizeMetric(raw: unknown, index: number): GeneratedUiMetricItem | null {
    const data = asRecord(raw);
    const label = asString(data.label);
    const value = typeof data.value === "number" ? String(data.value) : asString(data.value);
    if (!label || value === undefined) return null;
    return {
        id: asString(data.id) ?? fallbackId("metric", index),
        label,
        value,
        detail: asString(data.detail),
        trend: asString(data.trend),
        tone: asTone(data.tone),
    };
}

function sanitizeProgress(raw: unknown, index: number): GeneratedUiProgressItem | null {
    const data = asRecord(raw);
    const label = asString(data.label);
    const value = asFiniteNumber(data.value);
    const max = asFiniteNumber(data.max);
    if (!label || value === undefined || max === undefined || max <= 0) return null;
    return {
        id: asString(data.id) ?? fallbackId("progress", index),
        label,
        value: Math.max(0, Math.min(value, max)),
        max,
        status: asString(data.status),
        description: asString(data.description),
    };
}

function sanitizeTimeline(raw: unknown, index: number): GeneratedUiTimelineItem | null {
    const data = asRecord(raw);
    const title = asString(data.title) ?? asString(data.label);
    return title ? {
        id: asString(data.id) ?? fallbackId("timeline", index),
        title,
        time: asString(data.time),
        description: asString(data.description),
        status: asString(data.status),
    } : null;
}

function sanitizeTableColumn(raw: unknown): GeneratedUiTableColumn | null {
    const data = asRecord(raw);
    const key = asString(data.key);
    const label = asString(data.label);
    if (!key || !label) return null;
    const align = data.align === "center" || data.align === "right" ? data.align : "left";
    const format = data.format === "number" || data.format === "percent" ? data.format : "text";
    return { key, label, align, format, sortable: data.sortable === true };
}

function sanitizeChartSeries(raw: unknown): GeneratedUiChartSeries | null {
    const data = asRecord(raw);
    const key = asString(data.key);
    return key ? { key, label: asString(data.label), stack: asString(data.stack) } : null;
}

function sanitizeV2Section(raw: unknown, index: number): GeneratedUiSectionV2 | null {
    const data = asRecord(raw);
    const kind = asString(data.kind)?.toLowerCase().replace(/[\s-]+/g, "_");
    if (!kind) return null;
    const id = asString(data.id) ?? fallbackId("section", index);
    if (kind === "markdown") {
        const content = asString(data.content);
        return content ? { id, kind, content } : null;
    }
    if (kind === "callout") {
        const content = asString(data.content);
        return content ? { id, kind, title: asString(data.title), content, tone: asTone(data.tone) } : null;
    }
    if (kind === "metric_grid") {
        const items = Array.isArray(data.items) ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems).map(sanitizeMetric).filter((item): item is GeneratedUiMetricItem => item !== null) : [];
        return items.length ? { id, kind, items } : null;
    }
    if (kind === "key_value") {
        const items = Array.isArray(data.items) ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems).map(sanitizeKeyValueItem).filter((item): item is GeneratedUiKeyValueItem => item !== null) : [];
        return items.length ? { id, kind, items } : null;
    }
    if (kind === "status_list" || kind === "steps" || kind === "file_list") {
        const items = Array.isArray(data.items) ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems).map(sanitizeListItem).filter((item): item is GeneratedUiListItem => item !== null) : [];
        return items.length ? { id, kind, items } : null;
    }
    if (kind === "timeline") {
        const items = Array.isArray(data.items) ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems).map(sanitizeTimeline).filter((item): item is GeneratedUiTimelineItem => item !== null) : [];
        return items.length ? { id, kind, items } : null;
    }
    if (kind === "progress") {
        const items = Array.isArray(data.items) ? data.items.slice(0, GENERATED_UI_LIMITS.maxItems).map(sanitizeProgress).filter((item): item is GeneratedUiProgressItem => item !== null) : [];
        return items.length ? { id, kind, items } : null;
    }
    if (kind === "table") {
        const columns = Array.isArray(data.columns) ? data.columns.slice(0, 24).map(sanitizeTableColumn).filter((column): column is GeneratedUiTableColumn => column !== null) : [];
        const rows = Array.isArray(data.rows) ? data.rows.slice(0, GENERATED_UI_LIMITS.maxTableRows).map(sanitizePrimitiveRecord).filter((row): row is Record<string, GeneratedUiPrimitive> => row !== null) : [];
        return columns.length && rows.length ? { id, kind, columns, rows, caption: asString(data.caption) } : null;
    }
    if (kind === "chart") {
        const chartType = data.chartType === "line" || data.chartType === "area" || data.chartType === "pie" ? data.chartType : data.chartType === "bar" ? "bar" : null;
        const xKey = asString(data.xKey);
        const summary = asString(data.summary);
        const series = Array.isArray(data.series) ? data.series.slice(0, 12).map(sanitizeChartSeries).filter((item): item is GeneratedUiChartSeries => item !== null) : [];
        const chartData = Array.isArray(data.data) ? data.data.slice(0, GENERATED_UI_LIMITS.maxChartPoints).map(sanitizePrimitiveRecord).filter((row): row is Record<string, GeneratedUiPrimitive> => row !== null) : [];
        return chartType && xKey && summary && series.length && chartData.length
            ? { id, kind, chartType, xKey, summary, series, data: chartData, stacked: data.stacked === true }
            : null;
    }
    if (kind === "form") {
        const fields = Array.isArray(data.fields) ? data.fields.slice(0, GENERATED_UI_LIMITS.maxFormFields).map(sanitizeFormField).filter((field): field is GeneratedUiFormField => field !== null) : [];
        return fields.length ? { id, kind, fields, submitLabel: asString(data.submitLabel), submitPrompt: asString(data.submitPrompt) } : null;
    }
    if (kind === "action_bar") {
        const actions = Array.isArray(data.actions) ? data.actions.slice(0, GENERATED_UI_LIMITS.maxActions).map(sanitizeV2Action).filter((action): action is GeneratedUiActionV2 => action !== null) : [];
        return actions.length ? { id, kind, actions } : null;
    }
    return null;
}

function normalizeV2(data: Record<string, unknown>): GeneratedUiCardV2 | null {
    const sections = Array.isArray(data.sections)
        ? data.sections.slice(0, GENERATED_UI_LIMITS.maxSections).map(sanitizeV2Section).filter((section): section is GeneratedUiSectionV2 => section !== null)
        : [];
    if (!sections.length) return null;
    return {
        version: "v2",
        id: asString(data.id) ?? `generated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: asString(data.title),
        subtitle: asString(data.subtitle),
        tone: asTone(data.tone),
        sections,
    };
}

export function normalizeGeneratedUi(raw: unknown): GeneratedUiCard | null {
    if (!withinPayloadLimit(raw)) return null;
    const outer = asRecord(raw);
    const data = outer.operation === "upsert" && outer.card ? asRecord(outer.card) : outer;
    if (data.version === "v2") return normalizeV2(data);
    if (Array.isArray(data.sections)) {
        const sections = data.sections.slice(0, GENERATED_UI_LIMITS.maxSections).map(sanitizeV1Section).filter((section): section is GeneratedUiSection => section !== null);
        const fallbackContent = asString(data.content);
        if (!sections.length && fallbackContent) sections.push({ id: "markdown_fallback", kind: "markdown", content: fallbackContent });
        if (sections.length || asString(data.title)) {
            return {
                version: "v1",
                id: asString(data.id) ?? `generated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                title: asString(data.title),
                sections,
            };
        }
    }
    const hasLegacySignals = asString(data.kind) || asString(data.customType) || Array.isArray(data.items) || Array.isArray(data.actions) || asString(data.content) || asString(data.title);
    if (!hasLegacySignals) return null;
    const legacy = legacyCustomMessageCardToGeneratedUi(sanitizeLegacyCustomCard(data));
    return legacy.sections.length || legacy.title ? legacy : null;
}

export function cloneGeneratedUiCard(card: GeneratedUiCard | undefined): GeneratedUiCard | undefined {
    return card ? JSON.parse(JSON.stringify(card)) as GeneratedUiCard : undefined;
}

function pushPlainTextLine(lines: string[], value: string | undefined): void {
    const next = value?.trim();
    if (next) lines.push(next);
}

function generatedUiListItemLine(item: GeneratedUiListItem): string {
    const parts = [item.label.trim()];
    if (item.status?.trim()) parts.push(`(${item.status.trim()})`);
    if (item.description?.trim()) parts.push(item.description.trim());
    if (item.path?.trim() && item.path.trim() !== item.label.trim()) parts.push(item.path.trim());
    return parts.join(" - ");
}

function primitiveText(value: GeneratedUiPrimitive): string {
    return value === null ? "" : typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

export function generatedUiToPlainText(card: GeneratedUiCard | undefined): string {
    if (!card) return "";
    const lines: string[] = [];
    pushPlainTextLine(lines, card.title);
    if (card.version === "v2") pushPlainTextLine(lines, card.subtitle);
    for (const section of card.sections) {
        switch (section.kind) {
            case "summary":
            case "markdown": pushPlainTextLine(lines, section.content); break;
            case "callout": pushPlainTextLine(lines, section.title); pushPlainTextLine(lines, section.content); break;
            case "status_list":
            case "steps":
            case "file_list": section.items.forEach((item) => pushPlainTextLine(lines, generatedUiListItemLine(item))); break;
            case "key_value": section.items.forEach((item) => pushPlainTextLine(lines, `${item.key}: ${item.value}`)); break;
            case "action_bar": section.actions.forEach((action) => pushPlainTextLine(lines, `操作: ${action.label} -> ${action.value}`)); break;
            case "metric_grid": section.items.forEach((item) => pushPlainTextLine(lines, `${item.label}: ${item.value}${item.detail ? ` - ${item.detail}` : ""}`)); break;
            case "timeline": section.items.forEach((item) => pushPlainTextLine(lines, `${item.time ? `${item.time} ` : ""}${item.title}${item.description ? ` - ${item.description}` : ""}`)); break;
            case "progress": section.items.forEach((item) => pushPlainTextLine(lines, `${item.label}: ${item.value}/${item.max}`)); break;
            case "table":
                pushPlainTextLine(lines, section.caption);
                pushPlainTextLine(lines, section.columns.map((column) => column.label).join(" | "));
                section.rows.forEach((row) => pushPlainTextLine(lines, section.columns.map((column) => primitiveText(row[column.key] ?? null)).join(" | ")));
                break;
            case "chart": pushPlainTextLine(lines, section.summary); break;
            case "form": section.fields.forEach((field) => pushPlainTextLine(lines, `表单字段: ${field.label}${field.required ? " (必填)" : ""}`)); break;
            default: {
                const unreachable: never = section;
                return unreachable;
            }
        }
    }
    return lines.join("\n").trim();
}

export function contentWithGeneratedUiText(content: string, card: GeneratedUiCard | undefined): string {
    const plainCardText = generatedUiToPlainText(card);
    const plainContent = content.trim();
    if (!plainContent) return plainCardText;
    if (!plainCardText) return content;
    return plainContent === plainCardText ? plainContent : `${plainContent}\n${plainCardText}`;
}
