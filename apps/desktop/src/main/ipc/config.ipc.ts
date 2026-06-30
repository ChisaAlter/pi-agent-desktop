import { BrowserWindow, ipcMain } from "electron";
import { ipcError } from "@shared";
import type { ManagedModelDeleteInput, ManagedModelSaveInput, PiAuthFile, PiModelsFile, PiSettingsFile } from "@shared";
import type { ConfigManager } from "../services/config/config-manager";
import { isSafeUrl } from "../services/ssrf-guard";

export function setupConfigIpc(configManager: ConfigManager, opts: { onManagedModelsChanged?: () => void } = {}): void {
    const notifyIfValid = <T extends { valid: boolean }>(result: T): T => {
        if (result.valid) {
            opts.onManagedModelsChanged?.();
            broadcastPiConfigChanged();
        }
        return result;
    };

    ipcMain.handle("config:get-models", () => configManager.getModelsConfig());
    ipcMain.handle("config:get-auth", () => configManager.getAuthConfig());
    ipcMain.handle("config:get-settings", () => configManager.getSettingsConfig());
    ipcMain.handle("config:save-models", async (_event, data: PiModelsFile) =>
        notifyIfValid(await configManager.saveModelsConfig(data)),
    );
    ipcMain.handle("config:save-auth", async (_event, data: PiAuthFile) =>
        notifyIfValid(await configManager.saveAuthConfig(data)),
    );
    ipcMain.handle("config:save-settings", async (_event, data: PiSettingsFile) =>
        notifyIfValid(await configManager.saveSettingsConfig(data)),
    );
    ipcMain.handle("config:save-raw", async (_event, fileName: string, rawJson: string) =>
        notifyIfValid(await configManager.saveRawConfig(fileName, rawJson)),
    );
    ipcMain.handle("config:export", () => configManager.exportConfig());
    ipcMain.handle("config:import", async (_event, packageJson: string) =>
        notifyIfValid(await configManager.importConfig(packageJson)),
    );
    ipcMain.handle("config:list-managed-models", () => configManager.listManagedModels());
    ipcMain.handle("config:save-managed-model", async (_event, input: ManagedModelSaveInput) =>
        notifyIfValid(await configManager.saveManagedModel(input)),
    );
    ipcMain.handle("config:delete-managed-model", async (_event, input: ManagedModelDeleteInput) =>
        notifyIfValid(await configManager.deleteManagedModel(input)),
    );
    ipcMain.handle("config:set-default-model", async (_event, providerId: string, modelId: string) =>
        notifyIfValid(await configManager.setDefaultModel(providerId, modelId)),
    );
    ipcMain.handle("config:fetch-models", (_event, baseUrl: string, apiKey?: string, apiType?: string) => {
        // SSRF 防护: 验证 URL 安全性
        if (!isSafeUrl(baseUrl)) {
            return ipcError(
                "ipcErrors.config.unsafeUrl",
                "不安全的 URL: 禁止访问云元数据地址或非 HTTP(S) 协议",
                { url: baseUrl },
            );
        }
        return configManager.fetchModels(baseUrl, apiKey, apiType);
    });
    ipcMain.handle("config:test-provider", (_event, input: { baseUrl: string; providerId?: string; apiKey?: string; modelId?: string; apiType?: string; api?: string; headers?: Record<string, string> }) => {
        // SSRF 防护: 验证 URL 安全性
        if (!isSafeUrl(input.baseUrl)) {
            return ipcError(
                "ipcErrors.config.unsafeUrl",
                "不安全的 URL: 禁止访问云元数据地址或非 HTTP(S) 协议",
                { url: input.baseUrl },
            );
        }
        return configManager.testProviderConnection(input.baseUrl, input.apiKey, input.modelId, input.apiType, input.headers, {
            providerId: input.providerId,
            api: input.api,
        });
    });
}

function broadcastPiConfigChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("pi-config:changed");
        }
    }
}
