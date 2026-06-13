import { test, expect, _electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';

async function installTestIpc(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const target = globalThis as typeof globalThis & {
      __promptCalls?: Array<{ workspaceId: string; message: string }>;
    };
    target.__promptCalls = [];

    ipcMain.removeHandler('pi:status');
    ipcMain.handle('pi:status', async () => ({
      installed: true,
      localVersion: 'e2e',
      latestVersion: 'e2e',
      updateAvailable: false,
    }));

    ipcMain.removeHandler('pi:send');
    ipcMain.handle('pi:send', async (_event, workspaceId: string, message: string) => {
      target.__promptCalls?.push({ workspaceId, message });
      return undefined;
    });

    const g = globalThis as typeof globalThis & {
      __testWorkspaces?: Array<{ id: string; name: string; path: string; createdAt: number; lastActiveAt: number }>;
      __testCurrentWorkspaceId?: string | null;
    };
    g.__testWorkspaces = g.__testWorkspaces ?? [];
    g.__testCurrentWorkspaceId = g.__testCurrentWorkspaceId ?? null;

    ipcMain.removeHandler('workspace:create');
    ipcMain.handle('workspace:create', async (_event, name: string, path: string) => {
      const ws = { id: `ws_${name}_${Date.now()}`, name, path, createdAt: Date.now(), lastActiveAt: Date.now() };
      g.__testWorkspaces?.push(ws);
      g.__testCurrentWorkspaceId = ws.id;
      return ws;
    });

    ipcMain.removeHandler('workspace:select');
    ipcMain.handle('workspace:select', async (_event, path: string) => {
      const ws = g.__testWorkspaces?.find((w) => w.path === path);
      if (ws) g.__testCurrentWorkspaceId = ws.id;
      return undefined;
    });

    ipcMain.removeHandler('workspace:list');
    ipcMain.handle('workspace:list', async () => g.__testWorkspaces ?? []);

    ipcMain.removeHandler('session:create');
    ipcMain.handle('session:create', async (_event, workspaceId: string, title?: string, id?: string) => ({
      id: id ?? `session_${Date.now()}`,
      workspaceId,
      title: title ?? 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    }));

    ipcMain.removeHandler('session:list');
    ipcMain.handle('session:list', async () => []);

    ipcMain.removeHandler('plan:set-enabled');
    ipcMain.handle('plan:set-enabled', async () => undefined);

    ipcMain.removeHandler('agents:list');
    ipcMain.handle('agents:list', async () => []);

    ipcMain.removeHandler('agents:create');
    ipcMain.handle('agents:create', async () => ({ id: 'agent_test', workspaceId: 'ws_plan-test', title: 'Test Agent' }));

    ipcMain.removeHandler('agents:prompt');
    ipcMain.handle('agents:prompt', async (_event, input: { agentId: string; message: string }) => {
      const target = globalThis as typeof globalThis & { __promptCalls?: Array<{ workspaceId: string; message: string }> };
      target.__promptCalls?.push({ workspaceId: input.agentId, message: input.message });
      return undefined;
    });
  });
}

test.describe('Plan Mode Smoke Test', () => {
  let app: ElectronApplication;
  let page: Page;

  test.afterEach(async () => {
    try { await app?.close(); } catch { /* ignore */ }
  });

  test('plan mode clarification flow blocks first message and merges on second', async () => {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}`);
    app = await _electron.launch({
      args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
      env: { ...process.env, CI: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    page.on('console', (msg) => {
      console.log(`[RENDERER ${msg.type()}]`, msg.text());
    });

    await installTestIpc(app);

    // Setup: create workspace and skip onboarding
    await page.evaluate(async () => {
      window.localStorage.setItem('pi-desktop:firstLaunchDone', 'true');
      window.localStorage.setItem('pi-desktop.onboarding.completed', 'true');
      const ws = await window.piAPI.createWorkspace('plan-test', 'C:\\plan-test');
      await window.piAPI.selectWorkspace(ws.path);
    });

    // Wait for UI to settle and skip onboarding if present
    await page.waitForTimeout(1000);
    const onboardingModal = page.locator('[data-testid="onboarding-modal"]');
    if (await onboardingModal.count() > 0) {
      await page.getByRole('button', { name: '跳过引导' }).click();
      await expect(onboardingModal).toHaveCount(0, { timeout: 5_000 });
    }

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    // Enable plan mode via plus menu
    const plus = page.locator('[data-testid="chat-input-plus-trigger"]');
    await expect(plus).toBeVisible();
    await plus.click();
    await expect(page.getByRole('menuitemcheckbox', { name: '计划模式' })).toBeVisible();
    await page.getByRole('menuitemcheckbox', { name: '计划模式' }).click();

    // Wait for plan mode tag to appear
    await expect(page.locator('text=计划模式').first()).toBeVisible();

    // Send first message - should be blocked with clarification
    await textarea.fill('了解一下这个项目');
    await textarea.press('Enter');

    // Verify no prompt was sent to Pi yet
    await page.waitForTimeout(500);
    const callCount1 = await app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __promptCalls?: unknown[] };
      return target.__promptCalls?.length ?? 0;
    });
    expect(callCount1).toBe(0);

    // Verify clarification message appears in UI
    await expect(page.getByText('计划模式需要目标')).toBeVisible({ timeout: 5_000 });

    // Debug: check page content before second message
    const pageContent = await page.content();
    console.log('Page has 计划模式需要目标:', pageContent.includes('计划模式需要目标'));
    console.log('Page has 了解一下这个项目:', pageContent.includes('了解一下这个项目'));

    // Debug: check IPC call count before second message
    const callCountBefore = await app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __promptCalls?: unknown[] };
      return target.__promptCalls?.length ?? 0;
    });
    console.log('IPC call count before second message:', callCountBefore);

    // Debug: check textarea state before second message
    const textareaDisabled = await textarea.evaluate((el) => (el as HTMLTextAreaElement).disabled);
    console.log('Textarea disabled before second message:', textareaDisabled);

    // Send second message with clarification
    await textarea.fill('我要重构聊天输入框的计划模式交互');
    await textarea.press('Enter');

    // Wait a bit and check again
    await page.waitForTimeout(1000);
    const callCountAfter = await app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __promptCalls?: unknown[] };
      return target.__promptCalls?.length ?? 0;
    });
    console.log('IPC call count after second message:', callCountAfter);

    // Verify prompt was sent with /plan prefix and merged content
    await expect.poll(async () => {
      const calls = await app.evaluate(() => {
        const target = globalThis as typeof globalThis & { __promptCalls?: Array<{ message: string }> };
        return target.__promptCalls ?? [];
      });
      return calls.length;
    }, { timeout: 15_000 }).toBe(1);

    const sentMessage = await app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __promptCalls?: Array<{ message: string }> };
      return target.__promptCalls?.[0]?.message ?? '';
    });

    expect(sentMessage).toContain('/plan');
    expect(sentMessage).toContain('原始请求:');
    expect(sentMessage).toContain('了解一下这个项目');
    expect(sentMessage).toContain('补充目标:');
    expect(sentMessage).toContain('我要重构聊天输入框的计划模式交互');
  });
});
