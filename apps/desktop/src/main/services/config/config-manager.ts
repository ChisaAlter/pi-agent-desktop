import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
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

export class ConfigManager {
    constructor(private readonly configDir = join(homedir(), ".pi", "agent")) {}

    getModelsConfig(): Promise<{ raw: string; parsed: PiModelsFile }> {
        return this.readJsonFile("models.json", { providers: {} });
    }

    getAuthConfig(): Promise<{ raw: string; parsed: PiAuthFile }> {
        return this.readJsonFile("auth.json", {});
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

        models.sort((a, b) =>
            `${a.providerName}\u0000${a.modelName}`.localeCompare(`${b.providerName}\u0000${b.modelName}`),
        );

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
        await this.writeJsonFile("models.json", data);
        return { valid: true };
    }

    async saveAuthConfig(data: PiAuthFile): Promise<ConfigValidationResult> {
        if (!this.isPlainObject(data)) return { valid: false, error: "auth.json 必须是对象" };
        await this.writeJsonFile("auth.json", data);
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
        if (originalProviderId !== providerId || originalModelId !== modelId) {
            const originalProvider = modelsFile.providers[originalProviderId];
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
        const api = input.api?.trim() || this.apiFromApiType(input.apiType) || existingProvider.api;
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
            const existingAuthValue = this.getAuthValue(authFile[providerId]) ?? existingProvider.apiKey;
            if (existingAuthValue) nextProvider.apiKey = existingAuthValue;
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

    async fetchModels(baseUrl: string, apiKey?: string, _apiType?: string): Promise<PiModelItem[]> {
        if (!baseUrl || baseUrl.trim().length === 0) throw new Error("缺少 baseUrl，请在 models.json 中配置 provider 的 baseUrl");
        const url = `${this.trimBaseUrl(baseUrl)}/models`;
        const response = await fetch(url, {
            headers: {
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
        });
        if (!response.ok) throw new Error(`模型列表请求失败: HTTP ${response.status}`);
        const data = (await response.json()) as { data?: Array<{ id?: string; name?: string }> };
        return (data.data ?? [])
            .filter((model) => typeof model.id === "string")
            .map((model) => ({ id: String(model.id), name: model.name }));
    }

    async testProviderConnection(
        baseUrl?: string,
        apiKey?: string,
        modelId?: string,
        apiType?: string,
        headers?: Record<string, string>,
    ): Promise<ProviderTestResult> {
        if (!baseUrl) return { ok: false, message: "缺少 baseUrl" };
        const useResponses = apiType === "responses";
        const url = `${this.trimBaseUrl(baseUrl)}/${useResponses ? "responses" : "chat/completions"}`;
        const body = useResponses
            ? { model: modelId || "test", input: "ping", max_output_tokens: 1 }
            : { model: modelId || "test", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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

    private async readJsonFile<T>(fileName: string, fallback: T): Promise<{ raw: string; parsed: T }> {
        try {
            const raw = await readFile(join(this.configDir, fileName), "utf8");
            return { raw, parsed: JSON.parse(raw) as T };
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

    private normalizeProvider(rawProvider: Record<string, unknown>, providerId: string): PiProviderConfig {
        const rawModels = Array.isArray(rawProvider.models) ? rawProvider.models : [];
        return {
            ...rawProvider,
            name: typeof rawProvider.name === "string" ? rawProvider.name : providerId,
            baseUrl: typeof rawProvider.baseUrl === "string" ? rawProvider.baseUrl : undefined,
            apiType: rawProvider.apiType === "responses" || rawProvider.apiType === "openai" ? rawProvider.apiType : undefined,
            api: typeof rawProvider.api === "string" ? rawProvider.api : undefined,
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

    private apiTypeFromApi(api?: string): "openai" | "responses" | undefined {
        if (api === "openai-responses") return "responses";
        if (api === "openai-completions") return "openai";
        return undefined;
    }

    private apiFromApiType(apiType?: string): string | undefined {
        if (apiType === "responses") return "openai-responses";
        if (apiType === "openai") return "openai-completions";
        return undefined;
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

    private async writeJsonFile(fileName: string, data: unknown): Promise<void> {
        await mkdir(this.configDir, { recursive: true });
        await writeFile(join(this.configDir, fileName), JSON.stringify(data, null, 2), "utf8");
    }

    private isPlainObject(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    private trimBaseUrl(baseUrl: string): string {
        return baseUrl.replace(/\/+$/, "");
    }
}
