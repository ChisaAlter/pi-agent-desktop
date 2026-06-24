import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { mkdir as mkdirAsync } from "fs/promises";
import { join } from "path";

async function ensureAcceptanceDir(): Promise<string> {
    const dir = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
    await mkdirAsync(dir, { recursive: true });
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

async function reloadAppShell(page: Page): Promise<void> {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="onboarding-modal"]')).toHaveCount(0, { timeout: 5000 });
}

function prepareWorkspaceRepo(workspacePath: string): void {
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, ".github", "workflows"), { recursive: true });
    mkdirSync(join(workspacePath, ".vscode"), { recursive: true });
    mkdirSync(join(workspacePath, "src"), { recursive: true });

    writeFileSync(join(workspacePath, "README.md"), "# M5 Acceptance\n\nInitial content.\n", "utf-8");
    writeFileSync(join(workspacePath, ".gitignore"), "node_modules/\n.env.local\n", "utf-8");
    writeFileSync(join(workspacePath, ".env.local"), "M5_SECRET=1\n", "utf-8");
    writeFileSync(join(workspacePath, ".github", "workflows", "ci.yml"), "name: ci\non: [push]\n", "utf-8");
    writeFileSync(join(workspacePath, ".vscode", "settings.json"), '{\n  "editor.tabSize": 2\n}\n', "utf-8");
    writeFileSync(join(workspacePath, "src", "index.ts"), "export const m5Acceptance = true;\n", "utf-8");

    execSync("git init", { cwd: workspacePath, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: workspacePath, stdio: "ignore" });
    execSync('git config user.name "Pi Desktop E2E"', { cwd: workspacePath, stdio: "ignore" });
    execSync("git add .", { cwd: workspacePath, stdio: "ignore" });
    execSync('git commit -m "Initial commit"', { cwd: workspacePath, stdio: "ignore" });

    writeFileSync(join(workspacePath, "README.md"), "# M5 Acceptance\n\nREADME changed for Git panel screenshot.\n", "utf-8");
}

test.describe("M5 acceptance — critical dotfiles, async Git/File paths and batch export", () => {
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

    test("captures real Electron evidence for hidden-file search, Git panel and batch export", async () => {
        const acceptanceDir = await ensureAcceptanceDir();
        const userDataDir = test.info().outputPath(`m5-user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("m5-workspace");
        const now = Date.now();

        prepareWorkspaceRepo(workspacePath);

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath, now }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop.onboarding.completed", "true");

                const ws = await window.piAPI.createWorkspace("m5-acceptance", workspacePath);
                await window.piAPI.selectWorkspace(ws.path);

                const sessionA = await window.piAPI.createSession(ws.id, "M5 Export Session A", "m5-export-session-a");
                await window.piAPI.appendMessage(sessionA.id, {
                    id: "m5-export-message-a",
                    role: "user",
                    content: "batch export candidate A",
                    timestamp: new Date(now - 2_000).toISOString(),
                });

                const sessionB = await window.piAPI.createSession(ws.id, "M5 Export Session B", "m5-export-session-b");
                await window.piAPI.appendMessage(sessionB.id, {
                    id: "m5-export-message-b",
                    role: "assistant",
                    content: "batch export candidate B",
                    timestamp: new Date(now - 1_000).toISOString(),
                });
            },
            { workspacePath, now },
        );

        await reloadAppShell(page);
        await expect(page.getByRole("button", { name: "切换工作区：m5-acceptance" }).first()).toBeVisible({ timeout: 15_000 });

        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "files" } }));
        });
        const fileSearch = page.getByRole("textbox", { name: "搜索文件" });
        await expect(fileSearch).toBeVisible({ timeout: 5_000 });

        await fileSearch.fill(".g");
        await expect(page.locator('button[title=".gitignore"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('button[title=".github/workflows/ci.yml"]')).toBeVisible({ timeout: 5_000 });
        await page.locator('button[title=".github/workflows/ci.yml"]').click();
        await expect(page.getByLabel("文件只读预览")).toContainText("name: ci", { timeout: 5_000 });
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m5-01-dotfile-search.png"), fullPage: true });

        await fileSearch.fill(".env");
        await expect(page.getByText("没有匹配文件")).toBeVisible({ timeout: 5_000 });
        await fileSearch.fill(".v");
        await expect(page.locator('button[title=".vscode/settings.json"]')).toBeVisible({ timeout: 5_000 });

        await page.getByRole("tab", { name: "Git" }).click();
        await expect(page.getByRole("region", { name: "Git 面板" })).toBeVisible({ timeout: 5_000 });
        await page.getByRole("button", { name: "刷新 Git 状态" }).click();
        await expect(page.getByText(/0 staged \/ 1 changes/)).toBeVisible({ timeout: 10_000 });
        await page.getByRole("button", { name: "打开 README.md diff" }).click();
        await expect(page.getByText("README changed for Git panel screenshot.")).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m5-02-file-git-panel.png"), fullPage: true });

        await page.getByRole("tab", { name: "历史" }).click();
        await expect(page.getByRole("heading", { name: "会话中心" })).toBeVisible({ timeout: 5_000 });
        await page.getByRole("button", { name: "批量导出" }).click();
        const exportDialog = page.locator("div.fixed.inset-0");
        await expect(exportDialog.getByRole("heading", { name: "导出会话" })).toBeVisible({ timeout: 5_000 });
        await exportDialog.locator("label", { hasText: "M5 Export Session A" }).click();
        await exportDialog.locator("label", { hasText: "M5 Export Session B" }).click();
        await expect(exportDialog.getByText("选择会话 (2 已选择)")).toBeVisible({ timeout: 5_000 });
        await expect(exportDialog.getByRole("button", { name: "导出" })).toBeEnabled();
        await page.screenshot({ path: join(acceptanceDir, "2026-06-24-m5-03-batch-export.png"), fullPage: true });
    });
});
