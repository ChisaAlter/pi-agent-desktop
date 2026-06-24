import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
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

test.describe("Pi Desktop — session history navigation", () => {
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

    test("clicking a persisted history item opens its message detail", async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("workspace");
        const now = Date.now();

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath, now }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                const ws = await window.piAPI.createWorkspace("history-e2e", workspacePath);
                const oldSession = await window.piAPI.createSession(ws.id, "旧会话", "e2e-old-session");
                const targetSession = await window.piAPI.createSession(ws.id, "目标会话", "e2e-target-session");

                await window.piAPI.appendMessage(oldSession.id, {
                    id: "old-message",
                    role: "user",
                    content: "old message should not be selected",
                    timestamp: new Date(now - 10_000).toISOString(),
                });
                await window.piAPI.appendMessage(targetSession.id, {
                    id: "target-user-message",
                    role: "user",
                    content: "打开历史会话后必须看到这条用户消息",
                    timestamp: new Date(now - 5_000).toISOString(),
                });
                await window.piAPI.appendMessage(targetSession.id, {
                    id: "target-assistant-message",
                    role: "assistant",
                    content: "打开历史会话后必须看到这条助手回复",
                    timestamp: new Date(now - 4_000).toISOString(),
                });
            },
            { workspacePath, now },
        );

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));

        await page.locator('button[data-mmcode-section="new-task"]').click();
        await expect(page.getByText("输入消息后，Pi Agent 会在当前工作区开始运行。")).toBeVisible({ timeout: 15_000 });

        await page.getByRole("button", { name: "目标会话", exact: true }).click();

        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(
            "打开历史会话后必须看到这条用户消息",
            { timeout: 10_000 },
        );
        await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText(
            "打开历史会话后必须看到这条助手回复",
            { timeout: 10_000 },
        );
        await expect(page.getByText("输入消息后，Pi Agent 会在当前工作区开始运行。")).toHaveCount(0);
    });

    test("top history search result opens the matching persisted session", async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("workspace");
        const now = Date.now();

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath, now }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                const ws = await window.piAPI.createWorkspace("search-history-e2e", workspacePath);
                const targetSession = await window.piAPI.createSession(ws.id, "浮层搜索会话", "search-history-target-session");
                await window.piAPI.appendMessage(targetSession.id, {
                    id: "search-target-user-message",
                    role: "user",
                    content: "search-floating-needle 顶部历史搜索应该打开这条消息",
                    timestamp: new Date(now - 2_000).toISOString(),
                });
                await window.piAPI.appendMessage(targetSession.id, {
                    id: "search-target-assistant-message",
                    role: "assistant",
                    content: "search-floating-assistant-reply",
                    timestamp: new Date(now - 1_000).toISOString(),
                });
            },
            { workspacePath, now },
        );

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));

        await page.getByRole("tab", { name: "历史" }).click();
        await page.keyboard.press("Control+Shift+F");
        const search = page.getByRole("textbox", { name: "搜索对话历史" });
        await expect(search).toBeVisible({ timeout: 5_000 });
        await search.fill("search-floating-needle");
        await expect(page.getByText("找到 1 条结果")).toBeVisible({ timeout: 5_000 });

        await page
            .locator("button")
            .filter({ hasText: "浮层搜索会话" })
            .filter({ hasText: "search-floating-needle" })
            .click();

        await expect(search).toHaveCount(0, { timeout: 5_000 });
        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(
            "search-floating-needle 顶部历史搜索应该打开这条消息",
            { timeout: 10_000 },
        );
        await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText(
            "search-floating-assistant-reply",
            { timeout: 10_000 },
        );
    });

    test("left sidebar session archive, restore, and delete confirmation buttons work", async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("workspace");
        const now = Date.now();

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath, now }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                const ws = await window.piAPI.createWorkspace("sidebar-actions-e2e", workspacePath);
                const archiveSession = await window.piAPI.createSession(ws.id, "待归档会话", "sidebar-archive-session");
                const deleteSession = await window.piAPI.createSession(ws.id, "待删除会话", "sidebar-delete-session");
                await window.piAPI.appendMessage(archiveSession.id, {
                    id: "archive-message",
                    role: "user",
                    content: "sidebar archive action target",
                    timestamp: new Date(now - 2_000).toISOString(),
                });
                await window.piAPI.appendMessage(deleteSession.id, {
                    id: "delete-message",
                    role: "user",
                    content: "sidebar delete action target",
                    timestamp: new Date(now - 1_000).toISOString(),
                });
            },
            { workspacePath, now },
        );

        await app.close();
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));

        const sidebar = page.getByRole("navigation", { name: "会话列表" });
        const archiveRow = sidebar.getByRole("button", { name: "待归档会话", exact: true });
        await expect(archiveRow).toBeVisible({ timeout: 10_000 });
        await archiveRow.hover();
        await sidebar.getByRole("button", { name: "归档 待归档会话" }).click();
        await expect(sidebar.getByRole("button", { name: "待归档会话", exact: true })).toHaveCount(0);

        const archivedGroup = sidebar.getByRole("button", { name: /已归档/ });
        await expect(archivedGroup).toBeVisible({ timeout: 5_000 });
        await archivedGroup.click();
        await expect(sidebar.getByRole("button", { name: "待归档会话", exact: true })).toBeVisible({ timeout: 5_000 });
        await sidebar.getByRole("button", { name: "待归档会话", exact: true }).hover();
        await sidebar.getByRole("button", { name: "恢复 待归档会话" }).click();
        await expect(sidebar.getByRole("button", { name: /已归档/ })).toHaveCount(0, { timeout: 5_000 });
        await expect(sidebar.getByRole("button", { name: "待归档会话", exact: true })).toBeVisible({ timeout: 5_000 });

        const deleteRow = sidebar.getByRole("button", { name: "待删除会话", exact: true });
        await deleteRow.hover();
        await sidebar.getByRole("button", { name: "删除 待删除会话" }).click();
        const confirmDialog = sidebar.getByRole("dialog", { name: "确定删除「待删除会话」？此操作不可恢复。" });
        await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
        await confirmDialog.getByRole("button", { name: "取消" }).click();
        await expect(confirmDialog).toHaveCount(0, { timeout: 5_000 });
        await expect(deleteRow).toBeVisible();

        await deleteRow.hover();
        await sidebar.getByRole("button", { name: "删除 待删除会话" }).click();
        await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
        await confirmDialog.getByRole("button", { name: "确认" }).click();
        await expect(sidebar.getByRole("button", { name: "待删除会话", exact: true })).toHaveCount(0, { timeout: 5_000 });

        const remainingSessionIds = await page.evaluate(async () => {
            const sessions = await window.piAPI.listSessions();
            return sessions.map((session) => session.id);
        });
        expect(remainingSessionIds).toContain("sidebar-archive-session");
        expect(remainingSessionIds).not.toContain("sidebar-delete-session");
    });
});
