import { mkdir } from "fs/promises";
import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const configDir = `${userDataDir}-pi-config`;
    await mkdir(configDir, { recursive: true });
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: {
            ...process.env,
            CI: "1",
            ELECTRON_RENDERER_URL: "",
            PI_DESKTOP_CONFIG_DIR: configDir,
        },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

async function prepareWorkspace(page: Page, workspacePath: string): Promise<void> {
    await page.evaluate(async ({ workspacePath }) => {
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
        await window.piAPI.createWorkspace("settings-audit", workspacePath);
    }, { workspacePath });
    const onboardingModal = page.locator('[data-testid="onboarding-modal"]');
    if (await onboardingModal.count()) {
        await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
        await expect(onboardingModal).toHaveCount(0);
    }
}

async function openSettingsWindow(app: ElectronApplication, page: Page): Promise<Page> {
    const settingsWindowPromise = app.waitForEvent("window");
    await page.getByRole("tab", { name: "设置" }).click();
    const settingsWindow = await settingsWindowPromise;
    await settingsWindow.waitForLoadState("domcontentloaded");
    await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible();
    return settingsWindow;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body, "settings body should not have horizontal overflow").toBeLessThanOrEqual(2);
    expect(overflow.root, "settings root should not have horizontal overflow").toBeLessThanOrEqual(2);
}

async function expectVisibleButtonsUsable(page: Page): Promise<void> {
    const badButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.flatMap((button) => {
            const rect = button.getBoundingClientRect();
            const style = window.getComputedStyle(button);
            const text = (button.textContent ?? "").trim();
            const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            if (!visible) return [];
            const problems: string[] = [];
            if (rect.width < 20 || rect.height < 20) problems.push(`too small ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            if (text.length >= 2 && rect.width < 28) problems.push(`text button too narrow ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            if (text.length >= 3 && rect.height <= 48 && rect.width < rect.height * 1.2) problems.push(`looks vertical ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            return problems.length
                ? [{
                    name: button.getAttribute("aria-label") || text || button.id || button.className,
                    problems,
                }]
                : [];
        });
    });
    expect(badButtons).toEqual([]);
}

async function expectSettingsScrollerWorks(settingsWindow: Page): Promise<void> {
    const scrollRegion = settingsWindow.getByTestId("settings-scroll-region");
    await expect(scrollRegion).toBeVisible();
    const metrics = await scrollRegion.evaluate((element) => {
        const before = element.scrollTop;
        const canOverflow = element.scrollHeight > element.clientHeight + 4;
        element.scrollTop = element.scrollHeight;
        return {
            overflowY: window.getComputedStyle(element).overflowY,
            canOverflow,
            before,
            after: element.scrollTop,
            documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        };
    });
    expect(metrics.overflowY).toBe("auto");
    if (metrics.canOverflow) {
        expect(metrics.after, "settings content region should be scrollable when content overflows").toBeGreaterThan(metrics.before);
    }
    expect(metrics.documentOverflow, "settings window document should not own vertical scrolling").toBeLessThanOrEqual(4);
}

async function expectSoftInputFocus(locator: ReturnType<Page["locator"]>, label: string): Promise<void> {
    await locator.focus();
    const style = await locator.evaluate((element) => {
        const computed = window.getComputedStyle(element);
        return {
            borderColor: computed.borderColor,
            boxShadow: computed.boxShadow,
            outlineColor: computed.outlineColor,
            outlineStyle: computed.outlineStyle,
            outlineWidth: computed.outlineWidth,
        };
    });
    const blueFocusColors = new Set([
        "rgb(10, 104, 196)",
        "rgb(37, 99, 235)",
        "rgb(90, 167, 255)",
        "rgb(96, 165, 250)",
    ]);
    expect(blueFocusColors.has(style.borderColor), `${label} should not use a blue focus border`).toBe(false);
    expect(blueFocusColors.has(style.outlineColor), `${label} should not use a blue focus outline`).toBe(false);
    expect(style.outlineStyle === "none" || style.outlineWidth === "0px", `${label} should not show an outline`).toBe(true);
    expect(style.boxShadow, `${label} should show a soft focus shadow`).not.toBe("none");
}

async function installManagedModelsIpcStubs(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain }) => {
        type Model = {
            providerId: string;
            providerName: string;
            modelId: string;
            modelName: string;
            baseUrl?: string;
            apiType?: string;
            api?: string;
            contextWindow?: number;
            maxTokens?: number;
            reasoning?: boolean;
            source: "json";
            isDefault: boolean;
            hasApiKey: boolean;
            apiKeyPreview?: string;
        };
        type SaveInput = {
            originalProviderId?: string;
            originalModelId?: string;
            providerId: string;
            providerName?: string;
            baseUrl?: string;
            apiType?: string;
            api?: string;
            modelId: string;
            modelName?: string;
            contextWindow?: number;
            maxTokens?: number;
            reasoning?: boolean;
            setDefault?: boolean;
        };
        type DeleteInput = { providerId: string; modelId: string };
        type Event = { channel: string; providerId?: string; modelId?: string; modelName?: string; api?: string; apiType?: string };
        const target = globalThis as typeof globalThis & {
            __settingsModelEvents?: Event[];
            __settingsModels?: Model[];
        };
        target.__settingsModelEvents = [];
        target.__settingsModels = [{
            providerId: "stub_provider",
            providerName: "Stub Provider",
            modelId: "stub-model",
            modelName: "Stub Model",
            baseUrl: "https://stub.example.com/v1",
            apiType: "openai",
            contextWindow: 128000,
            maxTokens: 8192,
            reasoning: false,
            source: "json",
            isDefault: true,
            hasApiKey: true,
            apiKeyPreview: "sk-...stub",
        }];

        for (const channel of [
            "config:list-managed-models",
            "config:save-managed-model",
            "config:delete-managed-model",
            "config:test-provider",
            "config:get-auth",
        ]) {
            ipcMain.removeHandler(channel);
        }

        ipcMain.handle("config:list-managed-models", async () => ({
            configDir: "C:/test/pi-config",
            defaultProvider: target.__settingsModels?.find((model) => model.isDefault)?.providerId ?? "",
            defaultModel: target.__settingsModels?.find((model) => model.isDefault)?.modelId ?? "",
            models: target.__settingsModels ?? [],
        }));
        ipcMain.handle("config:get-auth", async () => ({
            raw: JSON.stringify({ stub_provider: { type: "api_key", key: "sk-stub" } }, null, 2),
            parsed: { stub_provider: { type: "api_key", key: "sk-stub" } },
        }));
        ipcMain.handle("config:test-provider", async (_event, input: { providerId?: string; modelId?: string }) => {
            target.__settingsModelEvents?.push({ channel: "config:test-provider", providerId: input.providerId, modelId: input.modelId });
            return { ok: true, status: 200, message: "连接成功" };
        });
        ipcMain.handle("config:save-managed-model", async (_event, input: SaveInput) => {
            target.__settingsModelEvents?.push({
                channel: "config:save-managed-model",
                providerId: input.providerId,
                modelId: input.modelId,
                modelName: input.modelName,
                api: input.api,
                apiType: input.apiType,
            });
            const nextModel: Model = {
                providerId: input.providerId,
                providerName: input.providerName ?? input.providerId,
                modelId: input.modelId,
                modelName: input.modelName ?? input.modelId,
                baseUrl: input.baseUrl,
                apiType: input.apiType ?? "openai",
                api: input.api,
                contextWindow: input.contextWindow,
                maxTokens: input.maxTokens,
                reasoning: Boolean(input.reasoning),
                source: "json",
                isDefault: Boolean(input.setDefault),
                hasApiKey: true,
                apiKeyPreview: "sk-...stub",
            };
            target.__settingsModels = (target.__settingsModels ?? [])
                .filter((model) => !(model.providerId === (input.originalProviderId ?? input.providerId) && model.modelId === (input.originalModelId ?? input.modelId)))
                .map((model) => ({ ...model, isDefault: input.setDefault ? false : model.isDefault }));
            target.__settingsModels.push(nextModel);
            return { valid: true };
        });
        ipcMain.handle("config:delete-managed-model", async (_event, input: DeleteInput) => {
            target.__settingsModelEvents?.push({ channel: "config:delete-managed-model", providerId: input.providerId, modelId: input.modelId });
            target.__settingsModels = (target.__settingsModels ?? [])
                .filter((model) => !(model.providerId === input.providerId && model.modelId === input.modelId));
            return { valid: true };
        });
    });
}

async function installPiConfigEditorIpcStubs(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain }) => {
        type ConfigEvent = { channel: string; fileName?: string; baseUrl?: string; apiKey?: string; apiType?: string; modelId?: string };
        const target = globalThis as typeof globalThis & {
            __settingsConfigEvents?: ConfigEvent[];
            __settingsConfigFiles?: Record<string, unknown>;
        };
        target.__settingsConfigEvents = [];
        target.__settingsConfigFiles = {
            "models.json": {
                providers: {
                    stub: {
                        name: "Stub Provider",
                        baseUrl: "https://stub.example.com/v1",
                        apiType: "responses",
                        models: [{ id: "stub-model", name: "Stub Model" }],
                    },
                },
            },
            "auth.json": { stub: { type: "api_key", key: "sk-config-stub" } },
            "settings.json": { defaultProvider: "stub", defaultModel: "stub-model" },
        };

        const readFile = (fileName: string, fallback: unknown): { raw: string; parsed: unknown } => {
            const parsed = target.__settingsConfigFiles?.[fileName] ?? fallback;
            return { raw: JSON.stringify(parsed, null, 2), parsed };
        };

        for (const channel of [
            "config:get-models",
            "config:get-auth",
            "config:get-settings",
            "config:save-raw",
            "config:export",
            "config:import",
            "config:fetch-models",
            "config:test-provider",
        ]) {
            ipcMain.removeHandler(channel);
        }

        ipcMain.handle("config:get-models", async () => readFile("models.json", { providers: {} }));
        ipcMain.handle("config:get-auth", async () => readFile("auth.json", {}));
        ipcMain.handle("config:get-settings", async () => readFile("settings.json", {}));
        ipcMain.handle("config:save-raw", async (_event, fileName: string, rawJson: string) => {
            target.__settingsConfigEvents?.push({ channel: "config:save-raw", fileName });
            target.__settingsConfigFiles = {
                ...(target.__settingsConfigFiles ?? {}),
                [fileName]: JSON.parse(rawJson) as unknown,
            };
            return { valid: true };
        });
        ipcMain.handle("config:export", async () => {
            target.__settingsConfigEvents?.push({ channel: "config:export" });
            return JSON.stringify({
                exportedAt: "2026-06-21T00:00:00.000Z",
                files: target.__settingsConfigFiles ?? {},
            }, null, 2);
        });
        ipcMain.handle("config:import", async (_event, packageJson: string) => {
            target.__settingsConfigEvents?.push({ channel: "config:import" });
            const parsed = JSON.parse(packageJson) as { files?: Record<string, unknown> };
            target.__settingsConfigFiles = parsed.files ?? {};
            return { valid: true };
        });
        ipcMain.handle("config:fetch-models", async (_event, baseUrl: string, apiKey?: string, apiType?: string) => {
            target.__settingsConfigEvents?.push({ channel: "config:fetch-models", baseUrl, apiKey, apiType });
            return [
                { id: "stub-model", name: "Stub Model" },
                { id: "stub-model-large", name: "Stub Model Large" },
            ];
        });
        ipcMain.handle("config:test-provider", async (_event, input: { baseUrl: string; apiKey?: string; apiType?: string; modelId?: string }) => {
            target.__settingsConfigEvents?.push({
                channel: "config:test-provider",
                baseUrl: input.baseUrl,
                apiKey: input.apiKey,
                apiType: input.apiType,
                modelId: input.modelId,
            });
            return { ok: true, status: 200, message: "连接成功" };
        });
    });
}

test.describe("Pi Desktop — settings window interaction audit", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // Ignore Electron shutdown races during test cleanup.
        } finally {
            app = undefined;
        }
    });

    test("all settings tabs switch, scroll, and expose usable controls", async () => {
        const userDataDir = test.info().outputPath(`settings-audit-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);

        const settingsWindow = await openSettingsWindow(app, page);
        const tabs = ["模型", "Agent", "权限", "用量", "长程能力", "界面", "通用", "快捷键", "配置文件", "关于"];

        for (const tabName of tabs) {
            const tab = settingsWindow.getByRole("tab", { name: tabName });
            await tab.click();
            await expect(tab).toHaveAttribute("aria-selected", "true");
            await expect(settingsWindow.locator('[role="tabpanel"]:visible')).toHaveCount(1);
            await expectNoHorizontalOverflow(settingsWindow);
            await expectVisibleButtonsUsable(settingsWindow);
        }

        await settingsWindow.getByRole("tab", { name: "配置文件" }).click();
        await expectSettingsScrollerWorks(settingsWindow);
    });

    test("settings controls can be toggled, selected, and edited", async () => {
        const userDataDir = test.info().outputPath(`settings-controls-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);

        const settingsWindow = await openSettingsWindow(app, page);

        await settingsWindow.getByRole("tab", { name: "权限" }).click();
        const fileWrite = settingsWindow.getByLabel("文件写入");
        const initialFileWrite = await fileWrite.isChecked();
        await fileWrite.setChecked(!initialFileWrite);
        await expect(fileWrite).toBeChecked({ checked: !initialFileWrite });
        await fileWrite.setChecked(initialFileWrite);
        await expect(fileWrite).toBeChecked({ checked: initialFileWrite });

        await settingsWindow.getByRole("tab", { name: "长程能力" }).click();
        const goalSwitch = settingsWindow.getByRole("switch", { name: "Goal / 停止条件" });
        const initialGoalState = await goalSwitch.getAttribute("aria-checked");
        await goalSwitch.click();
        await expect(goalSwitch).toHaveAttribute("aria-checked", initialGoalState === "true" ? "false" : "true");

        await settingsWindow.getByRole("tab", { name: "界面" }).click();
        await settingsWindow.getByRole("button", { name: "深色" }).click();
        await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "dark");
        await settingsWindow.getByLabel("字体大小").evaluate((input) => {
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            valueSetter?.call(input, "18");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await expect(settingsWindow.getByText("字体大小: 18px")).toBeVisible();

        await settingsWindow.getByRole("tab", { name: "通用" }).click();
        const autoSave = settingsWindow.getByRole("switch", { name: "自动保存" });
        const initialAutoSave = await autoSave.getAttribute("aria-checked");
        await autoSave.click();
        await expect(autoSave).toHaveAttribute("aria-checked", initialAutoSave === "true" ? "false" : "true");
        await settingsWindow.locator("#settings-language").selectOption("en-US");
        await expect(settingsWindow.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
        await settingsWindow.locator("#settings-language").selectOption("zh-CN");
        await expect(settingsWindow.getByRole("tab", { name: "通用" })).toHaveAttribute("aria-selected", "true");

        await settingsWindow.getByRole("tab", { name: "模型" }).click();
        await settingsWindow.getByRole("button", { name: "新增模型" }).click();
        await expect(settingsWindow.getByRole("dialog", { name: "模型编辑" })).toBeVisible();
        await settingsWindow.getByLabel("Provider ID").fill("audit_provider");
        await settingsWindow.getByLabel("Provider 名称").fill("Audit Provider");
        await settingsWindow.getByLabel("Base URL").fill("https://audit.example.com/v1");
        await settingsWindow.getByLabel("API Key").fill("sk-audit-test");
        await settingsWindow.getByLabel("模型 ID").fill("audit-model");
        await settingsWindow.getByLabel("模型名称").fill("Audit Model");
        await settingsWindow.getByLabel("推理模型").check();
        await expect(settingsWindow.getByLabel("推理模型")).toBeChecked();
        await settingsWindow.getByLabel("推理模型").uncheck();
        await expect(settingsWindow.getByLabel("推理模型")).not.toBeChecked();
        await settingsWindow.getByLabel("保存后设为默认").check();
        await expect(settingsWindow.getByLabel("保存后设为默认")).toBeChecked();
        await settingsWindow.getByRole("button", { name: "保存模型" }).click();
        await expect(settingsWindow.getByText("模型已保存")).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByText("Audit Model")).toBeVisible();
    });

    test("managed model dialog is fully visible and includes Anthropic API format", async () => {
        const userDataDir = test.info().outputPath(`settings-model-dialog-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);
        await installManagedModelsIpcStubs(app);

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "模型" }).click();
        await settingsWindow.getByTestId("settings-scroll-region").evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await settingsWindow.getByRole("button", { name: "新增模型" }).click();

        const dialog = settingsWindow.getByRole("dialog", { name: "模型编辑" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("新增模型")).toBeVisible();

        const visibility = await dialog.evaluate((element) => {
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const dialogRect = element.getBoundingClientRect();
            const controls = Array.from(element.querySelectorAll("label, button")).map((control) => {
                const rect = control.getBoundingClientRect();
                return {
                    text: (control.textContent ?? control.getAttribute("aria-label") ?? "").trim(),
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                    right: rect.right,
                };
            });
            return {
                viewport,
                dialog: {
                    top: dialogRect.top,
                    bottom: dialogRect.bottom,
                    left: dialogRect.left,
                    right: dialogRect.right,
                },
                clippedControls: controls.filter((control) =>
                    control.top < 0 ||
                    control.left < 0 ||
                    control.bottom > viewport.height ||
                    control.right > viewport.width
                ),
            };
        });

        expect(visibility.dialog.top, "dialog top should be inside the settings window").toBeGreaterThanOrEqual(0);
        expect(visibility.dialog.bottom, "dialog bottom should be inside the settings window").toBeLessThanOrEqual(visibility.viewport.height);
        expect(visibility.clippedControls, "dialog controls should not be clipped").toEqual([]);

        const apiOptions = await dialog.getByLabel("API 类型").locator("option").evaluateAll((options) =>
            options.map((option) => ({ label: option.textContent?.trim(), value: option.getAttribute("value") }))
        );
        expect(apiOptions).toEqual(expect.arrayContaining([
            { label: "OpenAI Chat Completions", value: "openai-completions" },
            { label: "OpenAI Responses", value: "openai-responses" },
            { label: "Anthropic Messages", value: "anthropic-messages" },
        ]));

        await expectSoftInputFocus(dialog.getByLabel("Provider ID"), "Provider ID input");
        await expectSoftInputFocus(dialog.getByLabel("API 类型"), "API type select");

        await dialog.getByLabel("API 类型").selectOption("anthropic-messages");
        await dialog.getByLabel("Provider ID").fill("anthropic");
        await dialog.getByLabel("Provider 名称").fill("Anthropic");
        await dialog.getByLabel("Base URL").fill("https://api.anthropic.com/v1");
        await dialog.getByLabel("API Key").fill("sk-ant-test");
        await dialog.getByLabel("模型 ID").fill("claude-sonnet-4-20250514");
        await dialog.getByLabel("模型名称").fill("Claude Sonnet 4");
        await dialog.getByRole("button", { name: "保存模型" }).click();
        await expect(settingsWindow.getByText("模型已保存")).toBeVisible({ timeout: 10_000 });

        const events = await app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __settingsModelEvents?: Array<{ channel: string; providerId?: string; modelId?: string; modelName?: string; api?: string; apiType?: string }>;
            };
            return target.__settingsModelEvents ?? [];
        });
        expect(events).toContainEqual(expect.objectContaining({
            channel: "config:save-managed-model",
            providerId: "anthropic",
            modelId: "claude-sonnet-4-20250514",
            api: "anthropic-messages",
        }));
    });

    test("managed model row buttons test, edit, cancel delete, and confirm delete", async () => {
        const userDataDir = test.info().outputPath(`settings-model-actions-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);
        await installManagedModelsIpcStubs(app);

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "模型" }).click();
        await expect(settingsWindow.getByText("Stub Model")).toBeVisible({ timeout: 10_000 });

        await settingsWindow.getByRole("button", { name: "测试 Stub Model" }).click();
        await expect(settingsWindow.getByText("连接成功")).toBeVisible({ timeout: 10_000 });

        await settingsWindow.getByRole("button", { name: "编辑 Stub Model" }).click();
        const editDialog = settingsWindow.getByRole("dialog", { name: "模型编辑" });
        await expect(editDialog).toBeVisible();
        await editDialog.getByLabel("模型名称").fill("Stub Model Edited");
        await editDialog.getByLabel("上下文窗口").fill("64000");
        await editDialog.getByLabel("最大输出 Token").fill("4096");
        await editDialog.getByLabel("推理模型").check();
        await editDialog.getByRole("button", { name: "保存模型" }).click();
        await expect(settingsWindow.getByText("模型已保存")).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByText("Stub Model Edited")).toBeVisible({ timeout: 10_000 });

        await settingsWindow.getByRole("button", { name: "删除 Stub Model Edited" }).click();
        const deleteDialog = settingsWindow.getByRole("dialog", { name: "删除模型确认" });
        await expect(deleteDialog).toBeVisible();
        await expect(deleteDialog).toContainText("stub_provider/stub-model");
        await deleteDialog.getByRole("button", { name: "取消" }).click();
        await expect(deleteDialog).toBeHidden({ timeout: 3000 });
        await expect(settingsWindow.getByText("Stub Model Edited")).toBeVisible();

        await settingsWindow.getByRole("button", { name: "删除 Stub Model Edited" }).click();
        await settingsWindow.getByRole("dialog", { name: "删除模型确认" }).getByRole("button", { name: "确认删除" }).click();
        await expect(settingsWindow.getByText("模型已删除")).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByText("Stub Model Edited")).toHaveCount(0);

        const events = await app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __settingsModelEvents?: Array<{ channel: string; providerId?: string; modelId?: string; modelName?: string; api?: string; apiType?: string }>;
            };
            return target.__settingsModelEvents ?? [];
        });
        expect(events).toContainEqual({ channel: "config:test-provider", providerId: "stub_provider", modelId: "stub-model" });
        expect(events).toContainEqual(expect.objectContaining({
            channel: "config:save-managed-model",
            providerId: "stub_provider",
            modelId: "stub-model",
            modelName: "Stub Model Edited",
        }));
        expect(events).toContainEqual({ channel: "config:delete-managed-model", providerId: "stub_provider", modelId: "stub-model" });
    });

    test("config editor buttons save, export, import, fetch models, and test provider", async () => {
        const userDataDir = test.info().outputPath(`settings-config-editor-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);
        await installPiConfigEditorIpcStubs(app);

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "配置文件" }).click();
        const editor = settingsWindow.getByLabel("Pi 配置 JSON");
        await expect(editor).toBeVisible({ timeout: 10_000 });
        await expect(editor).toContainText("Stub Provider");

        const editedModels = {
            providers: {
                stub: {
                    name: "Stub Provider Edited",
                    baseUrl: "https://stub.example.com/v1",
                    apiType: "responses",
                    models: [{ id: "stub-model", name: "Stub Model" }],
                },
            },
        };
        await editor.fill(JSON.stringify(editedModels, null, 2));
        await settingsWindow.getByRole("button", { name: "保存当前文件" }).click();
        await expect(settingsWindow.getByText("已保存，新的 Agent 或重启后的 Agent 会读取最新配置。")).toBeVisible({ timeout: 10_000 });

        await settingsWindow.getByRole("button", { name: "导出配置包" }).click();
        await expect(settingsWindow.getByText("已导出配置包，可复制保存或切换回具体文件继续编辑。")).toBeVisible({ timeout: 10_000 });
        await expect(editor).toContainText('"exportedAt"');

        const importPackage = {
            files: {
                "models.json": editedModels,
                "auth.json": { stub: { type: "api_key", key: "sk-config-stub" } },
                "settings.json": { defaultProvider: "stub", defaultModel: "stub-model" },
            },
        };
        await editor.fill(JSON.stringify(importPackage, null, 2));
        await settingsWindow.getByRole("button", { name: "从编辑区导入配置包" }).click();
        await expect(settingsWindow.getByText("已导入配置包。")).toBeVisible({ timeout: 10_000 });

        await editor.fill(JSON.stringify(editedModels, null, 2));
        await settingsWindow.getByRole("button", { name: "拉取模型列表" }).click();
        await expect(settingsWindow.getByText("拉取到 2 个模型")).toBeVisible({ timeout: 10_000 });
        await settingsWindow.getByRole("button", { name: "测试 Provider" }).click();
        await expect(settingsWindow.getByText("连接成功")).toBeVisible({ timeout: 10_000 });

        const events = await app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __settingsConfigEvents?: Array<{ channel: string; fileName?: string; baseUrl?: string; apiKey?: string; apiType?: string; modelId?: string }>;
            };
            return target.__settingsConfigEvents ?? [];
        });
        expect(events).toContainEqual({ channel: "config:save-raw", fileName: "models.json" });
        expect(events).toContainEqual({ channel: "config:export" });
        expect(events).toContainEqual({ channel: "config:import" });
        expect(events).toContainEqual({
            channel: "config:fetch-models",
            baseUrl: "https://stub.example.com/v1",
            apiKey: "sk-config-stub",
            apiType: "responses",
        });
        expect(events).toContainEqual({
            channel: "config:test-provider",
            baseUrl: "https://stub.example.com/v1",
            apiKey: "sk-config-stub",
            apiType: "responses",
            modelId: "stub-model",
        });
    });

    test("shortcuts can record, cancel, reset one, and reset all", async () => {
        const userDataDir = test.info().outputPath(`settings-shortcuts-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "快捷键" }).click();
        await expect(settingsWindow.getByText("快捷键设置")).toBeVisible();

        await settingsWindow.getByRole("button", { name: "修改" }).first().click();
        await expect(settingsWindow.getByText("按下新的快捷键...")).toBeVisible();
        await settingsWindow.getByRole("button", { name: "取消" }).click();
        await expect(settingsWindow.getByText("按下新的快捷键...")).toHaveCount(0);

        await settingsWindow.getByRole("button", { name: "修改" }).first().click();
        await settingsWindow.keyboard.press("Control+Shift+Y");
        await expect(settingsWindow.locator("kbd", { hasText: "Y" })).toHaveCount(1);
        await expect(settingsWindow.getByRole("button", { name: "重置全部" })).toBeVisible();

        await settingsWindow.getByRole("button", { name: "修改" }).nth(1).click();
        await settingsWindow.keyboard.press("Control+Alt+M");
        await expect(settingsWindow.locator("kbd", { hasText: "Alt" })).toHaveCount(1);
        await expect(settingsWindow.locator("kbd", { hasText: "M" })).toHaveCount(1);
        const resetOneButtons = settingsWindow.getByRole("button", { name: "重置", exact: true });
        await expect(resetOneButtons).toHaveCount(2);

        await resetOneButtons.first().click();
        await expect(resetOneButtons).toHaveCount(1);
        await settingsWindow.getByRole("button", { name: "重置全部" }).click();
        await expect(settingsWindow.getByRole("button", { name: "重置全部" })).toHaveCount(0);
        await expect(resetOneButtons).toHaveCount(0);
    });

    test("usage dashboard range filters and chart tooltips respond", async () => {
        const userDataDir = test.info().outputPath(`settings-usage-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace-main");
        const otherWorkspacePath = test.info().outputPath("workspace-other");
        await mkdir(workspacePath, { recursive: true });
        await mkdir(otherWorkspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await page.evaluate(async ({ workspacePath, otherWorkspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const now = Date.now();
            const main = await window.piAPI.createWorkspace("usage-main", workspacePath);
            const other = await window.piAPI.createWorkspace("usage-other", otherWorkspacePath);
            await window.piAPI.selectWorkspace(main.path);

            const current = await window.piAPI.createSession(main.id, "当前工作区高用量", "usage-current-active");
            await window.piAPI.updateSessionMetadata(current.id, {
                usage: {
                    provider: "anthropic",
                    model: "Claude Sonnet",
                    inputTokens: 80_000_000,
                    outputTokens: 40_000_000,
                    totalTokens: 120_000_000,
                    estimatedCostUsd: 12.4,
                    updatedAt: now,
                },
            });

            const archived = await window.piAPI.createSession(main.id, "当前工作区归档用量", "usage-current-archived");
            await window.piAPI.updateSessionMetadata(archived.id, {
                archived: true,
                usage: {
                    provider: "anthropic",
                    model: "Claude Haiku",
                    inputTokens: 20_000_000,
                    outputTokens: 10_000_000,
                    totalTokens: 30_000_000,
                    estimatedCostUsd: 1.8,
                    updatedAt: now,
                },
            });

            const otherSession = await window.piAPI.createSession(other.id, "其他工作区用量", "usage-other-active");
            await window.piAPI.updateSessionMetadata(otherSession.id, {
                usage: {
                    provider: "openai",
                    model: "GPT-4o",
                    inputTokens: 30_000_000,
                    outputTokens: 30_000_000,
                    totalTokens: 60_000_000,
                    estimatedCostUsd: 4.2,
                    updatedAt: now,
                },
            });
            await window.piAPI.selectWorkspace(main.path);
        }, { workspacePath, otherWorkspacePath });

        await page.reload();
        await page.waitForLoadState("domcontentloaded");

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "用量" }).click();
        await expect(settingsWindow.getByRole("tabpanel", { name: "用量" })).toBeVisible();
        await expect(settingsWindow.getByText("使用统计")).toBeVisible();
        await expect(settingsWindow.getByText("6000万", { exact: true }).first()).toBeVisible();

        await settingsWindow.getByRole("button", { name: "全部工作区" }).click();
        await expect(settingsWindow.getByText("1.8亿", { exact: true }).first()).toBeVisible();

        await settingsWindow.getByRole("button", { name: "含归档" }).click();
        await expect(settingsWindow.getByText("2.1亿", { exact: true }).first()).toBeVisible();

        await settingsWindow.getByRole("button", { name: "最近 7 天" }).click();
        await expect(settingsWindow.getByText("2.1亿", { exact: true }).first()).toBeVisible();

        await settingsWindow.getByRole("button", { name: "Claude Sonnet 模型用量详情" }).hover();
        await expect(settingsWindow.getByRole("tooltip")).toContainText("Claude Sonnet");
        await expect(settingsWindow.getByRole("tooltip")).toContainText("1.2亿 tokens");
        await expect(settingsWindow.getByRole("tooltip")).not.toContainText("预估费用");
        await expect(settingsWindow.getByRole("tooltip")).not.toContainText("$");

        await settingsWindow.getByRole("button", { name: /用量详情$/ }).first().hover();
        await expect(settingsWindow.getByRole("tooltip")).toBeVisible();
        await expect(settingsWindow.getByRole("tooltip")).not.toContainText("预估费用");
        await expect(settingsWindow.getByRole("tooltip")).not.toContainText("$");
    });
});
