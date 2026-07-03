/**
 * Terminal & Tools Tests — Pi Desktop 终端与工具集成
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const TEST_TIMEOUT = 60_000;

async function getWindowByUrl(app: ElectronApplication, urlPart: string): Promise<Page> {
    await expect.poll(async () => {
        return app.windows().some((candidate) => candidate.url().includes(urlPart));
    }, { timeout: 10_000 }).toBe(true);

    const page = app.windows().find((candidate) => candidate.url().includes(urlPart));
    if (!page) throw new Error(`Window page not found for ${urlPart}`);
    await page.waitForLoadState('domcontentloaded');
    return page;
}

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1', ELECTRON_RENDERER_URL: '' },
    });
    await app.firstWindow();
    const page = await getWindowByUrl(app, 'index.html');

    // Skip onboarding
    const modalCount = await page.locator('[data-testid="onboarding-modal"]').count();
    if (modalCount > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5000 });
        await page.waitForFunction(
            () => document.querySelector('[data-testid="onboarding-modal"]') === null,
            { timeout: 5000 }
        );
    }
    return { app, page };
}

async function windowState(app: ElectronApplication, urlPart: string): Promise<{ isMaximized: boolean; isMinimized: boolean; isDestroyed: boolean; bounds: { width: number; height: number } }> {
    return app.evaluate(({ BrowserWindow }, target) => {
        const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes(target));
        if (!win) throw new Error(`Window not found: ${target}`);
        return {
            isMaximized: win.isMaximized(),
            isMinimized: win.isMinimized(),
            isDestroyed: win.isDestroyed(),
            bounds: win.getBounds(),
        };
    }, urlPart);
}

async function restoreWindow(app: ElectronApplication, urlPart: string): Promise<void> {
    await app.evaluate(({ BrowserWindow }, target) => {
        const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes(target));
        if (!win || win.isDestroyed()) throw new Error(`Window not found: ${target}`);
        win.restore();
        win.show();
    }, urlPart);
}

async function installPermissionCapture(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain }) => {
        const target = globalThis as typeof globalThis & {
            __permissionResponses?: Array<{ requestId: string; response: unknown }>;
            __permissionCaptureInstalled?: boolean;
        };
        target.__permissionResponses = [];
        if (target.__permissionCaptureInstalled) return;
        target.__permissionCaptureInstalled = true;
        ipcMain.on("permission:respond", (_event, requestId: string, response: unknown) => {
            target.__permissionResponses?.push({ requestId, response });
        });
    });
}

async function emitPermissionRequest(
    app: ElectronApplication,
    request: { requestId: string; title: string; message?: string },
): Promise<void> {
    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find((item) => {
            try {
                return !item.isDestroyed() && item.webContents.getURL().includes("index.html");
            } catch {
                return false;
            }
        });
        if (!win) throw new Error("Main window not found for permission request injection");
        win.webContents.send("permission:request", {
            requestId: payload.requestId,
            kind: "select",
            source: "permission",
            title: payload.title,
            message: payload.message,
            createdAt: Date.now(),
        });
    }, request);
}

async function permissionResponses(app: ElectronApplication): Promise<Array<{ requestId: string; response: { requestId: string; decision: string } }>> {
    return app.evaluate(() => {
        const target = globalThis as typeof globalThis & {
            __permissionResponses?: Array<{ requestId: string; response: { requestId: string; decision: string } }>;
        };
        return target.__permissionResponses ?? [];
    });
}

async function expectTitlebarButtonsUsable(page: Page): Promise<void> {
    const buttons = page.locator('[data-mmcode-region="titlebar-right"] button');
    await expect(buttons).toHaveCount(3);
    const metrics = await buttons.evaluateAll((items) => items.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
            name: button.getAttribute("aria-label") ?? "",
            width: rect.width,
            height: rect.height,
        };
    }));
    for (const item of metrics) {
        expect(item.name).toBeTruthy();
        expect(item.width, `${item.name} width`).toBeGreaterThanOrEqual(30);
        expect(item.height, `${item.name} height`).toBeGreaterThanOrEqual(28);
    }
}

test.describe('Pi Desktop — Terminal & Tools', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('shortcuts cheatsheet opens and closes', async () => {
        const userDataDir = test.info().outputPath(`cheatsheet-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        await page.keyboard.press('Shift+?');
        await page.waitForTimeout(500);

        const cheatsheet = page.getByRole('dialog').filter({ hasText: '快捷键' });
        await expect(cheatsheet).toBeVisible({ timeout: 3000 });

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await expect(cheatsheet).toBeHidden({ timeout: 3000 });

        await app.close();
    });

    test('settings window opens and all tabs clickable', async () => {
        const userDataDir = test.info().outputPath(`settings-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        const settingsWindowPromise = app.waitForEvent('window');
        await page.getByRole('tab', { name: '设置' }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');

        // Get tabs
        const tabs = settingsWindow.locator('[role="tab"]');
        const tabCount = await tabs.count();
        expect(tabCount).toBe(10);
        console.log(`[TEST] Settings has ${tabCount} tabs`);

        // Click each tab
        for (let i = 0; i < tabCount; i++) {
            await tabs.nth(i).click();
            await settingsWindow.waitForTimeout(200);
            await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
        }

        const settingsClosed = settingsWindow.waitForEvent('close');
        await settingsWindow.getByRole('button', { name: '关闭窗口' }).click();
        await settingsClosed;

        await app.close();
    });

    test('main and settings titlebar window controls are clickable and correctly sized', async () => {
        const userDataDir = test.info().outputPath(`window-controls-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        await expectTitlebarButtonsUsable(page);

        const initialMainBounds = (await windowState(app, 'index.html')).bounds;
        await page.locator('[data-mmcode-region="titlebar-right"] button[aria-label="最大化"]').click();
        await expect(page.locator('[data-mmcode-region="titlebar-right"] button[aria-label="取消最大化"]')).toBeVisible();
        await expect.poll(async () => {
            const bounds = (await windowState(app, 'index.html')).bounds;
            return bounds.width * bounds.height;
        }).toBeGreaterThan(initialMainBounds.width * initialMainBounds.height);

        await page.locator('[data-mmcode-region="titlebar-right"] button[aria-label="取消最大化"]').click();
        await expect(page.locator('[data-mmcode-region="titlebar-right"] button[aria-label="最大化"]')).toBeVisible();
        await expect.poll(async () => {
            const bounds = (await windowState(app, 'index.html')).bounds;
            return bounds.width * bounds.height;
        }).toBeLessThan(initialMainBounds.width * initialMainBounds.height * 1.25);

        await page.locator('[data-mmcode-region="titlebar-right"] button[aria-label="最小化窗口"]').click();
        await expect.poll(async () => (await windowState(app, 'index.html')).isMinimized).toBe(true);
        await restoreWindow(app, 'index.html');
        await page.bringToFront();
        await expect.poll(async () => (await windowState(app, 'index.html')).isMinimized).toBe(false);

        const settingsWindowPromise = app.waitForEvent('window');
        await page.getByRole('tab', { name: '设置' }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');
        await expect(settingsWindow.getByRole('tablist', { name: '设置分类' })).toBeVisible();
        await expectTitlebarButtonsUsable(settingsWindow);

        const initialSettingsBounds = (await windowState(app, 'settings.html')).bounds;
        await settingsWindow.locator('[data-mmcode-region="titlebar-right"] button[aria-label="最大化"]').click();
        await expect(settingsWindow.locator('[data-mmcode-region="titlebar-right"] button[aria-label="取消最大化"]')).toBeVisible();
        await expect.poll(async () => {
            const bounds = (await windowState(app, 'settings.html')).bounds;
            return bounds.width * bounds.height;
        }).toBeGreaterThan(initialSettingsBounds.width * initialSettingsBounds.height);

        await settingsWindow.locator('[data-mmcode-region="titlebar-right"] button[aria-label="取消最大化"]').click();
        await expect(settingsWindow.locator('[data-mmcode-region="titlebar-right"] button[aria-label="最大化"]')).toBeVisible();
        await expect.poll(async () => {
            const bounds = (await windowState(app, 'settings.html')).bounds;
            return bounds.width * bounds.height;
        }).toBeLessThan(initialSettingsBounds.width * initialSettingsBounds.height * 1.25);

        await settingsWindow.locator('[data-mmcode-region="titlebar-right"] button[aria-label="关闭窗口"]').click();
        await expect.poll(async () => {
            return app.evaluate(({ BrowserWindow }) => {
                return BrowserWindow.getAllWindows().some((item) => {
                    try {
                        return !item.isDestroyed() && item.webContents.getURL().includes('settings.html');
                    } catch {
                        return false;
                    }
                });
            });
        }).toBe(false);

        await app.close();
    });

    test('tool permissions live in settings instead of the right rail', async () => {
        const userDataDir = test.info().outputPath(`tool-permissions-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        const expandRightRail = page.getByRole('button', { name: '展开右侧栏' });
        if (await expandRightRail.isVisible().catch(() => false)) {
            await expandRightRail.click();
        }

        await expect(page.getByRole('heading', { name: '工具权限' })).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath('right-rail-without-tool-permissions.png'), fullPage: true });

        const settingsWindowPromise = app.waitForEvent('window');
        await page.getByRole('tab', { name: '设置' }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');
        await settingsWindow.getByRole('tab', { name: '权限' }).click();
        await expect(settingsWindow.getByRole('heading', { name: '工具权限', exact: true })).toBeVisible({ timeout: 5000 });
        await expect(settingsWindow.getByLabel('网络')).toBeVisible();

        await app.close();
    });

    test('visible right rail actions open Files and Git panels', async () => {
        const userDataDir = test.info().outputPath(`rail-panels-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        const expandRightRail = page.getByRole('button', { name: '展开右侧栏' });
        if (await expandRightRail.isVisible().catch(() => false)) {
            await expandRightRail.click();
        }

        await page.getByRole('button', { name: '浏览全部文件' }).click();
        await expect(page.getByRole('region', { name: '文件工作区' })).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: test.info().outputPath('right-rail-visible-files-entry.png'), fullPage: true });

        await page.getByRole('tab', { name: '对话' }).click();
        if (await expandRightRail.isVisible().catch(() => false)) {
            await expandRightRail.click();
        }

        await page.getByRole('button', { name: /提交或推送/ }).click();
        await expect(page.getByRole('region', { name: 'Git 面板' })).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: test.info().outputPath('right-rail-visible-git-entry.png'), fullPage: true });

        await app.close();
    });

    test('runtime permission request card buttons respond and dismiss', async () => {
        const userDataDir = test.info().outputPath(`runtime-permissions-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);
        await installPermissionCapture(app);

        await emitPermissionRequest(app, {
            requestId: "perm_allow_session",
            title: "允许读取 package.json",
            message: "read package.json",
        });
        let dialog = page.getByRole("alertdialog", { name: "权限请求 1" });
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await expect(dialog).toContainText("允许读取 package.json");
        await dialog.getByRole("button", { name: "仅本对话" }).click();
        await expect(dialog).toHaveCount(0, { timeout: 5_000 });

        await emitPermissionRequest(app, {
            requestId: "perm_allow_always",
            title: "允许运行测试命令",
            message: "pnpm test",
        });
        dialog = page.getByRole("alertdialog", { name: "权限请求 1" });
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await dialog.getByRole("button", { name: "更多权限决策" }).click();
        await page.getByRole("menuitem", { name: /始终授权/ }).click();
        await expect(dialog).toHaveCount(0, { timeout: 5_000 });

        await emitPermissionRequest(app, {
            requestId: "perm_deny",
            title: "拒绝写入系统目录",
            message: "write C:\\Windows\\system32\\blocked.txt",
        });
        dialog = page.getByRole("alertdialog", { name: "权限请求 1" });
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0, { timeout: 5_000 });

        await expect.poll(async () => permissionResponses(app)).toEqual([
            { requestId: "perm_allow_session", response: { requestId: "perm_allow_session", decision: "allow_session" } },
            { requestId: "perm_allow_always", response: { requestId: "perm_allow_always", decision: "allow_always" } },
            { requestId: "perm_deny", response: { requestId: "perm_deny", decision: "deny" } },
        ]);

        await app.close();
    });

    test('sidebar toggle buttons stay top-aligned instead of centered', async () => {
        const userDataDir = test.info().outputPath(`sidebar-toggles-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        const leftToggle = page.getByRole('button', { name: '折叠左侧栏' });
        const rightToggle = page.getByRole('button', { name: '展开右侧栏' });
        await expect(leftToggle).toBeVisible({ timeout: 5000 });
        await expect(rightToggle).toBeVisible({ timeout: 5000 });

        const metrics = await page.evaluate(() => {
            const left = document.querySelector('button[aria-label="折叠左侧栏"]')?.getBoundingClientRect();
            const right = document.querySelector('button[aria-label="展开右侧栏"]')?.getBoundingClientRect();
            const body = document.querySelector('[data-mmcode-region="body"]')?.getBoundingClientRect();
            if (!left || !right || !body) return null;
            return {
                leftTop: left.top,
                rightTop: right.top,
                bodyTop: body.top,
                bodyHeight: body.height,
            };
        });

        expect(metrics).not.toBeNull();
        expect(Math.abs(metrics!.leftTop - metrics!.rightTop)).toBeLessThanOrEqual(1);
        expect(metrics!.leftTop - metrics!.bodyTop).toBeLessThanOrEqual(20);
        expect(metrics!.leftTop).toBeLessThan(metrics!.bodyTop + metrics!.bodyHeight / 3);

        await app.close();
    });
});
