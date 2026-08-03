import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { expect, test, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl, retryMainAction } from "./support/electron-windows";

const SCREENSHOT_DIR = join(__dirname, "..", "e2e-output", "right-rail-git-workflow");

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function prepareRepository(root: string): { workspacePath: string; remotePath: string } {
    const workspacePath = join(root, "workspace");
    const remotePath = join(root, "remote.git");
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(remotePath, { recursive: true });
    git(remotePath, "init", "--bare");
    git(workspacePath, "init");
    git(workspacePath, "config", "user.email", "right-rail-e2e@example.com");
    git(workspacePath, "config", "user.name", "Right Rail E2E");
    writeFileSync(join(workspacePath, "README.md"), "# Right Rail Git E2E\n", "utf-8");
    git(workspacePath, "add", "README.md");
    git(workspacePath, "commit", "-m", "test: initial commit");
    git(workspacePath, "branch", "-M", "master");
    git(workspacePath, "remote", "add", "origin", remotePath);
    git(workspacePath, "push", "-u", "origin", "master");
    writeFileSync(join(workspacePath, "README.md"), "# Right Rail Git E2E\n\nEdited through the real right rail workflow.\n", "utf-8");
    writeFileSync(join(workspacePath, "added-from-rail.txt"), "created from right rail e2e\n", "utf-8");
    return { workspacePath, remotePath };
}

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const configDir = `${userDataDir}-pi-config`;
    mkdirSync(configDir, { recursive: true });
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "", PI_DESKTOP_CONFIG_DIR: configDir },
    });
    return { app, page: await getWindowByUrl(app, "index.html") };
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function openRightRail(page: Page): Promise<void> {
    if (await page.getByTestId("right-rail-panel").count() > 0) return;
    await page.getByRole("button", { name: "展开右侧栏" }).first().click();
    await expect(page.getByTestId("right-rail-panel")).toBeVisible({ timeout: 10_000 });
}

test.describe("right rail Git workflow", () => {
    let app: ElectronApplication | undefined;

    test.setTimeout(120_000);

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // Electron may already be closed during teardown.
        }
        app = undefined;
    });

    test("opens real changes and diff, manages branches, then commits and pushes", async ({}, testInfo) => {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const repo = prepareRepository(testInfo.outputPath("right-rail-git-repo"));
        const launched = await launchApp(testInfo.outputPath(`right-rail-user-data-${Date.now()}`));
        app = launched.app;
        const page = launched.page;

        await retryMainAction(() => app!.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setSize(1440, 920);
        }));
        await page.setViewportSize({ width: 1440, height: 920 });
        await skipOnboarding(page);
        await page.evaluate(async (workspacePath) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const workspace = await window.piAPI.createWorkspace("right-rail-git-e2e", workspacePath);
            await window.piAPI.selectWorkspace(workspace.path);
        }, repo.workspacePath);
        await page.reload({ waitUntil: "domcontentloaded" });
        await skipOnboarding(page);
        await openRightRail(page);

        const rail = page.getByTestId("right-rail-panel");
        await expect(rail.getByText("本地", { exact: true })).toHaveCount(0);
        await expect(rail.getByText("比较分支", { exact: true })).toHaveCount(0);
        await rail.getByRole("button", { name: "查看变更文件列表" }).click();

        const changesOverlay = page.getByTestId("git-changes-overlay");
        await expect(changesOverlay).toBeVisible({ timeout: 10_000 });
        await expect(changesOverlay.getByText("README.md")).toBeVisible({ timeout: 10_000 });
        await expect(changesOverlay.getByText("added-from-rail.txt")).toBeVisible();
        await page.screenshot({ path: join(SCREENSHOT_DIR, "01-real-change-list.png"), fullPage: true });
        await changesOverlay.getByRole("button", { name: /README\.md/ }).click();
        await expect(changesOverlay.getByText("Edited through the real right rail workflow.")).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(SCREENSHOT_DIR, "02-real-diff.png"), fullPage: true });

        await page.getByRole("tab", { name: "对话", exact: true }).click();
        await openRightRail(page);
        await rail.getByRole("button", { name: "master", exact: true }).click();
        const branchDialog = page.getByRole("dialog", { name: "分支管理" });
        await expect(branchDialog).toBeVisible();
        await expect(branchDialog.getByText("master", { exact: true })).toBeVisible();
        await page.screenshot({ path: join(SCREENSHOT_DIR, "03-branch-popup.png"), fullPage: true });

        await branchDialog.getByPlaceholder("新分支名").fill("feature/right-rail-e2e");
        await branchDialog.getByRole("button", { name: "创建并检出" }).click();
        await expect(branchDialog).toHaveCount(0, { timeout: 10_000 });
        await expect.poll(() => git(repo.workspacePath, "branch", "--show-current")).toBe("feature/right-rail-e2e");

        await rail.getByRole("button", { name: "feature/right-rail-e2e", exact: true }).click();
        const checkoutDialog = page.getByRole("dialog", { name: "分支管理" });
        const masterBranch = checkoutDialog.getByRole("button", { name: "master", exact: true });
        await expect(masterBranch).toBeEnabled({ timeout: 10_000 });
        await masterBranch.click();
        await expect(checkoutDialog).toHaveCount(0, { timeout: 10_000 });
        await expect.poll(() => git(repo.workspacePath, "branch", "--show-current")).toBe("master");

        await rail.getByRole("button", { name: "提交或推送", exact: true }).click();
        const commitDialog = page.getByRole("dialog", { name: "提交或推送" });
        await expect(commitDialog).toBeVisible();
        await expect(commitDialog.getByText("包含未暂存的更改")).toBeVisible();
        await commitDialog.getByPlaceholder("提交信息（留空将自动生成）...").fill("test: commit and push from right rail");
        await page.screenshot({ path: join(SCREENSHOT_DIR, "04-commit-push-popup.png"), fullPage: true });
        await commitDialog.getByRole("button", { name: "提交并推送" }).click();
        await expect(commitDialog).toHaveCount(0, { timeout: 30_000 });

        const localHead = git(repo.workspacePath, "rev-parse", "HEAD");
        const remoteHead = git(repo.remotePath, "rev-parse", "refs/heads/master");
        expect(remoteHead).toBe(localHead);
        expect(git(repo.workspacePath, "log", "-1", "--pretty=%s")).toBe("test: commit and push from right rail");
        expect(git(repo.workspacePath, "status", "--porcelain")).toBe("");
        await expect(rail.getByText("+0")).toBeVisible({ timeout: 10_000 });
        await expect(rail.getByText("-0")).toBeVisible({ timeout: 10_000 });
    });
});
