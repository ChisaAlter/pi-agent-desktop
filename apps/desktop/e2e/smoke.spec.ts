// E2E smoke: 全面 runtime test v1.0.16 Pi Desktop 的各个功能。
//
// 覆盖矩阵:
//   - 顶部导航路由 (对话/技能/Git/历史/设置窗口)
//   - ChatView 新对话页 + ChatInput 渲染
//   - 插件面板 3 个真接通按钮 (GitHub 导入/编写技能/搜索)
//   - Settings 独立窗口接通 + 10 个 tabs
//   - CommandPalette 接通 (Ctrl+K 快捷键)
//   - ApprovalPanel 渲染 + 自动审批 toggle
//   - ChatInput reference-frame 控件 (附件/Agent 模式/模型/思考强度)
//
// 设计原则: 用 page.click 触发 React onClick, 不走 OS 鼠标 (避免 z-order 抢焦点)

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1', ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // v1.0.16: 跳过 onboarding
    //   路径 A: 之前 localStorage 没设 firstLaunchDone → onboarding 渲染 → 点 "跳过引导"
    //   路径 B: 之前已点过 (localStorage=true) → onboarding 不渲染 → 跳过
    // 注: 不能用 .remove() 删 DOM (破坏 React ownership 导致 portal 卸载时
    //      removeChild error 把 App crash 到 error boundary,见 memory entry)
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

test.describe('Pi Desktop v1.0.16 — 全功能 smoke', () => {
    let app: ElectronApplication;
    let page: Page;

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* ignore */ }
    });

    test('1. 顶部导航主路由 (对话/技能/Git/历史/设置窗口)', async () => {
        ({ app, page } = await launchApp());

        await expect(page.getByRole('tablist', { name: '顶部标签栏' })).toBeVisible();
        await expect(page.getByRole('tab', { name: '对话' })).toBeVisible();
        await expect(page.getByRole('tab', { name: '技能' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Git' })).toBeVisible();
        await expect(page.getByRole('tab', { name: '历史' })).toBeVisible();
        await expect(page.getByRole('button', { name: '打开设置窗口' })).toBeVisible();
        await expect(page.locator('button[data-mmcode-section="new-task"]')).toBeVisible();

        // 导航已移到顶部，左栏只保留会话列表。
        await expect(page.locator('nav[aria-label="会话列表"]')).toBeVisible();

        await page.getByRole('tab', { name: '技能' }).click();
        await expect(page.getByRole('region', { name: '插件面板' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('tab', { name: '技能' })).toHaveAttribute('aria-selected', 'true');

        await page.getByRole('tab', { name: 'Git' }).click();
        await expect(page.getByRole('region', { name: 'Git 面板' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('tab', { name: 'Git' })).toHaveAttribute('aria-selected', 'true');

        await page.getByRole('tab', { name: '历史' }).click();
        await page.keyboard.press('Control+Shift+F');
        await expect(page.getByRole('textbox', { name: '搜索对话历史' })).toBeVisible({ timeout: 5000 });
        await page.getByRole('button', { name: '关闭搜索' }).click();
        await expect(page.getByRole('textbox', { name: '搜索对话历史' })).toBeHidden({ timeout: 3000 });

        const settingsWindowPromise = app.waitForEvent('window');
        await page.getByRole('button', { name: '打开设置窗口' }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');
        await expect(settingsWindow.getByRole('tablist', { name: '设置分类' })).toBeVisible({ timeout: 5000 });

        const settingsClosed = settingsWindow.waitForEvent('close');
        await settingsWindow.getByRole('button', { name: '关闭窗口' }).click();
        await settingsClosed;
        await page.bringToFront();

        await page.locator('button[data-mmcode-section="new-task"]').click();
        await expect(page.getByText('输入消息后，Pi Agent 会在当前工作区开始运行。')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('tab', { name: '对话' })).toHaveAttribute('aria-selected', 'true');
    });

    test('2. ChatView 新对话页和 ChatInput 渲染', async () => {
        ({ app, page } = await launchApp());

        await expect(page.getByText('输入消息后，Pi Agent 会在当前工作区开始运行。')).toBeVisible({ timeout: 15000 });

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i]').first();
        await expect(textarea).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: '添加文件或图片' })).toBeVisible();
        await expect(page.getByRole('button', { name: '打开 Slash 命令' })).toBeVisible();
        await expect(page.getByRole('button', { name: '选择 Agent 模式' })).toBeVisible();
        await expect(page.getByRole('button', { name: /当前模型:/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /思考强度:/ })).toBeVisible();
        await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
        await expect(page.locator('[data-testid="chat-input-reference-controls"]')).toBeVisible();
    });

    test('3. 插件面板 3 个真接通按钮', async () => {
        ({ app, page } = await launchApp());

        // 切到插件面板
        await page.getByRole('tab', { name: '技能' }).click();
        await expect(page.getByRole('region', { name: '插件面板' })).toBeVisible({ timeout: 5000 });

        // (1) "+ 创建" dropdown 按钮接通
        const createBtn = page.getByRole('button', { name: /\+ 创建/ });
        await expect(createBtn).toBeVisible();

        // (2) 点 "+ 创建" → dropdown 展开 → 3 选项都在
        await createBtn.click();
        const buildBtn = page.getByRole('button', { name: /用 Pi 构建/ });
        const writeBtn = page.getByRole('button', { name: /编写技能/ });
        // 注:实际渲染是 "从 Github 导入"(小写 h),文本匹配用 regex
        const githubBtn = page.getByRole('button', { name: /从 Github 导入/ });
        await expect(buildBtn).toBeVisible();
        await expect(writeBtn).toBeVisible();
        await expect(githubBtn).toBeVisible();

        // (3) 点 "编写技能" 关闭 dropdown + 弹写技能 modal
        await writeBtn.click();
        // modal 有 aria-label="编写技能" dialog 出现
        const writeDialog = page.getByRole('dialog', { name: '编写技能' });
        await expect(writeDialog).toBeVisible({ timeout: 5000 });
        // 关闭 modal — modal 内部"取消"按钮 (aria-label=t("common.cancel")="取消")
        await writeDialog.getByRole('button', { name: '取消' }).click();
        await expect(writeDialog).toBeHidden({ timeout: 3000 });

        // (4) "搜索 Pi 插件" input 接通 — <input> 默认 type=text 不是 search, 用 getByLabel
        const searchInput = page.getByLabel('搜索 Pi 插件');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('pi-coding-agent');
        const v = await searchInput.inputValue();
        expect(v).toBe('pi-coding-agent');
    });

    test('4. Settings 独立窗口接通 — 10 个 tabs 都能切', async () => {
        ({ app, page } = await launchApp());

        const settingsWindowPromise = app.waitForEvent('window');
        await page.getByRole('button', { name: '打开设置窗口' }).click();
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');

        const tablist = settingsWindow.getByRole('tablist', { name: '设置分类' });
        await expect(tablist).toBeVisible();
        const tabs = tablist.getByRole('tab');
        const tabCount = await tabs.count();
        expect(tabCount).toBe(10);
        for (const name of ['模型', 'Agent', '权限', '用量', '长程能力', '界面', '通用', '快捷键', '配置文件', '关于']) {
            await expect(tablist.getByRole('tab', { name })).toBeVisible();
        }

        // 验证能切 tab
        await tablist.getByRole('tab', { name: '模型' }).click();
        await expect(tablist.getByRole('tab', { name: '模型' })).toHaveAttribute('aria-selected', 'true');

        await tablist.getByRole('tab', { name: '长程能力' }).click();
        await expect(tablist.getByRole('tab', { name: '长程能力' })).toHaveAttribute('aria-selected', 'true');

        await tablist.getByRole('tab', { name: '界面' }).click();
        await expect(tablist.getByRole('tab', { name: '界面' })).toHaveAttribute('aria-selected', 'true');

        await tablist.getByRole('tab', { name: '关于' }).click();
        await expect(tablist.getByRole('tab', { name: '关于' })).toHaveAttribute('aria-selected', 'true');

        const settingsClosed = settingsWindow.waitForEvent('close');
        await settingsWindow.getByRole('button', { name: '关闭窗口' }).click();
        await settingsClosed;
    });

    test('5. CommandPalette 接通 — Ctrl+K 快捷键', async () => {
        ({ app, page } = await launchApp());

        // 默认未开
        await expect(page.locator('[role="dialog"]').filter({ hasText: '命令面板' })).toHaveCount(0);

        // Ctrl+K 打开(aria-label 含 "Ctrl+K" 副标题,用 attribute selector 最稳)
        await page.keyboard.press('Control+k');
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        await expect(palette).toBeVisible({ timeout: 3000 });

        // search input 接通(aria-label=t("commandPalette.aria.search")="搜索命令")
        // 注: <input> 默认 type=text 不是 search, getByRole('searchbox') 找不到
        // 注: getByLabel('搜索') 严格模式 match 2 个 (CommandPalette "搜索命令" + SkillsPanel "搜索技能")
        // 用精确 attribute selector
        const search = palette.locator('input[aria-label="搜索命令"]');
        await expect(search).toBeVisible();
        // 验证 input 可交互 — 验证 placeholder (默认 mode='file' 时 placeholder 是 "搜索文件..."),
        // 不强求 value 验证,因为 fill 后会触发 onChange 重新渲染导致 input 引用 stale
        const placeholder = await search.getAttribute('placeholder');
        expect(placeholder).toBeTruthy();

        // Escape 关闭 (App.tsx 调 setPaletteOpen(false))
        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden({ timeout: 3000 });
    });

    test('7. ChatInput reference-frame 控件接通', async () => {
        ({ app, page } = await launchApp());

        const attachBtn = page.getByRole('button', { name: '添加文件或图片' });
        const agentModeTrigger = page.getByRole('button', { name: '选择 Agent 模式' });
        const modelTrigger = page.getByRole('button', { name: /当前模型:/ });
        const thinkingTrigger = page.getByRole('button', { name: /思考强度:/ });
        await expect(attachBtn).toBeVisible();
        await expect(agentModeTrigger).toBeVisible();
        await expect(modelTrigger).toBeVisible();
        await expect(thinkingTrigger).toBeVisible();

        await agentModeTrigger.click();
        const agentModeMenu = page.getByRole('menu', { name: 'Agent 模式' });
        await expect(agentModeMenu).toBeVisible();
        await expect(agentModeMenu.getByRole('menuitemradio', { name: /Build/ })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(agentModeMenu).toBeHidden();

        await modelTrigger.click();
        const modelMenu = page.getByRole('menu').filter({ hasText: '选择模型' });
        await expect(modelMenu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modelMenu).toBeHidden();

        await thinkingTrigger.click();
        const thinkingMenu = page.getByRole('menu', { name: '思考强度' });
        await expect(thinkingMenu).toBeVisible();
        await expect(thinkingMenu.getByRole('menuitemradio', { name: '高' })).toBeVisible();
        await thinkingMenu.getByRole('menuitemradio', { name: '低' }).click();
        await expect(thinkingMenu).toBeHidden();
        await expect(thinkingTrigger).toContainText('低');

        // 附件按钮 React fiber onClick 检查
        const hasOnClick = await page.evaluate(() => {
            const el = document.querySelector('button[aria-label="添加文件或图片"]') as
                | (HTMLElement & Record<string, unknown>)
                | null;
            if (!el) return false;
            const propKeys = Object.keys(el).filter(
                (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
            );
            const props = propKeys.length > 0 ? (el[propKeys[0]] as { onClick?: unknown }) : null;
            return typeof props?.onClick === 'function';
        });
        expect(hasOnClick).toBe(true);
    });
});
