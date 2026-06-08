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
});
