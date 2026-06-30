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
});
