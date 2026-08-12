// E2E: Agents 舰队面板（Herdr 控制面）
//
// 验证真实 Electron renderer 中的 Herdr 舰队 UI 契约:
//  - TopTabBar 第 2 个 tab 切换到「智能体」面板
//  - 非 mock（默认构建）→ 空态提示（无运行时禁止假数据，D6/NL-010）
//  - 任务编排 tab 路由到 MissionCockpit
//  - chat 右栏的 Agents rollup 卡渲染
//
// 注意: mock 舰队（原型同款数据）的完整交互断言走 parity production 套件
// （HERDR_PARITY_TARGET=production + build:mock），本文件只覆盖默认构建。

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

async function getMainWindow(app: ElectronApplication): Promise<Page> {
    return getWindowByUrl(app, "index.html");
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5000 });
    await expect(modal).toHaveCount(0, { timeout: 5000 });
}

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await getMainWindow(app);
    await page.waitForLoadState('domcontentloaded');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await skipOnboarding(page);
    return { app, page };
}

test('智能体 tab 导航 + 非 mock 空态（无运行时禁止假数据）', async () => {
    const { app, page } = await launchApp();
    try {
        const agentsTab = page.locator('[data-mmcode-tab="agents"]');
        await expect(agentsTab).toBeVisible({ timeout: 15_000 });
        await agentsTab.click();
        const surface = page.getByTestId('herdr-control-surface');
        await expect(surface).toBeVisible({ timeout: 10_000 });
        // 非 mock: 空态提示（herdr.card.empty）
        await expect(surface.getByText('该工作区暂无智能体').first()).toBeVisible({ timeout: 10_000 });
        // 全局状态条存在（Herdr 未连接）
        await expect(page.getByTestId('herdr-status-bar')).toBeVisible();
    } finally {
        await app.close();
    }
});

test('任务编排 tab 路由到 MissionCockpit（非 mock 空态）', async () => {
    const { app, page } = await launchApp();
    try {
        const missionTab = page.locator('[data-mmcode-tab="mission"]');
        await expect(missionTab).toBeVisible({ timeout: 15_000 });
        await missionTab.click();
        const hero = page.getByTestId('mission-hero');
        await expect(hero).toBeVisible({ timeout: 10_000 });
        await expect(hero.getByText('任务控制中心')).toBeVisible();
    } finally {
        await app.close();
    }
});

test('chat 右栏显示 Agents rollup 卡（空态）', async () => {
    const { app, page } = await launchApp();
    try {
        await page.locator('[data-mmcode-tab="chat"]').click();
        const toggle = page.locator('[data-mmcode-region="header-right-toggle"]');
        if (await toggle.count() > 0) {
            await toggle.click({ timeout: 5_000 });
        }
        const railAgents = page.getByTestId('right-rail-agents');
        await expect(railAgents).toBeVisible({ timeout: 10_000 });
        // 无 agent → 空态文案
        await expect(railAgents.getByText('当前工作区暂无 Agent').first()).toBeVisible({ timeout: 5_000 });
    } finally {
        await app.close();
    }
});
