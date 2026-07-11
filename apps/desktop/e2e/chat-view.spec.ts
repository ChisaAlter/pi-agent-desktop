// E2E smoke: verify ChatView 真接通 usePiStream → session-store → MessageBubble,
// and the current chat input controls remain interactive.
//
// 关键点(跟 launch.spec.ts 区别):
//  - 用 page.click 触发 React onClick,不走 OS 鼠标(避免 z-order 抢焦点)
//  - 用 page.fill 往 ChatInput 灌测试 prompt
//  - 不依赖用户键盘/鼠标,纯 headless 自动化

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl, retryMainAction } from "./support/electron-windows";

async function getMainWindow(app: ElectronApplication): Promise<Page> {
    await getWindowByUrl(app, "index.html");
    return getWindowByUrl(app, "index.html");
}

async function waitForPersistedSession(page: Page, sessionId: string): Promise<void> {
    await expect.poll(async () => page.evaluate(async (id) => {
        const sessions = await window.piAPI.listSessions();
        return sessions.some((session) => session.id === id);
    }, sessionId), { timeout: 10_000 }).toBe(true);
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5000 });
    await expect(modal).toHaveCount(0, { timeout: 5000 });
}

async function stubPromptIpc(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('pi:send');
        ipcMain.handle('pi:send', async () => undefined);
        ipcMain.removeHandler('agents:prompt');
        ipcMain.handle('agents:prompt', async () => undefined);
    });
}

async function emitPiEvents(app: ElectronApplication, events: Array<Record<string, unknown>>): Promise<void> {
    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().includes('index.html'))
            ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error('No Electron window available for pi:event injection');
        for (const event of payload) {
            win.webContents.send('pi:event', event);
        }
    }, events);
}

async function emitCurrentAgentEvents(page: Page, app: ElectronApplication, events: Array<Record<string, unknown>>): Promise<void> {
    await page.waitForFunction(
        async () => (await window.piAPI.agentsList()).some((agent) => agent.sessionId),
        { timeout: 10_000 },
    );
    const agent = await page.evaluate(async () => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId) ?? agents[0] ?? null;
    });
    if (!agent) throw new Error('No agent available for agents:event injection');
    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().includes('index.html'))
            ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error('No Electron window available for agents:event injection');
        for (const event of payload.events) {
            win.webContents.send('agents:event', {
                agentId: payload.agent.id,
                workspaceId: payload.agent.workspaceId,
                event,
            });
        }
    }, { agent, events });
}

async function expectProgressRailAvailable(page: Page): Promise<void> {
    const progressHeading = page.getByRole('heading', { name: '进度' });
    if (await progressHeading.isVisible().catch(() => false)) return;

    await page.getByRole('button', { name: '展开右侧栏' }).click();
    await expect(progressHeading).toBeVisible({ timeout: 5_000 });
}

async function enablePlanMode(page: Page): Promise<void> {
    const modeTrigger = page.getByRole('button', { name: '选择 Agent 模式' });
    await expect(modeTrigger).toBeVisible({ timeout: 5_000 });
    await modeTrigger.click();
    const modeMenu = page.getByRole('menu', { name: 'Agent 模式' });
    await expect(modeMenu).toBeVisible({ timeout: 5_000 });
    await modeMenu.getByRole('menuitemradio', { name: /Plan/ }).click();
    await expect(modeTrigger).toContainText('Plan');
}

async function expectChatInputAnchored(page: Page): Promise<void> {
    const inputShell = page.locator('[data-testid="chat-input-shell"]').first();
    await expect(inputShell).toBeVisible({ timeout: 5_000 });
    const metrics = await inputShell.evaluate((el) => {
        const rectFor = (node: Element | null) => {
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: rect.height };
        };
        const rect = el.getBoundingClientRect();
        return {
            distanceToBottom: window.innerHeight - rect.bottom,
            windowHeight: window.innerHeight,
            shell: rectFor(el),
            inputOuter: rectFor(el.parentElement),
            chatRoot: rectFor(document.querySelector('[data-testid="chat-view-root"]')),
            scrollRegion: rectFor(document.querySelector('[data-testid="chat-scroll-region"]')),
            main: rectFor(document.querySelector('[data-mmcode-region="center"]')),
        };
    });
    expect(metrics.distanceToBottom, JSON.stringify(metrics)).toBeLessThan(32);
}

async function expectChatLayoutStable(page: Page): Promise<void> {
    await expectChatInputAnchored(page);
    const metrics = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="chat-view-root"]');
        const scrollRegion = document.querySelector('[data-testid="chat-scroll-region"]');
        const scrollingElement = document.scrollingElement ?? document.documentElement;
        return {
            documentOverflow: scrollingElement.scrollHeight - scrollingElement.clientHeight,
            rootOverflowY: root ? getComputedStyle(root).overflowY : null,
            scrollRegionOverflowY: scrollRegion ? getComputedStyle(scrollRegion).overflowY : null,
            scrollRegionHasOverflow: scrollRegion
                ? scrollRegion.scrollHeight > scrollRegion.clientHeight + 4
                : false,
        };
    });
    expect(metrics.documentOverflow, 'document/window should not be the chat scroller').toBeLessThanOrEqual(4);
    expect(metrics.rootOverflowY).toBe('hidden');
    expect(metrics.scrollRegionOverflowY).toBe('auto');
    expect(metrics.scrollRegionHasOverflow, 'chat-scroll-region should own vertical overflow').toBe(true);
}

async function seedLongPlanConversation(page: Page, workspacePath: string): Promise<void> {
    await page.evaluate(
        async ({ workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("chat-layout-regression", workspacePath);
            const session = await window.piAPI.createSession(ws.id, "计划模式布局回归", "chat-layout-regression-session");
            await window.piAPI.appendMessage(session.id, {
                id: "layout-user",
                role: "user",
                content: "/plan\n你好",
                timestamp: new Date(Date.now() - 3_000).toISOString(),
            });
            await window.piAPI.appendMessage(session.id, {
                id: "layout-assistant",
                role: "assistant",
                content: `<think>这里是应该折叠的思考内容</think>\n\n${Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行长回复内容，用来撑出消息区内部滚动。`).join("\n")}`,
                timestamp: new Date(Date.now() - 2_000).toISOString(),
            });
        },
        { workspacePath },
    );
}

test.describe('Pi Desktop — ChatView 接通 + ChatInput controls', () => {
    let app: ElectronApplication;
    let page: Page;

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* ignore */ }
    });

    test('welcome screen renders current ChatView, textarea send creates user message', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');

        // 跳过 onboarding: 走 React 自身的 onComplete 路径,避免破坏 portal ownership
        await skipOnboarding(page);
        await expect(page.getByText('新对话', { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('输入消息后，Pi Agent 会在当前工作区开始运行。', { exact: true })).toBeVisible();

        // 确认旧 WelcomeScreen 假按钮串已清理
        await expect(page.getByText('创建 Team')).toHaveCount(0);
        await expect(page.getByText('幻灯片', { exact: true })).toHaveCount(0);
        await expect(page.getByText('PDF', { exact: true })).toHaveCount(0);

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
        await expect(textarea).toBeVisible({ timeout: 5_000 });
        await expect(page.getByRole('button', { name: '添加文件或图片' })).toBeVisible();
        await expect(page.getByRole('button', { name: /当前模型:/ })).toBeVisible();

        await textarea.fill('test ping from v1.0.12 verification');
        await textarea.press('Enter');

        const userArticle = page.getByRole('article', { name: /你 ·/ });
        await expect(userArticle).toBeVisible({ timeout: 10_000 });
        await expect(userArticle).toContainText('test ping from v1.0.12 verification');
        await expectChatInputAnchored(page);

        // 运行中允许继续输入追加指令；发布级 smoke 只验证消息入栈和进度区出现。
        await expect(textarea).toBeEnabled({ timeout: 5_000 });
        await expectProgressRailAvailable(page);
    });

    test('provider message_end errors stay visible in the chat instead of generic empty-output errors', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath('provider-error-workspace');
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await stubPromptIpc(app);
        await skipOnboarding(page);

        await page.evaluate(async ({ workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("provider-error-e2e", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
            const session = await window.piAPI.createSession(ws.id, "provider-error-session", "provider-error-session");
            await window.piAPI.agentsCreate({
                workspaceId: ws.id,
                title: "provider-error-agent",
                sessionId: session.id,
            });
        }, { workspacePath });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await skipOnboarding(page);
        await page.getByRole('button', { name: 'provider-error-session', exact: true }).click();

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
        await expect(textarea).toBeVisible({ timeout: 5_000 });
        await textarea.fill('触发 provider 错误展示');
        await textarea.press('Enter');

        await expect(page.getByRole('article', { name: /你 ·/ })).toContainText('触发 provider 错误展示', { timeout: 10_000 });

        await emitCurrentAgentEvents(page, app, [
            { type: 'agent_start' },
            {
                type: 'message_end',
                message: {
                    role: 'assistant',
                    provider: 'anthropic',
                    model: 'claude-opus-4-7',
                    content: [],
                    errorMessage: '403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
                },
            },
            { type: 'agent_end' },
        ]);

        const alert = page.getByRole('alert').filter({ hasText: 'anthropic / claude-opus-4-7' });
        await expect(alert).toBeVisible({ timeout: 10_000 });
        await expect(alert).toContainText('403');
        await expect(alert).toContainText('Request not allowed');
        await expect(alert).not.toContainText('Pi 本轮没有返回内容');
    });

    test('ChatInput reference-frame 控件真接通: Agent 模式/模型/附件 全部能交互', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath('chat-controls-workspace');
        const pickedFile = join(workspacePath, 'notes', 'picked.txt');
        await mkdir(join(workspacePath, 'notes'), { recursive: true });
        await writeFile(pickedFile, 'picked by chat controls e2e\n', 'utf8');

        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await retryMainAction(() => app.evaluate(({ ipcMain }, selectedFile) => {
            ipcMain.removeHandler('files:select');
            ipcMain.handle('files:select', async () => [selectedFile]);
        }, pickedFile));

        await page.evaluate(async ({ workspacePath }) => {
            window.localStorage.setItem('pi-desktop:firstLaunchDone', 'true');
            window.localStorage.setItem('pi-desktop.onboarding.completed', 'true');
            const ws = await window.piAPI.createWorkspace('chat-controls-e2e', workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
        }, { workspacePath });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await skipOnboarding(page);
        await page.waitForFunction(
            async () => (await window.piAPI.agentsList()).some((agent) => agent.workspaceId),
            { timeout: 10_000 },
        );

        const controls = page.getByTestId('chat-input-reference-controls');
        const agentModeTrigger = controls.getByRole('button', { name: '选择 Agent 模式' });
        const modelTrigger = controls.getByRole('button', { name: /当前模型:/ });
        const thinkingTrigger = controls.getByRole('button', { name: /思考强度:/ });
        const attachBtn = controls.getByRole('button', { name: '添加文件或图片' });
        await expect(agentModeTrigger).toBeVisible();
        await expect(modelTrigger).toBeVisible();
        await expect(thinkingTrigger).toBeVisible();
        await expect(attachBtn).toBeVisible();

        await controls.getByRole('button', { name: /思考强度: 中/ }).click();
        const thinkingMenu = page.getByRole('menu', { name: '思考强度' });
        await expect(thinkingMenu).toBeVisible();
        await expect(thinkingMenu.getByRole('menuitemradio', { name: '高' })).toBeVisible();
        await thinkingMenu.getByRole('menuitemradio', { name: '高' }).click();
        await expect(page.getByRole('button', { name: /思考强度: 高/ })).toBeVisible();
        await controls.getByRole('button', { name: /思考强度: 高/ }).click();
        await expect(thinkingMenu.getByRole('menuitemradio', { name: '高' })).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');
        await expect(thinkingMenu).toBeHidden();

        await controls.getByRole('button', { name: '选择 Agent 模式' }).click();
        const agentModeMenu = page.getByRole('menu', { name: 'Agent 模式' });
        await expect(agentModeMenu).toBeVisible();
        await expect(agentModeMenu.getByRole('menuitemradio', { name: /Plan/ })).toBeVisible();
        await agentModeMenu.getByRole('menuitemradio', { name: /Plan/ }).click();
        await expect(agentModeTrigger).toContainText('Plan');
        await agentModeTrigger.click();
        await expect(agentModeMenu.getByRole('menuitemradio', { name: /Plan/ })).toHaveAttribute('aria-checked', 'true');
        await agentModeMenu.getByRole('menuitemradio', { name: /Compose/ }).click();
        await expect(agentModeTrigger).toContainText('Compose');
        await expect(agentModeMenu).toBeHidden();

        await attachBtn.click();
        const attachmentList = page.getByRole('list', { name: '已选附件' });
        await expect(attachmentList).toContainText('picked.txt', { timeout: 5_000 });
        await page.getByRole('button', { name: /移除附件 picked\.txt/ }).click();
        await expect(attachmentList).toHaveCount(0, { timeout: 5_000 });
    });

    test('计划模式发送后 ChatInput 仍固定在主区底部', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');

        await skipOnboarding(page);
        await expect(page.locator('[data-testid="chat-input-shell"]')).toBeVisible({ timeout: 15_000 });

        await enablePlanMode(page);

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
        await textarea.fill('计划模式布局回归测试');
        await textarea.press('Enter');

        await expect(page.getByRole('article', { name: /你 ·/ })).toContainText('计划模式布局回归测试', { timeout: 10_000 });
        await expectChatInputAnchored(page);
    });

    test('长回复和计划卡出现后只滚动消息区，ChatInput 不随内容上移', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath('chat-layout-workspace');
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');

        await seedLongPlanConversation(page, workspacePath);
        await waitForPersistedSession(page, "chat-layout-regression-session");
        await app.close();

        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await skipOnboarding(page);

        await expect(page.getByRole('article', { name: /你 ·/ })).toContainText('你好', { timeout: 15_000 });
        await expect(page.getByRole('article', { name: /你 ·/ })).toContainText('计划模式');
        await expect(page.getByRole('article', { name: /你 ·/ })).not.toContainText('/plan');
        await expect(page.getByRole('article', { name: /Pi ·/ })).toContainText('第 80 行长回复内容');

        await app.evaluate(({ BrowserWindow }) => {
            for (const win of BrowserWindow.getAllWindows()) {
                win.webContents.send('plan:card', {
                    id: 'layout-plan-card',
                    title: '计划模式布局回归计划',
                    filename: 'layout-plan.md',
                    content: Array.from({ length: 40 }, (_, index) => `- 步骤 ${index + 1}: 验证计划卡不会把输入框顶上去`).join('\n'),
                });
            }
        });

        const planCard = page.locator('article').filter({ hasText: '计划模式布局回归计划' });
        await expect(planCard).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('article').filter({ hasText: '<think>' })).toHaveCount(0);
        await expectChatLayoutStable(page);
    });

    test('已有计划文本收到 plan card 后升级原消息并突出选择区', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath('plan-card-upgrade-workspace');
        const evidenceDir = test.info().outputPath('plan-card-upgrade-evidence');
        await mkdir(evidenceDir, { recursive: true });
        const planContent = [
            '背景说明：这些是生成计划时的上下文，不应该抢占计划卡主视觉。',
            '项目事实：前端页面较多，需要先确认范围。',
            '',
            '## 用户需选择方向',
            'A) 全量发布审查：覆盖代码、数据、安全、UI、测试。',
            'B) 上线阻断审查：只找 P0/P1。',
            'C) 专项深挖审查：选择一个方向深挖。',
        ].join('\n');

        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await page.evaluate(
            async ({ workspacePath, planContent }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
                const ws = await window.piAPI.createWorkspace("plan-card-upgrade-e2e", workspacePath);
                await window.piAPI.selectWorkspace(ws.path);
                const session = await window.piAPI.createSession(ws.id, "计划升级回归", "plan-card-upgrade-session");
                await window.piAPI.appendMessage(session.id, {
                    id: "plan-card-upgrade-user",
                    role: "user",
                    content: "请制定一个全面审查项目的计划",
                    timestamp: new Date(Date.now() - 3_000).toISOString(),
                });
                await window.piAPI.appendMessage(session.id, {
                    id: "plan-card-upgrade-assistant",
                    role: "assistant",
                    content: planContent,
                    timestamp: new Date(Date.now() - 2_000).toISOString(),
                });
            },
            { workspacePath, planContent },
        );
        await waitForPersistedSession(page, "plan-card-upgrade-session");
        await app.close();

        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await skipOnboarding(page);
        const seededSessionButton = page.locator('button, [role="button"]').filter({ hasText: '计划升级回归' }).first();
        await expect(seededSessionButton).toBeVisible({ timeout: 15_000 });
        await seededSessionButton.click();
        const initialUserArticle = page.getByRole('article', { name: /你 ·/ }).filter({ hasText: '请制定一个全面审查项目的计划' });
        await expect(initialUserArticle).toBeVisible({ timeout: 15_000 });
        await expect(initialUserArticle.getByTestId('message-surface')).toHaveClass(/py-3/);
        const initialAssistantArticle = page.getByRole('article', { name: /Pi ·/ }).filter({ hasText: '背景说明' });
        await expect(initialAssistantArticle).toBeVisible();
        await expect(initialAssistantArticle.getByTestId('message-surface')).not.toHaveClass(/bg-\[var\(--mm-bg-panel\)\]/);
        await page.screenshot({ path: join(evidenceDir, '00-assistant-no-background.png'), fullPage: true });

        await app.evaluate(({ ipcMain }) => {
            const target = globalThis as typeof globalThis & {
                __planCardUpgradePromptCalls?: Array<
                    | { kind: 'legacy'; workspaceId: string; message: string }
                    | { kind: 'agent'; input: { agentId: string; message: string; mode?: 'build' | 'plan' | 'compose' } }
                >;
            };
            target.__planCardUpgradePromptCalls = [];
            ipcMain.removeHandler('pi:send');
            ipcMain.handle('pi:send', async (_event, workspaceId: string, message: string) => {
                target.__planCardUpgradePromptCalls?.push({ kind: 'legacy', workspaceId, message });
                return undefined;
            });
            ipcMain.removeHandler('agents:prompt');
            ipcMain.handle('agents:prompt', async (_event, input: { agentId: string; message: string; mode?: 'build' | 'plan' | 'compose' }) => {
                target.__planCardUpgradePromptCalls?.push({ kind: 'agent', input });
                return undefined;
            });
        });

        await app.evaluate(({ BrowserWindow }, content) => {
            for (const win of BrowserWindow.getAllWindows()) {
                win.webContents.send('plan:card', {
                    id: 'plan-card-upgrade-card',
                    title: '全面审查项目计划',
                    filename: 'comprehensive-project-review.md',
                    content,
                    createdAt: Date.now(),
                });
            }
        }, planContent);

        const planArticle = page.getByRole('article', { name: /Pi ·/ }).filter({ hasText: '全面审查项目计划' });
        await expect(planArticle).toHaveCount(1);
        await expect(planArticle.getByTestId('message-surface')).not.toHaveClass(/bg-\[var\(--mm-bg-panel\)\]/);
        await expect(planArticle.getByTestId('plan-card')).toHaveClass(/rounded-lg/);
        await expect(planArticle).toContainText('用户需选择方向');
        await expect(planArticle).toContainText('A) 全量发布审查');
        await expect(planArticle).toContainText('B) 上线阻断审查');
        await expect(planArticle).toContainText('C) 专项深挖审查');
        await expect(planArticle).not.toContainText('背景说明');
        await expect(page.getByText('计划已保存')).toHaveCount(0);
        await page.screenshot({ path: join(evidenceDir, '01-collapsed-choice-first.png'), fullPage: true });

        await planArticle.getByRole('button', { name: '展开计划详情' }).click();
        await expect(planArticle).toContainText('背景说明：这些是生成计划时的上下文');
        await page.screenshot({ path: join(evidenceDir, '02-expanded-details.png'), fullPage: true });

        await planArticle.getByTestId('plan-option').first().click();
        await expect(planArticle.getByRole('button', { name: '确认并执行' })).toBeEnabled();
        await planArticle.getByRole('button', { name: '确认并执行' }).click();
        await expect.poll(async () => app.evaluate(() => {
            const target = globalThis as typeof globalThis & { __planCardUpgradePromptCalls?: unknown[] };
            return target.__planCardUpgradePromptCalls?.length ?? 0;
        })).toBe(1);
        const executionArticle = page.getByRole('article', { name: /你 ·/ }).filter({ hasText: '执行计划：comprehensive-project-review.md' });
        await expect(executionArticle.getByTestId('plan-execution-user-state')).toBeVisible();
        await expect(executionArticle.getByTestId('message-surface')).toHaveClass(/bg-\[var\(--mm-bg-control\)\]/);
        await expect(planArticle.getByText('执行中')).toBeVisible();
        await page.screenshot({ path: join(evidenceDir, '03-executing-after-confirm.png'), fullPage: true });
    });

    test('左右栏、发送运行态和思考块使用真实 UI 动效过渡', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath('motion-transition-workspace');
        const evidenceDir = test.info().outputPath('motion-transition-evidence');
        await mkdir(evidenceDir, { recursive: true });
        await mkdir(workspacePath, { recursive: true });

        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await page.evaluate(async ({ workspacePath }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("motion-transition-e2e", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
            const session = await window.piAPI.createSession(ws.id, "动效验收会话", "motion-transition-session");
            await window.piAPI.appendMessage(session.id, {
                id: "motion-user",
                role: "user",
                content: "请观察左右栏、思考块和运行态的动效。",
                timestamp: new Date(Date.now() - 3_000).toISOString(),
            });
            await window.piAPI.appendMessage(session.id, {
                id: "motion-assistant",
                role: "assistant",
                content: "<think>这里是应该折叠但可以平滑展开的思考内容。\n第二行用于观察展开动画。</think>\n\n这是用于动效验收的助手回复。",
                timestamp: new Date(Date.now() - 2_000).toISOString(),
            });
        }, { workspacePath });
        await expect.poll(async () => page.evaluate(async () => {
            const sessions = await window.piAPI.listSessions();
            return sessions.some((session) => session.id === "motion-transition-session");
        })).toBe(true);
        await app.close();
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');
        await skipOnboarding(page);
        await app.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('pi:send');
            ipcMain.handle('pi:send', async () => new Promise<void>(() => undefined));
            ipcMain.removeHandler('agents:prompt');
            ipcMain.handle('agents:prompt', async () => new Promise<void>(() => undefined));
        });

        const seededSessionButton = page.locator('button, [role="button"]').filter({ hasText: '动效验收会话' }).first();
        await expect(seededSessionButton).toBeVisible({ timeout: 15_000 });
        await seededSessionButton.click();
        await expect(page.getByRole('article', { name: /Pi ·/ }).filter({ hasText: '这是用于动效验收的助手回复' })).toBeVisible({ timeout: 15_000 });

        const screenshots: string[] = [];
        const capture = async (name: string): Promise<void> => {
            const file = join(evidenceDir, `${String(screenshots.length).padStart(2, '0')}-${name}.png`);
            await page.screenshot({ path: file, fullPage: true });
            screenshots.push(file);
        };

        await capture('initial-with-left-sidebar');

        await page.getByRole('button', { name: '展开右侧栏' }).click();
        await page.waitForTimeout(120);
        await capture('right-rail-opening');
        const rightRail = page.locator('[data-mmcode-region="right-floating"]');
        await expect(rightRail).toHaveAttribute('data-motion-state', 'enter', { timeout: 5_000 });
        await expect(rightRail).toHaveClass(/pi-motion-floating-rail/);
        await page.waitForTimeout(260);
        await capture('right-rail-settled');

        await page.getByRole('button', { name: '收起右侧栏' }).click();
        await page.waitForTimeout(120);
        await expect(rightRail).toHaveAttribute('data-motion-state', 'exit');
        await capture('right-rail-closing');

        await page.getByRole('button', { name: '折叠左侧栏' }).click();
        await page.waitForTimeout(120);
        await capture('left-sidebar-collapsing');
        const leftRail = page.locator('[data-mmcode-region="left"]');
        await expect(leftRail).toHaveClass(/pi-motion-rail/);
        await expect(leftRail).toHaveAttribute('data-collapsed', 'true');
        await page.waitForTimeout(260);
        await capture('left-sidebar-collapsed');

        await page.getByRole('button', { name: '展开左侧栏' }).click();
        await page.waitForTimeout(120);
        await capture('left-sidebar-opening');
        await expect(leftRail).toHaveAttribute('data-collapsed', 'false');

        await page.getByRole('button', { name: /展开思考/ }).click();
        await expect(page.getByText('这里是应该折叠但可以平滑展开的思考内容。')).toBeVisible();
        await capture('thinking-expanded');

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
        await textarea.fill('触发运行态动效');
        await textarea.press('Enter');
        await expect(page.getByRole('article', { name: /你 ·/ }).filter({ hasText: '触发运行态动效' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('status', { name: '任务运行中提醒' })).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(120);
        await capture('running-state-after-send');

        const motionMetrics = await page.evaluate(() => {
            const rail = document.querySelector('[data-mmcode-region="left"]');
            const floating = document.querySelector('[data-mmcode-region="right-floating"]');
            const message = document.querySelector('[data-motion="message-enter"]');
            const thinking = document.querySelector('[data-motion="thinking-content"]');
            const running = document.querySelector('[data-motion="running-strip"]');
            const streamPlaceholderCount = document.querySelectorAll('[data-motion="stream-placeholder"]').length;
            return {
                leftRailClass: rail?.className ?? null,
                leftRailCollapsed: rail?.getAttribute('data-collapsed') ?? null,
                rightFloatingClass: floating?.className ?? null,
                rightFloatingState: floating?.getAttribute('data-motion-state') ?? null,
                messageMotionClass: message?.className ?? null,
                thinkingMotionClass: thinking?.className ?? null,
                runningMotionClass: running?.className ?? null,
                streamPlaceholderCount,
            };
        });

        expect(motionMetrics.leftRailClass).toContain('pi-motion-rail');
        expect(motionMetrics.messageMotionClass).toContain('pi-motion-message-enter');
        expect(motionMetrics.thinkingMotionClass).toContain('pi-motion-thinking-content');
        expect(motionMetrics.runningMotionClass).toContain('pi-motion-running');
        expect(motionMetrics.streamPlaceholderCount).toBe(0);

        const analysis = screenshots.map((file) => {
            const name = file.split(/[\\/]/).pop() ?? file;
            return {
                file,
                observation: name.includes('right-rail')
                    ? '右侧上下文栏使用 pi-motion-floating-rail，打开/关闭有滑入滑出状态。'
                    : name.includes('left-sidebar')
                        ? '左侧栏轨道使用 pi-motion-rail，内容使用 pi-motion-rail-content 淡入淡出。'
                        : name.includes('thinking')
                            ? '思考内容展开后可见，展开区域使用 pi-motion-thinking-content。'
                            : name.includes('running')
                                ? '发送后进入真实运行态，仅保留输入区上方的运行提醒，没有中间重复运行占位。'
                                : '初始会话含左侧栏、中心消息和折叠思考入口。',
            };
        });
        await writeFile(
            join(evidenceDir, 'screenshot-analysis.json'),
            JSON.stringify({ screenshots, motionMetrics, analysis }, null, 2),
            'utf8',
        );
    });

    test('计划模式真实 UI 路径只提交一次 /plan prompt', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await getMainWindow(app);
        await page.waitForLoadState('domcontentloaded');

        await skipOnboarding(page);
        await expect(page.locator('[data-testid="chat-input-shell"]')).toBeVisible({ timeout: 15_000 });

        await app.evaluate(({ ipcMain }) => {
            const target = globalThis as typeof globalThis & {
                __planPromptCalls?: Array<{ kind: string; payload: unknown }>;
            };
            target.__planPromptCalls = [];
            ipcMain.removeHandler('agents:prompt');
            ipcMain.removeHandler('pi:send');
            ipcMain.handle('agents:prompt', async (_event, input) => {
                target.__planPromptCalls?.push({ kind: 'agent', payload: input });
                return undefined;
            });
            ipcMain.handle('pi:send', async (_event, workspaceId, message) => {
                target.__planPromptCalls?.push({ kind: 'legacy', payload: { workspaceId, message } });
                return undefined;
            });
        });

        await enablePlanMode(page);

        const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
        await textarea.fill('你好');
        await textarea.press('Enter');
        await expect.poll(async () => app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __planPromptCalls?: Array<{ kind: string; payload: unknown }>;
            };
            return target.__planPromptCalls?.length ?? 0;
        })).toBe(1);

        const calls = await app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __planPromptCalls?: Array<{ kind: string; payload: unknown }>;
            };
            const result = target.__planPromptCalls ?? [];
            return result;
        });
        await expect(page.getByRole('article', { name: /你 ·/ })).toContainText('你好', { timeout: 10_000 });
        const payload = calls[0]?.payload as { message?: string; input?: { message?: string } };
        const message = payload.message ?? payload.input?.message ?? '';
        expect(message).not.toMatch(/^\/plan\n/);
        expect(message.match(/^\/plan/gm) ?? []).toHaveLength(0);
        expect(message).toContain('你好');
    });
});
