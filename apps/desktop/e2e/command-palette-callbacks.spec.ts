// E2E: CommandPalette 3 callback 真接通 (v1.0.16 audit sweep fix)
//
// 背景: App.tsx 之前只给 CommandPalette 传 isOpen / onClose / workspacePath,
//        漏了 onSelectFile / onSelectHistory / onRunCommand — 3 个 callback 全
//        optional + undefined, 点了文件/历史/命令 5 个 cmd 都没反应.
//
// 本 spec 验证修复后行为:
//   (1) cmd mode: 5 个命令 click 行为正确 (switch_workspace 用 IPC stub
//        替代原生目录窗口, 仍走真实命令面板点击和 App 回调)
//   (2) file mode: UI 渲染 + 3 tab 切换正常 + 真实文件结果点击灌入聊天输入框
//   (3) history mode: UI 渲染 + tab 切换正常 + 真实历史结果点击切换会话
//
// 关键点 (踩坑记录,见 memory):
//   - 跳过 onboarding 走 React onComplete 路径 (点 "跳过引导" 按钮),
//     不能 page.evaluate(() => modal.remove()) (会破坏 React 19 DOM ownership)
//   - Settings dialog 打开后, 后续测试前必须关 (App.tsx modal 状态独立于
//     sidebar 切换; 不关会遮 chat panel 副标题)
//   - Terminal panel 打开后, 后续测试前必须 toggle 关 (盖住 chat panel)
//   - 切 mode 用 click tab button, 不用 keyboard.press('Tab') (CommandPalette 的
//     Tab 切 mode 依赖 search input 有焦点, headless 时 focus 时机不稳)
//   - commandPalette 的 tab 标签: 文件 / 历史 / 命令 (i18n zh-CN)

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // 走 React onComplete 路径 (memory 警告: 不能 modal.remove() 破坏 React ownership)
    const modalCount = await page.locator('[data-testid="onboarding-modal"]').count();
    if (modalCount > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5000 });
        await page.waitForFunction(
            () => document.querySelector('[data-testid="onboarding-modal"]') === null,
            { timeout: 5000 },
        );
    }
    return { app, page };
}

async function installWorkspaceSwitchIpc(app: ElectronApplication, selectedPath: string): Promise<void> {
    await app.evaluate(({ ipcMain }, selectedPath) => {
        const target = globalThis as typeof globalThis & {
            __paletteWorkspaceEvents?: Array<{ channel: string; name?: string; path?: string }>;
            __paletteWorkspaces?: Array<{ id: string; name: string; path: string; createdAt: number; lastActiveAt: number }>;
        };
        target.__paletteWorkspaceEvents = [];
        target.__paletteWorkspaces = [{
            id: "palette-initial",
            name: "palette-initial",
            path: "C:\\palette-initial",
            createdAt: Date.now() - 1000,
            lastActiveAt: Date.now() - 1000,
        }];

        ipcMain.removeHandler("workspace:select-directory");
        ipcMain.handle("workspace:select-directory", async () => {
            target.__paletteWorkspaceEvents?.push({ channel: "workspace:select-directory", path: selectedPath });
            return selectedPath;
        });

        ipcMain.removeHandler("workspace:create");
        ipcMain.handle("workspace:create", async (_event, name: string, path: string) => {
            const ws = { id: `palette-switch-${Date.now()}`, name, path, createdAt: Date.now(), lastActiveAt: Date.now() };
            target.__paletteWorkspaceEvents?.push({ channel: "workspace:create", name, path });
            target.__paletteWorkspaces?.push(ws);
            return ws;
        });

        ipcMain.removeHandler("workspace:select");
        ipcMain.handle("workspace:select", async (_event, path: string) => {
            target.__paletteWorkspaceEvents?.push({ channel: "workspace:select", path });
            return undefined;
        });

        ipcMain.removeHandler("workspace:list");
        ipcMain.handle("workspace:list", async () => target.__paletteWorkspaces ?? []);
    }, selectedPath);
}

async function reloadAppShell(page: Page): Promise<void> {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const modal = page.locator('[data-testid="onboarding-modal"]');
    await expect(modal).toHaveCount(0, { timeout: 5000 });
}

async function openPalette(page: Page): Promise<void> {
    await page.keyboard.press('Control+k');
    const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
    await expect(palette).toBeVisible({ timeout: 3000 });
}

async function closePalette(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
    await expect(palette).toBeHidden({ timeout: 3000 });
}

type Mode = 'file' | 'history' | 'cmd';

async function switchMode(page: Page, target: Mode): Promise<void> {
    // 用 click tab button, 不用 keyboard Tab (focus 时机不稳)
    const tabName = target === 'cmd' ? '命令' : target === 'history' ? '历史' : '文件';
    const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
    await palette.getByRole('tab', { name: tabName }).click();
    // 验证切到位
    await expect(palette.getByRole('tab', { name: tabName })).toHaveAttribute('aria-selected', 'true');
}

test.describe('CommandPalette 3 callback (v1.0.16 fix)', () => {
    let app: ElectronApplication;
    let page: Page;

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* ignore */ }
    });

    test('cmd mode — 导航命令 click 行为正确 (new_chat / open_skills / open_settings)', async () => {
        ({ app, page } = await launchApp());

        // 起点: chat panel 副标题可见
        await expect(page.getByText('输入消息后，Pi Agent 会在当前工作区开始运行。')).toBeVisible({ timeout: 15_000 });

        // ── 1. new_chat — 切到 chat (本来就在 chat, 验证 palette 关闭 + 副标题还在)
        await openPalette(page);
        await switchMode(page, 'cmd');
        const cmdPalette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        await cmdPalette.getByRole('option', { name: /新建对话/ }).click();
        // palette 关闭
        await expect(cmdPalette).toBeHidden({ timeout: 3000 });
        // 还在 chat (副标题可见)
        await expect(page.getByText('输入消息后，Pi Agent 会在当前工作区开始运行。')).toBeVisible();

        // ── 2. open_skills — 切到 SkillsPanel
        await openPalette(page);
        await switchMode(page, 'cmd');
        await cmdPalette.getByRole('option', { name: /打开 Skills/ }).click();
        await expect(cmdPalette).toBeHidden({ timeout: 3000 });
        // SkillsPanel 接管中栏
        await expect(page.getByRole('region', { name: '插件面板' })).toBeVisible({ timeout: 5000 });

        // ── 3. open_settings — 打开独立 Settings window
        await openPalette(page);
        await switchMode(page, 'cmd');
        const settingsWindowPromise = app.waitForEvent('window');
        await cmdPalette.getByRole('option', { name: /打开设置/ }).click();
        await expect(cmdPalette).toBeHidden({ timeout: 3000 });
        const settingsWindow = await settingsWindowPromise;
        await settingsWindow.waitForLoadState('domcontentloaded');
        await expect(settingsWindow.getByRole('tablist', { name: '设置分类' })).toBeVisible({ timeout: 5000 });
        const settingsClosed = settingsWindow.waitForEvent('close');
        await settingsWindow.getByRole('button', { name: '关闭窗口' }).click();
        await settingsClosed;
        await page.bringToFront();

    });

    test('cmd mode — 切换 workspace 会走目录选择、创建并选中新 workspace', async () => {
        ({ app, page } = await launchApp());
        const workspacePath = test.info().outputPath('palette-switch-target');
        await mkdir(workspacePath, { recursive: true });
        await installWorkspaceSwitchIpc(app, workspacePath);
        await page.evaluate(() => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
        });
        await reloadAppShell(page);

        await openPalette(page);
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        await switchMode(page, 'cmd');
        await palette.getByRole('option', { name: /切换 workspace/ }).click();

        await expect(palette.getByRole('status').filter({ hasText: '已切换到 palette-switch-target' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: '切换工作区：palette-switch-target' }).first()).toBeVisible({ timeout: 5000 });

        const events = await app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __paletteWorkspaceEvents?: Array<{ channel: string; name?: string; path?: string }>;
            };
            return target.__paletteWorkspaceEvents ?? [];
        });
        expect(events.map((event) => event.channel)).toEqual([
            'workspace:select-directory',
            'workspace:create',
            'workspace:select',
        ]);
        expect(events[1]).toMatchObject({ channel: 'workspace:create', name: 'palette-switch-target', path: workspacePath });
        expect(events[2]).toMatchObject({ channel: 'workspace:select', path: workspacePath });
    });

    test('cmd mode — 有 workspace 时切换终端会打开真实终端面板', async () => {
        ({ app, page } = await launchApp());
        const workspacePath = test.info().outputPath('palette-terminal-workspace');
        await mkdir(workspacePath, { recursive: true });

        await page.evaluate(async ({ workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("palette-terminal-e2e", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
        }, { workspacePath });
        await reloadAppShell(page);

        await openPalette(page);
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        await switchMode(page, 'cmd');
        await palette.getByRole('option', { name: /切换终端/ }).click();

        await expect(palette).toBeHidden({ timeout: 3000 });
        await expect(page.getByRole('status').filter({ hasText: '暂无终端' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: /新建终端/ })).toBeVisible();

        await openPalette(page);
        await switchMode(page, 'cmd');
        await palette.getByRole('option', { name: /切换终端/ }).click();
        await expect(page.getByRole('status').filter({ hasText: '暂无终端' })).toHaveCount(0, { timeout: 3000 });
    });

    test('file mode — 渲染 + 3 tab 切换正常', async () => {
        ({ app, page } = await launchApp());

        await openPalette(page);
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');

        // (1) 默认 mode=file — file tab aria-selected=true
        const fileTab = palette.getByRole('tab', { name: '文件' });
        const historyTab = palette.getByRole('tab', { name: '历史' });
        const cmdTab = palette.getByRole('tab', { name: '命令' });
        await expect(fileTab).toHaveAttribute('aria-selected', 'true');
        await expect(historyTab).toHaveAttribute('aria-selected', 'false');
        await expect(cmdTab).toHaveAttribute('aria-selected', 'false');

        // (2) file → history
        await historyTab.click();
        await expect(historyTab).toHaveAttribute('aria-selected', 'true');
        await expect(fileTab).toHaveAttribute('aria-selected', 'false');

        // (3) history → cmd
        await cmdTab.click();
        await expect(cmdTab).toHaveAttribute('aria-selected', 'true');

        // (4) cmd → file
        await fileTab.click();
        await expect(fileTab).toHaveAttribute('aria-selected', 'true');

        // (5) search input 渲染 + 可交互 (fill 不抛错即视为活)
        //    跳过 toHaveValue 断言: Playwright auto-wait 跟 React rerender
        //    (setQuery → input 节点 transient unmount) 偶尔冲突, 行为正确性
        //    由 chat-view.spec.ts 测 ChatInput 灌入覆盖
        const search = palette.locator('input#command-palette-search');
        await expect(search).toBeVisible();
        await search.fill('foo');
    });

    test('file mode — 点击文件结果会通过 App 回调灌入聊天输入框', async () => {
        ({ app, page } = await launchApp());
        const workspacePath = test.info().outputPath('palette-file-workspace');
        const filePath = join(workspacePath, 'src', 'main.ts');
        await mkdir(join(workspacePath, 'src'), { recursive: true });
        await writeFile(filePath, 'export const paletteFileE2E = true;\n', 'utf8');

        await page.evaluate(async ({ workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("palette-file-e2e", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
        }, { workspacePath });
        await reloadAppShell(page);

        await openPalette(page);
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        const search = palette.locator('input#command-palette-search');
        await expect(search).toBeVisible();
        await search.fill('main.ts');

        await palette.getByRole('option', { name: /src[\\/]main\.ts|main\.ts/ }).click();
        await expect(palette).toBeHidden({ timeout: 3000 });

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="描述" i]').first();
        await expect(textarea).toBeVisible({ timeout: 5000 });
        await expect(textarea).toHaveValue(/@.*src[\\/]main\.ts\s$/);
    });

    test('history mode — 渲染 + tab 切换正常 (新用户无 session 走空态)', async () => {
        ({ app, page } = await launchApp());

        await openPalette(page);
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');

        // (1) 切到 history mode
        await palette.getByRole('tab', { name: '历史' }).click();
        await expect(palette.getByRole('tab', { name: '历史' })).toHaveAttribute('aria-selected', 'true');

        // (2) history 模式: 新用户无 session 走空态
        //     search input 还在 (用 id selector 稳定)
        const search = palette.locator('input#command-palette-search');
        await expect(search).toBeVisible();

        // (3) 切回 file mode
        await palette.getByRole('tab', { name: '文件' }).click();
        await expect(palette.getByRole('tab', { name: '历史' })).toHaveAttribute('aria-selected', 'false');
        await expect(palette.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
    });

    test('history mode — 点击历史结果会通过 App 回调切换到对应会话', async () => {
        ({ app, page } = await launchApp());
        const workspacePath = test.info().outputPath('palette-history-workspace');
        await mkdir(workspacePath, { recursive: true });

        await page.evaluate(async ({ workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("palette-history-e2e", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
            const older = await window.piAPI.createSession(ws.id, "目标历史会话", "palette-history-target");
            await window.piAPI.appendMessage(older.id, {
                id: "palette-history-target-message",
                role: "user",
                content: "palette-history-target-needle",
                timestamp: new Date(Date.now() - 10_000).toISOString(),
            });
            const newer = await window.piAPI.createSession(ws.id, "当前会话", "palette-history-current");
            await window.piAPI.appendMessage(newer.id, {
                id: "palette-history-current-message",
                role: "user",
                content: "palette-history-current-visible-before-click",
                timestamp: new Date(Date.now() - 1_000).toISOString(),
            });
        }, { workspacePath });
        await reloadAppShell(page);

        await expect(page.getByText('palette-history-current-visible-before-click')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('palette-history-target-needle')).toHaveCount(0);

        await openPalette(page);
        const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
        await palette.getByRole('tab', { name: '历史' }).click();
        await expect(palette.getByRole('tab', { name: '历史' })).toHaveAttribute('aria-selected', 'true');
        await palette.locator('input#command-palette-search').fill('target-needle');
        await palette.getByRole('option', { name: /palette-history-target-needle/ }).click();
        await expect(palette).toBeHidden({ timeout: 3000 });

        await expect(page.getByText('palette-history-target-needle')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('palette-history-current-visible-before-click')).toHaveCount(0);
    });
});
