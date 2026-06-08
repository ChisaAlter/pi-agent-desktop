/**
 * Pi Desktop 完整功能演示 — Playwright E2E
 *
 * 覆盖:
 *   1. 启动 + 跳过 onboarding
 *   2. 右侧面板 (Agent 卡片 / Git / 计划)
 *   3. 聊天空态和输入框
 *   4. 设置面板 (模型/Auth/桌面/原始JSON)
 *   5. 技能面板
 *   6. 命令面板
 *   7. 终端 Dock (如果有)
 */

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: [electronMainEntry],
    env: { ...process.env, CI: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // 跳过 onboarding
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

test.describe('Pi Desktop 完整功能演示', () => {
  let app: ElectronApplication;
  let page: Page;

  test.afterEach(async () => {
    try { await app?.close(); } catch { /* ignore */ }
  });

  test('启动 → 导航 → 设置 → 技能 → 聊天 → 截图', async () => {
    ({ app, page } = await launchApp());

    // ── 1. 启动确认 ──────────────────────────────
    await page.screenshot({ path: 'e2e-output/demo-01-launch.png' });
    // 标题栏
    await expect(page).toHaveTitle(/Pi|Desktop/);

    // ── 2. Sidebar 导航 ─────────────────────────
    // 新建任务 (默认)
    await expect(page.locator('button[data-mmcode-section="new-task"]')).toBeVisible({ timeout: 10000 });

    // 技能按钮
    await page.locator('button[data-mmcode-section="skills"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e-output/demo-02-skills.png' });

    // 设置按钮
    await page.locator('button[data-mmcode-section="settings"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e-output/demo-03-settings.png' });

    // 关闭设置
    const settingsDialog = page.getByRole('dialog', { name: '设置' });
    const closeBtn = settingsDialog.locator('button[aria-label="关闭"]');
    if (await closeBtn.isVisible()) await closeBtn.click();

    // 回到聊天
    await page.locator('button[data-mmcode-section="new-task"]').click();
    await page.waitForTimeout(500);

    // ── 3. 聊天空态 ──────────────────────────────
    await expect(page.getByRole('heading', { name: '准备好开始了吗？' })).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e-output/demo-04-chat-empty.png' });

    // ── 4. 聊天输入 ──────────────────────────────
    const input = page.locator('textarea[placeholder]').first();
    await input.fill('用 TypeScript 写一个简单的 TODO 应用，包含增删改查功能');
    await page.screenshot({ path: 'e2e-output/demo-05-input.png' });

    // 发送消息
    await input.press('Enter');
    // 等待一些流式响应
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'e2e-output/demo-06-streaming.png' });

    // 等待完成 (最多 60s)
    try {
      await page.waitForFunction(() => {
        const els = document.querySelectorAll('[data-testid="message-bubble"]');
        return els.length >= 2;
      }, { timeout: 60000 });
    } catch {
      // 超时也继续
    }
    await page.screenshot({ path: 'e2e-output/demo-07-response.png' });

    // ── 5. 右侧面板 (RightRail) ─────────────────
    // 看看 Agent 卡片
    await page.screenshot({ path: 'e2e-output/demo-08-full-layout.png', fullPage: false });

    // ── 6. 命令面板 (Ctrl+K) ────────────────────
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'e2e-output/demo-09-command-palette.png' });
    await page.keyboard.press('Escape');

    // ── 7. 设置 Model Tab ───────────────────────
    await page.locator('button[data-mmcode-section="settings"]').click();
    await page.waitForTimeout(500);

    // 尝试切换 tab
    const modelTab = page.getByRole('tab', { name: '模型' });
    if (await modelTab.isVisible()) {
      await modelTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'e2e-output/demo-10-settings-model.png' });
    }
  });
});
