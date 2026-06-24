/**
 * File & Git Workflow Tests — Pi Desktop 文件操作与版本控制
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const TEST_TIMEOUT = 60_000;

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1', ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

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

function prepareGitRepo(dir: string): void {
    const { execSync } = require('child_process');
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'README.md'), '# Test Project\n', 'utf-8');
    execSync('git add README.md', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: 'ignore' });
}

async function reloadAppShell(page: Page): Promise<void> {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const modal = page.locator('[data-testid="onboarding-modal"]');
    await expect(modal).toHaveCount(0, { timeout: 5000 });
}

test.describe('Pi Desktop — File & Git Workflow', () => {
    test.setTimeout(TEST_TIMEOUT);

    // ===== Test 1: Git 状态检测 =====
    test('git status via IPC shows correct branch and modifications', async () => {
        const userDataDir = test.info().outputPath(`git-test-${Date.now()}`);
        const wsPath = join(userDataDir, 'git-project');
        mkdirSync(wsPath, { recursive: true });
        prepareGitRepo(wsPath);
        writeFileSync(join(wsPath, 'modified.ts'), 'export const changed = true;\n', 'utf-8');

        const { app, page } = await launchApp(userDataDir);

        const workspace = await page.evaluate(async ({ wsPath }) => {
            return await window.piAPI.createWorkspace('git-test', wsPath);
        }, { wsPath });

        const gitStatus = await page.evaluate(async (workspacePath) => {
            return await window.piAPI.getGitStatus(workspacePath);
        }, workspace.path);

        expect(gitStatus).toBeTruthy();
        expect(gitStatus.branch).toBeTruthy();
        expect([...(gitStatus.modified ?? []), ...(gitStatus.untracked ?? [])]).toContain('modified.ts');
        console.log(`[TEST] Git branch: ${gitStatus.branch}, modified files: ${gitStatus.modified?.length ?? 0}`);

        await app.close();
    });

    // ===== Test 2: 文件树加载 (通过 project:detect) =====
    test('project detection returns file tree', async () => {
        const userDataDir = test.info().outputPath(`project-${Date.now()}`);
        const wsPath = join(userDataDir, 'project');
        mkdirSync(wsPath, { recursive: true });
        writeFileSync(join(wsPath, 'index.ts'), 'export const x = 1;\n', 'utf-8');
        writeFileSync(join(wsPath, 'package.json'), '{"name": "test"}\n', 'utf-8');

        const { app, page } = await launchApp(userDataDir);

        await page.evaluate(async ({ wsPath }) => {
            await window.piAPI.createWorkspace('project-test', wsPath);
        }, { wsPath });

        const project = await page.evaluate(async () => {
            const workspaces = await window.piAPI.listWorkspaces();
            const ws = workspaces[0];
            if (!ws) return null;
            return await window.piAPI.detectProject(ws.path);
        });

        expect(project).toBeTruthy();
        console.log(`[TEST] Project detected: ${JSON.stringify(project).slice(0, 200)}`);

        await app.close();
    });

    test('Git panel UI opens diffs, stages, unstages, and commits a real workspace change', async () => {
        const userDataDir = test.info().outputPath(`git-panel-ui-${Date.now()}`);
        const wsPath = join(userDataDir, 'git-panel-project');
        mkdirSync(wsPath, { recursive: true });
        prepareGitRepo(wsPath);
        writeFileSync(join(wsPath, 'README.md'), '# Test Project\n\nEdited from GitPanel E2E.\n', 'utf-8');

        const { app, page } = await launchApp(userDataDir);

        await page.evaluate(async ({ wsPath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace('git-panel-ui', wsPath);
            await window.piAPI.selectWorkspace(ws.path);
        }, { wsPath });
        await reloadAppShell(page);

        await page.getByRole('tab', { name: 'Git' }).click();
        await expect(page.getByRole('region', { name: 'Git 面板' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/0 staged \/ 1 changes/)).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: '刷新 Git 状态' }).click();
        await expect(page.getByRole('button', { name: '打开 README.md diff' })).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: '打开 README.md diff' }).click();
        await expect(page.getByText('Edited from GitPanel E2E.')).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: '打开 README.md diff' }).hover();
        await page.getByRole('button', { name: '暂存 README.md' }).click();
        await expect(page.getByRole('status').filter({ hasText: '已暂存 README.md' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/1 staged \/ 0 changes/)).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: '打开 README.md diff' }).hover();
        await page.getByRole('button', { name: '取消暂存 README.md' }).click();
        await expect(page.getByRole('status').filter({ hasText: '已取消暂存 README.md' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/0 staged \/ 1 changes/)).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: '全部暂存' }).click();
        await expect(page.getByRole('status').filter({ hasText: '已暂存 1 个文件' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('只会提交 1 个暂存文件')).toBeVisible({ timeout: 10_000 });

        await page.getByRole('textbox', { name: '提交信息' }).fill('test: commit from git panel e2e');
        await expect(page.getByRole('button', { name: '提交' })).toBeEnabled();
        await page.getByRole('button', { name: '提交' }).click();
        await expect(page.getByRole('status').filter({ hasText: '提交完成: test: commit from git panel e2e' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('工作区干净')).toBeVisible({ timeout: 15_000 });

        await app.close();
    });
});
