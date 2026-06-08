import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type {
    ConfigValidationResult,
    PiAuthFile,
    PiModelItem,
    PiModelsFile,
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
