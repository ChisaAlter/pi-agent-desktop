import type log from "electron-log/main";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /^(?:api[_-]?key|authorization|cookie|password|secret|token|x-api-key)$/i;
let hookInstalled = false;

export function redactLogValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
    if (typeof value === "string") return redactLogString(value);
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") return String(value);
    if (depth >= 8) return "[MaxDepth]";
    if (value instanceof Date) return value;
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (value instanceof Error) {
        const error = new Error(redactLogString(value.message));
        error.name = value.name;
        error.stack = value.stack ? redactLogString(value.stack) : undefined;
        return error;
    }
    if (typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => redactLogValue(item, seen, depth + 1));
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactLogValue(item, seen, depth + 1);
    }
    return result;
}

export function configureProductionLogging(logger: typeof log): void {
    if (logger.transports?.file) {
        logger.transports.file.maxSize = 10 * 1024 * 1024;
    }
    if (hookInstalled || !Array.isArray(logger.hooks)) return;
    logger.hooks.push((message) => ({
        ...message,
        data: message.data.map((item) => redactLogValue(item)),
    }));
    hookInstalled = true;
}

function redactLogString(value: string): string {
    return value
        .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
        .replace(/\b(api[_-]?key|password|secret|token)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
        .replace(/\bsk-[A-Za-z0-9._-]+\b/g, REDACTED);
}
