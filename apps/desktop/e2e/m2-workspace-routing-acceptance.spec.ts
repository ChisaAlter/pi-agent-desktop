import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { join } from "path";
import { mkdir } from "fs/promises";

async function ensureAcceptanceDir(): Promise<string> {
    const dir = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
    await mkdir(dir, { recursive: true });
    return dir;
}

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const onboarding = page.locator('[data-testid="onboarding-modal"]');
    if (await onboarding.count() > 0) {
        await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5000 });
        await expect(onboarding).toHaveCount(0, { timeout: 5000 });
    }
    return { app, page };
}

test.describe("M2 acceptance — workspace routing, session center and history jump", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // ignore electron shutdown failures
        } finally {
            app = undefined;
        }
    });

    test("captures real Electron evidence for workspace switching, session center and message jump", async () => {
        const acceptanceDir = await ensureAcceptanceDir();
        const userDataDir = test.info().outputPath(`m2-user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspaceOnePath = test.info().outputPath("workspace-one");
        const workspaceTwoPath = test.info().outputPath("workspace-two");
        const now = Date.now();

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspaceOnePath, workspaceTwoPath, now }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop.onboarding.completed", "true");

                const wsOne = await window.piAPI.createWorkspace("m2-workspace-one", workspaceOnePath);
                const wsTwo = await window.piAPI.createWorkspace("m2-workspace-two", workspaceTwoPath);
                await window.piAPI.selectWorkspace(wsOne.path);

                const targetSession = await window.piAPI.createSession(wsTwo.id, "M2 目标会话", "m2-target-session");
                await window.piAPI.appendMessage(targetSession.id, {
                    id: "m2-target-message-user",
                    role: "user",
                    content: "m2-search-needle 这条消息必须能从搜索结果直接跳到这里",
                    timestamp: new Date(now - 2_000).toISOString(),
                });
                await window.piAPI.appendMessage(targetSession.id, {
                    id: "m2-target-message-assistant",
                    role: "assistant",
                    content: "m2-search-reply",
                    timestamp: new Date(now - 1_000).toISOString(),
                });

                const wsTwoSession = await window.piAPI.createSession(wsOne.id, "M2 第二工作区会话", "m2-secondary-session");
                await window.piAPI.appendMessage(wsTwoSession.id, {
                    id: "m2-secondary-message",
                    role: "user",
                    content: "secondary workspace marker",
                    timestamp: new Date(now - 500).toISOString(),
                });
            },
            { workspaceOnePath, workspaceTwoPath, now },
        );

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "快速新建对话" }).click();
        const workspaceButton = page.getByRole("button", { name: /切换工作区：/ }).first();
        await expect(workspaceButton).toBeVisible({ timeout: 15_000 });

        await workspaceButton.click();
        const workspaceMenu = page.locator('[role="menu"]').last();
        await expect(workspaceMenu).toBeVisible({ timeout: 5_000 });
        await workspaceMenu.getByRole("menuitem").filter({ hasText: "m2-workspace-two" }).click();
        await expect(page.getByRole("button", { name: "切换工作区：m2-workspace-two" }).first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole("button", { name: "切换工作区：m2-workspace-two" }).first().click();
        await expect(page.locator('[role="menu"]').last()).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m2-01-workspace-switch.png"), fullPage: true });
        await page.keyboard.press("Escape");

        const persistedWorkspaces = await page.evaluate(async () => {
            const workspaces = await window.piAPI.listWorkspaces();
            return workspaces.map((workspace) => ({
                id: workspace.id,
                name: workspace.name,
                lastActiveAt: workspace.lastActiveAt,
            }));
        });
        const wsOne = persistedWorkspaces.find((workspace) => workspace.name === "m2-workspace-one");
        const wsTwo = persistedWorkspaces.find((workspace) => workspace.name === "m2-workspace-two");
        expect(typeof wsOne?.lastActiveAt).toBe("number");
        expect(typeof wsTwo?.lastActiveAt).toBe("number");
        expect((wsTwo?.lastActiveAt ?? 0)).toBeGreaterThanOrEqual(wsOne?.lastActiveAt ?? 0);

        await page.getByRole("tab", { name: "历史" }).click();
        await expect(page.getByRole("heading", { name: "会话中心" })).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m2-02-session-center.png"), fullPage: true });

        await page.keyboard.press("Control+Shift+F");
        const search = page.getByRole("textbox", { name: "搜索对话历史" });
        await expect(search).toBeVisible({ timeout: 5_000 });
        await search.fill("m2-search-needle");
        await expect(page.getByText("找到 1 条结果")).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m2-03-search-result.png"), fullPage: true });
        await page
            .locator("button")
            .filter({ hasText: "M2 目标会话" })
            .filter({ hasText: "m2-search-needle" })
            .click();

        await expect(search).toHaveCount(0, { timeout: 5_000 });
        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(
            "m2-search-needle 这条消息必须能从搜索结果直接跳到这里",
            { timeout: 10_000 },
        );
        await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText(
            "m2-search-reply",
            { timeout: 10_000 },
        );
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m2-04-message-jump.png"), fullPage: true });
    });
});
