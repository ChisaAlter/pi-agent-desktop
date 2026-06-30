import { mkdir } from "fs/promises";
import { join } from "path";
import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");

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
        window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
        window.localStorage.setItem("pi-desktop.locale", "zh-CN");
        await window.piAPI.createWorkspace("notification-settings", workspacePath);
    }, { workspacePath });

    const onboardingModal = page.locator('[data-testid="onboarding-modal"]');
    if (await onboardingModal.count()) {
        await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
        await expect(onboardingModal).toHaveCount(0);
    }
}

async function installGrantedNotificationMock(page: Page): Promise<void> {
    await page.context().addInitScript(() => {
        class MockNotification {
            static permission: NotificationPermission = "granted";
            static requestPermission(): Promise<NotificationPermission> {
                return Promise.resolve("granted");
            }
        }

        Object.defineProperty(window, "Notification", {
            value: MockNotification,
            configurable: true,
            writable: true,
        });
    });
}

async function openSettingsWindow(app: ElectronApplication, page: Page): Promise<Page> {
    const settingsWindowPromise = app.waitForEvent("window");
    await page.getByRole("tab", { name: "设置" }).click();
    const settingsWindow = await settingsWindowPromise;
    await settingsWindow.waitForLoadState("domcontentloaded");
    await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible({ timeout: 10_000 });
    await settingsWindow.getByRole("tab", { name: "通用" }).click();
    await expect(settingsWindow.getByText("通用设置")).toBeVisible({ timeout: 10_000 });
    return settingsWindow;
}

async function closeSettingsWindow(settingsWindow: Page): Promise<void> {
    const closeEvent = settingsWindow.waitForEvent("close");
    await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
    await closeEvent;
}

async function captureAcceptanceScreenshot(page: Page, fileName: string): Promise<void> {
    await mkdir(ACCEPTANCE_DIR, { recursive: true });
    await page.screenshot({
        path: join(ACCEPTANCE_DIR, fileName),
        animations: "disabled",
        fullPage: true,
    });
}

test.describe("notification settings", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // Ignore shutdown races.
        } finally {
            app = undefined;
        }
    });

    test("persists the system notification toggle across reopen and relaunch with real Electron screenshots", async () => {
        const userDataDir = test.info().outputPath(`notification-settings-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await installGrantedNotificationMock(page);
        await prepareWorkspace(page, workspacePath);

        let settingsWindow = await openSettingsWindow(app, page);
        const notificationSwitch = settingsWindow.getByRole("switch", { name: "系统通知" });
        await expect(notificationSwitch).toHaveAttribute("aria-checked", "true");

        await notificationSwitch.click();
        await expect(notificationSwitch).toHaveAttribute("aria-checked", "false");
        await captureAcceptanceScreenshot(settingsWindow, "2026-06-30-notification-settings-off.png");
        await closeSettingsWindow(settingsWindow);

        settingsWindow = await openSettingsWindow(app, page);
        await expect(settingsWindow.getByRole("switch", { name: "系统通知" })).toHaveAttribute("aria-checked", "false");
        await captureAcceptanceScreenshot(settingsWindow, "2026-06-30-notification-settings-reopen.png");
        await closeSettingsWindow(settingsWindow);

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await installGrantedNotificationMock(page);
        await prepareWorkspace(page, workspacePath);

        settingsWindow = await openSettingsWindow(app, page);
        await expect(settingsWindow.getByRole("switch", { name: "系统通知" })).toHaveAttribute("aria-checked", "false");
        await captureAcceptanceScreenshot(settingsWindow, "2026-06-30-notification-settings-relaunch.png");
    });
});
