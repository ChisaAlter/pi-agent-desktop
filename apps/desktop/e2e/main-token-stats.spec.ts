import { mkdirSync } from "fs";
import { join } from "path";
import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

const SCREENSHOT_DIR = join(__dirname, "..", "e2e-output", "main-token-stats");
const SESSION_ID = "main-token-stats-session";
const SESSION_TITLE = "主页面 Token 验收";

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const configDir = `${userDataDir}-pi-config`;
    mkdirSync(configDir, { recursive: true });
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
    const page = await getWindowByUrl(app, "index.html");
    return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try {
        await app?.close();
    } catch {
        // Electron can already be closed by the time Playwright tears down.
    }
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function openRightRailIfNeeded(page: Page): Promise<void> {
    if (await page.getByTestId("right-rail-panel").count() > 0) return;
    await page.getByRole("button", { name: "展开右侧栏" }).first().click();
    await expect(page.getByTestId("right-rail-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Git 工具")).toBeVisible({ timeout: 10_000 });
}

async function openSettingsWindow(app: ElectronApplication, page: Page): Promise<Page> {
    const settingsWindowPromise = app.waitForEvent("window");
    await page.getByRole("button", { name: "打开设置" }).click();
    const settingsWindow = await settingsWindowPromise;
    await settingsWindow.waitForLoadState("domcontentloaded");
    await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible({ timeout: 10_000 });
    return settingsWindow;
}

test.describe("main page token presentation", () => {
    let app: ElectronApplication | undefined;

    test.setTimeout(90_000);

    test.afterEach(async () => {
        await closeApp(app);
        app = undefined;
    });

    test("keeps persisted usage in the header and settings but removes it from the right rail", async ({}, testInfo) => {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const userDataDir = testInfo.outputPath(`main-token-user-data-${Date.now()}`);
        const workspacePath = testInfo.outputPath("main-token-workspace");
        mkdirSync(workspacePath, { recursive: true });

        let launched = await launchApp(userDataDir);
        app = launched.app;
        let page = launched.page;

        await page.evaluate(async ({ sessionId, sessionTitle, workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const now = Date.now();
            const workspace = await window.piAPI.createWorkspace("main-token-workspace", workspacePath);
            await window.piAPI.selectWorkspace(workspace.path);
            const session = await window.piAPI.createSession(workspace.id, sessionTitle, sessionId);
            await window.piAPI.updateSessionMetadata(session.id, {
                usage: {
                    provider: "mimo",
                    model: "mimo-v2.5-pro",
                    inputTokens: 42_000_000,
                    outputTokens: 18_000_000,
                    totalTokens: 60_000_000,
                    updatedAt: now,
                },
            });
        }, { sessionId: SESSION_ID, sessionTitle: SESSION_TITLE, workspacePath });
        await expect.poll(async () => page.evaluate(async (sessionId) => {
            const sessions = await window.piAPI.listSessions();
            const session = sessions.find((item) => item.id === sessionId);
            return session?.usage?.totalTokens ?? 0;
        }, SESSION_ID), { timeout: 10_000 }).toBe(60_000_000);

        await closeApp(app);
        launched = await launchApp(userDataDir);
        app = launched.app;
        page = launched.page;
        await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
            win?.setSize(1440, 920);
        });
        await page.setViewportSize({ width: 1440, height: 920 });
        await skipOnboarding(page);

        const sidebar = page.getByRole("navigation", { name: "会话列表" });
        await sidebar.getByRole("button", { name: SESSION_TITLE, exact: true }).click();
        await expect(page.getByText(/Token:\s*60M/)).toBeVisible({ timeout: 10_000 });
        await page.screenshot({
            path: join(SCREENSHOT_DIR, "01-main-header-token.png"),
            fullPage: true,
        });

        await openRightRailIfNeeded(page);
        await expect(page.getByText("Git 工具")).toBeVisible();
        await expect(page.getByText("来源")).toHaveCount(0);
        // Progress only appears when there is a goal or plan checklist.
        await expect(page.getByTestId("right-rail-progress")).toHaveCount(0);
        await expect(page.getByText("Token 使用统计")).toHaveCount(0);
        await expect(page.getByText("总 Token")).toHaveCount(0);
        await expect(page.getByText("输入 Token")).toHaveCount(0);
        await expect(page.getByText("输出 Token")).toHaveCount(0);
        await expect(page.getByText("mimo/mimo-v2.5-pro")).toHaveCount(0);
        const utilityPanel = page.getByTestId("right-rail-panel");
        await expect(utilityPanel).toBeVisible();
        await page.screenshot({
            path: join(SCREENSHOT_DIR, "02-main-right-rail-compact.png"),
            fullPage: true,
        });
        await utilityPanel.screenshot({
            path: join(SCREENSHOT_DIR, "03-main-right-rail-closeup.png"),
        });

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "用量" }).click();
        await expect(settingsWindow.getByRole("tabpanel", { name: "用量" })).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByText("预估费用")).toHaveCount(0);
        await expect(settingsWindow.getByText(/\$\d/)).toHaveCount(0);
        await settingsWindow.screenshot({
            path: join(SCREENSHOT_DIR, "04-settings-usage-no-cost.png"),
            fullPage: true,
        });
        await settingsWindow.getByRole("button", { name: "mimo-v2.5-pro 模型用量详情" }).hover();
        await expect(settingsWindow.getByRole("tooltip")).toContainText("mimo-v2.5-pro");
        await expect(settingsWindow.getByRole("tooltip")).not.toContainText("预估费用");
        await expect(settingsWindow.getByRole("tooltip")).not.toContainText("$");
        await settingsWindow.screenshot({
            path: join(SCREENSHOT_DIR, "05-settings-tooltip-no-cost.png"),
            fullPage: true,
        });
        await settingsWindow.close();
    });
});
