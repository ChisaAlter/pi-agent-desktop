/**
 * Session Center Tests — Pi Desktop 会话中心
 *
 * 覆盖:
 *   1. 会话列表加载
 *   2. 创建新会话
 *   3. 切换会话
 *   4. 会话搜索
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { join } from 'path';

const TEST_TIMEOUT = 60_000;

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1', ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

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

test.describe('Pi Desktop — Session Center', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('session center UI loads', async () => {
        const userDataDir = test.info().outputPath(`session-ui-${Date.now()}`);
        const { app, page } = await launchApp(userDataDir);

        await page.getByRole('tab', { name: '历史' }).click();
        await expect(page.getByRole('heading', { name: '会话中心' })).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Control+Shift+F');
        await expect(page.getByRole('textbox', { name: '搜索对话历史' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: '关闭搜索' })).toBeVisible();
        await page.getByRole('button', { name: '关闭搜索' }).click();
        await expect(page.getByRole('textbox', { name: '搜索对话历史' })).toBeHidden({ timeout: 3000 });

        await app.close();
    });

    test('session IPC: create + list + delete', async () => {
        const userDataDir = test.info().outputPath(`session-lifecycle-${Date.now()}`);
        const wsPath = join(userDataDir, 'workspace');
        const { app, page } = await launchApp(userDataDir);

        // Create workspace
        const ws = await page.evaluate(async ({ wsPath }) => {
            return await window.piAPI.createWorkspace('session-test', wsPath);
        }, { wsPath });
        expect(ws).toBeTruthy();

        // Create sessions
        const sessions = await page.evaluate(async () => {
            const workspaces = await window.piAPI.listWorkspaces();
            const ws = workspaces[0];
            if (!ws) return [];

            const s1 = await window.piAPI.createSession(ws.id, 'Session A', 'session-a');
            const s2 = await window.piAPI.createSession(ws.id, 'Session B', 'session-b');

            const list = await window.piAPI.listSessions();
            return list.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title }));
        });

        expect(sessions.length).toBeGreaterThanOrEqual(2);
        const titles = sessions.map((s: { title: string }) => s.title);
        expect(titles).toContain('Session A');
        expect(titles).toContain('Session B');

        console.log(`[TEST] Sessions: ${titles.join(', ')}`);

        // Delete one session
        await page.evaluate(async () => {
            await window.piAPI.deleteSession('session-a');
            return await window.piAPI.listSessions();
        });

        const afterDelete = await page.evaluate(async () => {
            const list = await window.piAPI.listSessions();
            return list.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title }));
        });

        const afterTitles = afterDelete.map((s: { title: string }) => s.title);
        expect(afterTitles).not.toContain('Session A');
        expect(afterTitles).toContain('Session B');

        console.log(`[TEST] After delete: ${afterTitles.join(', ')}`);

        await app.close();
    });
});
