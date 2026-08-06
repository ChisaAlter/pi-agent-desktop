import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { ipcError } from "@shared";
import type { AppSettings, ManagedModelDeleteInput, ManagedModelSaveInput, PiAuthFile, PiModelsFile, PiSettingsFile } from "@shared";
import { z } from "zod";
import type { ConfigManager } from "../services/config/config-manager";
import { isSafeUrl } from "../services/ssrf-guard";

const describeImagesInputSchema = z.array(z.object({
    name: z.string().trim().min(1),
    dataUrl: z.string().trim().startsWith("data:"),
    // mimeType 只是元数据, 实际识别用 dataUrl (自带 MIME 类型).
    // 真实剪贴板粘贴 (截图工具等) 的 DataTransferItem.type 可能是空字符串,
    // 校验 min(1) 会把合法的图拒之门外 — 只做类型检查即可.
    mimeType: z.string().optional(),
})).min(1).max(6);

export function setupConfigIpc(
    configManager: ConfigManager,
    opts: { onManagedModelsChanged?: () => void; getSettings?: () => AppSettings } = {},
): void {
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
            // 校验失败要能看到具体字段, 否则用户/日志只能看到笼统的"无效的图片输入"
            const issues = parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; ");
            log.warn("[config.ipc] describe-images invalid input:", issues);
            return ipcError("ipcErrors.config.invalidImages", `无效的图片输入 (${issues})`, { issues });
        }
        // 输入摘要 (不含图片内容) — 帮助定位用户侧传参问题
        log.info("[config.ipc] describe-images input:", parsed.data.map((image) => ({
            name: image.name,
            mimeType: image.mimeType ?? null,
            dataUrlPrefix: image.dataUrl.slice(0, 40),
        })));
        // 未显式配置识图模型时, 回退到桌面设置的识图模型, 再回退到当前对话模型 —
        // 保证多数支持多模态的模型开箱即用, 而不是把用户堵在"请先设置识图模型"的死路上。
        // 注意: 识图 provider/model 必须成对出现才算显式配置, 半配状态会混搭出无效模型。
        const app = opts.getSettings?.();
        let fallback: { providerId: string; modelId: string } | undefined;
        if (app) {
            const visionProvider = app.visionProvider?.trim() || "";
            const visionModel = app.visionModel?.trim() || "";
            const hasVisionConfig = Boolean(visionProvider && visionModel);
            const providerId = hasVisionConfig ? visionProvider : app.provider?.trim() || "";
            const modelId = hasVisionConfig ? visionModel : app.model?.trim() || "";
            if (providerId && modelId) fallback = { providerId, modelId };
        }
        try {
            return await configManager.describeImages(parsed.data, fallback);
        } catch (err) {
            // 记录完整堆栈到日志, 避免错误条只能显示误导性的摘要
            log.error("[config.ipc] describeImages failed:", err);
            const message = err instanceof Error ? err.message : String(err);
            return ipcError("ipcErrors.config.visionFailed", `识图失败: ${message}`);
        }
    });
}

function broadcastPiConfigChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("pi-config:changed");
        }
    }
}
