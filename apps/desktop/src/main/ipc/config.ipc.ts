import { BrowserWindow, ipcMain } from "electron";
import { ipcError } from "@shared";
import type { ManagedModelDeleteInput, ManagedModelSaveInput, PiAuthFile, PiModelsFile, PiSettingsFile } from "@shared";
import { z } from "zod";
import type { ConfigManager } from "../services/config/config-manager";
import { isSafeUrl } from "../services/ssrf-guard";

const describeImagesInputSchema = z.array(z.object({
    name: z.string().trim().min(1),
    dataUrl: z.string().trim().startsWith("data:"),
    mimeType: z.string().trim().min(1).optional(),
})).min(1).max(6);

export function setupConfigIpc(configManager: ConfigManager, opts: { onManagedModelsChanged?: () => void } = {}): void {
    // 生产分级通知：
    // - heavy: 模型清单/鉴权变更 → 重建 live session（贵）
    // - light: 仅默认模型切换 → 只广播 pi-config:changed，禁止 refreshWorkspace/disposeAll
    const notifyConfigChangedLight = (): void => {
        broadcastPiConfigChanged();
    };
    const notifyManagedModelsChangedHeavy = (): void => {
        opts.onManagedModelsChanged?.();
        broadcastPiConfigChanged();
    };
    const notifyIfValidHeavy = <T extends { valid: boolean }>(result: T): T => {
        if (result.valid) notifyManagedModelsChangedHeavy();
        return result;
    };
    const notifyIfValidLight = <T extends { valid: boolean }>(result: T): T => {
        if (result.valid) notifyConfigChangedLight();
        return result;
    };

    ipcMain.handle("config:get-models", () => configManager.getModelsConfigRedacted());
    ipcMain.handle("config:get-auth", () => configManager.getAuthConfigRedacted());
    ipcMain.handle("config:get-settings", () => configManager.getSettingsConfig());
    ipcMain.handle("config:save-models", async (_event, data: PiModelsFile) =>
        notifyIfValidHeavy(await configManager.saveModelsConfig(data)),
    );
    ipcMain.handle("config:save-auth", async (_event, data: PiAuthFile) =>
        notifyIfValidHeavy(await configManager.saveAuthConfig(data)),
    );
    ipcMain.handle("config:save-settings", async (_event, data: PiSettingsFile) =>
        notifyIfValidHeavy(await configManager.saveSettingsConfig(data)),
    );
    ipcMain.handle("config:save-raw", async (_event, fileName: string, rawJson: string) =>
        notifyIfValidHeavy(await configManager.saveRawConfig(fileName, rawJson)),
    );
    ipcMain.handle("config:export", () => configManager.exportConfigRedacted());
    ipcMain.handle("config:import", async (_event, packageJson: string) =>
        notifyIfValidHeavy(await configManager.importConfig(packageJson)),
    );
    ipcMain.handle("config:list-managed-models", () => configManager.listManagedModels());
    ipcMain.handle("config:save-managed-model", async (_event, input: ManagedModelSaveInput) =>
        notifyIfValidHeavy(await configManager.saveManagedModel(input)),
    );
    ipcMain.handle("config:delete-managed-model", async (_event, input: ManagedModelDeleteInput) =>
        notifyIfValidHeavy(await configManager.deleteManagedModel(input)),
    );
    // 关键：composer 选模型会走这里。绝不能触发 onManagedModelsChanged（会 refresh 全部 workspace + disposeAll）。
    ipcMain.handle("config:set-default-model", async (_event, providerId: string, modelId: string) =>
        notifyIfValidLight(await configManager.setDefaultModel(providerId, modelId)),
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
    ipcMain.handle("pi:describe-images", async (_event, rawImages: unknown) => {
        const parsed = describeImagesInputSchema.safeParse(rawImages);
        if (!parsed.success) {
            return ipcError("ipcErrors.config.invalidImages", "无效的图片输入", { issues: JSON.stringify(parsed.error.issues) });
        }
        return configManager.describeImages(parsed.data);
    });
}

function broadcastPiConfigChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("pi-config:changed");
        }
    }
}
