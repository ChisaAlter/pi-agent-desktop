import { mkdir } from "fs/promises";
import { expect, test, _electron, type ElectronApplication, type Page } from "@playwright/test";
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
        await window.piAPI.createWorkspace("updater-audit", workspacePath);
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
    return settingsWindow;
}

async function installUpdaterIpcStubs(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
        type UpdaterState = {
            phase: string;
            currentVersion: string;
            latestVersion: string | null;
            updateAvailable: boolean;
            releaseNotes: string | null;
            progress: null | { percent: number; bytesPerSecond: number; transferred: number; total: number };
            lastCheckedAt: number | null;
            disabledReason: string | null;
            error: string | null;
            releasePageUrl: string;
        };
        const target = globalThis as typeof globalThis & {
            __updaterInstallCount?: number;
            __updaterState?: UpdaterState;
            __updaterTimer?: ReturnType<typeof setTimeout>;
        };
        const broadcast = () => {
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                    win.webContents.send("updater:state-changed", target.__updaterState);
                }
            }
        };
        target.__updaterInstallCount = 0;
        target.__updaterState = {
            phase: "idle",
            currentVersion: "0.1.0",
            latestVersion: null,
            updateAvailable: false,
            releaseNotes: null,
            progress: null,
            lastCheckedAt: null,
            disabledReason: null,
            error: null,
            releasePageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest",
        };
        for (const channel of ["updater:get-state", "updater:check", "updater:download", "updater:install"]) {
            ipcMain.removeHandler(channel);
        }
        ipcMain.handle("updater:get-state", async () => target.__updaterState);
        ipcMain.handle("updater:check", async () => {
            target.__updaterState = {
                ...target.__updaterState!,
                phase: "available",
                latestVersion: "0.2.0",
                updateAvailable: true,
                releaseNotes: "Stubbed release notes for updater e2e",
                lastCheckedAt: Date.now(),
            };
            broadcast();
            return target.__updaterState;
        });
        ipcMain.handle("updater:download", async () => {
            target.__updaterState = {
                ...target.__updaterState!,
                phase: "downloading",
                progress: { percent: 35, bytesPerSecond: 1024, transferred: 35, total: 100 },
            };
            broadcast();
            if (target.__updaterTimer) clearTimeout(target.__updaterTimer);
            target.__updaterTimer = setTimeout(() => {
                target.__updaterState = {
                    ...target.__updaterState!,
                    phase: "downloaded",
                    progress: { percent: 100, bytesPerSecond: 0, transferred: 100, total: 100 },
                };
                broadcast();
            }, 250);
            return target.__updaterState;
        });
        ipcMain.handle("updater:install", async () => {
            target.__updaterInstallCount = (target.__updaterInstallCount ?? 0) + 1;
            return target.__updaterState;
        });
    });
}

test.describe("Pi Desktop updater flow", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // Ignore Electron shutdown races during cleanup.
        } finally {
            app = undefined;
        }
    });

    test("settings about tab drives updater actions and surfaces main-window notices", async () => {
        const userDataDir = test.info().outputPath(`updater-audit-${Date.now()}`);
        const workspacePath = test.info().outputPath("workspace");
        await mkdir(workspacePath, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await prepareWorkspace(page, workspacePath);
        await installUpdaterIpcStubs(app);

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "关于" }).click();

        await settingsWindow.getByRole("button", { name: "检查更新" }).click();
        await expect(settingsWindow.getByText("最新版本: 0.2.0")).toBeVisible();
        await expect(settingsWindow.getByText("Stubbed release notes for updater e2e")).toBeVisible();
        await expect(settingsWindow.getByRole("button", { name: "下载更新" })).toBeVisible();
        await expect(page.getByText("发现新版本 0.2.0，可在“关于”里下载更新。")).toBeVisible();
        await settingsWindow.screenshot({ path: test.info().outputPath("updater-available.png") });

        await settingsWindow.getByRole("button", { name: "下载更新" }).click();
        await expect(settingsWindow.getByText("35%")).toBeVisible();
        await settingsWindow.screenshot({ path: test.info().outputPath("updater-downloading.png") });
        await expect(settingsWindow.getByRole("button", { name: "重启并安装" })).toBeVisible();
        await expect(settingsWindow.getByText("100%")).toBeVisible();
        await expect(page.getByText("更新 0.2.0 已下载完成，可在“关于”里重启安装。")).toBeVisible();
        await settingsWindow.screenshot({ path: test.info().outputPath("updater-downloaded.png") });

        await settingsWindow.getByRole("button", { name: "重启并安装" }).click();
        const installCount = await app.evaluate(() => {
            return (globalThis as typeof globalThis & { __updaterInstallCount?: number }).__updaterInstallCount ?? 0;
        });
        expect(installCount).toBe(1);
    });
});
