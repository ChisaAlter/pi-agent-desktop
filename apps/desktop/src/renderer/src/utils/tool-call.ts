import type { ToolCall } from "@shared";

const TOOL_CALL_STATUSES = new Set<ToolCall["status"]>([
    "pending",
    "running",
    "completed",
    "error",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toolCallRecords(value: unknown): Record<string, unknown>[] {
    const record = asRecord(value);
    if (!record) return [];

    const records = [record];
    const completedToolCall = asRecord(record.toolCall);
    if (completedToolCall) records.push(completedToolCall);

    const partial = asRecord(record.partial);
    const content = partial?.content;
    const contentIndex = record.contentIndex;
    if (Array.isArray(content) && typeof contentIndex === "number" && Number.isInteger(contentIndex)) {
        const partialToolCall = asRecord(content[contentIndex]);
        if (partialToolCall) records.push(partialToolCall);
    }

    return records;
}

function readStringField(records: Record<string, unknown>[], fields: string[]): string | null {
    for (const record of records) {
        for (const field of fields) {
            const value = asNonEmptyString(record[field]);
            if (value) return value;
        }
    }
    return null;
}

function reviveDate(value: unknown): Date | undefined {
    if (value == null) return undefined;
    if (value instanceof Date) return new Date(value);
    if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    if (typeof value === "string" && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
}

function normalizeStatus(value: unknown, fallback: ToolCall["status"]): ToolCall["status"] {
    if (typeof value !== "string" || !value.trim()) return fallback;
    if (TOOL_CALL_STATUSES.has(value as ToolCall["status"])) {
        return value as ToolCall["status"];
    }
    switch (value) {
        case "success":
        case "executed":
            return "completed";
        case "failed":
        case "cancelled":
        case "blocked":
            return "error";
        case "executing":
        case "pausing":
        case "paused":
        case "waiting":
            return "running";
        default:
            return fallback;
    }
}

export function readToolCallId(value: unknown): string | null {
    return readStringField(toolCallRecords(value), ["toolCallId", "id"]);
}

export function readToolCallName(value: unknown): string | null {
    return readStringField(toolCallRecords(value), ["toolName", "name"]);
}

export function readToolCallInput(value: unknown): Record<string, unknown> {
    for (const record of toolCallRecords(value)) {
        for (const field of ["args", "input", "arguments"]) {
            const input = asRecord(record[field]);
            if (input) return input;
        }
    }
    return {};
}

export function readToolCallOutput(value: unknown): unknown {
    for (const record of toolCallRecords(value)) {
        if (record.output !== undefined) return record.output;
        if (record.result !== undefined) return record.result;
    }
    return undefined;
}

export function readToolCallIsError(value: unknown): boolean {
    for (const record of toolCallRecords(value)) {
        if (typeof record.isError === "boolean") return record.isError;
        if (record.status !== undefined) return normalizeStatus(record.status, "pending") === "error";
    }
    return false;
}

export function normalizeToolCallForRuntime(
    value: unknown,
    fallbackStatus: ToolCall["status"] = "pending",
): ToolCall | null {
    const record = asRecord(value);
    if (!record) return null;

    const id = readToolCallId(record);
    const name = readToolCallName(record);
    if (!id || !name) return null;

    const toolCall: ToolCall = {
        id,
        name,
        status: normalizeStatus(record.status, fallbackStatus),
    };

    const input = record.input ?? record.args ?? record.arguments;
    if (input !== undefined) {
        toolCall.input = input;
    }

    const output = record.output ?? record.result;
    if (output !== undefined) {
        toolCall.output = output;
    }

    const args = asRecord(record.args ?? record.arguments);
    if (args) {
        toolCall.args = args;
    }

    if (record.result !== undefined) {
        toolCall.result = record.result;
    }

    const startTime = reviveDate(record.startTime);
    if (startTime) {
        toolCall.startTime = startTime;
    }

    const endTime = reviveDate(record.endTime);
    if (endTime) {
        toolCall.endTime = endTime;
    }

    return toolCall;
}

export function normalizeToolCallForPersistence(
    value: unknown,
    fallbackStatus: ToolCall["status"] = "pending",
): ToolCall | null {
    const toolCall = normalizeToolCallForRuntime(value, fallbackStatus);
    if (!toolCall) return null;

    const persisted: ToolCall = {
        id: toolCall.id,
        name: toolCall.name,
        status: toolCall.status,
    };

    if (toolCall.input !== undefined) {
        persisted.input = toolCall.input;
    }

    if (toolCall.output !== undefined) {
        persisted.output = toolCall.output;
    }

    if (toolCall.startTime) {
        persisted.startTime = toolCall.startTime;
    }

    if (toolCall.endTime) {
        persisted.endTime = toolCall.endTime;
    }

    return persisted;
}

export function normalizeToolCallsForRuntime(
    value: unknown,
    fallbackStatus: ToolCall["status"] = "pending",
): ToolCall[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeToolCallForRuntime(item, fallbackStatus))
        .filter((item): item is ToolCall => item !== null);
}

export function normalizeToolCallsForPersistence(
    value: unknown,
    fallbackStatus: ToolCall["status"] = "pending",
): ToolCall[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeToolCallForPersistence(item, fallbackStatus))
        .filter((item): item is ToolCall => item !== null);
}
