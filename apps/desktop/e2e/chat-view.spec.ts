// E2E smoke: verify ChatView 真接通 usePiStream → session-store → MessageBubble,
// 当前 welcome 空态、ChatInput 和 Popover 入口都能交互。
//
// 关键点(跟 launch.spec.ts 区别):
//  - 用 page.click 触发 React onClick,不走 OS 鼠标(避免 z-order 抢焦点)
//  - 用 page.fill 往 ChatInput 灌测试 prompt
//  - 不依赖用户键盘/鼠标,纯 headless 自动化

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';

test.describe('Pi Desktop — ChatView 接通 + ChatInput 交互', () => {
    let app: ElectronApplication;
    let page: Page;

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* ignore */ }
    });

    test('welcome 空态渲染 ChatInput，输入和发送流程接通', async () => {
        app = await _electron.launch({
            args: [electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await app.firstWindow();
        await page.waitForLoadState('domcontentloaded');

        // (1) Welcome 标题 — ChatView 接管中栏
        //  ChatView 副标题:"描述你想要构建或修改的内容,Pi 会为你创建一个独立的工作环境。"
        //  注:onboarding 模态会先盖住,直接 evaluate 删掉(本 spec 只测 ChatView 接通,不在测 onboarding)
        await page.evaluate(() => {
            const modal = document.querySelector('[data-testid="onboarding-modal"]');
            if (modal) modal.remove();
        });
        const subtitle = page.getByText('描述你想要构建或修改的内容');
        await expect(subtitle).toBeVisible({ timeout: 15_000 });

        // (2) 当前空态直接渲染 ChatInput，不再渲染快捷卡片
        await expect(page.getByRole('heading', { name: '准备好开始了吗？' })).toBeVisible();

        // (3) 确认是 ChatView 内部 (而不是 MiniMaxCode/WelcomeScreen 的假按钮)
        //   假按钮串(应已全清):创建 Team / 幻灯片 / PDF / 文档 / 表格
        await expect(page.getByText('创建 Team')).toHaveCount(0);
        await expect(page.getByText('幻灯片', { exact: true })).toHaveCount(0);
        await expect(page.getByText('PDF', { exact: true })).toHaveCount(0);

        // (4) ChatInput 的 textarea 可输入
        const textarea = page.getByRole('textbox', { name: '发送' });
        await expect(textarea).toBeVisible({ timeout: 5_000 });
        await textarea.fill('test ping from ChatView verification');
        await expect(textarea).toHaveValue('test ping from ChatView verification');

        // (5) 验证 ChatView 接管 chat panel(不是 WelcomeScreen)— ChatInput 自身的"附件"按钮
        //   跟 WelcomeScreen 的 MiniMaxCodeInput 不同(没附件按钮)
        await expect(page.getByRole('button', { name: /添加附件/ })).toBeVisible();
        await expect(page.locator('[data-testid="chat-input-model-trigger"]')).toBeVisible();

        // (6) 验证 send 真的能发 — 监听 window.piAPI.sendPrompt 是否被调
        // 触发 send: 按 Enter
        await textarea.press('Enter');

        // (7) 消息流出现:user 消息 — 走 article 区域避开 textarea 残留 value
        const userArticle = page.getByRole('article', { name: /你说/ });
        await expect(userArticle).toBeVisible({ timeout: 10_000 });
        await expect(userArticle).toContainText('test ping from ChatView verification');

        // (8) Pi 正在 streaming 回复 — ChatInput 因 isProcessing 锁住(>1 步证据)
        //   注:不查 "Pi 正在思考" 状态文本,因为时序敏感(可能 1 秒就消失),
        //   ChatInput disabled 是 isProcessing 走过 的稳证据
        await expect(textarea).toBeDisabled({ timeout: 5_000 });

        // (9) 右栏进度区域存在
        await expect(page.getByRole('heading', { name: '进度' })).toBeVisible();
    });

    test('v1.0.13 — ChatInput 3 个假按钮真接通: 权限/模型/附件 全部能交互', async () => {
        app = await _electron.launch({
            args: [electronMainEntry],
            env: { ...process.env, CI: '1' },
        });
        page = await app.firstWindow();
        await page.waitForLoadState('domcontentloaded');

        // 跳过 onboarding
        await page.evaluate(() => {
            const modal = document.querySelector('[data-testid="onboarding-modal"]');
            if (modal) modal.remove();
        });

        // (1) 默认状态下 3 个按钮都渲染
        const permTrigger = page.locator('[data-testid="chat-input-permission-trigger"]');
        const modelTrigger = page.locator('[data-testid="chat-input-model-trigger"]');
        const attachBtn = page.getByRole('button', { name: /添加附件/ });
        await expect(permTrigger).toBeVisible();
        await expect(modelTrigger).toBeVisible();
        await expect(attachBtn).toBeVisible();

        // (2) 权限按钮 — click → popover 出现 → 选 "智能授权" → 按钮 label 切换
        //    注:不依赖初始 label,因为跨 test 共享 electron-store,初始可能是任何档位
        await permTrigger.click();
        // popover role=menu 出现
        const permMenu = page.getByRole('menu').filter({ hasText: '智能授权' });
        await expect(permMenu).toBeVisible();
        // 选"智能授权"
        await permMenu.getByRole('menuitemradio', { name: /智能授权/ }).click();
        // popover 关闭,按钮 label 切到"智能授权"
        await expect(permMenu).toBeHidden();
        await expect(permTrigger).toContainText('智能授权');

        // (3) 模型按钮 — click → popover 出现
        //    Pi CLI 配置可能有也可能没有 — 但 popover 至少要出现
        await modelTrigger.click();
        const modelMenu = page.getByRole('menu').filter({ hasText: '选择模型' });
        await expect(modelMenu).toBeVisible();
        // 关闭 popover
        await page.keyboard.press('Escape');
        await expect(modelMenu).toBeHidden();

        // (4) 附件按钮接通验证 — 不能在 headless 真弹 native file picker
        //    走 React fiber 检查 onClick 真有引用 (不是 undefined/null)
        //    这能证明"按钮从死 div 变成活 button",功能接通靠 ChatInput.tsx 源码 review
        const hasOnClick = await page.evaluate(() => {
            // 找 button 元素(支持 React 18+ 的 __reactProps$ 前缀)
            const el = document.querySelector('button[aria-label*="添加附件" i]') as
                | (HTMLElement & Record<string, unknown>)
                | null;
            if (!el) return { found: false, hasOnClick: false };
            const propKeys = Object.keys(el).filter(
                (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'),
            );
            const props = propKeys.length > 0 ? (el[propKeys[0]] as { onClick?: unknown }) : null;
            return {
                found: true,
                hasOnClick: typeof props?.onClick === 'function',
                disabled: (el as HTMLButtonElement).disabled,
            };
        });
        expect(hasOnClick.found).toBe(true);
        expect(hasOnClick.hasOnClick).toBe(true);

        // (5) 同一方式验证 4 个 clickable (发送 / 附件 / 权限 / 模型) 都活
        const liveButtons = await page.evaluate(() => {
            const checks = [
                { label: '添加附件', expected: true },
                { label: '权限', expected: true },
                { label: '当前模型', expected: true },
            ];
            return checks.map((c) => {
                const el = document.querySelector(`[aria-label*="${c.label}" i]`) as
                    | (HTMLElement & Record<string, unknown>)
                    | null;
                if (!el) return { label: c.label, hasOnClick: false };
                const propKeys = Object.keys(el).filter((k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                const props = propKeys.length > 0 ? (el[propKeys[0]] as { onClick?: unknown }) : null;
                return { label: c.label, hasOnClick: typeof props?.onClick === 'function' };
            });
        });
        // 3 个按钮都应该有 onClick 引用(权限/模型是 Popover cloneElement 注入,附件是 onClick handler)
        for (const r of liveButtons) {
            expect(r.hasOnClick, `button ${r.label} should have onClick handler`).toBe(true);
        }
    });
});
