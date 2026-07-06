import type { ZodSchema } from "zod";
import { isSafeUrl } from "../ssrf-guard";
import type { Verdict } from "./judge-prompt";

// ---- Local minimal types --------------------------------------------------
//
// The codebase has no `ResolvedProvider` / `ResolvedModel` type. ConfigManager
// keeps these as a private `ResolvedVisionConfig` built from `PiProviderConfig`
// + `PiModelItem` (@shared). The judge client only needs a few fields, so we
// declare minimal local interfaces — these are intentionally narrower than
// `PiProviderConfig` / `PiModelItem` and a real `PiProviderConfig` value
// satisfies them structurally.

export interface ResolvedModel {
    readonly id: string;
    readonly headers?: Record<string, string>;
}

export interface ResolvedProvider {
    readonly id: string;
    readonly baseUrl?: string;
    readonly api?: string;
    readonly apiKey?: string;
    readonly headers?: Record<string, string>;
    readonly models?: readonly ResolvedModel[];
}

export interface ModelMessage {
    readonly role: "system" | "user" | "assistant";
    readonly content: string;
}

export interface JudgeModelClientDeps {
    /** Resolve a provider by id (used by future `evaluate()`-style callers). */
    readonly resolveProvider: (providerId: string) => Promise<ResolvedProvider>;
    /** Resolve a provider API key by id (used by future `evaluate()`-style callers). */
    readonly resolveApiKey: (providerId: string) => Promise<string | undefined>;
}

export interface CompleteParams {
    readonly provider: ResolvedProvider;
    readonly model: ResolvedModel;
    readonly messages: ModelMessage[];
    readonly schema: ZodSchema<Verdict>;
    readonly temperature?: number;
}

const DEFAULT_MAX_TOKENS = 1024;

export class JudgeModelClient {
    constructor(private readonly deps: JudgeModelClientDeps) {}

    /** Accessor for callers that need to resolve providers/keys via the deps. */
    get resolveProvider(): (providerId: string) => Promise<ResolvedProvider> {
        return this.deps.resolveProvider;
    }

    get resolveApiKey(): (providerId: string) => Promise<string | undefined> {
        return this.deps.resolveApiKey;
    }

    /**
     * Run the judge model against `messages` and parse the response into a
     * `Verdict`. Dispatches on `provider.api` to one of three API branches.
     */
    async complete(params: CompleteParams): Promise<Verdict> {
        const temperature = params.temperature ?? 0;
        const api = params.provider.api;
        switch (api) {
            case "anthropic-messages":
                return this.completeAnthropic(params, temperature);
            case "openai-responses":
            case "openai-codex-responses":
                return this.completeOpenAiResponses(params, temperature);
            case "openai-completions":
                return this.completeOpenAiCompletions(params, temperature);
            default:
                throw new Error(`judge unsupported provider api: ${api ?? "(undefined)"}`);
        }
    }

    // ---- Anthropic Messages API ------------------------------------------

    private async completeAnthropic(params: CompleteParams, temperature: number): Promise<Verdict> {
        const { provider, model, messages, schema } = params;
        const baseUrl = requireBaseUrl(provider);
        assertSafeUrl(baseUrl);
        const system = extractSystem(messages);
        const chat = stripSystem(messages);
        const headers = mergeHeaders(provider, model);

        try {
            const response = await fetch(`${trimBaseUrl(baseUrl)}/messages`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(provider.apiKey ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" } : {}),
                    ...headers,
                },
                body: JSON.stringify({
                    model: model.id,
                    ...(system !== undefined ? { system } : {}),
                    messages: chat,
                    max_tokens: DEFAULT_MAX_TOKENS,
                    temperature,
                }),
                signal: AbortSignal.timeout(30_000),
            });
            const data = (await response.json()) as unknown;
            if (!response.ok) {
                throw new Error(`judge anthropic request failed: HTTP ${response.status}: ${stringifyBody(data)}`);
            }
            const text = readAnthropicText(data);
            if (!text) throw new Error("judge anthropic response missing text content");
            return parseVerdict(text, schema);
        } catch (err) {
            throw wrapFetchError(err, "judge anthropic request");
        }
    }

    // ---- OpenAI Responses API --------------------------------------------

    private async completeOpenAiResponses(params: CompleteParams, temperature: number): Promise<Verdict> {
        const { provider, model, messages, schema } = params;
        const baseUrl = requireBaseUrl(provider);
        assertSafeUrl(baseUrl);
        const system = extractSystem(messages);
        const chat = stripSystem(messages);
        const headers = mergeHeaders(provider, model);

        try {
            const response = await fetch(`${trimBaseUrl(baseUrl)}/responses`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
                    ...headers,
                },
                body: JSON.stringify({
                    model: model.id,
                    input: chat,
                    ...(system !== undefined ? { instructions: system } : {}),
                    temperature,
                }),
                signal: AbortSignal.timeout(30_000),
            });
            const data = (await response.json()) as unknown;
            if (!response.ok) {
                throw new Error(`judge openai-responses request failed: HTTP ${response.status}: ${stringifyBody(data)}`);
            }
            const text = readOpenAiResponsesText(data);
            if (!text) throw new Error("judge openai-responses response missing text content");
            return parseVerdict(text, schema);
        } catch (err) {
            throw wrapFetchError(err, "judge openai-responses request");
        }
    }

    // ---- OpenAI Chat Completions API -------------------------------------

    private async completeOpenAiCompletions(params: CompleteParams, temperature: number): Promise<Verdict> {
        const { provider, model, messages, schema } = params;
        const baseUrl = requireBaseUrl(provider);
        assertSafeUrl(baseUrl);
        const headers = mergeHeaders(provider, model);

        try {
            const response = await fetch(`${trimBaseUrl(baseUrl)}/chat/completions`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
                    ...headers,
                },
                body: JSON.stringify({
                    model: model.id,
                    messages,
                    temperature,
                    response_format: { type: "json_object" },
                }),
                signal: AbortSignal.timeout(30_000),
            });
            const data = (await response.json()) as unknown;
            if (!response.ok) {
                throw new Error(`judge openai-completions request failed: HTTP ${response.status}: ${stringifyBody(data)}`);
            }
            const text = readOpenAiCompletionsText(data);
            if (!text) throw new Error("judge openai-completions response missing text content");
            return parseVerdict(text, schema);
        } catch (err) {
            throw wrapFetchError(err, "judge openai-completions request");
        }
    }
}

// ---- Helpers ---------------------------------------------------------------

function trimBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

/**
 * Wrap a fetch error into a readable message. Distinguishes abort/timeout
 * errors (from `AbortSignal.timeout`) so callers see "timed out" instead of
 * a generic `AbortError`. Non-timeout errors are re-thrown unchanged so the
 * original message (e.g. HTTP status, malformed JSON) is preserved.
 */
function wrapFetchError(err: unknown, label: string): Error {
    if (err instanceof Error) {
        const name = err.name;
        if (name === "AbortError" || name === "TimeoutError") {
            return new Error(`${label} timed out after 30s`);
        }
        return err;
    }
    return new Error(`${label} failed: ${String(err)}`);
}

function requireBaseUrl(provider: ResolvedProvider): string {
    const baseUrl = provider.baseUrl;
    if (!baseUrl) {
        throw new Error(`judge provider ${provider.id} missing baseUrl`);
    }
    return baseUrl;
}

function assertSafeUrl(baseUrl: string): void {
    if (!isSafeUrl(baseUrl)) {
        throw new Error(`judge baseUrl unsafe: ${baseUrl}`);
    }
}

function mergeHeaders(provider: ResolvedProvider, model: ResolvedModel): Record<string, string> {
    return { ...(provider.headers ?? {}), ...(model.headers ?? {}) };
}

function extractSystem(messages: readonly ModelMessage[]): string | undefined {
    const sys = messages.find((m) => m.role === "system");
    return sys?.content;
}

function stripSystem(messages: readonly ModelMessage[]): ModelMessage[] {
    return messages.filter((m) => m.role !== "system");
}

function readAnthropicText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const data = payload as { content?: unknown };
    const content = Array.isArray(data.content) ? data.content : [];
    return content
        .flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const candidate = item as { text?: unknown };
            return typeof candidate.text === "string" ? [candidate.text] : [];
        })
        .join("\n")
        .trim();
}

function readOpenAiResponsesText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const data = payload as { output_text?: unknown; output?: unknown };

    if (typeof data.output_text === "string" && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const output = Array.isArray(data.output) ? data.output : [];
    const text = output
        .flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const candidate = item as { content?: unknown };
            const parts = Array.isArray(candidate.content) ? candidate.content : [];
            return parts.flatMap((part) => {
                if (!part || typeof part !== "object") return [];
                const piece = part as { text?: unknown };
                if (typeof piece.text === "string") return [piece.text];
                return [];
            });
        })
        .join("\n")
        .trim();
    return text;
}

function readOpenAiCompletionsText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const data = payload as { choices?: unknown };
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0];
    if (!first || typeof first !== "object") return "";
    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== "object") return "";
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content.trim();
    return "";
}

function stringifyBody(payload: unknown): string {
    if (payload && typeof payload === "object") {
        const err = (payload as { error?: unknown }).error;
        if (err && typeof err === "object") {
            const msg = (err as { message?: unknown }).message;
            if (typeof msg === "string") return msg;
        }
        const msg = (payload as { message?: unknown }).message;
        if (typeof msg === "string") return msg;
        try {
            return JSON.stringify(payload);
        } catch {
            return "(unserializable body)";
        }
    }
    return typeof payload === "string" ? payload : "";
}

export function parseVerdict(text: string, schema: ZodSchema<Verdict>): Verdict {
    let trimmed = text.trim();
    // Strip ```json ... ``` code-fence wrapping (some models wrap responses).
    if (trimmed.startsWith("```")) {
        trimmed = trimmed.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (err) {
        throw new Error(
            `judge response malformed: JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`judge response malformed: schema validation failed: ${result.error.message}`);
    }
    return result.data;
}
