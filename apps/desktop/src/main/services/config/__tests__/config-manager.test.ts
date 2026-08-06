import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigManager } from "../config-manager";

describe("ConfigManager", () => {
    let dir: string;
    let manager: ConfigManager;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "pi-config-"));
        manager = new ConfigManager(dir);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns defaults when config files are missing", async () => {
        await expect(manager.getModelsConfig()).resolves.toMatchObject({
            parsed: { providers: {} },
        });
        await expect(manager.getAuthConfig()).resolves.toMatchObject({ parsed: {} });
        await expect(manager.getSettingsConfig()).resolves.toMatchObject({ parsed: {} });
    });

    it("redacts auth secrets for UI reads and preserves them when saving redacted values", async () => {
        await manager.saveAuthConfig({ openai: { type: "api_key", key: "sk-secret" } });
        const redacted = await manager.getAuthConfigRedacted();
        expect(redacted.parsed).toEqual({ openai: { type: "api_key", key: "[REDACTED]" } });
        expect(redacted.raw).not.toContain("sk-secret");

        await expect(manager.saveAuthConfig(redacted.parsed)).resolves.toEqual({ valid: true });
        await expect(manager.getAuthConfig()).resolves.toMatchObject({
            parsed: { openai: { key: "sk-secret" } },
        });
    });

    it("redacts models.json secrets and preserves them when saving redacted values", async () => {
        await manager.saveModelsConfig({
            providers: {
                openai: {
                    name: "OpenAI",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "sk-provider-secret",
                    headers: { Authorization: "Bearer sk-header-secret", "X-Custom": "plain" },
                    models: [
                        { id: "gpt-4o", name: "GPT-4o", apiKey: "sk-model-secret", key: "sk-model-key", headers: { "x-api-key": "sk-model-header" } },
                    ],
                },
            },
        });

        const redacted = await manager.getModelsConfigRedacted();
        expect(redacted.raw).not.toContain("sk-provider-secret");
        expect(redacted.raw).not.toContain("sk-header-secret");
        expect(redacted.raw).not.toContain("sk-model-secret");
        expect(redacted.raw).not.toContain("sk-model-key");
        expect(redacted.raw).not.toContain("sk-model-header");
        expect(redacted.raw).toContain("X-Custom");

        await expect(manager.saveModelsConfig(redacted.parsed)).resolves.toEqual({ valid: true });
        await expect(manager.getModelsConfig()).resolves.toMatchObject({
            parsed: {
                providers: {
                    openai: {
                        apiKey: "sk-provider-secret",
                        headers: { Authorization: "Bearer sk-header-secret", "X-Custom": "plain" },
                        models: [{
                            id: "gpt-4o",
                            apiKey: "sk-model-secret",
                            key: "sk-model-key",
                            headers: { "x-api-key": "sk-model-header" },
                        }],
                    },
                },
            },
        });
    });

    it("rejects saving redacted models secrets when no previous value exists", async () => {
        const result = await manager.saveModelsConfig({
            providers: {
                openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "[REDACTED]" },
            },
        });
        expect(result.valid).toBe(false);
        await expect(readFile(join(dir, "models.json"), "utf8")).rejects.toThrow();
    });

    it("validates models.json before saving", async () => {
        const invalid = await manager.saveModelsConfig({} as any);

        expect(invalid.valid).toBe(false);
        await expect(readFile(join(dir, "models.json"), "utf8")).rejects.toThrow();

        const valid = await manager.saveModelsConfig({
            providers: {
                openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [] },
            },
        });

        expect(valid.valid).toBe(true);
        await expect(readFile(join(dir, "models.json"), "utf8")).resolves.toContain("openai");
    });

    it("imports and exports all pi config files", async () => {
        await writeFile(join(dir, "models.json"), JSON.stringify({ providers: { a: {} } }), "utf8");
        await writeFile(join(dir, "auth.json"), JSON.stringify({ a: { apiKey: "secret" } }), "utf8");
        await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "a" }), "utf8");

        const exported = await manager.exportConfig();
        const nextDir = await mkdtemp(join(tmpdir(), "pi-config-import-"));
        const next = new ConfigManager(nextDir);

        const result = await next.importConfig(exported);

        expect(result.valid).toBe(true);
        await expect(next.getSettingsConfig()).resolves.toMatchObject({
            parsed: { defaultProvider: "a" },
        });
    });

    it("lists managed models from models.json with auth and default metadata", async () => {
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    openai: {
                        name: "OpenAI",
                        baseUrl: "https://api.openai.com/v1",
                        apiType: "responses",
                        models: [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxTokens: 4096 }],
                    },
                },
            }),
            "utf8",
        );
        await writeFile(join(dir, "auth.json"), JSON.stringify({ openai: { key: "sk-secret" } }), "utf8");
        await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4o" }), "utf8");

        const result = await manager.listManagedModels();

        expect(result.defaultProvider).toBe("openai");
        expect(result.defaultModel).toBe("gpt-4o");
        expect(result.models).toEqual([
            expect.objectContaining({
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-4o",
                modelName: "GPT-4o",
                baseUrl: "https://api.openai.com/v1",
                apiType: "responses",
                source: "json",
                isDefault: true,
                hasApiKey: true,
                apiKeyPreview: "sk-...cret",
                contextWindow: 128000,
                maxTokens: 4096,
            }),
        ]);
    });

    it("preserves provider and model declaration order when listing managed models", async () => {
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    zeta: {
                        name: "Zeta Provider",
                        models: [
                            { id: "second", name: "Second Model" },
                            { id: "first", name: "First Model" },
                        ],
                    },
                    alpha: {
                        name: "Alpha Provider",
                        models: [{ id: "only", name: "Only Model" }],
                    },
                },
            }),
            "utf8",
        );
        await writeFile(
            join(dir, "settings.json"),
            JSON.stringify({ defaultProvider: "alpha", defaultModel: "only" }),
            "utf8",
        );

        const result = await manager.listManagedModels();

        expect(result.models.map((model) => `${model.providerId}:${model.modelId}`)).toEqual([
            "zeta:second",
            "zeta:first",
            "alpha:only",
        ]);
        expect(manager.loadPiAgentConfig()?.providers.flatMap((provider) =>
            provider.models.map((model) => `${provider.id}:${model.id}`),
        )).toEqual([
            "zeta:second",
            "zeta:first",
            "alpha:only",
        ]);
    });

    it("saves a managed model with Pi SDK compatible api and key fields", async () => {
        const result = await manager.saveManagedModel({
            providerId: "custom",
            providerName: "Custom Provider",
            baseUrl: "https://api.example.com/v1",
            apiType: "openai",
            apiKey: "sk-new-secret",
            modelId: "custom-model",
            modelName: "Custom Model",
            contextWindow: 64000,
            maxTokens: 8192,
            setDefault: true,
        });

        expect(result.valid).toBe(true);
        await expect(manager.getModelsConfig()).resolves.toMatchObject({
            parsed: {
                providers: {
                    custom: {
                        name: "Custom Provider",
                        baseUrl: "https://api.example.com/v1",
                        apiType: "openai",
                        api: "openai-completions",
                        apiKey: "sk-new-secret",
                        models: [{ id: "custom-model", name: "Custom Model", contextWindow: 64000, maxTokens: 8192 }],
                    },
                },
            },
        });
        await expect(manager.getAuthConfig()).resolves.toMatchObject({
            parsed: { custom: { type: "api_key", key: "sk-new-secret" } },
        });
        await expect(manager.getSettingsConfig()).resolves.toMatchObject({
            parsed: { defaultProvider: "custom", defaultModel: "custom-model" },
        });
    });

    it("preserves Pi model runtime fields when loading the desktop config", async () => {
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    custom: {
                        name: "Custom",
                        baseUrl: "https://api.example.com/v1",
                        api: "openai-completions",
                        headers: { "X-Provider": "desktop" },
                        authHeader: false,
                        models: [{
                            id: "reasoner",
                            name: "Reasoner",
                            api: "openai-responses",
                            baseUrl: "https://model.example.com/v1",
                            reasoning: true,
                            thinkingLevelMap: { minimal: null, high: "high", xhigh: "max" },
                            headers: { "X-Model": "reasoner" },
                            compat: { supportsDeveloperRole: false },
                            cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
                        }],
                    },
                },
            }),
            "utf8",
        );
        await writeFile(join(dir, "auth.json"), JSON.stringify({ custom: { key: "sk-test" } }), "utf8");

        expect(manager.loadPiAgentConfig()).toMatchObject({
            providers: [{
                id: "custom",
                headers: { "X-Provider": "desktop" },
                authHeader: false,
                models: [{
                    id: "reasoner",
                    api: "openai-responses",
                    baseUrl: "https://model.example.com/v1",
                    thinkingLevelMap: { minimal: null, high: "high", xhigh: "max" },
                    headers: { "X-Model": "reasoner" },
                    compat: { supportsDeveloperRole: false },
                    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
                }],
            }],
        });
    });

    it("moves the existing API key when a provider id is renamed with a blank key field", async () => {
        await manager.saveModelsConfig({
            providers: {
                openai_legacy: {
                    name: "OpenAI legacy",
                    baseUrl: "https://api.example.com/v1",
                    api: "openai-completions",
                    apiKey: "sk-existing",
                    models: [{ id: "gpt-custom", name: "GPT Custom" }],
                },
            },
        });
        await manager.saveAuthConfig({
            openai_legacy: { type: "api_key", key: "sk-existing" },
        });
        await manager.saveSettingsConfig({
            defaultProvider: "openai_legacy",
            defaultModel: "gpt-custom",
        });

        const result = await manager.saveManagedModel({
            originalProviderId: "openai_legacy",
            originalModelId: "gpt-custom",
            providerId: "openai",
            providerName: "OpenAI",
            baseUrl: "https://api.example.com/v1",
            api: "openai-completions",
            modelId: "gpt-custom",
            modelName: "GPT Custom",
            setDefault: true,
        });

        expect(result.valid).toBe(true);
        await expect(manager.getModelsConfig()).resolves.toMatchObject({
            parsed: {
                providers: {
                    openai: expect.objectContaining({
                        apiKey: "sk-existing",
                        models: [expect.objectContaining({ id: "gpt-custom" })],
                    }),
                },
            },
        });
        expect((await manager.getModelsConfig()).parsed.providers).not.toHaveProperty("openai_legacy");
        await expect(manager.getAuthConfig()).resolves.toMatchObject({
            parsed: { openai: { type: "api_key", key: "sk-existing" } },
        });
        expect((await manager.getAuthConfig()).parsed).not.toHaveProperty("openai_legacy");
        await expect(manager.getSettingsConfig()).resolves.toMatchObject({
            parsed: { defaultProvider: "openai", defaultModel: "gpt-custom" },
        });
    });

    it("deletes a default model and falls back to the next available model", async () => {
        await manager.saveModelsConfig({
            providers: {
                a: {
                    name: "Provider A",
                    models: [
                        { id: "one", name: "One" },
                        { id: "two", name: "Two" },
                    ],
                },
            },
        });
        await manager.saveSettingsConfig({ defaultProvider: "a", defaultModel: "one" });

        const result = await manager.deleteManagedModel({ providerId: "a", modelId: "one" });

        expect(result.valid).toBe(true);
        await expect(manager.getModelsConfig()).resolves.toMatchObject({
            parsed: { providers: { a: { models: [{ id: "two", name: "Two" }] } } },
        });
        await expect(manager.getSettingsConfig()).resolves.toMatchObject({
            parsed: { defaultProvider: "a", defaultModel: "two" },
        });
    });

    it("removes a json-only provider and auth when deleting its final model", async () => {
        await manager.saveModelsConfig({
            providers: {
                temp: {
                    name: "Temp Provider",
                    baseUrl: "https://temp.example.com/v1",
                    api: "openai-completions",
                    models: [{ id: "only", name: "Only" }],
                },
            },
        });
        await manager.saveAuthConfig({ temp: { type: "api_key", key: "sk-temp" } });

        const result = await manager.deleteManagedModel({ providerId: "temp", modelId: "only" });

        expect(result.valid).toBe(true);
        await expect(manager.getModelsConfig()).resolves.toMatchObject({
            parsed: { providers: {} },
        });
        await expect(manager.getAuthConfig()).resolves.toMatchObject({ parsed: {} });
    });

    it("migrates yaml-sourced models on edit and marks yaml deletions so they do not reappear", async () => {
        await writeFile(
            join(dir, "models.yml"),
            [
                "providers:",
                "  y:",
                "    name: YAML Provider",
                "    baseUrl: https://yaml.example.com/v1",
                "    api: openai-completions",
                "    models:",
                "      - id: keep",
                "        name: Keep",
                "      - id: remove",
                "        name: Remove",
            ].join("\n"),
            "utf8",
        );

        await manager.saveManagedModel({
            originalProviderId: "y",
            originalModelId: "keep",
            providerId: "y",
            providerName: "YAML Provider",
            baseUrl: "https://yaml.example.com/v1",
            api: "openai-completions",
            modelId: "keep",
            modelName: "Keep Edited",
        });
        await manager.deleteManagedModel({ providerId: "y", modelId: "remove" });

        const list = await manager.listManagedModels();

        expect(list.models.map((model) => model.modelId)).toEqual(["keep"]);
        expect(list.models[0]).toMatchObject({ source: "json", modelName: "Keep Edited" });
        await expect(readFile(join(dir, "models.json"), "utf8")).resolves.toContain("\"_piDesktopDeletedModels\"");
    });

    it("tests provider connections with the provider api key when auth.json has no matching key", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({}),
        }));
        vi.stubGlobal("fetch", fetchMock);
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    mimo: {
                        name: "MiMo",
                        baseUrl: "https://api.xiaomimimo.com/v1",
                        apiKey: "sk-provider-key",
                        api: "openai-completions",
                        models: [{ id: "mimo-v2.5-pro", name: "MiMo v2.5 Pro", api: "openai-completions" }],
                    },
                },
            }),
            "utf8",
        );
        await writeFile(join(dir, "auth.json"), JSON.stringify({ provider: { key: "sk-other" } }), "utf8");

        const result = await manager.testProviderConnection(
            "https://api.xiaomimimo.com/v1",
            undefined,
            "mimo-v2.5-pro",
            undefined,
            undefined,
            { providerId: "mimo", api: "openai-completions" },
        );

        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.xiaomimimo.com/v1/chat/completions",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer sk-provider-key",
                }),
            }),
        );
    });

    it("tests Anthropic message providers with Anthropic headers and endpoint", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({}),
        }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await manager.testProviderConnection(
            "https://api.anthropic.com/v1",
            "sk-ant-test",
            "claude-sonnet-4-20250514",
            undefined,
            undefined,
            { providerId: "anthropic", api: "anthropic-messages" },
        );

        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.anthropic.com/v1/messages",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "x-api-key": "sk-ant-test",
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }),
                body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    messages: [{ role: "user", content: "ping" }],
                    max_tokens: 1,
                }),
            }),
        );
    });

    it("adds the Anthropic v1 path when the provider base URL omits it", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({}),
        }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await manager.testProviderConnection(
            "https://api.minimaxi.com/anthropic",
            "sk-minimax-test",
            "MiniMax-M3",
            undefined,
            undefined,
            { providerId: "minimax", api: "anthropic-messages" },
        );

        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.minimaxi.com/anthropic/v1/messages",
            expect.any(Object),
        );
    });

    it("describes images with the configured vision provider and model", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    {
                        message: {
                            content: [
                                { type: "text", text: "图中是设置窗口" },
                            ],
                        },
                    },
                ],
            }),
        }));
        vi.stubGlobal("fetch", fetchMock);
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    openai: {
                        name: "OpenAI",
                        baseUrl: "https://api.openai.com/v1",
                        api: "openai-completions",
                        models: [{ id: "gpt-4.1-mini", name: "GPT-4.1 Mini", api: "openai-completions" }],
                    },
                },
            }),
            "utf8",
        );
        await writeFile(join(dir, "auth.json"), JSON.stringify({ openai: { key: "sk-vision-key" } }), "utf8");
        await writeFile(join(dir, "settings.json"), JSON.stringify({ visionProvider: "openai", visionModel: "gpt-4.1-mini" }), "utf8");

        const result = await manager.describeImages([
            { name: "settings.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" },
        ]);

        expect(result).toEqual({ text: "图中是设置窗口" });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.openai.com/v1/chat/completions",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer sk-vision-key",
                }),
            }),
        );
        const requestInit = fetchMock.mock.calls[0]?.[1];
        if (!requestInit || typeof requestInit !== "object" || !("body" in requestInit)) {
            throw new Error("missing vision request body");
        }
        const body = JSON.parse(String(requestInit.body));
        expect(body.model).toBe("gpt-4.1-mini");
        expect(body.messages[0]?.content).toEqual([
            { type: "text", text: "请用简洁中文描述这张图片里的关键信息。" },
            { type: "image_url", image_url: { url: "data:image/png;base64,Zm9v" } },
        ]);
    });

    it("falls back to the provided current model when no vision config is set", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{ message: { content: [{ type: "text", text: "图中是聊天窗口" }] } }],
            }),
        }));
        vi.stubGlobal("fetch", fetchMock);
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    grok4_5: {
                        name: "grok4.5",
                        baseUrl: "https://grok.example.com/v1",
                        apiKey: "sk-grok-key",
                        api: "openai-completions",
                        models: [{ id: "grok-4.5", name: "grok-4.5", api: "openai-completions" }],
                    },
                },
            }),
            "utf8",
        );
        // settings.json 存在但没有任何识图配置
        await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "grok4_5" }), "utf8");

        const result = await manager.describeImages(
            [{ name: "chat.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" }],
            { providerId: "grok4_5", modelId: "grok-4.5" },
        );

        expect(result).toEqual({ text: "图中是聊天窗口" });
        const requestInit = fetchMock.mock.calls[0]?.[1];
        if (!requestInit || typeof requestInit !== "object" || !("body" in requestInit)) {
            throw new Error("missing vision request body");
        }
        const body = JSON.parse(String(requestInit.body));
        expect(body.model).toBe("grok-4.5");
    });

    it("prefers explicit settings.json vision config over the fallback model", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: [{ type: "text", text: "显式模型识别结果" }] } }] }),
        }));
        vi.stubGlobal("fetch", fetchMock);
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    openai: {
                        name: "OpenAI",
                        baseUrl: "https://api.openai.com/v1",
                        apiKey: "sk-openai-key",
                        api: "openai-completions",
                        models: [{ id: "gpt-4.1-mini", name: "GPT-4.1 Mini" }],
                    },
                    grok4_5: {
                        name: "grok4.5",
                        baseUrl: "https://grok.example.com/v1",
                        apiKey: "sk-grok-key",
                        api: "openai-completions",
                        models: [{ id: "grok-4.5", name: "grok-4.5" }],
                    },
                },
            }),
            "utf8",
        );
        await writeFile(
            join(dir, "settings.json"),
            JSON.stringify({ visionProvider: "openai", visionModel: "gpt-4.1-mini" }),
            "utf8",
        );

        await manager.describeImages(
            [{ name: "chat.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" }],
            { providerId: "grok4_5", modelId: "grok-4.5" },
        );

        const requestInit = fetchMock.mock.calls[0]?.[1];
        if (!requestInit || typeof requestInit !== "object" || !("body" in requestInit)) {
            throw new Error("missing vision request body");
        }
        expect(JSON.parse(String(requestInit.body)).model).toBe("gpt-4.1-mini");
    });

    it("throws when neither explicit vision config nor fallback model is available", async () => {
        await expect(
            manager.describeImages([
                { name: "chat.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" },
            ]),
        ).rejects.toThrow("请先在设置中选择识图模型");
    });

    it("ignores a half-configured explicit vision pair and uses the fallback instead", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: [{ type: "text", text: "回退识别结果" }] } }] }),
        }));
        vi.stubGlobal("fetch", fetchMock);
        await writeFile(
            join(dir, "models.json"),
            JSON.stringify({
                providers: {
                    grok4_5: {
                        name: "grok4.5",
                        baseUrl: "https://grok.example.com/v1",
                        apiKey: "sk-grok-key",
                        api: "openai-completions",
                        models: [{ id: "grok-4.5", name: "grok-4.5" }],
                    },
                },
            }),
            "utf8",
        );
        // 只配了 provider 没配 model → 视为未配置, 走回退
        await writeFile(join(dir, "settings.json"), JSON.stringify({ visionProvider: "openai" }), "utf8");

        await manager.describeImages(
            [{ name: "chat.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" }],
            { providerId: "grok4_5", modelId: "grok-4.5" },
        );

        const requestInit = fetchMock.mock.calls[0]?.[1];
        if (!requestInit || typeof requestInit !== "object" || !("body" in requestInit)) {
            throw new Error("missing vision request body");
        }
        expect(JSON.parse(String(requestInit.body)).model).toBe("grok-4.5");
    });

    describe("loadPiAgentConfig", () => {
        it("returns null when config dir does not exist", () => {
            const mgr = new ConfigManager(join(tmpdir(), "nonexistent-dir-" + Date.now()));
            expect(mgr.loadPiAgentConfig()).toBeNull();
        });

        it("parses models.json providers", async () => {
            await writeFile(
                join(dir, "models.json"),
                JSON.stringify({
                    providers: {
                        openai: {
                            name: "OpenAI",
                            baseUrl: "https://api.openai.com/v1",
                            apiKey: "OPENAI_API_KEY",
                            models: [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000 }],
                        },
                    },
                }),
                "utf8",
            );

            const config = manager.loadPiAgentConfig();

            expect(config).not.toBeNull();
            expect(config!.defaultProvider).toBe("google");
            expect(config!.providers).toHaveLength(1);
            expect(config!.providers[0].id).toBe("openai");
            expect(config!.providers[0].apiKey).toBe("OPENAI_API_KEY");
            expect(config!.providers[0].models[0].id).toBe("gpt-4o");
            expect(config!.providers[0].models[0].contextWindow).toBe(128000);
        });

        it("hydrates provider api keys from auth.json for runtime config summaries", async () => {
            await writeFile(
                join(dir, "models.json"),
                JSON.stringify({
                    providers: {
                        openai_ispure: {
                            name: "OpenAI (ispure)",
                            baseUrl: "https://example.test/v1",
                            api: "openai-completions",
                            models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
                        },
                    },
                }),
                "utf8",
            );
            await writeFile(
                join(dir, "auth.json"),
                JSON.stringify({ openai_ispure: { key: "sk-local-real" } }),
                "utf8",
            );

            const config = manager.loadPiAgentConfig();

            expect(config?.providers[0]).toMatchObject({
                id: "openai_ispure",
                apiKey: "sk-local-real",
            });
        });

        it("falls back to models.yml via js-yaml", async () => {
            await writeFile(
                join(dir, "models.yml"),
                [
                    "providers:",
                    "  anthropic:",
                    "    name: Anthropic",
                    "    baseUrl: https://api.anthropic.com",
                    "    models:",
                    "      - id: claude-sonnet-4-20250514",
                    "        name: Claude Sonnet 4",
                ].join("\n"),
                "utf8",
            );

            const config = manager.loadPiAgentConfig();

            expect(config).not.toBeNull();
            expect(config!.providers).toHaveLength(1);
            expect(config!.providers[0].id).toBe("anthropic");
            expect(config!.providers[0].models[0].id).toBe("claude-sonnet-4-20250514");
        });
    });

    describe("fetchModels error and success paths (B-015)", () => {
        it("rejects empty baseUrl before network I/O", async () => {
            await expect(manager.fetchModels("")).rejects.toThrow(/缺少 baseUrl/);
            await expect(manager.fetchModels("   ")).rejects.toThrow(/缺少 baseUrl/);
        });

        it("surfaces non-2xx HTTP status as a readable failure", async () => {
            const fetchMock = vi.fn(async () => ({
                ok: false,
                status: 401,
                json: async () => ({ error: "unauthorized" }),
            }));
            vi.stubGlobal("fetch", fetchMock);

            await expect(manager.fetchModels("https://api.example.com/v1", "sk-bad")).rejects.toThrow(
                /模型列表请求失败: HTTP 401/,
            );
            expect(fetchMock).toHaveBeenCalledWith(
                "https://api.example.com/v1/models",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "Bearer sk-bad" }),
                }),
            );
        });

        it("surfaces network timeouts / fetch rejections without swallowing them", async () => {
            vi.stubGlobal("fetch", vi.fn(async () => {
                throw new Error("fetch failed: network timeout");
            }));

            await expect(manager.fetchModels("https://api.example.com/v1")).rejects.toThrow(/network timeout/);
        });

        it("maps OpenAI-style and Google-style list payloads to model items", async () => {
            const fetchMock = vi.fn(async (url: string) => {
                if (String(url).includes("generativelanguage")) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
                                { name: "models/", displayName: "skip empty" },
                            ],
                        }),
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            { id: "gpt-test", name: "GPT Test" },
                            { id: "", name: "empty" },
                        ],
                    }),
                };
            });
            vi.stubGlobal("fetch", fetchMock);

            await expect(manager.fetchModels("https://api.example.com/v1", "sk-ok")).resolves.toEqual([
                { id: "gpt-test", name: "GPT Test" },
            ]);
            // apiType must be the resolved provider api id for Google prefix stripping.
            await expect(
                manager.fetchModels(
                    "https://generativelanguage.googleapis.com/v1beta",
                    "gkey",
                    "google-generative-ai",
                ),
            ).resolves.toEqual([{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" }]);
        });

        it("resolves [REDACTED] keys from models.json by baseUrl and never sends the sentinel", async () => {
            await manager.saveModelsConfig({
                providers: {
                    openai: {
                        name: "OpenAI",
                        baseUrl: "https://api.openai.com/v1",
                        apiKey: "sk-provider-secret",
                    },
                },
            });
            const fetchMock = vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({ data: [{ id: "gpt-4o", name: "GPT-4o" }] }),
            }));
            vi.stubGlobal("fetch", fetchMock);

            await expect(
                manager.fetchModels("https://api.openai.com/v1", "[REDACTED]"),
            ).resolves.toEqual([{ id: "gpt-4o", name: "GPT-4o" }]);

            expect(fetchMock).toHaveBeenCalledWith(
                "https://api.openai.com/v1/models",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "Bearer sk-provider-secret" }),
                }),
            );
        });

        it("resolves [REDACTED] keys for Anthropic headers and never sends the sentinel", async () => {
            await manager.saveModelsConfig({
                providers: {
                    anthropic: {
                        name: "Anthropic",
                        baseUrl: "https://api.anthropic.com",
                        apiKey: "sk-ant-provider-secret",
                    },
                },
            });
            const fetchMock = vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({ data: [{ id: "claude-sonnet-4-20250514" }] }),
            }));
            vi.stubGlobal("fetch", fetchMock);

            await manager.fetchModels("https://api.anthropic.com", "[REDACTED]", "anthropic-messages");

            expect(fetchMock).toHaveBeenCalledWith(
                "https://api.anthropic.com/models",
                expect.objectContaining({
                    headers: expect.objectContaining({
                        "x-api-key": "sk-ant-provider-secret",
                        "anthropic-version": "2023-06-01",
                    }),
                }),
            );
        });
    });
});