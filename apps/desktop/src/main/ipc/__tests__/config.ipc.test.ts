import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigValidationResult, ManagedModelDeleteInput, ManagedModelSaveInput } from "@shared";
import type { ConfigManager } from "../../services/config/config-manager";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => [
            {
                isDestroyed: () => false,
                webContents: { send: webContentsSend },
            },
        ]),
    },
}));

import { setupConfigIpc } from "../config.ipc";

type ConfigManagerStub = Pick<
    ConfigManager,
    | "getModelsConfig"
    | "getAuthConfig"
    | "getSettingsConfig"
    | "saveModelsConfig"
    | "saveAuthConfig"
    | "saveSettingsConfig"
    | "saveRawConfig"
    | "exportConfig"
    | "importConfig"
    | "fetchModels"
    | "testProviderConnection"
    | "describeImages"
    | "listManagedModels"
    | "saveManagedModel"
    | "deleteManagedModel"
    | "setDefaultModel"
>;

function createManagerStub(): ConfigManagerStub {
    return {
        getModelsConfig: vi.fn(async () => ({ raw: "{}", parsed: { providers: {} } })),
        getAuthConfig: vi.fn(async () => ({ raw: "{}", parsed: {} })),
        getSettingsConfig: vi.fn(async () => ({ raw: "{}", parsed: {} })),
        saveModelsConfig: vi.fn(async () => ({ valid: true })),
        saveAuthConfig: vi.fn(async () => ({ valid: true })),
        saveSettingsConfig: vi.fn(async () => ({ valid: true })),
        saveRawConfig: vi.fn(async () => ({ valid: true })),
        exportConfig: vi.fn(async () => "{}"),
        importConfig: vi.fn(async () => ({ valid: true })),
        fetchModels: vi.fn(async () => []),
        testProviderConnection: vi.fn(async () => ({ ok: true, message: "连接成功" })),
        describeImages: vi.fn(async () => ({ text: "图里有设置面板" })),
        listManagedModels: vi.fn(async () => ({
            configDir: "C:/Users/demo/.pi/agent",
            defaultProvider: "openai",
            defaultModel: "gpt-4o",
            models: [],
        })),
        saveManagedModel: vi.fn(async () => ({ valid: true })),
        deleteManagedModel: vi.fn(async () => ({ valid: true })),
        setDefaultModel: vi.fn(async (providerId, modelId): Promise<ConfigValidationResult> => {
            if (!providerId || !modelId) return { valid: false, error: "Provider ID 和模型 ID 不能为空" };
            return { valid: true };
        }),
    };
}

describe("setupConfigIpc", () => {
    beforeEach(() => {
        handlers.clear();
        webContentsSend.mockClear();
    });

    it("registers managed model handlers against ConfigManager", async () => {
        const manager = createManagerStub();
        const saveInput: ManagedModelSaveInput = { providerId: "openai", modelId: "gpt-4o" };
        const deleteInput: ManagedModelDeleteInput = { providerId: "openai", modelId: "gpt-4o" };

        setupConfigIpc(manager as ConfigManager);

        await handlers.get("config:list-managed-models")?.({});
        await handlers.get("config:save-managed-model")?.({}, saveInput);
        await handlers.get("config:delete-managed-model")?.({}, deleteInput);
        await expect(handlers.get("config:set-default-model")?.({}, "", "")).resolves.toEqual({
            valid: false,
            error: "Provider ID 和模型 ID 不能为空",
        });

        expect(manager.listManagedModels).toHaveBeenCalled();
        expect(manager.saveManagedModel).toHaveBeenCalledWith(saveInput);
        expect(manager.deleteManagedModel).toHaveBeenCalledWith(deleteInput);
        expect(manager.setDefaultModel).toHaveBeenCalledWith("", "");
    });

    it("notifies when direct config saves change Pi Agent config", async () => {
        const manager = createManagerStub();
        const onManagedModelsChanged = vi.fn();

        setupConfigIpc(manager as ConfigManager, { onManagedModelsChanged });

        await handlers.get("config:save-models")?.({}, { providers: {} });
        await handlers.get("config:save-auth")?.({}, {});
        await handlers.get("config:save-settings")?.({}, {});
        await handlers.get("config:save-raw")?.({}, "models.json", '{"providers":{}}');
        await handlers.get("config:import")?.({}, '{"files":{"models.json":{"providers":{}}}}');

        expect(onManagedModelsChanged).toHaveBeenCalledTimes(5);
    });

    it("broadcasts Pi config changes to renderer windows after managed model edits", async () => {
        const manager = createManagerStub();
        const deleteInput: ManagedModelDeleteInput = { providerId: "mimo", modelId: "mimo-v2.5" };

        setupConfigIpc(manager as ConfigManager);

        await handlers.get("config:delete-managed-model")?.({}, deleteInput);

        expect(webContentsSend).toHaveBeenCalledWith("pi-config:changed");
    });

    it("returns IpcError for unsafe fetch-models URLs", async () => {
        const manager = createManagerStub();

        setupConfigIpc(manager as ConfigManager);
        const result = await handlers.get("config:fetch-models")!({}, "http://169.254.169.254/latest/meta-data");

        expect(result).toMatchObject({
            code: "ipcErrors.config.unsafeUrl",
        });
        expect(manager.fetchModels).not.toHaveBeenCalled();
    });

    it("returns IpcError for unsafe provider test URLs", async () => {
        const manager = createManagerStub();

        setupConfigIpc(manager as ConfigManager);
        const result = await handlers.get("config:test-provider")!({}, {
            baseUrl: "file:///C:/secret",
        });

        expect(result).toMatchObject({
            code: "ipcErrors.config.unsafeUrl",
        });
        expect(manager.testProviderConnection).not.toHaveBeenCalled();
    });

    it("parses and delegates pi:describe-images payloads", async () => {
        const manager = createManagerStub();

        setupConfigIpc(manager as ConfigManager);
        const result = await handlers.get("pi:describe-images")!({}, [
            { name: "settings.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" },
        ]);

        expect(result).toEqual({ text: "图里有设置面板" });
        expect(manager.describeImages).toHaveBeenCalledWith([
            { name: "settings.png", dataUrl: "data:image/png;base64,Zm9v", mimeType: "image/png" },
        ]);
    });

    // wave-101 residual
    it("returns invalidImages for malformed describe-images payloads", async () => {
        const manager = createManagerStub();
        setupConfigIpc(manager as ConfigManager);
        const result = await handlers.get("pi:describe-images")!({}, "not-an-array");
        expect(result).toMatchObject({
            code: "ipcErrors.config.invalidImages",
        });
        expect(manager.describeImages).not.toHaveBeenCalled();
    });

    it("allows safe https fetch-models and test-provider URLs", async () => {
        const manager = createManagerStub();
        setupConfigIpc(manager as ConfigManager);

        await handlers.get("config:fetch-models")!({}, "https://api.openai.com/v1", "sk-test");
        expect(manager.fetchModels).toHaveBeenCalledWith("https://api.openai.com/v1", "sk-test", undefined);

        await handlers.get("config:test-provider")!({}, {
            baseUrl: "https://api.openai.com/v1",
            providerId: "openai",
            apiKey: "sk-test",
            modelId: "gpt-4o",
        });
        expect(manager.testProviderConnection).toHaveBeenCalled();
    });

    it("blocks metadata hostnames on fetch-models and test-provider", async () => {
        const manager = createManagerStub();
        setupConfigIpc(manager as ConfigManager);
        for (const url of [
            "http://metadata.google.internal/computeMetadata/v1/",
            "https://169.254.169.254/latest/meta-data",
        ]) {
            const fetchResult = await handlers.get("config:fetch-models")!({}, url);
            expect(fetchResult).toMatchObject({ code: "ipcErrors.config.unsafeUrl" });
            const testResult = await handlers.get("config:test-provider")!({}, { baseUrl: url });
            expect(testResult).toMatchObject({ code: "ipcErrors.config.unsafeUrl" });
        }
        expect(manager.fetchModels).not.toHaveBeenCalled();
        expect(manager.testProviderConnection).not.toHaveBeenCalled();
    });

    it("reads models/auth/settings and exports config", async () => {
        const manager = createManagerStub();
        setupConfigIpc(manager as ConfigManager);
        await expect(handlers.get("config:get-models")!({})).resolves.toMatchObject({ raw: "{}" });
        await expect(handlers.get("config:get-auth")!({})).resolves.toMatchObject({ raw: "{}" });
        await expect(handlers.get("config:get-settings")!({})).resolves.toMatchObject({ raw: "{}" });
        await expect(handlers.get("config:export")!({})).resolves.toBe("{}");
        expect(manager.getModelsConfig).toHaveBeenCalled();
        expect(manager.getAuthConfig).toHaveBeenCalled();
        expect(manager.getSettingsConfig).toHaveBeenCalled();
        expect(manager.exportConfig).toHaveBeenCalled();
    });

    it("broadcasts pi-config:changed after set-default-model success", async () => {
        const manager = createManagerStub();
        setupConfigIpc(manager as ConfigManager);
        await handlers.get("config:set-default-model")!({}, "openai", "gpt-4o");
        expect(manager.setDefaultModel).toHaveBeenCalledWith("openai", "gpt-4o");
        expect(webContentsSend).toHaveBeenCalledWith("pi-config:changed");
    });
});
