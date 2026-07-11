import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl, retryMainAction } from "./support/electron-windows";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
const SESSION_ID = "deep-use-session";
const SESSION_TITLE = "深度使用修复验收";

async function ensureAcceptanceDir(): Promise<void> {
    mkdirSync(ACCEPTANCE_DIR, { recursive: true });
}

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
    });
    const page = await getWindowByUrl(app, "index.html");
    return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try {
        await app?.close();
    } catch {
        // ignore shutdown failures during acceptance flow
    }
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function openSettingsWindow(app: ElectronApplication, page: Page): Promise<Page> {
    const settingsWindowPromise = app.waitForEvent("window");
    await page.getByRole("button", { name: "打开设置" }).click();
    const settingsWindow = await settingsWindowPromise;
    await settingsWindow.waitForLoadState("domcontentloaded");
    await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible({ timeout: 10_000 });
    return settingsWindow;
}

async function installAcceptanceStubs(app: ElectronApplication, blankParentDir: string): Promise<void> {
    await retryMainAction(() => app.evaluate(({ ipcMain }, payload) => {
        const target = globalThis as typeof globalThis & {
            __deepUseAgentPromptCalls?: Array<{ agentId: string; message: string }>;
        };
        target.__deepUseAgentPromptCalls = [];

        ipcMain.removeHandler("agents:prompt");
        ipcMain.handle("agents:prompt", async (_event, input: { agentId: string; message: string }) => {
            target.__deepUseAgentPromptCalls?.push(input);
            return undefined;
        });

        ipcMain.removeHandler("workspace:select-directory");
        ipcMain.handle("workspace:select-directory", async () => payload.blankParentDir);
    }, { blankParentDir }));
}

async function openSession(page: Page, title: string): Promise<void> {
    const sidebar = page.getByRole("navigation", { name: "会话列表" });
    const button = sidebar.getByRole("button", { name: title, exact: true });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
}

async function emitBoundAgentEvents(page: Page, app: ElectronApplication, events: Array<Record<string, unknown>>): Promise<void> {
    const agent = await page.evaluate(async (sessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === sessionId) ?? null;
    }, SESSION_ID);
    if (!agent) throw new Error(`No bound agent found for ${SESSION_ID}`);
    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().includes("index.html"))
            ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error("No Electron window available for event injection");
        for (const event of payload.events) {
            win.webContents.send("agents:event", {
                agentId: payload.agent.id,
                workspaceId: payload.agent.workspaceId,
                event,
            });
        }
    }, { agent, events });
}

function chatTextarea(page: Page) {
    return page.locator('textarea[aria-label="发送"]').first();
}

test.describe("Pi Desktop deep-use current fixes acceptance", () => {
    let app: ElectronApplication | undefined;

    test.setTimeout(120_000);

    test.afterEach(async () => {
        await closeApp(app);
        app = undefined;
    });

    test("verifies session-bound usage sync, history jump, and empty workspace creation with real Electron screenshots", async () => {
        await ensureAcceptanceDir();
        const userDataDir = test.info().outputPath(`deep-use-user-data-${Date.now()}`);
        const workspacePath = test.info().outputPath("deep-use-workspace");
        const blankParentDir = test.info().outputPath("blank-parent");
        mkdirSync(blankParentDir, { recursive: true });

        let launched = await launchApp(userDataDir);
        app = launched.app;
        let page = launched.page;
        await installAcceptanceStubs(app, blankParentDir);

        await page.evaluate(async ({ workspacePath, sessionId, sessionTitle }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("deep-use-audit", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
            const session = await window.piAPI.createSession(ws.id, sessionTitle, sessionId);
            await window.piAPI.agentsCreate({
                workspaceId: ws.id,
                title: `${sessionTitle} Agent`,
                sessionId: session.id,
            });
        }, { workspacePath, sessionId: SESSION_ID, sessionTitle: SESSION_TITLE });

        await closeApp(app);
        launched = await launchApp(userDataDir);
        app = launched.app;
        page = launched.page;
        await installAcceptanceStubs(app, blankParentDir);
        await skipOnboarding(page);
        await page.evaluate(() => {
            window.prompt = () => "BlankProject";
        });
        await openSession(page, SESSION_TITLE);
        await expect.poll(async () => page.evaluate(async (sessionId) => {
            const agents = await window.piAPI.agentsList();
            return agents.find((item) => item.sessionId === sessionId)?.id ?? null;
        }, SESSION_ID), { timeout: 15_000 }).not.toBeNull();

        const textarea = chatTextarea(page);
        await expect(textarea).toBeVisible({ timeout: 10_000 });
        await textarea.fill("deep use current message");
        await textarea.press("Enter");
        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText("deep use current message", { timeout: 10_000 });

        await emitBoundAgentEvents(page, app, [
            { type: "agent_start" },
            {
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "assistant synced into session store",
                },
            },
            {
                type: "usage_update",
                usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            },
            { type: "turn_end" },
            { type: "agent_end" },
        ]);

        await expect(page.getByRole("article", { name: /Pi ·/ }).filter({ hasText: "assistant synced into session store" }).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/Token:\s*12/)).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-01-session-usage-sync.png"), fullPage: true });

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "用量" }).click();
        await expect(settingsWindow.getByRole("tabpanel", { name: "用量" })).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByRole("heading", { name: "Token 用量概览" })).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByText(SESSION_TITLE, { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(settingsWindow.getByText("12", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
        await settingsWindow.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-01b-settings-usage-sync.png"), fullPage: true });
        await settingsWindow.close();

        await page.keyboard.press("Control+Shift+F");
        const searchInput = page.getByRole("textbox", { name: "搜索对话历史" });
        await expect(searchInput).toBeVisible({ timeout: 5_000 });
        await searchInput.fill("deep use current message");
        await expect(page.getByText("找到 1 条结果")).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-02-history-search-hit.png"), fullPage: true });
        await page
            .locator("button")
            .filter({ hasText: SESSION_TITLE })
            .filter({ hasText: "deep use current message" })
            .click();

        await expect(searchInput).toHaveCount(0, { timeout: 5_000 });
        const highlighted = page.locator('[data-search-target="true"]').filter({ hasText: "deep use current message" }).first();
        await expect(highlighted).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-03-history-jump-target.png"), fullPage: true });

        const workspaceButton = page.getByRole("button", { name: /切换工作区：/ }).first();
        await workspaceButton.click();
        await expect(page.locator('[role="menu"]').last()).toBeVisible({ timeout: 5_000 });
        await page.getByRole("menuitem", { name: "新增空白项目" }).click();
        await expect(page.getByRole("button", { name: "切换工作区：BlankProject" }).first()).toBeVisible({ timeout: 10_000 });
        expect(existsSync(join(blankParentDir, "BlankProject"))).toBe(true);
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-04-empty-workspace-created.png"), fullPage: true });
    });
});
