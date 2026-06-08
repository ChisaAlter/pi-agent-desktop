import { ipcMain } from "electron";
import type { PiAuthFile, PiModelsFile, PiSettingsFile } from "@shared";
import type { ConfigManager } from "../services/config/config-manager";

export function setupConfigIpc(configManager: ConfigManager): void {
    ipcMain.handle("config:get-models", () => configManager.getModelsConfig());
    ipcMain.handle("config:get-auth", () => configManager.getAuthConfig());
    ipcMain.handle("config:get-settings", () => configManager.getSettingsConfig());
    ipcMain.handle("config:save-models", (_event, data: PiModelsFile) => configManager.saveModelsConfig(data));
    ipcMain.handle("config:save-auth", (_event, data: PiAuthFile) => configManager.saveAuthConfig(data));
    ipcMain.handle("config:save-settings", (_event, data: PiSettingsFile) => configManager.saveSettingsConfig(data));
    ipcMain.handle("config:save-raw", (_event, fileName: string, rawJson: string) =>
        configManager.saveRawConfig(fileName, rawJson),
    );
    ipcMain.handle("config:export", () => configManager.exportConfig());
    ipcMain.handle("config:import", (_event, packageJson: string) => configManager.importConfig(packageJson));
    ipcMain.handle("config:fetch-models", (_event, baseUrl: string, apiKey?: string, apiType?: string) =>
        configManager.fetchModels(baseUrl, apiKey, apiType),
    );
    ipcMain.handle("config:test-provider", (_event, input: { baseUrl: string; apiKey?: string; modelId?: string; apiType?: string; headers?: Record<string, string> }) =>
        configManager.testProviderConnection(input.baseUrl, input.apiKey, input.modelId, input.apiType, input.headers),
    );
}
