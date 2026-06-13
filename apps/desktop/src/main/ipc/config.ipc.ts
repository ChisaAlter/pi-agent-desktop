import { ipcMain } from "electron";
import { ipcError } from "@shared";
import type { ManagedModelDeleteInput, ManagedModelSaveInput, PiAuthFile, PiModelsFile, PiSettingsFile } from "@shared";
import type { ConfigManager } from "../services/config/config-manager";

// SSRF 防护: 只阻断云实例元数据端点，允许本地模型提供商（Ollama、LocalAI 等）
// 设计决策：Pi Desktop 用户经常在本地运行模型，阻止 localhost/private IP 会破坏正常使用。
// 真正的 SSRF 风险在于云提供商元数据端点，可泄露凭证。
function isSafeUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        // 只允许 http 和 https 协议
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const hostname = url.hostname.toLowerCase();
        // 阻止云实例元数据端点（SSRF 主要风险）
        const metadataHostnames = [
            "169.254.169.254",   // AWS / Azure / GCP 元数据
            "metadata.google.internal", // GCP 元数据
        ];
        if (metadataHostnames.includes(hostname)) return false;
        // 阻止 169.254.0.0/16 link-local 段（链路本地地址，包含云元数据）
        const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipv4Match) {
            const [, a] = ipv4Match.map(Number);
            if (a === 169) return false; // 169.254.0.0/16 链路本地（含云元数据）
        }
        return true;
    } catch {
        return false;
    }
}

export function setupConfigIpc(configManager: ConfigManager, opts: { onManagedModelsChanged?: () => void } = {}): void {
    const notifyIfValid = <T extends { valid: boolean }>(result: T): T => {
        if (result.valid) opts.onManagedModelsChanged?.();
        return result;
    };

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
    ipcMain.handle("config:test-provider", (_event, input: { baseUrl: string; apiKey?: string; modelId?: string; apiType?: string; headers?: Record<string, string> }) => {
        // SSRF 防护: 验证 URL 安全性
        if (!isSafeUrl(input.baseUrl)) {
            return ipcError(
                "ipcErrors.config.unsafeUrl",
                "不安全的 URL: 禁止访问云元数据地址或非 HTTP(S) 协议",
                { url: input.baseUrl },
            );
        }
        return configManager.testProviderConnection(input.baseUrl, input.apiKey, input.modelId, input.apiType, input.headers);
    });
}
