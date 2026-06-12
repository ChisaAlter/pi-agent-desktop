import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../config-manager";

describe("ConfigManager", () => {
    let dir: string;
    let manager: ConfigManager;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "pi-config-"));
        manager = new ConfigManager(dir);
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

    it("saves a managed model and stores the provider api key in auth.json", async () => {
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
});
