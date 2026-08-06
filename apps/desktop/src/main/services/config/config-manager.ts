import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import log from "electron-log/main";
import type {
    ConfigValidationResult,
    ManagedModelDeleteInput,
    ManagedModelEntry,
    ManagedModelsResult,
    ManagedModelSaveInput,
    PiAuthFile,
    PiAuthItem,
    PiModelItem,
    PiModelsFile,
    PiProviderConfig,
    PiSettingsFile,
    ProviderTestResult,
} from "@shared";
import type { PiAgentConfig, PiAgentModel } from "../../types";
import { isSafeUrl, fetchWithSafeRedirects } from "../ssrf-guard";

const DEFAULT_PROVIDER_API = "openai-completions";
export const REDACTED_AUTH_VALUE = "[REDACTED]";

interface VisionImageInput {
    readonly name: string;
    readonly dataUrl: string;
    readonly mimeType?: string;
}

interface ResolvedVisionConfig {
    readonly providerId: string;
    readonly provider: PiProviderConfig;
    readonly model: PiModelItem;
    readonly api: string;
    readonly apiKey?: string;
}

export class ConfigManager {
    constructor(private readonly configDir = join(homedir(), ".pi", "agent")) {}

    private jsonCache = new Map<string, { mtime: number; raw: string; parsed: unknown }>();

    // TODO: convert to async — currently uses sync existsSync/readFileSync.
    // Only called at app startup (index.ts app.whenReady) and on managed-models-changed callbacks, so not hot.
    loadPiAgentConfig(): PiAgentConfig | null {
        try {
            if (!existsSync(this.configDir)) return null;

            const settingsPath = join(this.configDir, "settings.json");
            let defaultProvider = "google";
            let defaultModel = "";
            if (existsSync(settingsPath)) {
                const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
                defaultProvider = settings.defaultProvider || defaultProvider;
                defaultModel = settings.defaultModel || "";
            }

            const providers: PiAgentConfig["providers"] = [];
            let authData: PiAuthFile = {};
            const authJsonPath = join(this.configDir, "auth.json");
            if (existsSync(authJsonPath)) {
                const parsedAuth = JSON.parse(readFileSync(authJsonPath, "utf-8")) as unknown;
                if (this.isPlainObject(parsedAuth)) {
                    authData = parsedAuth as PiAuthFile;
                }
            }

            const modelsJsonPath = join(this.configDir, "models.json");
            if (existsSync(modelsJsonPath)) {
                const modelsData = JSON.parse(readFileSync(modelsJsonPath, "utf-8"));
                if (modelsData.providers) {
                    for (const [providerId, providerData] of Object.entries(modelsData.providers)) {
                        const pd = providerData as {
                            name?: string;
                            baseUrl?: string;
                            apiKey?: string;
                             apiType?: string;
                             api?: string;
                             headers?: Record<string, unknown>;
                             authHeader?: boolean;
                            models?: Array<Record<string, unknown>>;
                            _piDesktopDeletedModels?: string[];
                        };
                        const models: PiAgentModel[] = (pd.models || [])
                            .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof m.id === "string")
                            .map((m) => ({
                                id: m.id as string,
                                name: typeof m.name === "string" ? m.name : (m.id as string),
                                 provider: providerId,
                                 providerName: pd.name || providerId,
                                 api: typeof m.api === "string" ? this.apiFromApiType(m.api) : undefined,
                                 baseUrl: typeof m.baseUrl === "string" ? m.baseUrl : undefined,
                                 contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
                                 maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
                                 reasoning: Boolean(m.reasoning),
                                 input: Array.isArray(m.input) ? (m.input as string[]) : undefined,
                                 thinkingLevelMap: this.thinkingLevelMap(m.thinkingLevelMap),
                                 headers: this.stringRecord(m.headers),
                                 compat: this.isPlainObject(m.compat) ? m.compat : undefined,
                                 cost: this.modelCost(m.cost),
                            }));
                        providers.push({
                            id: providerId,
                            name: pd.name || providerId,
                            baseUrl: pd.baseUrl,
                            apiKey: this.getAuthValue(authData[providerId]) ?? pd.apiKey,
                            apiType: pd.apiType,
                             api: this.apiFromApiType(pd.api ?? pd.apiType),
                             headers: this.stringRecord(pd.headers),
                             authHeader: typeof pd.authHeader === "boolean" ? pd.authHeader : undefined,
                            _piDesktopDeletedModels: Array.isArray(pd._piDesktopDeletedModels) ? pd._piDesktopDeletedModels : undefined,
                            models,
                        });
                    }
                }
            }

            const modelsYmlPath = join(this.configDir, "models.yml");
            if (existsSync(modelsYmlPath)) {
                const ymlContent = readFileSync(modelsYmlPath, "utf-8");
                const ymlProviders = this.parseYamlProviders(ymlContent);
                for (const yp of ymlProviders) {
                    if (!providers.find((p) => p.id === yp.id)) {
                        providers.push(yp);
                    } else {
                        const existing = providers.find((p) => p.id === yp.id);
                        if (!existing) continue;
                        const deletedModels = new Set(existing._piDesktopDeletedModels ?? []);
                        for (const ym of yp.models) {
                            if (deletedModels.has(ym.id)) continue;
                            if (!existing.models.find((m) => m.id === ym.id)) {
                                existing.models.push(ym);
                            }
                        }
                    }
                }
            }

            return { defaultProvider, defaultModel, providers };
        } catch (e) {
            log.error("Failed to load Pi Agent config:", e);
            return null;
        }
    }

    private parseYamlProviders(content: string): PiAgentConfig["providers"] {
        const data = yaml.load(content) as { providers?: Record<string, unknown> } | null;
        if (!data || typeof data !== "object" || !data.providers) return [];

        const result: PiAgentConfig["providers"] = [];
        for (const [providerId, raw] of Object.entries(data.providers)) {
            const pd = raw as {
                name?: string;
                baseUrl?: string;
                apiKey?: string;
                apiType?: string;
                 api?: string;
                 headers?: Record<string, unknown>;
                 authHeader?: boolean;
                _piDesktopDeletedModels?: string[];
                models?: Array<Record<string, unknown>>;
            };
            if (!pd || typeof pd !== "object") continue;

            const models: PiAgentModel[] = Array.isArray(pd.models)
                ? pd.models
                      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof m.id === "string")
                      .map((m) => ({
                          id: m.id as string,
                          name: typeof m.name === "string" ? m.name : (m.id as string),
                           provider: providerId,
                           providerName: typeof pd.name === "string" ? pd.name : providerId,
                           api: typeof m.api === "string" ? this.apiFromApiType(m.api) : undefined,
                           baseUrl: typeof m.baseUrl === "string" ? m.baseUrl : undefined,
                           contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
                           maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
                           reasoning: Boolean(m.reasoning),
                           input: Array.isArray(m.input) ? (m.input as string[]) : undefined,
                           thinkingLevelMap: this.thinkingLevelMap(m.thinkingLevelMap),
                           headers: this.stringRecord(m.headers),
                           compat: this.isPlainObject(m.compat) ? m.compat : undefined,
                           cost: this.modelCost(m.cost),
                      }))
                : [];

            result.push({
                id: providerId,
                name: typeof pd.name === "string" ? pd.name : providerId,
                baseUrl: typeof pd.baseUrl === "string" ? pd.baseUrl : undefined,
                apiKey: typeof pd.apiKey === "string" ? pd.apiKey : undefined,
                apiType: typeof pd.apiType === "string" ? pd.apiType : undefined,
                 api: this.apiFromApiType(typeof pd.api === "string" ? pd.api : typeof pd.apiType === "string" ? pd.apiType : undefined),
                 headers: this.stringRecord(pd.headers),
                 authHeader: typeof pd.authHeader === "boolean" ? pd.authHeader : undefined,
                _piDesktopDeletedModels: Array.isArray(pd._piDesktopDeletedModels)
                    ? pd._piDesktopDeletedModels.filter((id): id is string => typeof id === "string")
                    : undefined,
                models,
            });
        }

        return result;
    }

    getModelsConfig(): Promise<{ raw: string; parsed: PiModelsFile }> {
        return this.readJsonFile("models.json", { providers: {} });
    }

    /** Return models config for UI/export without leaking duplicate provider secrets. */
    async getModelsConfigRedacted(): Promise<{ raw: string; parsed: PiModelsFile }> {
        const models = await this.getModelsConfig();
        const providers = Object.fromEntries(
            Object.entries(models.parsed.providers ?? {}).map(([providerId, provider]) => {
                const redacted = { ...provider } as PiProviderConfig;
                if (typeof redacted.apiKey === "string" && redacted.apiKey) {
                    redacted.apiKey = REDACTED_AUTH_VALUE;
                }
                if (redacted.headers) redacted.headers = this.redactStringRecord(redacted.headers);
                redacted.models = redacted.models?.map((model) => {
                    const next = { ...model };
                    if (typeof next.apiKey === "string" && next.apiKey) next.apiKey = REDACTED_AUTH_VALUE;
                    if (typeof next.key === "string" && next.key) next.key = REDACTED_AUTH_VALUE;
                    if (next.headers) next.headers = this.redactStringRecord(next.headers);
                    return next;
                });
                return [providerId, redacted];
            }),
        );
        const parsed = { ...models.parsed, providers };
        return { raw: JSON.stringify(parsed, null, 2), parsed };
    }

    getAuthConfig(): Promise<{ raw: string; parsed: PiAuthFile }> {
        return this.readJsonFile("auth.json", {});
    }

    /** Return auth config for UI only; secret values are never exposed over IPC. */
    async getAuthConfigRedacted(): Promise<{ raw: string; parsed: PiAuthFile }> {
        const auth = await this.getAuthConfig();
        const parsed: PiAuthFile = {};
        for (const [providerId, item] of Object.entries(auth.parsed)) {
            if (!this.isPlainObject(item)) continue;
            const secret = this.getAuthValue(item as PiAuthItem);
            const redacted = { ...item } as PiAuthItem;
            if (secret && Object.prototype.hasOwnProperty.call(item, "key")) redacted.key = REDACTED_AUTH_VALUE;
            if (secret && Object.prototype.hasOwnProperty.call(item, "apiKey")) redacted.apiKey = REDACTED_AUTH_VALUE;
            parsed[providerId] = redacted;
        }
        return { raw: JSON.stringify(parsed, null, 2), parsed };
    }

    getSettingsConfig(): Promise<{ raw: string; parsed: PiSettingsFile }> {
        return this.readJsonFile("settings.json", {});
    }

    async listManagedModels(): Promise<ManagedModelsResult> {
        const [jsonModels, yamlModels, auth, settings] = await Promise.all([
            this.getModelsConfig(),
            this.getYamlModelsConfig(),
            this.getAuthConfig(),
            this.getSettingsConfig(),
        ]);
        const models: ManagedModelEntry[] = [];
        const seen = new Set<string>();

        const addProviderModels = (source: "json" | "yaml", providerId: string, provider: PiProviderConfig): void => {
            const deleted = new Set(provider._piDesktopDeletedModels ?? []);
            for (const model of provider.models ?? []) {
                if (!model.id || deleted.has(model.id)) continue;
                const key = `${providerId}:${model.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                models.push(this.toManagedModelEntry(source, providerId, provider, model, auth.parsed, settings.parsed));
            }
        };

        for (const [providerId, provider] of Object.entries(jsonModels.parsed.providers ?? {})) {
            addProviderModels("json", providerId, provider);
        }
        for (const [providerId, provider] of Object.entries(yamlModels.providers ?? {})) {
            const jsonProvider = jsonModels.parsed.providers?.[providerId];
            const deleted = new Set(jsonProvider?._piDesktopDeletedModels ?? []);
            const filteredProvider: PiProviderConfig = {
                ...provider,
                models: (provider.models ?? []).filter((model) => !deleted.has(model.id)),
            };
            addProviderModels("yaml", providerId, filteredProvider);
        }

        return {
            configDir: this.configDir,
            defaultProvider: this.getStringSetting(settings.parsed, "defaultProvider"),
            defaultModel: this.getStringSetting(settings.parsed, "defaultModel"),
            models,
        };
    }

    async saveModelsConfig(data: PiModelsFile): Promise<ConfigValidationResult> {
        if (!data || typeof data !== "object" || !data.providers || typeof data.providers !== "object") {
            return { valid: false, error: "models.json 必须包含 providers 对象" };
        }
        const existing = (await this.getModelsConfig()).parsed;

        for (const [providerId, incoming] of Object.entries(data.providers)) {
            if (!this.isPlainObject(incoming)) return { valid: false, error: "models.json 的 provider 配置必须是对象" };
            const previous = existing.providers[providerId];
            if (incoming.apiKey === REDACTED_AUTH_VALUE && !previous?.apiKey) {
                return { valid: false, error: "脱敏凭据只能用于保留已有密钥" };
            }
            const incomingModels = Array.isArray(incoming.models) ? incoming.models : [];
            for (const model of incomingModels) {
                if (!this.isPlainObject(model)) return { valid: false, error: "models.json 的 model 配置必须是对象" };
                const previousModel = previous?.models?.find((item) => item.id === model.id);
                if (model.apiKey === REDACTED_AUTH_VALUE && !previousModel?.apiKey) {
                    return { valid: false, error: "脱敏凭据只能用于保留已有密钥" };
                }
                if (model.key === REDACTED_AUTH_VALUE && !previousModel?.key) {
                    return { valid: false, error: "脱敏凭据只能用于保留已有密钥" };
                }
            }
        }

        const providers: Record<string, PiProviderConfig> = {};
        for (const [providerId, incoming] of Object.entries(data.providers)) {
            const previous = existing.providers[providerId];
            const merged: PiProviderConfig = { ...incoming } as PiProviderConfig;

            if (merged.apiKey === REDACTED_AUTH_VALUE && previous?.apiKey) {
                merged.apiKey = previous.apiKey;
            }
            if (merged.headers) {
                merged.headers = this.restoreRedactedHeaders(merged.headers, previous?.headers);
            }

            const incomingModels = Array.isArray(incoming.models) ? incoming.models : [];
            merged.models = incomingModels.map((model) => {
                const next = { ...model } as PiModelItem;
                const previousModel = previous?.models?.find((item) => item.id === next.id);
                if (next.apiKey === REDACTED_AUTH_VALUE && previousModel?.apiKey) {
                    next.apiKey = previousModel.apiKey;
                }
                if (next.key === REDACTED_AUTH_VALUE && previousModel?.key) {
                    next.key = previousModel.key;
                }
                if (next.headers) {
                    next.headers = this.restoreRedactedHeaders(next.headers, previousModel?.headers);
                }
                return next;
            });
            providers[providerId] = merged;
        }
        await this.writeJsonFile("models.json", { ...data, providers });
        return { valid: true };
    }

    async saveAuthConfig(data: PiAuthFile): Promise<ConfigValidationResult> {
        if (!this.isPlainObject(data)) return { valid: false, error: "auth.json 必须是对象" };
        const existing = (await this.getAuthConfig()).parsed;
        const next: PiAuthFile = {};
        for (const [providerId, item] of Object.entries(data)) {
            if (!this.isPlainObject(item)) return { valid: false, error: "auth.json 的 provider 配置必须是对象" };
            const existingItem = existing[providerId];
            const merged = { ...item } as PiAuthItem;
            for (const field of ["key", "apiKey"] as const) {
                if (merged[field] !== REDACTED_AUTH_VALUE) continue;
                const previous = existingItem?.[field] ?? this.getAuthValue(existingItem);
                if (!previous) return { valid: false, error: "脱敏凭据只能用于保留已有密钥" };
                merged[field] = previous;
            }
            next[providerId] = merged;
        }
        await this.writeJsonFile("auth.json", next);
        return { valid: true };
    }

    async saveSettingsConfig(data: PiSettingsFile): Promise<ConfigValidationResult> {
        if (!this.isPlainObject(data)) return { valid: false, error: "settings.json 必须是对象" };
        await this.writeJsonFile("settings.json", data);
        return { valid: true };
    }

    async saveManagedModel(input: ManagedModelSaveInput): Promise<ConfigValidationResult> {
        const providerId = input.providerId.trim();
        const modelId = input.modelId.trim();
        if (!providerId || !modelId) return { valid: false, error: "Provider ID 和模型 ID 不能为空" };

        const [modelsResult, yamlModels, authResult] = await Promise.all([
            this.getModelsConfig(),
            this.getYamlModelsConfig(),
            this.getAuthConfig(),
        ]);
        const modelsFile = modelsResult.parsed;
        const authFile = authResult.parsed;

        if (input.originalProviderId && input.originalModelId) {
            this.ensureYamlProviderMigrated(modelsFile, yamlModels, input.originalProviderId);
        }

        const originalProviderId = input.originalProviderId?.trim() || providerId;
        const originalModelId = input.originalModelId?.trim() || modelId;
        const originalProvider = modelsFile.providers[originalProviderId];
        const originalAuthValue = this.getAuthValue(authFile[originalProviderId]) ?? originalProvider?.apiKey;
        if (originalProviderId !== providerId || originalModelId !== modelId) {
            if (originalProvider?.models) {
                originalProvider.models = originalProvider.models.filter((model) => model.id !== originalModelId);
            }
        }

        const existingProvider = modelsFile.providers[providerId] ?? {};
        const nextProvider: PiProviderConfig = {
            ...existingProvider,
            name: input.providerName?.trim() || existingProvider.name || providerId,
            baseUrl: input.baseUrl?.trim() || existingProvider.baseUrl,
            models: [...(existingProvider.models ?? [])],
        };
        if (input.apiType) nextProvider.apiType = input.apiType;
        const api = this.apiFromApiType(input.api?.trim() || input.apiType) || this.apiFromApiType(existingProvider.api ?? existingProvider.apiType);
        if (api) nextProvider.api = api;
        if (input.headers) nextProvider.headers = input.headers;

        const existingModel = nextProvider.models?.find((model) => model.id === modelId);
        const nextModel: PiModelItem = {
            ...(existingModel ?? {}),
            id: modelId,
            name: input.modelName?.trim() || existingModel?.name || modelId,
        };
        if (input.contextWindow != null) nextModel.contextWindow = input.contextWindow;
        if (input.maxTokens != null) nextModel.maxTokens = input.maxTokens;
        if (input.reasoning != null) nextModel.reasoning = input.reasoning;
        if (input.thinkingLevelMap != null) nextModel.thinkingLevelMap = input.thinkingLevelMap;
        if (input.input) nextModel.input = input.input;
        if (input.api) nextModel.api = input.api;

        nextProvider.models = (nextProvider.models ?? []).filter((model) => model.id !== modelId);
        nextProvider.models.push(nextModel);
        nextProvider._piDesktopDeletedModels = (nextProvider._piDesktopDeletedModels ?? []).filter((id) => id !== modelId);
        if (nextProvider._piDesktopDeletedModels.length === 0) delete nextProvider._piDesktopDeletedModels;
        modelsFile.providers[providerId] = nextProvider;

        if (input.clearApiKey) {
            delete authFile[providerId];
            delete nextProvider.apiKey;
        } else if (input.apiKey && input.apiKey.trim()) {
            const apiKey = input.apiKey.trim();
            authFile[providerId] = { type: "api_key", key: apiKey };
            nextProvider.apiKey = apiKey;
        } else {
            const existingAuthValue = this.getAuthValue(authFile[providerId])
                ?? existingProvider.apiKey
                ?? (originalProviderId !== providerId ? originalAuthValue : undefined);
            if (existingAuthValue) nextProvider.apiKey = existingAuthValue;
            if (existingAuthValue && originalProviderId !== providerId) {
                authFile[providerId] = { type: "api_key", key: existingAuthValue };
            }
        }

        if (originalProviderId !== providerId && (originalProvider?.models?.length ?? 0) === 0) {
            delete modelsFile.providers[originalProviderId];
            delete authFile[originalProviderId];
        }

        await this.saveModelsConfig(modelsFile);
        await this.saveAuthConfig(authFile);
        if (input.setDefault) {
            await this.setDefaultModel(providerId, modelId);
        }
        return { valid: true };
    }

    async deleteManagedModel(input: ManagedModelDeleteInput): Promise<ConfigValidationResult> {
        const providerId = input.providerId.trim();
        const modelId = input.modelId.trim();
        if (!providerId || !modelId) return { valid: false, error: "Provider ID 和模型 ID 不能为空" };

        const [modelsResult, yamlModels, settingsResult] = await Promise.all([
            this.getModelsConfig(),
            this.getYamlModelsConfig(),
            this.getSettingsConfig(),
        ]);
        const modelsFile = modelsResult.parsed;
        const settings = settingsResult.parsed;
        this.ensureYamlProviderMigrated(modelsFile, yamlModels, providerId);

        const provider = modelsFile.providers[providerId];
        if (!provider) return { valid: false, error: "Provider 不存在" };
        provider.models = (provider.models ?? []).filter((model) => model.id !== modelId);
        provider._piDesktopDeletedModels = Array.from(new Set([...(provider._piDesktopDeletedModels ?? []), modelId]));
        await this.saveModelsConfig(modelsFile);

        if (
            this.getStringSetting(settings, "defaultProvider") === providerId &&
            this.getStringSetting(settings, "defaultModel") === modelId
        ) {
            const nextDefault = await this.findFirstManagedModel();
            await this.saveSettingsConfig({
                ...settings,
                defaultProvider: nextDefault?.providerId ?? "",
                defaultModel: nextDefault?.modelId ?? "",
            });
        }
        return { valid: true };
    }

    async setDefaultModel(providerId: string, modelId: string): Promise<ConfigValidationResult> {
        const trimmedProviderId = providerId.trim();
        const trimmedModelId = modelId.trim();
        if (!trimmedProviderId || !trimmedModelId) return { valid: false, error: "Provider ID 和模型 ID 不能为空" };
        const list = await this.listManagedModels();
        if (!list.models.some((model) => model.providerId === trimmedProviderId && model.modelId === trimmedModelId)) {
            return { valid: false, error: "模型不存在，无法设为默认" };
        }
        const settings = await this.getSettingsConfig();
        await this.saveSettingsConfig({
            ...settings.parsed,
            defaultProvider: trimmedProviderId,
            defaultModel: trimmedModelId,
        });
        return { valid: true };
    }

    async saveRawConfig(fileName: string, rawJson: string): Promise<ConfigValidationResult> {
        if (!["models.json", "auth.json", "settings.json"].includes(fileName)) {
            return { valid: false, error: "只允许编辑 models.json、auth.json 或 settings.json" };
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawJson);
        } catch (error) {
            return { valid: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (fileName === "models.json") return this.saveModelsConfig(parsed as PiModelsFile);
        if (fileName === "auth.json") return this.saveAuthConfig(parsed as PiAuthFile);
        return this.saveSettingsConfig(parsed as PiSettingsFile);
    }

    async exportConfig(): Promise<string> {
        const [models, auth, settings] = await Promise.all([
            this.getModelsConfig(),
            this.getAuthConfig(),
            this.getSettingsConfig(),
        ]);
        return JSON.stringify(
            {
                exportedAt: new Date().toISOString(),
                files: {
                    "models.json": models.parsed,
                    "auth.json": auth.parsed,
                    "settings.json": settings.parsed,
                },
            },
            null,
            2,
        );
    }

    async exportConfigRedacted(): Promise<string> {
        const [models, auth, settings] = await Promise.all([
            this.getModelsConfigRedacted(),
            this.getAuthConfigRedacted(),
            this.getSettingsConfig(),
        ]);
        return JSON.stringify(
            {
                exportedAt: new Date().toISOString(),
                files: {
                    "models.json": models.parsed,
                    "auth.json": auth.parsed,
                    "settings.json": settings.parsed,
                },
            },
            null,
            2,
        );
    }
    async importConfig(packageJson: string): Promise<ConfigValidationResult> {
        let parsed: { files?: Record<string, unknown> };
        try {
            parsed = JSON.parse(packageJson) as { files?: Record<string, unknown> };
        } catch (error) {
            return { valid: false, error: error instanceof Error ? error.message : String(error) };
        }
        const files = parsed.files;
        if (!files || typeof files !== "object") return { valid: false, error: "导入包缺少 files 对象" };
        const modelsInput = this.isPlainObject(files["models.json"])
            ? (files["models.json"] as unknown as PiModelsFile)
            : { providers: {} };
        const models = await this.saveModelsConfig(modelsInput);
        if (!models.valid) return models;
        const authInput = this.isPlainObject(files["auth.json"])
            ? (files["auth.json"] as PiAuthFile)
            : ({} as PiAuthFile);
        const auth = await this.saveAuthConfig(authInput);
        if (!auth.valid) return auth;
        const settingsInput = this.isPlainObject(files["settings.json"])
            ? (files["settings.json"] as PiSettingsFile)
            : ({} as PiSettingsFile);
        return this.saveSettingsConfig(settingsInput);
    }

    async fetchModels(baseUrl: string, apiKey?: string, apiType?: string): Promise<PiModelItem[]> {
        if (!baseUrl || baseUrl.trim().length === 0) throw new Error("缺少 baseUrl，请在 models.json 中配置 provider 的 baseUrl");
        const resolvedApi = this.apiFromApiType(apiType) ?? DEFAULT_PROVIDER_API;
        const effectiveApiKey = apiKey === REDACTED_AUTH_VALUE
            ? await this.resolveProviderApiKeyByBaseUrl(baseUrl)
            : apiKey;
        const base = this.trimBaseUrl(baseUrl);
        const url = resolvedApi === "google-generative-ai" && effectiveApiKey
            ? `${base}/models?key=${encodeURIComponent(effectiveApiKey)}`
            : `${base}/models`;
        const response = await fetchWithSafeRedirects(url, {
            headers: {
                "content-type": "application/json",
                ...(resolvedApi === "anthropic-messages" && effectiveApiKey ? { "x-api-key": effectiveApiKey, "anthropic-version": "2023-06-01" } : {}),
                ...(resolvedApi !== "anthropic-messages" && resolvedApi !== "google-generative-ai" && effectiveApiKey ? { Authorization: `Bearer ${effectiveApiKey}` } : {}),
            },
        });
        if (!response.ok) throw new Error(`模型列表请求失败: HTTP ${response.status}`);
        const data = (await response.json()) as { data?: Array<{ id?: string; name?: string; displayName?: string }>; models?: Array<{ id?: string; name?: string; displayName?: string }> };
        const rawModels = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
        return rawModels
            .map((model) => {
                const rawId = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : "";
                const id = resolvedApi === "google-generative-ai" ? rawId.replace(/^models\//, "") : rawId;
                const name = typeof model.displayName === "string"
                    ? model.displayName
                    : typeof model.name === "string"
                        ? model.name.replace(/^models\//, "")
                        : id;
                return { id, name };
            })
            .filter((model) => model.id.length > 0);
    }

    async describeImages(
        images: readonly VisionImageInput[],
        fallbackVision?: { providerId: string; modelId: string },
    ): Promise<{ text: string }> {
        if (images.length === 0) throw new Error("至少需要一张图片");
        const vision = await this.resolveVisionConfig(fallbackVision);
        const baseUrl = vision.provider.baseUrl;
        if (!baseUrl) {
            throw new Error(`识图 provider ${vision.providerId} 缺少 baseUrl`);
        }
        if (!isSafeUrl(baseUrl)) {
            throw new Error("不安全的 URL: 禁止访问云元数据地址或非 HTTP(S) 协议");
        }

        const prompt = images.length === 1
            ? "请用简洁中文描述这张图片里的关键信息。"
            : "请按顺序用简洁中文描述这些图片里的关键信息。";
        const headers = vision.model.headers ?? vision.provider.headers ?? {};
        const base = this.trimBaseUrl(baseUrl);

        if (vision.api === "anthropic-messages") {
            const response = await fetchWithSafeRedirects(this.anthropicMessagesUrl(base), {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(vision.apiKey ? { "x-api-key": vision.apiKey, "anthropic-version": "2023-06-01" } : {}),
                    ...headers,
                },
                body: JSON.stringify({
                    model: vision.model.id,
                    max_tokens: 500,
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            ...images.map((image) => ({
                                type: "image",
                                source: this.anthropicImageSource(image),
                            })),
                        ],
                    }],
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(await this.describeResponseFailure(response.status, data));
            }
            const text = this.readAnthropicVisionText(data);
            if (!text) throw new Error("识图响应缺少可读文本");
            return { text };
        }

        if (vision.api === "openai-responses" || vision.api === "openai-codex-responses") {
            const response = await fetchWithSafeRedirects(`${base}/responses`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(vision.apiKey ? { Authorization: `Bearer ${vision.apiKey}` } : {}),
                    ...headers,
                },
                body: JSON.stringify({
                    model: vision.model.id,
                    input: [{
                        role: "user",
                        content: [
                            { type: "input_text", text: prompt },
                            ...images.map((image) => ({
                                type: "input_image",
                                image_url: image.dataUrl,
                            })),
                        ],
                    }],
                    max_output_tokens: 500,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(await this.describeResponseFailure(response.status, data));
            }
            const text = this.readOpenAiVisionText(data);
            if (!text) throw new Error("识图响应缺少可读文本");
            return { text };
        }

        if (vision.api === "openai-completions") {
            const response = await fetchWithSafeRedirects(`${base}/chat/completions`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(vision.apiKey ? { Authorization: `Bearer ${vision.apiKey}` } : {}),
                    ...headers,
                },
                body: JSON.stringify({
                    model: vision.model.id,
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            ...images.map((image) => ({
                                type: "image_url",
                                image_url: { url: image.dataUrl },
                            })),
                        ],
                    }],
                    max_tokens: 500,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(await this.describeResponseFailure(response.status, data));
            }
            const text = this.readOpenAiVisionText(data);
            if (!text) throw new Error("识图响应缺少可读文本");
            return { text };
        }

        throw new Error(`识图暂不支持当前 provider api: ${vision.api}`);
    }

    async testProviderConnection(
        baseUrl?: string,
        apiKey?: string,
        modelId?: string,
        apiType?: string,
        headers?: Record<string, string>,
        options?: { providerId?: string; api?: string },
    ): Promise<ProviderTestResult> {
        if (!baseUrl) return { ok: false, message: "缺少 baseUrl" };
        const resolvedApiType = this.apiFromApiType(apiType ?? options?.api) ?? DEFAULT_PROVIDER_API;
        const resolvedApiKey = apiKey === REDACTED_AUTH_VALUE
            ? await this.resolveProviderApiKey(options?.providerId)
            : apiKey ?? await this.resolveProviderApiKey(options?.providerId);
        const model = modelId || "test";
        const base = this.trimBaseUrl(baseUrl);
        const isResponses = resolvedApiType === "openai-responses" || resolvedApiType === "openai-codex-responses";
        const isAnthropic = resolvedApiType === "anthropic-messages";
        const url = isAnthropic
            ? this.anthropicMessagesUrl(base)
            : `${base}/${isResponses ? "responses" : "chat/completions"}`;
        const body = isResponses
            ? { model, input: "ping", max_output_tokens: 1 }
            : { model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
        try {
            const response = await fetchWithSafeRedirects(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(isAnthropic && resolvedApiKey ? { "x-api-key": resolvedApiKey, "anthropic-version": "2023-06-01" } : {}),
                    ...(!isAnthropic && resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : {}),
                    ...(headers ?? {}),
                },
                body: JSON.stringify(body),
            });
            return {
                ok: response.ok,
                status: response.status,
                message: response.ok ? "连接成功" : `连接失败: HTTP ${response.status}`,
            };
        } catch (error) {
            return {
                ok: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async resolveProviderApiKey(providerId?: string): Promise<string | undefined> {
        if (!providerId) return undefined;
        const [authResult, modelsResult, yamlModels] = await Promise.all([
            this.getAuthConfig(),
            this.getModelsConfig(),
            this.getYamlModelsConfig(),
        ]);
        return (
            this.getAuthValue(authResult.parsed[providerId]) ??
            modelsResult.parsed.providers?.[providerId]?.apiKey ??
            yamlModels.providers?.[providerId]?.apiKey
        );
    }

    private async resolveProviderApiKeyByBaseUrl(baseUrl: string): Promise<string | undefined> {
        const [authResult, modelsResult, yamlModels] = await Promise.all([
            this.getAuthConfig(),
            this.getModelsConfig(),
            this.getYamlModelsConfig(),
        ]);
        const normalized = this.trimBaseUrl(baseUrl);
        const findProvider = (providers: Record<string, PiProviderConfig> | undefined): string | undefined =>
            Object.entries(providers ?? {})
                .find(([, provider]) => this.trimBaseUrl(provider.baseUrl ?? "") === normalized)?.[0];
        const providerId = findProvider(modelsResult.parsed.providers) ?? findProvider(yamlModels.providers);
        if (!providerId) return undefined;
        return (
            this.getAuthValue(authResult.parsed[providerId]) ??
            modelsResult.parsed.providers?.[providerId]?.apiKey ??
            yamlModels.providers?.[providerId]?.apiKey
        );
    }
    private async resolveVisionConfig(fallbackVision?: { providerId: string; modelId: string }): Promise<ResolvedVisionConfig> {
        const [settings, models, yamlModels] = await Promise.all([
            this.getSettingsConfig(),
            this.getModelsConfig(),
            this.getYamlModelsConfig(),
        ]);
        // 优先级: 显式识图配置 (settings.json 中 provider+model 都填了才生效)
        // > 回退配置 (桌面端当前对话模型 / 桌面设置里的识图模型)。
        const explicitProvider = this.getStringSetting(settings.parsed, "visionProvider");
        const explicitModel = this.getStringSetting(settings.parsed, "visionModel");
        const hasExplicit = Boolean(explicitProvider && explicitModel);
        const providerId = hasExplicit ? explicitProvider : fallbackVision?.providerId;
        const modelId = hasExplicit ? explicitModel : fallbackVision?.modelId;
        if (!providerId || !modelId) {
            throw new Error("请先在设置中选择识图模型");
        }
        const provider = this.mergeProviderConfigs(
            models.parsed.providers?.[providerId],
            yamlModels.providers?.[providerId],
        );
        if (!provider) {
            throw new Error(`未找到识图 provider: ${providerId}`);
        }
        const model = (provider.models ?? []).find((item) => item.id === modelId);
        if (!model) {
            throw new Error(`未找到识图模型: ${modelId}`);
        }
        return {
            providerId,
            provider,
            model,
            api: this.apiFromApiType(model.api ?? provider.api ?? provider.apiType) ?? DEFAULT_PROVIDER_API,
            apiKey: await this.resolveProviderApiKey(providerId),
        };
    }

    private async readJsonFile<T>(fileName: string, fallback: T): Promise<{ raw: string; parsed: T }> {
        const filePath = join(this.configDir, fileName);
        try {
            const stats = await stat(filePath);
            const cached = this.jsonCache.get(fileName);
            if (cached && cached.mtime === stats.mtimeMs) {
                return { raw: cached.raw, parsed: cached.parsed as T };
            }
            const raw = await readFile(filePath, "utf8");
            const parsed = JSON.parse(raw) as T;
            this.jsonCache.set(fileName, { mtime: stats.mtimeMs, raw, parsed });
            return { raw, parsed };
        } catch {
            return { raw: JSON.stringify(fallback, null, 2), parsed: fallback };
        }
    }

    private async getYamlModelsConfig(): Promise<PiModelsFile> {
        try {
            const raw = await readFile(join(this.configDir, "models.yml"), "utf8");
            const parsed = yaml.load(raw) as unknown;
            if (!this.isPlainObject(parsed) || !this.isPlainObject(parsed.providers)) return { providers: {} };
            const providers: PiModelsFile["providers"] = {};
            for (const [providerId, rawProvider] of Object.entries(parsed.providers)) {
                if (!this.isPlainObject(rawProvider)) continue;
                providers[providerId] = this.normalizeProvider(rawProvider, providerId);
            }
            return { providers };
        } catch {
            return { providers: {} };
        }
    }

    private mergeProviderConfigs(
        jsonProvider?: PiProviderConfig,
        yamlProvider?: PiProviderConfig,
    ): PiProviderConfig | undefined {
        if (!jsonProvider && !yamlProvider) return undefined;
        if (!jsonProvider) {
            return yamlProvider ? { ...yamlProvider, models: [...(yamlProvider.models ?? [])] } : undefined;
        }
        if (!yamlProvider) {
            return { ...jsonProvider, models: [...(jsonProvider.models ?? [])] };
        }
        const deletedModels = new Set(jsonProvider._piDesktopDeletedModels ?? []);
        const mergedModels = [...(jsonProvider.models ?? [])];
        for (const model of yamlProvider.models ?? []) {
            if (deletedModels.has(model.id)) continue;
            if (!mergedModels.some((existing) => existing.id === model.id)) {
                mergedModels.push(model);
            }
        }
        return {
            ...yamlProvider,
            ...jsonProvider,
            headers: jsonProvider.headers ?? yamlProvider.headers,
            models: mergedModels,
        };
    }

    private normalizeProvider(rawProvider: Record<string, unknown>, providerId: string): PiProviderConfig {
        const rawModels = Array.isArray(rawProvider.models) ? rawProvider.models : [];
        return {
            ...rawProvider,
            name: typeof rawProvider.name === "string" ? rawProvider.name : providerId,
            baseUrl: typeof rawProvider.baseUrl === "string" ? rawProvider.baseUrl : undefined,
            apiType: typeof rawProvider.apiType === "string" ? rawProvider.apiType : undefined,
            api: this.apiFromApiType(typeof rawProvider.api === "string" ? rawProvider.api : typeof rawProvider.apiType === "string" ? rawProvider.apiType : undefined),
            headers: this.stringRecord(rawProvider.headers),
            models: rawModels
                .filter((model): model is Record<string, unknown> => this.isPlainObject(model) && typeof model.id === "string")
                .map((model) => ({
                    ...model,
                    id: String(model.id),
                    name: typeof model.name === "string" ? model.name : String(model.id),
                    api: typeof model.api === "string" ? model.api : undefined,
                    reasoning: typeof model.reasoning === "boolean" ? model.reasoning : undefined,
                    input: Array.isArray(model.input) ? model.input.filter((item): item is string => typeof item === "string") : undefined,
                    contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : undefined,
                    maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : undefined,
                })),
            _piDesktopDeletedModels: Array.isArray(rawProvider._piDesktopDeletedModels)
                ? rawProvider._piDesktopDeletedModels.filter((id): id is string => typeof id === "string")
                : undefined,
        };
    }

    private ensureYamlProviderMigrated(modelsFile: PiModelsFile, yamlModels: PiModelsFile, providerId: string): void {
        if (modelsFile.providers[providerId]) return;
        const yamlProvider = yamlModels.providers[providerId];
        if (!yamlProvider) return;
        modelsFile.providers[providerId] = {
            ...yamlProvider,
            models: [...(yamlProvider.models ?? [])],
        };
    }

    private async findFirstManagedModel(): Promise<ManagedModelEntry | undefined> {
        const list = await this.listManagedModels();
        return list.models[0];
    }

    private toManagedModelEntry(
        source: "json" | "yaml",
        providerId: string,
        provider: PiProviderConfig,
        model: PiModelItem,
        auth: PiAuthFile,
        settings: PiSettingsFile,
    ): ManagedModelEntry {
        const authValue = this.getAuthValue(auth[providerId]) ?? provider.apiKey;
        return {
            providerId,
            providerName: provider.name || providerId,
            modelId: model.id,
            modelName: model.name || model.id,
            baseUrl: provider.baseUrl,
            apiType: provider.apiType ?? this.apiTypeFromApi(model.api ?? provider.api),
            api: model.api ?? provider.api,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            reasoning: model.reasoning,
            thinkingLevelMap: this.thinkingLevelMap(model.thinkingLevelMap),
            input: model.input,
            source,
            isDefault:
                this.getStringSetting(settings, "defaultProvider") === providerId &&
                this.getStringSetting(settings, "defaultModel") === model.id,
            hasApiKey: Boolean(authValue),
            apiKeyPreview: authValue ? this.maskSecret(authValue) : undefined,
            headers: model.headers ?? provider.headers,
        };
    }

    private apiTypeFromApi(api?: string): string | undefined {
        return this.apiFromApiType(api);
    }

    private anthropicImageSource(image: VisionImageInput): { type: "base64"; media_type: string; data: string } {
        const parsed = image.dataUrl.match(/^data:(?<mime>[^;]+);base64,(?<data>.+)$/);
        if (!parsed?.groups?.mime || !parsed.groups.data) {
            throw new Error(`图片 ${image.name} 不是有效的 base64 data URL`);
        }
        return {
            type: "base64",
            media_type: image.mimeType ?? parsed.groups.mime,
            data: parsed.groups.data,
        };
    }

    private readOpenAiVisionText(payload: unknown): string {
        const data = this.isPlainObject(payload) ? payload : {};
        if (typeof data.output_text === "string" && data.output_text.trim()) {
            return data.output_text.trim();
        }
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const choiceMessage = choices[0];
        if (this.isPlainObject(choiceMessage) && this.isPlainObject(choiceMessage.message)) {
            const content = choiceMessage.message.content;
            if (typeof content === "string" && content.trim()) {
                return content.trim();
            }
            if (Array.isArray(content)) {
                const text = content
                    .map((item) => {
                        if (!this.isPlainObject(item)) return "";
                        if (typeof item.text === "string") return item.text;
                        if (this.isPlainObject(item.text) && typeof item.text.value === "string") return item.text.value;
                        return "";
                    })
                    .filter(Boolean)
                    .join("\n")
                    .trim();
                if (text) return text;
            }
        }
        const output = Array.isArray(data.output) ? data.output : [];
        const text = output
            .flatMap((item) => {
                if (!this.isPlainObject(item) || !Array.isArray(item.content)) return [];
                return item.content.flatMap((part) => {
                    if (!this.isPlainObject(part)) return [];
                    if (typeof part.text === "string") return [part.text];
                    if (this.isPlainObject(part.text) && typeof part.text.value === "string") return [part.text.value];
                    return [];
                });
            })
            .join("\n")
            .trim();
        return text;
    }

    private readAnthropicVisionText(payload: unknown): string {
        const data = this.isPlainObject(payload) ? payload : {};
        const content = Array.isArray(data.content) ? data.content : [];
        return content
            .flatMap((item) => {
                if (!this.isPlainObject(item) || typeof item.text !== "string") return [];
                return [item.text];
            })
            .join("\n")
            .trim();
    }

    private async describeResponseFailure(status: number, payload: unknown): Promise<string> {
        const data = this.isPlainObject(payload) ? payload : {};
        const error = this.isPlainObject(data.error) ? data.error : undefined;
        const detail = typeof error?.message === "string"
            ? error.message
            : typeof data.message === "string"
                ? data.message
                : "";
        return detail ? `识图请求失败: HTTP ${status} - ${detail}` : `识图请求失败: HTTP ${status}`;
    }

    private apiFromApiType(apiType?: string): string | undefined {
        const trimmed = apiType?.trim();
        if (!trimmed) return undefined;
        if (trimmed === "openai" || trimmed === "openai-chat-completions" || trimmed === "openai-completions") {
            return "openai-completions";
        }
        if (trimmed === "responses" || trimmed === "openai-responses") return "openai-responses";
        if (trimmed === "anthropic" || trimmed === "anthropic-messages") return "anthropic-messages";
        return trimmed;
    }

    private getAuthValue(item?: PiAuthItem): string | undefined {
        if (!item) return undefined;
        return item.key || item.apiKey;
    }

    private getStringSetting(settings: PiSettingsFile, key: string): string {
        const value = settings[key];
        return typeof value === "string" ? value : "";
    }

    private maskSecret(value: string): string {
        if (value.length <= 8) return "••••";
        return `${value.slice(0, 3)}...${value.slice(-4)}`;
    }

    private stringRecord(value: unknown): Record<string, string> | undefined {
        if (!this.isPlainObject(value)) return undefined;
        const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }

    private redactStringRecord(value: Record<string, string>): Record<string, string> {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            const sensitive = /(?:key|token|secret|password|authorization|cookie)/i.test(key);
            return [key, sensitive && item ? REDACTED_AUTH_VALUE : item];
        }));
    }

    private restoreRedactedHeaders(
        incoming: Record<string, string>,
        previous: Record<string, string> | undefined,
    ): Record<string, string> {
        return Object.fromEntries(Object.entries(incoming).map(([key, value]) => {
            if (value !== REDACTED_AUTH_VALUE) return [key, value];
            const previousValue = previous?.[key];
            if (!previousValue) return [key, REDACTED_AUTH_VALUE];
            return [key, previousValue];
        }));
    }

    private async writeJsonFile(fileName: string, data: unknown): Promise<void> {
        await mkdir(this.configDir, { recursive: true });
        const filePath = join(this.configDir, fileName);
        const tmpPath = join(this.configDir, `${fileName}.tmp`);
        const raw = JSON.stringify(data, null, 2);
        await writeFile(tmpPath, raw, "utf8");
        await rename(tmpPath, filePath);
        // Update cache after write so subsequent reads skip the disk
        const stats = await stat(filePath);
        this.jsonCache.set(fileName, { mtime: stats.mtimeMs, raw, parsed: data });
    }

    private isPlainObject(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    private trimBaseUrl(baseUrl: string): string {
        return baseUrl.replace(/\/+$/, "");
    }

    private thinkingLevelMap(value: unknown): PiAgentModel["thinkingLevelMap"] {
        if (!this.isPlainObject(value)) return undefined;
        const result: NonNullable<PiAgentModel["thinkingLevelMap"]> = {};
        for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"] as const) {
            const mapped = value[level];
            if (typeof mapped === "string" || mapped === null) result[level] = mapped;
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    private modelCost(value: unknown): PiAgentModel["cost"] {
        if (!this.isPlainObject(value)) return undefined;
        const result: NonNullable<PiAgentModel["cost"]> = {};
        for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
            if (typeof value[field] === "number") result[field] = value[field];
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    private anthropicMessagesUrl(baseUrl: string): string {
        return `${baseUrl}${/\/v1$/i.test(baseUrl) ? "" : "/v1"}/messages`;
    }
}
