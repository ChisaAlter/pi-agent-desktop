import { mkdir } from "fs/promises";
import { join } from "path";
import { test, expect, _electron, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

async function expectHealthyLayout(page: Page): Promise<void> {
    await expect(page.getByText("出错了")).toHaveCount(0);
    const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body, "body should not have horizontal overflow").toBeLessThanOrEqual(2);
    expect(overflow.root, "documentElement should not have horizontal overflow").toBeLessThanOrEqual(2);
}

async function screenshot(page: Page, dir: string, name: string): Promise<void> {
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
}

async function cssNumber(page: Page, variableName: string): Promise<number> {
    return page.evaluate((name) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)), variableName);
}

async function elementFontSize(locator: Locator): Promise<number> {
    return locator.first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

function relativeLuminance(color: string): number {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return 255;
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function expectDarkSurface(locator: Locator, label: string): Promise<void> {
    const color = await locator.first().evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(relativeLuminance(color), `${label} should be dark, got ${color}`).toBeLessThan(90);
}

async function expectLightSurface(locator: Locator, label: string): Promise<void> {
    const color = await locator.first().evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(relativeLuminance(color), `${label} should be light, got ${color}`).toBeGreaterThan(170);
}

async function expectNoLargeLightSurfaces(page: Page, label: string): Promise<void> {
    const offenders = await page.evaluate(() => {
        function parseColor(color: string): { luminance: number; alpha: number } | null {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
            if (!match) return null;
            const r = Number(match[1]);
            const g = Number(match[2]);
            const b = Number(match[3]);
            const alpha = match[4] === undefined ? 1 : Number(match[4]);
            return { luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b, alpha };
        }

        return Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const color = parseColor(getComputedStyle(element).backgroundColor);
                return {
                    tag: element.tagName.toLowerCase(),
                    text: element.textContent?.trim().slice(0, 60) ?? "",
                    className: String(element.className).slice(0, 180),
                    area: Math.round(rect.width * rect.height),
                    luminance: color?.luminance ?? 0,
                    alpha: color?.alpha ?? 0,
                    allowed: Boolean(element.closest("[data-allow-light-surface]")),
                    visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0,
                };
            })
            .filter((item) => item.visible && !item.allowed && item.alpha > 0.8 && item.area > 12_000 && item.luminance > 175)
            .sort((a, b) => b.area - a.area)
            .slice(0, 8);
    });
    expect(offenders, `${label} should not contain large light surfaces`).toEqual([]);
}

async function expectSingleSidebarCurrent(page: Page, label: string): Promise<void> {
    const currentItems = page.locator('nav[aria-label="会话列表"] button[aria-current="page"]');
    await expect(currentItems).toHaveCount(1);
    await expect(currentItems.first()).toHaveAttribute("aria-label", label);
}

async function expectTopTabSelected(page: Page, label: string): Promise<void> {
    await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
}

async function closeBlockingOverlays(page: Page): Promise<void> {
    const overlay = page.locator(".fixed.inset-0").first();
    for (let i = 0; i < 3; i += 1) {
        if (!(await overlay.isVisible().catch(() => false))) return;
        const closeSearch = page.getByRole("button", { name: "关闭搜索" });
        if (await closeSearch.isVisible().catch(() => false)) {
            await closeSearch.click();
        } else {
            await page.keyboard.press("Escape");
        }
        await expect(overlay).toBeHidden({ timeout: 5_000 });
    }
}

async function seedWorkspace(page: Page, workspaceName: string, workspacePath: string): Promise<void> {
    await page.evaluate(
        async ({ workspaceName, workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            const ws = await window.piAPI.createWorkspace(workspaceName, workspacePath);
            await window.piAPI.selectWorkspace?.(workspacePath);
            const session = await window.piAPI.createSession(ws.id, "主题巡检会话", `${workspaceName}-session`);
            await window.piAPI.appendMessage(session.id, {
                id: `${workspaceName}-user`,
                role: "user",
                content: "检查主题是否覆盖所有页面。",
                timestamp: new Date(Date.now() - 3_000).toISOString(),
            });
            await window.piAPI.appendMessage(session.id, {
                id: `${workspaceName}-assistant`,
                role: "assistant",
                content: "主题巡检内容已准备好，用于确认浅色和深色模式在主界面中同步。",
                timestamp: new Date(Date.now() - 2_000).toISOString(),
            });
        },
        { workspaceName, workspacePath },
    );
}

async function captureMainEntrypoints(page: Page, dir: string, prefix: string): Promise<void> {
    await page.bringToFront();
    await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
    await closeBlockingOverlays(page);
    const existingPalette = page.locator('[role="dialog"][aria-label*="命令面板"]');
    if (await existingPalette.isVisible().catch(() => false)) {
        await page.keyboard.press("Escape");
        await expect(existingPalette).toBeHidden({ timeout: 5_000 });
    }

    await page.locator('button[data-mmcode-section="new-task"]').click();
    await expect(page.locator('[data-testid="chat-input-shell"]')).toBeVisible();
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-01-new-task`);

    await page.getByRole("button", { name: "主题巡检会话", exact: true }).click({ position: { x: 24, y: 18 } });
    await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText("主题巡检内容");
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-02-chat`);

    await page.getByRole("tab", { name: "技能" }).click();
    await expectTopTabSelected(page, "技能");
    await expect(page.getByRole("region", { name: "插件面板" })).toBeVisible();
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-03-skills`);

    await page.getByRole("tab", { name: "Git" }).click();
    await expectTopTabSelected(page, "Git");
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-04-git`);

    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "files" } }));
    });
    await expect(page.getByText(/文件|选择文件|工作区/).first()).toBeVisible();
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-05-files`);

    await page.getByRole("tab", { name: "历史" }).click();
    await expectTopTabSelected(page, "历史");
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-06-history`);
    await closeBlockingOverlays(page);

    await page.keyboard.press("Control+k");
    const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
    await expect(palette).toBeVisible();
    await expectHealthyLayout(page);
    await screenshot(page, dir, `${prefix}-07-command-palette`);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden({ timeout: 5_000 });
}

test.describe("Pi Desktop — visual function audit", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // ignore cleanup failures in Electron shutdown
        } finally {
            app = undefined;
        }
    });

    test("major screens show polished, non-empty user-facing UI", async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("workspace");
        const screenshotDir = test.info().outputPath("visual-audit");
        await mkdir(screenshotDir, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                const ws = await window.piAPI.createWorkspace("visual-audit", workspacePath);
                const session = await window.piAPI.createSession(ws.id, "UI 巡检会话", "visual-audit-session");
                await window.piAPI.appendMessage(session.id, {
                    id: "visual-user",
                    role: "user",
                    content: "请检查这个桌面应用的主要界面是否正常展示。",
                    timestamp: new Date(Date.now() - 3_000).toISOString(),
                });
                await window.piAPI.appendMessage(session.id, {
                    id: "visual-assistant",
                    role: "assistant",
                    content: "主要界面已加载。这里是一段较长的回复，用来验证消息气泡的换行、间距、时间戳和工具摘要是否稳定。",
                    timestamp: new Date(Date.now() - 2_000).toISOString(),
                    toolCalls: [
                        {
                            id: "visual-tool",
                            name: "read",
                            status: "completed",
                            output: "C:/visual-audit/output.txt",
                            startTime: new Date(Date.now() - 2_500).toISOString(),
                            endTime: new Date(Date.now() - 2_200).toISOString(),
                        },
                    ],
                });
            },
            { workspacePath },
        );

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));

        await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole("tab", { name: "Git" })).toBeVisible();
        await expectHealthyLayout(page);
        await screenshot(page, screenshotDir, "01-initial-loaded");

        await page.locator('button[data-mmcode-section="new-task"]').click();
        await expect(page.getByText("输入消息后，Pi Agent 会在当前工作区开始运行。")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: /添加文件|添加附件/ })).toBeVisible();
        await expectHealthyLayout(page);
        await screenshot(page, screenshotDir, "02-new-task");

        await page.getByRole("button", { name: "UI 巡检会话", exact: true }).click();
        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText("请检查这个桌面应用");
        await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText("主要界面已加载");
        await expect(page.getByText("查看 1 个文件")).toBeVisible();
        await expectSingleSidebarCurrent(page, "UI 巡检会话");
        await expectHealthyLayout(page);
        await screenshot(page, screenshotDir, "03-session-detail");

        await page.getByRole("tab", { name: "技能" }).click();
        await expectTopTabSelected(page, "技能");
        await expect(page.getByRole("region", { name: "插件面板" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Pi 插件" })).toBeVisible();
        await expect(page.getByText("加载 Pi 插件市场...")).toBeHidden({ timeout: 30_000 });
        await expect(page.getByText(/spawn pi|Command failed|ENOENT/)).toHaveCount(0);
        await expect(page.locator('[role="alert"]')).toHaveCount(0);
        const firstInstallButton = page.getByRole("button", { name: /安装 / }).first();
        if (await firstInstallButton.count()) {
            const box = await firstInstallButton.boundingBox();
            expect(box?.width ?? 0, "Pi plugin install button should not collapse into vertical text").toBeGreaterThanOrEqual(56);
            expect(box?.height ?? 0, "Pi plugin install button should keep a compact horizontal shape").toBeLessThanOrEqual(34);
        }
        await expectHealthyLayout(page);
        await screenshot(page, screenshotDir, "04-skills");

        const settingsWindowPromise = app.waitForEvent("window");
        await page.getByRole("button", { name: "打开设置窗口" }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState("domcontentloaded");
        await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible();
        await expectHealthyLayout(settingsWindow);
        await screenshot(settingsWindow, screenshotDir, "05-settings");
        const settingsClosed = settingsWindow.waitForEvent("close");
        await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
        await settingsClosed;
        await page.bringToFront();

        await page.keyboard.press("Control+k");
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        await expect(palette).toBeVisible();
        await expect(palette.locator('input[aria-label="搜索命令"]')).toBeVisible();
        await expectHealthyLayout(page);
        await screenshot(page, screenshotDir, "06-command-palette");
    });

    test("dark theme keeps chrome and global composer on dark surfaces", async () => {
        const userDataDir = test.info().outputPath(`user-data-dark-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("dark-workspace");
        const screenshotDir = test.info().outputPath("dark-visual-audit");
        await mkdir(screenshotDir, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop-theme", "dark");
                document.documentElement.setAttribute("data-theme", "dark");
                await window.piAPI.setSettings({ theme: "dark" });
                await window.piAPI.createWorkspace("dark-visual-audit", workspacePath);
                await window.piAPI.selectWorkspace?.(workspacePath);
            },
            { workspacePath },
        );

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
        await page.locator('button[data-mmcode-section="new-task"]').click();
        await expect(page.locator('[data-testid="chat-input-shell"]')).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

        await expectDarkSurface(page.locator('[data-mmcode-layout="window-frame"]'), "window frame");
        await expectDarkSurface(page.locator('[data-mmcode-region="titlebar"]'), "title bar");
        await expectDarkSurface(page.locator('[data-mmcode-region="left"]'), "left sidebar");
        await expectDarkSurface(page.locator('[data-testid="chat-view-root"]'), "chat view");
        await expectDarkSurface(page.locator('[data-testid="chat-input-shell"]'), "global composer");
        await expectHealthyLayout(page);
        await screenshot(page, screenshotDir, "dark-new-task");
    });

    test("dark settings window keeps every settings tab on dark surfaces", async () => {
        const userDataDir = test.info().outputPath(`user-data-settings-dark-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("settings-dark-workspace");
        const screenshotDir = test.info().outputPath("settings-dark-visual-audit");
        await mkdir(screenshotDir, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await page.evaluate(
            async ({ workspacePath }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop-theme", "dark");
                document.documentElement.setAttribute("data-theme", "dark");
                await window.piAPI.setSettings({ theme: "dark" });
                await window.piAPI.createWorkspace("settings-dark-visual-audit", workspacePath);
                await window.piAPI.selectWorkspace?.(workspacePath);
            },
            { workspacePath },
        );

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });

        const settingsWindowPromise = app.waitForEvent("window");
        await page.getByRole("button", { name: "打开设置窗口" }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState("domcontentloaded");
        await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "dark");
        await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible();

        const tabLabels = ["模型", "Agent", "权限", "用量", "长程能力", "界面", "通用", "快捷键", "配置文件", "关于"];
        for (const label of tabLabels) {
            await settingsWindow.getByRole("tab", { name: label }).click();
            await expect(settingsWindow.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
            await expectDarkSurface(settingsWindow.locator('[data-mm-window-kind="settings"]'), `settings window ${label}`);
            await expectNoLargeLightSurfaces(settingsWindow, `settings tab ${label}`);
            await expectHealthyLayout(settingsWindow);
            await screenshot(settingsWindow, screenshotDir, `settings-dark-${label}`);
        }
    });

    test("settings theme changes propagate to all main surfaces and persist", async () => {
        const userDataDir = test.info().outputPath(`user-data-theme-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("theme-sync-workspace");
        const screenshotDir = test.info().outputPath("theme-sync-visual-audit");
        await mkdir(screenshotDir, { recursive: true });

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));
        await seedWorkspace(page, "theme-sync", workspacePath);
        await page.evaluate(async () => {
            window.localStorage.setItem("pi-desktop-theme", "dark");
            window.localStorage.setItem("pi-desktop-font-size", "14");
            document.documentElement.setAttribute("data-theme", "dark");
            document.documentElement.style.setProperty("--font-size-body", "14px");
            await window.piAPI.setSettings({ theme: "dark", fontSize: 14 });
        });

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

        const settingsWindowPromise = app.waitForEvent("window");
        await page.getByRole("button", { name: "打开设置窗口" }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState("domcontentloaded");
        await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible();
        await settingsWindow.getByRole("tab", { name: "界面" }).click();
        await expect(settingsWindow.getByRole("button", { name: "深色" })).toBeVisible();
        expect(await cssNumber(page, "--font-size-body")).toBe(14);
        expect(await cssNumber(settingsWindow, "--font-size-body")).toBe(14);

        await settingsWindow.getByRole("button", { name: "浅色" }).click();
        await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "light");
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await expectLightSurface(page.locator('[data-mmcode-layout="window-frame"]'), "light window frame");
        await expectLightSurface(page.locator('[data-mmcode-region="titlebar"]'), "light title bar");
        await expectLightSurface(page.locator('[data-mmcode-region="left"]'), "light left sidebar");
        await screenshot(settingsWindow, screenshotDir, "light-settings-appearance");
        await captureMainEntrypoints(page, screenshotDir, "light");

        await settingsWindow.bringToFront();
        await settingsWindow.locator("#settings-font-size").evaluate((element) => {
            const input = element as HTMLInputElement;
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            valueSetter?.call(input, "20");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await expect.poll(() => cssNumber(settingsWindow, "--font-size-body")).toBe(20);
        await expect.poll(() => cssNumber(page, "--font-size-body")).toBe(20);
        await page.bringToFront();
        await page.locator('button[data-mmcode-section="new-task"]').click();
        const scaledTextarea = page.locator('[data-testid="chat-input-shell"] textarea');
        await expect.poll(() => elementFontSize(scaledTextarea)).toBeGreaterThan(17);
        await screenshot(page, screenshotDir, "font-size-20-main");
        await settingsWindow.bringToFront();
        await screenshot(settingsWindow, screenshotDir, "font-size-20-settings");

        await settingsWindow.bringToFront();
        await settingsWindow.getByRole("button", { name: "深色" }).click();
        await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "dark");
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await expectDarkSurface(page.locator('[data-mmcode-layout="window-frame"]'), "dark window frame after click");
        await expectNoLargeLightSurfaces(page, "dark main window after click");
        await screenshot(settingsWindow, screenshotDir, "dark-settings-appearance");
        await captureMainEntrypoints(page, screenshotDir, "dark");

        await settingsWindow.bringToFront();
        await settingsWindow.getByRole("button", { name: "跟随系统" }).click();
        const resolvedSystemTheme = await settingsWindow.locator("html").getAttribute("data-theme");
        expect(resolvedSystemTheme === "light" || resolvedSystemTheme === "dark").toBe(true);
        await expect(page.locator("html")).toHaveAttribute("data-theme", resolvedSystemTheme ?? "");
        const storedTheme = await page.evaluate(() => window.piAPI.getSettings().then((settings) => settings.theme));
        expect(storedTheme).toBe("system");
        const storedFontSize = await page.evaluate(() => window.piAPI.getSettings().then((settings) => settings.fontSize));
        expect(storedFontSize).toBe(20);

        const settingsClosed = settingsWindow.waitForEvent("close");
        await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
        await settingsClosed;
        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
        const restartedTheme = await page.evaluate(() => window.piAPI.getSettings().then((settings) => settings.theme));
        expect(restartedTheme).toBe("system");
        const restartedFontSize = await page.evaluate(() => window.piAPI.getSettings().then((settings) => settings.fontSize));
        expect(restartedFontSize).toBe(20);
        await expect.poll(() => cssNumber(page, "--font-size-body")).toBe(20);
        const restartedResolvedTheme = await page.locator("html").getAttribute("data-theme");
        expect(restartedResolvedTheme === "light" || restartedResolvedTheme === "dark").toBe(true);
        await screenshot(page, screenshotDir, "system-restarted-main");
    });
});
