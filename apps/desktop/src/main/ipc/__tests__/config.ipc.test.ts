import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigValidationResult, ManagedModelDeleteInput, ManagedModelSaveInput } from "@shared";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

import { setupConfigIpc } from "../config.ipc";
import type { ConfigManager } from "../../services/config/config-manager";

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
    | "listManagedModels"
    | "saveManagedModel"
    | "deleteManagedModel"
    | "setDefaultModel"
>;

describe("setupConfigIpc", () => {
    beforeEach(() => handlers.clear());

    it("registers managed model handlers against ConfigManager", async () => {
        const manager: ConfigManagerStub = {
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
});
