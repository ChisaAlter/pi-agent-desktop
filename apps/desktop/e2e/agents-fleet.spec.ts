// E2E: Agents 舰队面板 (herdr 式编排视图)
//
// 验证真实 Electron renderer 中的舰队 UI 契约:
//  - TopTabBar 第 2 个 tab 切换到 Agents 面板
//  - seed 的 agent 以卡片形式展示 (标题 + 空闲徽章 + 工作区)
//  - 新建 Agent 弹窗 → 创建 → 新卡片出现 (不发送真 prompt, 防真 agent 干扰)
//  - chat 右栏的 Agents rollup 卡渲染
//
// 断言全部基于 UI 结构 (宽容断言), 不依赖真实模型推理。

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

async function seedWorkspaceWithAgent(page: Page, workspacePath: string, agentTitle: string): Promise<string> {
    return page.evaluate(async ({ workspacePath, agentTitle }) => {
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
        window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
        const ws = await window.piAPI.createWorkspace("agents-fleet-e2e", workspacePath);
        await window.piAPI.selectWorkspace(ws.path);
        const agent = await window.piAPI.agentsCreate({ workspaceId: ws.id, title: agentTitle });
        return ws.id;
    }, { workspacePath, agentTitle });
}

async function launchFleetApp(): Promise<{ app: ElectronApplication; page: Page; workspaceId: string }> {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const workspacePath = test.info().outputPath('agents-fleet-workspace');
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await getMainWindow(app);
    await page.waitForLoadState('domcontentloaded');
    const workspaceId = await seedWorkspaceWithAgent(page, workspacePath, "fleet-agent-1");
    await page.reload({ waitUntil: 'domcontentloaded' });
    await skipOnboarding(page);
    return { app, page, workspaceId };
}

test('Agents tab 导航 + 舰队卡片渲染', async () => {
    const { app, page } = await launchFleetApp();
    try {
        // TopTabBar 第 2 个 tab = Agents
        const agentsTab = page.locator('[data-mmcode-tab="agents"]');
        await expect(agentsTab).toBeVisible({ timeout: 15_000 });
        await agentsTab.click();
        const panel = page.getByTestId('agents-panel');
        await expect(panel).toBeVisible({ timeout: 10_000 });

        // 断言限定在面板作用域内, 避免撞到左侧栏的 workspace 名 (hidden)
        await expect(panel.getByText('fleet-agent-1').first()).toBeVisible({ timeout: 10_000 });
        await expect(panel.getByText('空闲').first()).toBeVisible();
        await expect(panel.getByText('agents-fleet-e2e').first()).toBeVisible();

        // 卡片操作区存在
        await expect(panel.getByText('打开对话').first()).toBeVisible();
        await expect(panel.getByText('停止').first()).toBeVisible();
        await expect(panel.getByText('重启').first()).toBeVisible();
    } finally {
        await app.close();
    }
});

test('新建 Agent 弹窗 → 创建后新卡片出现', async () => {
    const { app, page } = await launchFleetApp();
    try {
        await page.locator('[data-mmcode-tab="agents"]').click();
        const panel = page.getByTestId('agents-panel');
        await expect(panel).toBeVisible({ timeout: 10_000 });

        await panel.getByTestId('new-agent-button').click();
        await expect(page.getByTestId('new-agent-dialog')).toBeVisible({ timeout: 5_000 });

        // 填标题并创建 (不填任务描述, 不触发真 prompt)
        await page.getByPlaceholder('给这个 agent 起个名字（可选）').fill('fleet-agent-2');
        await page.getByRole('button', { name: '创建', exact: true }).click();

        // 新卡片出现 (创建是异步的, 宽容超时)
        await expect(panel.getByText('fleet-agent-2').first()).toBeVisible({ timeout: 15_000 });
    } finally {
        await app.close();
    }
});

test('chat 右栏显示 Agents rollup 卡', async () => {
    const { app, page } = await launchFleetApp();
    try {
        // 回到 chat tab, 手动展开右栏 (默认折叠, 且首条消息未发送不自动展开)
        await page.locator('[data-mmcode-tab="chat"]').click();
        const toggle = page.locator('[data-mmcode-region="header-right-toggle"]');
        if (await toggle.count() > 0) {
            await toggle.click({ timeout: 5_000 });
        }
        const railAgents = page.getByTestId('right-rail-agents');
        await expect(railAgents).toBeVisible({ timeout: 10_000 });
        await expect(railAgents.getByText('Agents').first()).toBeVisible();
        // seed 的 agent 空闲且无产出 → "全部空闲"
        await expect(railAgents.getByText('全部空闲').first()).toBeVisible({ timeout: 5_000 });
    } finally {
        await app.close();
    }
});
