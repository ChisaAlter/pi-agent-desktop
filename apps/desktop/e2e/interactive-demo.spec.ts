/**
 * Interactive Demo: Automated clicks through Pi Desktop UI
 * This spec launches the Electron app and automatically performs
 * a series of UI interactions (clicks, inputs, screenshots).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { join } from 'path';
import { mkdirSync } from 'fs';

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1', ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Skip onboarding if present
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

test.describe('Pi Desktop — Interactive Automated Demo', () => {
    let app: ElectronApplication;
    let page: Page;
    const screenshotDir = join(__dirname, '..', 'e2e-output', 'interactive-demo');

    test.beforeAll(() => {
        mkdirSync(screenshotDir, { recursive: true });
    });

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* ignore */ }
    });

    test('auto-navigates through all major UI sections with screenshots', async () => {
        ({ app, page } = await launchApp());

        // ===== Step 1: Initial launch screenshot =====
        await page.screenshot({ path: join(screenshotDir, '01-initial-launch.png') });
        console.log('[AUTO] Screenshot 01: Initial launch captured');

        // ===== Step 2: Click "新建任务" (New Task) =====
        const newTaskBtn = page.locator('button[data-mmcode-section="new-task"]');
        await expect(newTaskBtn).toBeVisible({ timeout: 5000 });
        await newTaskBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(screenshotDir, '02-after-click-new-task.png') });
        console.log('[AUTO] Clicked "新建任务" (New Task)');

        // ===== Step 3: Click "历史" (History) =====
        const historyTab = page.getByRole('tab', { name: '历史' });
        await expect(historyTab).toBeVisible({ timeout: 5000 });
        await historyTab.click();
        await page.keyboard.press('Control+Shift+F');
        await expect(page.getByRole('textbox', { name: '搜索对话历史' })).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(screenshotDir, '03-after-click-history.png') });
        await page.getByRole('button', { name: '关闭搜索' }).click();
        console.log('[AUTO] Clicked "历史" (History)');

        // ===== Step 4: Click "插件" (Skills/Plugins) =====
        const skillsBtn = page.getByRole('tab', { name: '技能' });
        await expect(skillsBtn).toBeVisible({ timeout: 5000 });
        await skillsBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(screenshotDir, '04-after-click-skills.png') });
        console.log('[AUTO] Clicked "插件" (Skills)');

        // Click "+ 创建" dropdown inside skills panel
        const createBtn = page.getByRole('button', { name: /\+ 创建/ });
        if (await createBtn.isVisible().catch(() => false)) {
            await createBtn.click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(screenshotDir, '04b-skills-create-dropdown.png') });
            console.log('[AUTO] Clicked "+ 创建" dropdown in Skills panel');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }

        // ===== Step 5: Click "Git" =====
        const gitBtn = page.getByRole('tab', { name: 'Git' });
        await expect(gitBtn).toBeVisible({ timeout: 5000 });
        await gitBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(screenshotDir, '05-after-click-git.png') });
        console.log('[AUTO] Clicked "Git"');

        // ===== Step 6: Click "设置" (Settings) — opens window =====
        const settingsBtn = page.getByRole('button', { name: '打开设置窗口' });
        await expect(settingsBtn).toBeVisible({ timeout: 5000 });
        const settingsWindowPromise = app.waitForEvent('window');
        await settingsBtn.click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');
        await expect(settingsWindow.getByRole('tablist', { name: '设置分类' })).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(400);
        await settingsWindow.screenshot({ path: join(screenshotDir, '06-after-click-settings.png') });
        console.log('[AUTO] Clicked "设置" (Settings) — window opened');

        // Switch a few Settings tabs (first 3)
        const tabs = settingsWindow.locator('[role="tab"]');
        const tabCount = await tabs.count();
        for (let i = 1; i < Math.min(tabCount, 4); i++) {
            await tabs.nth(i).click();
            await settingsWindow.waitForTimeout(300);
            await settingsWindow.screenshot({ path: join(screenshotDir, `06b-settings-tab-${i}.png`) });
            console.log(`[AUTO] Settings tab ${i} clicked`);
        }

        const settingsClosed = settingsWindow.waitForEvent('close');
        await settingsWindow.getByRole('button', { name: '关闭窗口' }).click();
        await settingsClosed;
        await page.bringToFront();
        await page.screenshot({ path: join(screenshotDir, '06c-after-close-settings.png') });
        console.log('[AUTO] Closed Settings window');

        // ===== Step 7: Open Command Palette with Ctrl+K =====
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(screenshotDir, '07-command-palette-open.png') });
        console.log('[AUTO] Opened Command Palette (Ctrl+K)');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        // ===== Step 8: Click Agent mode trigger =====
        const modeTrigger = page.getByRole('button', { name: '选择 Agent 模式' });
        if (await modeTrigger.isVisible().catch(() => false)) {
            await modeTrigger.click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(screenshotDir, '08-agent-mode-menu-open.png') });
            console.log('[AUTO] Clicked Agent mode trigger');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }

        // ===== Step 9: Click model trigger =====
        const modelTrigger = page.getByRole('button', { name: /当前模型:/ });
        if (await modelTrigger.isVisible().catch(() => false)) {
            await modelTrigger.click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(screenshotDir, '09-model-menu-open.png') });
            console.log('[AUTO] Clicked model trigger');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }

        // ===== Step 10: Final screenshot — back to new task view =====
        await newTaskBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(screenshotDir, '10-final-state.png') });
        console.log('[AUTO] Final screenshot captured');

        console.log('[AUTO] === All automated interactions completed ===');
        console.log(`[AUTO] Screenshots saved to: ${screenshotDir}`);
    });
});
