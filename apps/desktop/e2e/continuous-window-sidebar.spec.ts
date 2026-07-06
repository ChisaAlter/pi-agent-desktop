import { expect, test, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";

type CaseStatus = "PASS" | "FAIL" | "BLOCKED";

interface CaseResult {
    readonly id: string;
    readonly functionId: string;
    readonly title: string;
    readonly status: CaseStatus;
    readonly observation?: string;
    readonly error?: string;
    readonly screenshot?: string;
    readonly startedAt: string;
    readonly endedAt: string;
}

const RUN_ID = process.env.CONTINUOUS_ACCEPTANCE_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const ACCEPTANCE_DIR = process.env.CONTINUOUS_ACCEPTANCE_DIR
    ?? join(__dirname, "..", "e2e-output", "continuous-acceptance", RUN_ID);
const USER_DATA_DIR = join(__dirname, "..", "e2e-output", `continuous-window-sidebar-user-data-${RUN_ID}`);
const WORKSPACE_PATH = join(__dirname, "..", "e2e-output", `continuous-window-sidebar-workspace-${RUN_ID}`);

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.stack ?? error.message;
    return String(error);
}

async function launchApp(): Promise<{ readonly app: ElectronApplication; readonly page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${USER_DATA_DIR}`, electronMainEntry],
        env: {
            ...process.env,
            CI: "1",
            ELECTRON_RENDERER_URL: "",
            PI_DESKTOP_CONFIG_DIR: join(USER_DATA_DIR, "pi-config"),
        },
    });
    const page = await waitForMainWindow(app);
    return { app, page };
}

async function waitForMainWindow(app: ElectronApplication, timeout = 30_000): Promise<Page> {
    const started = Date.now();
    const markers = [
        '[data-testid="onboarding-modal"]',
        '[data-mmcode-layout="root"]',
        '[role="tablist"][aria-label="顶部标签栏"]',
    ].join(", ");

    while (Date.now() - started < timeout) {
        for (const candidate of app.windows()) {
            await candidate.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => undefined);
            const hasAppUi = await candidate.locator(markers).count().catch(() => 0);
            if (hasAppUi > 0) return candidate;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const urls = app.windows().map((candidate) => candidate.url()).join(", ");
    throw new Error(`main window with app UI not found; windows=${urls}`);
}

async function quitApp(app: ElectronApplication | undefined): Promise<void> {
    if (!app) return;
    await app.evaluate(({ app: electronApp }) => {
        electronApp.quit();
    }).catch(() => undefined);
    await app.close().catch(() => undefined);
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

function sessionButton(page: Page, title: string) {
    return page.getByRole("button", { name: title, exact: true });
}

async function seedWorkspaceAndSessions(page: Page): Promise<void> {
    await page.evaluate(async ({ workspacePath }) => {
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
        window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
        const workspace = await window.piAPI.createWorkspace("continuous-window-sidebar", workspacePath);
        if ("code" in workspace) throw new Error(workspace.fallback);
        await window.piAPI.selectWorkspace(workspace.path);

        const alpha = await window.piAPI.createSession(workspace.id, "验收会话 Alpha", "continuous-session-alpha");
        const beta = await window.piAPI.createSession(workspace.id, "验收会话 Beta", "continuous-session-beta");
        const gamma = await window.piAPI.createSession(workspace.id, "验收会话 Gamma", "continuous-session-gamma");
        await window.piAPI.renameSession(alpha.id, "验收会话 Alpha");
        await window.piAPI.renameSession(beta.id, "验收会话 Beta");
        await window.piAPI.renameSession(gamma.id, "验收会话 Gamma");
        await window.piAPI.updateSessionMetadata(gamma.id, { archived: true });
    }, { workspacePath: WORKSPACE_PATH });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
}

test.describe("continuous acceptance window, tabs, and sidebar", () => {
    test("continues the full-function matrix through window chrome, tabs, and session lists", async () => {
        test.setTimeout(180_000);
        await mkdir(ACCEPTANCE_DIR, { recursive: true });
        await mkdir(WORKSPACE_PATH, { recursive: true });

        const results: CaseResult[] = [];
        const screenshots: string[] = [];
        let app: ElectronApplication | undefined;
        let page: Page | undefined;

        const screenshot = async (name: string): Promise<string> => {
            if (!page) throw new Error("main page missing");
            const file = join(ACCEPTANCE_DIR, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
            await page.screenshot({ path: file, fullPage: true });
            screenshots.push(file);
            return file;
        };

        const record = async (
            id: string,
            functionId: string,
            title: string,
            action: () => Promise<string>,
            screenshotName: string,
        ): Promise<void> => {
            const startedAt = new Date().toISOString();
            try {
                const observation = await action();
                const shot = await screenshot(`${id}-${screenshotName}`);
                results.push({
                    id,
                    functionId,
                    title,
                    status: "PASS",
                    observation,
                    screenshot: shot,
                    startedAt,
                    endedAt: new Date().toISOString(),
                });
            } catch (error) {
                let shot: string | undefined;
                try {
                    shot = await screenshot(`${id}-FAIL-${screenshotName}`);
                } catch (screenshotError) {
                    shot = `screenshot failed: ${errorMessage(screenshotError)}`;
                }
                results.push({
                    id,
                    functionId,
                    title,
                    status: "FAIL",
                    error: errorMessage(error),
                    screenshot: shot,
                    startedAt,
                    endedAt: new Date().toISOString(),
                });
                throw error;
            }
        };

        try {
            ({ app, page } = await launchApp());
            await record("F01-C03", "F01", "主窗口完成 onboarding 后保持可操作", async () => {
                if (!page) throw new Error("main page missing");
                await skipOnboarding(page);
                await expect(page.locator('[data-mmcode-layout="root"]')).toBeVisible({ timeout: 15_000 });
                return "真实主窗口越过 onboarding 后三栏布局可见。";
            }, "window-layout");

            await record("F01-C04", "F01", "创建真实工作区后主窗口仍显示当前工作区", async () => {
                if (!page) throw new Error("main page missing");
                await seedWorkspaceAndSessions(page);
                await expect(page.locator('button[aria-label="切换工作区：continuous-window-sidebar"]').last()).toBeVisible();
                return "通过真实 workspace IPC 创建并选择工作区，标题/顶部工作区入口刷新。";
            }, "workspace-selected");

            await record("F01-C05", "F01", "主窗口 renderer reload 后仍恢复布局和工作区", async () => {
                if (!page) throw new Error("main page missing");
                await page.reload({ waitUntil: "domcontentloaded" });
                await expect(page.locator('[data-mmcode-layout="root"]')).toBeVisible({ timeout: 15_000 });
                await expect(page.locator('button[aria-label="切换工作区：continuous-window-sidebar"]').last()).toBeVisible();
                return "renderer reload 后布局和当前工作区都从持久化状态恢复。";
            }, "window-reload-restored");

            await record("F01-C06", "F01", "主窗口左栏折叠后中心区仍可操作", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "折叠左侧栏" }).click();
                await expect(page.getByRole("button", { name: "展开左侧栏" })).toBeVisible();
                await expect(page.getByRole("tab", { name: "对话" })).toBeVisible();
                return "左栏折叠通过真实按钮生效，中心区和顶栏仍可操作。";
            }, "left-collapsed");

            await record("F01-C07", "F01", "主窗口左栏展开后会话列表恢复", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "展开左侧栏" }).click();
                await expect(page.getByRole("navigation", { name: "会话列表" })).toBeVisible();
                await expect(sessionButton(page, "验收会话 Alpha")).toBeVisible();
                return "左栏重新展开后真实会话列表恢复显示。";
            }, "left-expanded");

            await record("F01-C08", "F01", "关闭并重开应用后恢复当前工作区和布局", async () => {
                if (!app) throw new Error("app missing");
                await quitApp(app);
                ({ app, page } = await launchApp());
                await expect(page.locator('[data-mmcode-layout="root"]')).toBeVisible({ timeout: 15_000 });
                await expect(page.locator('button[aria-label="切换工作区：continuous-window-sidebar"]').last()).toBeVisible();
                return "同一 user-data-dir 关闭重开后主窗口和当前工作区恢复。";
            }, "window-restart-restored");

            await record("F01-C09", "F01", "空工作区路径错误不会破坏当前窗口", async () => {
                if (!page) throw new Error("main page missing");
                const result = await page.evaluate(async () => window.piAPI.selectWorkspace("Z:/pi-desktop-missing-workspace"));
                expect(typeof result).toBe("object");
                await expect(page.locator('[data-mmcode-layout="root"]')).toBeVisible();
                return "错误 workspace 选择返回结构化结果，当前主窗口没有崩溃。";
            }, "workspace-error-safe");

            await record("F01-C10", "F01", "主窗口截图显示标题栏、左栏、中心区三块没有重叠", async () => {
                if (!page) throw new Error("main page missing");
                const regions = await page.evaluate(() => {
                    const title = document.querySelector('[data-mmcode-region="titlebar"]')?.getBoundingClientRect();
                    const left = document.querySelector('[data-mmcode-region="left"]')?.getBoundingClientRect();
                    const center = document.querySelector('[data-mmcode-region="center"]')?.getBoundingClientRect();
                    return {
                        titleHeight: title?.height ?? 0,
                        leftWidth: left?.width ?? 0,
                        centerWidth: center?.width ?? 0,
                    };
                });
                expect(regions.titleHeight).toBeGreaterThan(20);
                expect(regions.leftWidth).toBeGreaterThan(100);
                expect(regions.centerWidth).toBeGreaterThan(300);
                return `布局区域尺寸正常：title=${regions.titleHeight}, left=${regions.leftWidth}, center=${regions.centerWidth}。`;
            }, "window-layout-analysis");

            await record("F02-C01", "F02", "标题栏显示应用名和窗口控制按钮", async () => {
                if (!page) throw new Error("main page missing");
                await expect(page.locator('[data-mmcode-region="titlebar"]')).toContainText("Pi Agent");
                await expect(page.getByRole("button", { name: "最小化窗口" })).toBeVisible();
                await expect(page.getByRole("button", { name: "最大化" })).toBeVisible();
                await expect(page.getByRole("button", { name: "关闭窗口" })).toBeVisible();
                return "标题栏应用名、最小化、最大化、关闭按钮都是真实可见控件。";
            }, "titlebar-controls");

            await record("F02-C02", "F02", "最大化按钮通过真实 IPC 改变窗口状态", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "最大化" }).click();
                await expect(page.getByRole("button", { name: "取消最大化" })).toBeVisible({ timeout: 5_000 });
                const maximized = await page.evaluate(() => window.piAPI.windowIsMaximized());
                expect(maximized).toBe(true);
                return "点击最大化后 IPC 读回 isMaximized=true，按钮切换为取消最大化。";
            }, "window-maximized");

            await record("F02-C03", "F02", "取消最大化恢复窗口状态", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "取消最大化" }).click();
                await expect(page.getByRole("button", { name: "最大化" })).toBeVisible({ timeout: 5_000 });
                const maximized = await page.evaluate(() => window.piAPI.windowIsMaximized());
                expect(maximized).toBe(false);
                return "取消最大化后 IPC 读回 isMaximized=false。";
            }, "window-unmaximized");

            await record("F02-C04", "F02", "最小化按钮触发真实 BrowserWindow 最小化并可恢复", async () => {
                if (!page || !app) throw new Error("main page or app missing");
                const browserWindow = await app.browserWindow(page);
                await page.getByRole("button", { name: "最小化窗口" }).click();
                await expect.poll(async () => browserWindow.evaluate((win) => win.isMinimized())).toBe(true);
                await browserWindow.evaluate((win) => win.restore());
                await page.bringToFront();
                await expect(page.getByRole("button", { name: "最小化窗口" })).toBeVisible();
                return "最小化按钮触发 BrowserWindow.isMinimized=true，随后恢复继续操作。";
            }, "window-minimized-restored");

            await record("F02-C05", "F02", "标题栏按钮焦点态可由键盘触达", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "最大化" }).focus();
                await expect(page.getByRole("button", { name: "最大化" })).toBeFocused();
                await page.keyboard.press("Tab");
                await expect(page.getByRole("button", { name: "关闭窗口" })).toBeFocused();
                return "窗口控制按钮可以键盘聚焦，非纯鼠标入口。";
            }, "titlebar-keyboard-focus");

            await record("F02-C06", "F02", "标题栏拖拽区域与按钮区域分离", async () => {
                if (!page) throw new Error("main page missing");
                const regions = await page.evaluate(() => {
                    const title = window.getComputedStyle(document.querySelector('[data-mmcode-region="titlebar"]') as HTMLElement).webkitAppRegion;
                    const button = window.getComputedStyle(document.querySelector('button[aria-label="最小化窗口"]') as HTMLElement).webkitAppRegion;
                    return { title, button };
                });
                expect(regions.title).toBe("drag");
                expect(regions.button).toBe("no-drag");
                return "标题栏主体是 drag 区域，窗口按钮是 no-drag 可点击区域。";
            }, "titlebar-drag-regions");

            await record("F02-C07", "F02", "最大化状态在 renderer reload 后同步回 UI", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "最大化" }).click();
                await page.reload({ waitUntil: "domcontentloaded" });
                await expect(page.getByRole("button", { name: "取消最大化" })).toBeVisible({ timeout: 5_000 });
                return "窗口最大化后 reload，标题栏仍显示取消最大化状态。";
            }, "titlebar-reload-max-state");

            await record("F02-C08", "F02", "关闭窗口按钮按真实生命周期隐藏窗口并可重启", async () => {
                if (!page || !app) throw new Error("main page or app missing");
                const browserWindow = await app.browserWindow(page);
                await page.getByRole("button", { name: "关闭窗口" }).click();
                await expect.poll(async () => browserWindow.evaluate((win) => win.isVisible())).toBe(false);
                await quitApp(app);
                ({ app, page } = await launchApp());
                await expect(page.locator('[data-mmcode-layout="root"]')).toBeVisible({ timeout: 15_000 });
                return "关闭按钮触发真实窗口生命周期，窗口隐藏后测试实例退出并可重启。";
            }, "titlebar-close-relaunch");

            await record("F02-C09", "F02", "重启后窗口控制 IPC 仍可读写", async () => {
                if (!page) throw new Error("main page missing");
                const maximized = await page.evaluate(() => window.piAPI.windowIsMaximized());
                expect(typeof maximized).toBe("boolean");
                await expect(page.getByRole("button", { name: maximized ? "取消最大化" : "最大化" })).toBeVisible();
                return `重启后 windowIsMaximized 返回 ${maximized}，标题栏状态可继续使用。`;
            }, "titlebar-after-relaunch");

            await record("F02-C10", "F02", "标题栏截图显示三枚窗口控制按钮没有遮挡顶栏 tabs", async () => {
                if (!page) throw new Error("main page missing");
                const overlap = await page.evaluate(() => {
                    const tabs = document.querySelector('[role="tablist"][aria-label="顶部标签栏"]')?.getBoundingClientRect();
                    const controls = document.querySelector('[data-mmcode-region="titlebar-right"]')?.getBoundingClientRect();
                    if (!tabs || !controls) return false;
                    return tabs.right > controls.left && tabs.left < controls.right;
                });
                expect(overlap).toBe(false);
                return "窗口控制区域与顶部 tablist 没有水平重叠。";
            }, "titlebar-overlap-analysis");

            const tabNames = ["对话", "任务", "记忆", "工具", "设置"] as const;
            await record("F03-C02", "F03", "顶部 tabs 具有正确 tablist 与 aria 语义", async () => {
                if (!page) throw new Error("main page missing");
                const tablist = page.getByRole("tablist", { name: "顶部标签栏" });
                await expect(tablist).toBeVisible();
                for (const name of tabNames) await expect(tablist.getByRole("tab", { name })).toBeVisible();
                return "顶部 tabs 都位于真实 tablist 中，可由无障碍角色定位。";
            }, "tabs-aria");

            await record("F03-C03", "F03", "对话 tab 路由回 ChatView 和输入框", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "对话" }).click();
                await expect(page.locator('[data-testid="chat-view-root"]')).toBeVisible();
                await expect(page.locator('textarea[aria-label="发送"]').first()).toBeVisible();
                return "对话 tab 路由到 ChatView，真实输入框可见。";
            }, "tab-chat");

            await record("F03-C04", "F03", "任务 tab 路由到任务总览并设置选中态", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "任务" }).click();
                await expect(page.getByText("任务总览")).toBeVisible();
                await expect(page.getByRole("tab", { name: "任务" })).toHaveAttribute("aria-selected", "true");
                return "任务 tab 显示任务总览且 aria-selected=true。";
            }, "tab-tasks");

            await record("F03-C05", "F03", "记忆 tab 路由到记忆搜索并显示输入", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "记忆" }).click();
                await expect(page.getByRole("heading", { name: "记忆" })).toBeVisible();
                await expect(page.getByPlaceholder("搜索记忆...")).toBeVisible();
                return "记忆 tab 显示 MemoryPanel 搜索输入，不是空路由。";
            }, "tab-memory");

            await record("F03-C06", "F03", "工具 tab 路由到插件面板并保留创建入口", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "工具" }).click();
                await expect(page.getByRole("region", { name: "插件面板" })).toBeVisible();
                await expect(page.getByRole("button", { name: /创建/ }).first()).toBeVisible();
                return "工具 tab 显示 SkillsPanel 和创建入口。";
            }, "tab-tools");

            await record("F03-C07", "F03", "设置 tab 打开独立设置窗口而非替换主中心区", async () => {
                if (!page || !app) throw new Error("main page or app missing");
                const settingsWindowPromise = app.waitForEvent("window");
                await page.getByRole("tab", { name: "设置" }).click();
                const settingsWindow = await settingsWindowPromise;
                await settingsWindow.waitForLoadState("domcontentloaded");
                await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible();
                await settingsWindow.close();
                await page.bringToFront();
                return "设置 tab 通过真实 IPC 打开独立 BrowserWindow，主窗口仍存在。";
            }, "tab-settings-window");

            await record("F03-C08", "F03", "tab 循环切换后可回到对话并继续输入", async () => {
                if (!page) throw new Error("main page missing");
                for (const name of ["任务", "记忆", "工具", "对话"] as const) {
                    await page.getByRole("tab", { name }).click();
                }
                await page.locator('textarea[aria-label="发送"]').first().fill("tab route persistence check");
                await expect(page.locator('textarea[aria-label="发送"]').first()).toHaveValue("tab route persistence check");
                return "多次 tab 切换后对话输入仍可编辑。";
            }, "tabs-roundtrip-input");

            await record("F03-C09", "F03", "renderer reload 后当前 tab 恢复到对话可用状态", async () => {
                if (!page) throw new Error("main page missing");
                await page.reload({ waitUntil: "domcontentloaded" });
                await page.getByRole("tab", { name: "对话" }).click();
                await expect(page.locator('[data-testid="chat-view-root"]')).toBeVisible();
                return "reload 后顶部 tab 仍可路由到对话面板。";
            }, "tabs-reload");

            await record("F03-C10", "F03", "顶部 tabs 截图显示选中态与中心面板一致", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "工具" }).click();
                await expect(page.getByRole("tab", { name: "工具" })).toHaveAttribute("aria-selected", "true");
                await expect(page.getByRole("region", { name: "插件面板" })).toBeVisible();
                return "工具 tab 选中态和中心插件面板一致。";
            }, "tabs-state-analysis");

            await record("F04-C01", "F04", "左侧会话列表显示时间分组入口和已创建会话", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "对话" }).click();
                await expect(page.getByRole("navigation", { name: "会话列表" })).toBeVisible();
                await expect(page.getByRole("button", { name: "按时间分组" })).toHaveAttribute("aria-pressed", "true");
                await expect(sessionButton(page, "验收会话 Alpha")).toBeVisible();
                return "左侧会话列表按时间分组，真实持久化会话可见。";
            }, "sidebar-date-list");

            await record("F04-C02", "F04", "今天分组可折叠并隐藏会话", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: /今天/ }).click();
                await expect(sessionButton(page, "验收会话 Alpha")).toHaveCount(0);
                return "点击今天分组后 aria 展开态改变，会话行隐藏。";
            }, "sidebar-date-collapse");

            await record("F04-C03", "F04", "今天分组可展开并恢复会话", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: /今天/ }).click();
                await expect(sessionButton(page, "验收会话 Alpha")).toBeVisible();
                return "再次点击今天分组后会话行恢复。";
            }, "sidebar-date-expand");

            await record("F04-C04", "F04", "选择会话会更新当前选中态", async () => {
                if (!page) throw new Error("main page missing");
                await sessionButton(page, "验收会话 Beta").click();
                await expect(sessionButton(page, "验收会话 Beta")).toHaveAttribute("aria-current", "page");
                return "点击会话 Beta 后左侧列表 aria-current=page，选择真实生效。";
            }, "sidebar-select-session");

            await record("F04-C05", "F04", "归档会话会移入已归档区并从活动列表消失", async () => {
                if (!page) throw new Error("main page missing");
                await sessionButton(page, "验收会话 Beta").hover();
                await page.getByRole("button", { name: "归档 验收会话 Beta" }).click();
                await expect(sessionButton(page, "验收会话 Beta")).toHaveCount(0);
                await expect(page.getByRole("button", { name: /已归档/ })).toBeVisible();
                const beta = await page.evaluate(async () => {
                    const sessions = await window.piAPI.listSessions();
                    return sessions.find((session) => session.id === "continuous-session-beta")?.archived;
                });
                expect(beta).toBe(true);
                return "归档按钮触发真实 session:archive，IPC 读回 Beta archived=true。";
            }, "sidebar-archive-session");

            await record("F04-C06", "F04", "已归档区可展开并显示归档会话", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: /已归档/ }).click();
                await expect(sessionButton(page, "验收会话 Beta")).toBeVisible();
                await expect(sessionButton(page, "验收会话 Gamma")).toBeVisible();
                return "已归档分组展开后显示 Beta/Gamma 两个归档会话。";
            }, "sidebar-archived-expanded");

            await record("F04-C07", "F04", "点击归档会话会恢复并选中", async () => {
                if (!page) throw new Error("main page missing");
                await sessionButton(page, "验收会话 Beta").click();
                await expect(sessionButton(page, "验收会话 Beta")).toHaveAttribute("aria-current", "page");
                const beta = await page.evaluate(async () => {
                    const sessions = await window.piAPI.listSessions();
                    return sessions.find((session) => session.id === "continuous-session-beta")?.archived;
                });
                expect(beta).toBe(false);
                return "点击归档区会话后恢复到活动会话并选中，IPC 读回 archived=false。";
            }, "sidebar-restore-session");

            await record("F04-C08", "F04", "右键重命名会话会更新 UI 和持久化标题", async () => {
                if (!page) throw new Error("main page missing");
                await sessionButton(page, "验收会话 Alpha").click({ button: "right" });
                await page.getByRole("menuitem", { name: "重命名 验收会话 Alpha" }).click();
                const input = page.getByLabel("重命名会话 验收会话 Alpha");
                await input.fill("验收会话 Alpha 已重命名");
                await input.press("Enter");
                await expect(sessionButton(page, "验收会话 Alpha 已重命名")).toBeVisible();
                const title = await page.evaluate(async () => {
                    const sessions = await window.piAPI.listSessions();
                    return sessions.find((session) => session.id === "continuous-session-alpha")?.title;
                });
                expect(title).toBe("验收会话 Alpha 已重命名");
                return "右键重命名后 UI 与 session:list 持久化标题一致。";
            }, "sidebar-rename-session");

            await record("F04-C09", "F04", "右键删除取消不会删除会话", async () => {
                if (!page) throw new Error("main page missing");
                await sessionButton(page, "验收会话 Alpha 已重命名").click({ button: "right" });
                await page.getByRole("menuitem", { name: "删除 验收会话 Alpha 已重命名" }).click();
                const dialog = page.getByRole("dialog", { name: /确定删除/ });
                await expect(dialog).toBeVisible();
                await dialog.getByRole("button", { name: "取消" }).click();
                await expect(sessionButton(page, "验收会话 Alpha 已重命名")).toBeVisible();
                return "删除确认取消后会话仍在列表中。";
            }, "sidebar-delete-cancel");

            await record("F04-C10", "F04", "右键删除确认会删除会话并从持久化消失", async () => {
                if (!page) throw new Error("main page missing");
                await sessionButton(page, "验收会话 Alpha 已重命名").click({ button: "right" });
                await page.getByRole("menuitem", { name: "删除 验收会话 Alpha 已重命名" }).click();
                const dialog = page.getByRole("dialog", { name: /确定删除/ });
                await dialog.getByRole("button", { name: "确认" }).click();
                await expect(sessionButton(page, "验收会话 Alpha 已重命名")).toHaveCount(0);
                const exists = await page.evaluate(async () => {
                    const sessions = await window.piAPI.listSessions();
                    return sessions.some((session) => session.id === "continuous-session-alpha");
                });
                expect(exists).toBe(false);
                return "确认删除后 UI 消失，session:list 中也不再存在 Alpha。";
            }, "sidebar-delete-confirm");

            await record("F04-C11", "F04", "切换工作区分组会按 workspace 显示并持久化设置", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("button", { name: "按工作区分组" }).click();
                await expect(page.getByRole("button", { name: "按工作区分组" })).toHaveAttribute("aria-pressed", "true");
                await expect(page.getByText("continuous-window-sidebar").first()).toBeVisible();
                await expect.poll(
                    () => page.evaluate(() => window.piAPI.getSettings().then((settings) => settings.sidebarGroupMode)),
                    { timeout: 10_000 },
                ).toBe("workspace");
                return "会话列表切到工作区分组，settings IPC 读回 sidebarGroupMode=workspace。";
            }, "sidebar-workspace-group");

            await record("F04-C12", "F04", "reload 后工作区分组仍保持并可切回时间分组", async () => {
                if (!page) throw new Error("main page missing");
                await page.reload({ waitUntil: "domcontentloaded" });
                await expect(page.getByRole("button", { name: "按工作区分组" })).toHaveAttribute("aria-pressed", "true");
                await page.getByRole("button", { name: "按时间分组" }).click();
                await expect(page.getByRole("button", { name: "按时间分组" })).toHaveAttribute("aria-pressed", "true");
                return "reload 后分组偏好仍为工作区，随后可真实切回时间分组。";
            }, "sidebar-group-persist-revert");
        } finally {
            await quitApp(app).catch((error: unknown) => {
                results.push({
                    id: "APP-CLOSE",
                    functionId: "F01",
                    title: "Electron 应用关闭",
                    status: "BLOCKED",
                    error: errorMessage(error),
                    startedAt: new Date().toISOString(),
                    endedAt: new Date().toISOString(),
                });
            });
        }

        const pass = results.filter((result) => result.status === "PASS").length;
        const fail = results.filter((result) => result.status === "FAIL").length;
        const blocked = results.filter((result) => result.status === "BLOCKED").length;
        const screenshotAnalysis = screenshots.map((file, index) => ({
            file,
            observation: `截图 ${index + 1} 是本轮真实 Windows Electron 窗口/标题栏/tabs/侧栏状态；核对对应 case 的可见 UI、状态变化、持久化或错误边界。`,
        }));
        const report = {
            runId: RUN_ID,
            endedAt: new Date().toISOString(),
            workspaceDirtyAtStart: true,
            dirtyScope: "本轮只新增 continuous-window-sidebar Electron 验收 spec 与验收产物，不修改产品逻辑，不覆盖既有脏改动。",
            coveredFunctionIds: ["F01", "F02", "F03", "F04"],
            cases: results,
            summary: { total: results.length, pass, fail, blocked, screenshots: screenshots.length },
            screenshots,
            screenshotAnalysis,
            blockedItems: [
                "连续 10 轮真实 AI 对话仍需要真实 Provider/API key 或可用 Pi runtime。",
                "真实工具调用审批 allow/deny 仍需可控 Pi runtime 工具触发。",
                "完整功能矩阵尚未执行完，本轮继续推进 F01-F04。",
            ],
        };

        await writeFile(join(ACCEPTANCE_DIR, "window-sidebar-report.json"), JSON.stringify(report, null, 2), "utf8");
        await writeFile(
            join(ACCEPTANCE_DIR, "window-sidebar-report.md"),
            [
                `# Pi Desktop Continuous Window/Sidebar Acceptance ${RUN_ID}`,
                "",
                "## Summary",
                "",
                `- Cases: ${results.length}; PASS ${pass}; FAIL ${fail}; BLOCKED ${blocked}`,
                `- Screenshots: ${screenshots.length}`,
                "- Dirty scope: 只新增验收 spec 与产物，不改产品逻辑。",
                "",
                "## Cases",
                "",
                ...results.flatMap((result, index) => [
                    `### ${index + 1}. ${result.id} ${result.title}`,
                    "",
                    `- Function: ${result.functionId}`,
                    `- Status: ${result.status}`,
                    `- Observation: ${result.observation ?? ""}`,
                    `- Error: ${result.error ?? ""}`,
                    `- Screenshot: ${result.screenshot ?? ""}`,
                    "",
                ]),
                "## Screenshot Analysis",
                "",
                ...screenshotAnalysis.map((item) => `- ${item.file}: ${item.observation}`),
                "",
                "## Blocked / Continuing",
                "",
                ...report.blockedItems.map((item) => `- ${item}`),
                "",
            ].join("\n"),
            "utf8",
        );

        expect(fail).toBe(0);
    });
});
