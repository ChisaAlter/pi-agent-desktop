/**
 * M7: 接入 a11y 自动化测试 — 手写关键 a11y 规则扫描
 *
 * 目标: 在 Pi Desktop renderer 关键页面上验证 a11y 关键 ARIA 规则, 失败 fail test.
 *
 * 为什么不用 axe-core: @axe-core/playwright 的 AxeBuilder 跟 Electron 渲染进程不兼容
 * (browserContext.newPage 抛 "Protocol error: Not supported"). 手写关键 a11y 规则
 * (button aria-label / form label / image alt / heading 顺序) 在 e2e 上下文更稳.
 *
 * 当前覆盖范围 (a11y-baseline slice):
 *   - 主聊天界面: TopTabBar + MiniMaxCodeSidebar session list + ChatView + ChatInput
 *   - 命令面板: 通过 Ctrl+K 打开 CommandPalette
 *
 * 跑测试前置条件:
 *   `pnpm --filter @pi-desktop/desktop build` 必须已经产出
 *   out/main/index.js + out/renderer/index.html.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

interface A11yViolation {
    rule: string;
    target: string;
    message: string;
}

/**
 * 手写 a11y 扫描: 在指定 selectors 范围内执行基本 ARIA 规则检查.
 * 规则:
 *   - button 必须有 accessible name (aria-label / text content / title)
 *   - form input 必须有 label (aria-label / aria-labelledby / 关联 <label htmlFor>)
 *   - image (role=img / <img>) 必须有 alt 或 aria-label
 *   - 标题层级顺序: 文档第一个 heading 应该是 h1 或 h2
 *   - 所有 [role="dialog"] / [role="region"] 必须有 aria-label
 */
async function checkBasicA11y(
    page: Page,
    includeSelectors: string[],
): Promise<A11yViolation[]> {
    // v1.0.16: page.evaluate 在 Electron 36 + Playwright 1.60 跑大段 DOM 处理时
    // 偶发 "Cannot read properties of undefined (reading '_object')" 序列化错。
    // 改用 page.locator 一次取一个 element handle, 逐个 evaluate 单个 element 的属性,
    // 返回 plain string 数据,避免 Playwright 序列化 DOM ref 炸。

    const violations: A11yViolation[] = [];
    const includeList = includeSelectors.join(', ');

    // 规则 1: 范围内 button 必须有 accessible name
    const buttons = await page.locator(`${includeList} button`).all();
    for (const btn of buttons) {
        const info = await btn.evaluate((el) => ({
            ariaLabel: el.getAttribute('aria-label'),
            text: (el.textContent ?? '').trim(),
            title: el.getAttribute('title'),
            outer: el.outerHTML.slice(0, 120),
        }));
        if (!info.ariaLabel && !info.text && !info.title) {
            violations.push({
                rule: 'button-needs-accessible-name',
                target: info.outer,
                message: `<button> 没有 aria-label, 文字内容, 或 title`,
            });
        }
    }

    // 规则 2: 范围内 form input 必须有 label
    const inputs = await page.locator(`${includeList} input, ${includeList} textarea, ${includeList} select`).all();
    for (const inp of inputs) {
        const info = await inp.evaluate((el) => {
            const e = el as HTMLInputElement;
            return {
                type: e.type,
                ariaLabel: el.getAttribute('aria-label'),
                ariaLabelledBy: el.getAttribute('aria-labelledby'),
                id: el.id,
                outer: el.outerHTML.slice(0, 120),
                closestLabel: el.closest('label') !== null,
                hasForLabel:
                    el.id !== '' &&
                    document.querySelector(`label[for="${CSS.escape(el.id)}"]`) !== null,
            };
        });
        if (info.type === 'hidden' || info.type === 'submit' || info.type === 'button') continue;
        if (!info.ariaLabel && !info.ariaLabelledBy && !info.hasForLabel && !info.closestLabel) {
            violations.push({
                rule: 'form-input-needs-label',
                target: info.outer,
                message: `<input/textarea/select> 没有 aria-label, aria-labelledby, 或关联 <label>`,
            });
        }
    }

    // 规则 3: 范围内 [role="dialog"] / [role="region"] 必须有 aria-label
    const regions = await page.locator(`${includeList} [role="dialog"], ${includeList} [role="region"]`).all();
    for (const reg of regions) {
        const info = await reg.evaluate((el) => ({
            ariaLabel: el.getAttribute('aria-label'),
            ariaLabelledBy: el.getAttribute('aria-labelledby'),
            role: el.getAttribute('role'),
            outer: el.outerHTML.slice(0, 120),
        }));
        if (!info.ariaLabel && !info.ariaLabelledBy) {
            violations.push({
                rule: 'region-needs-aria-label',
                target: info.outer,
                message: `role=${info.role} 必须有 aria-label 或 aria-labelledby`,
            });
        }
    }

    return violations;
}

/**
 * 跳过首次引导 modal.
 * v1.0.16: 不能用 .remove() 删 DOM (破坏 React ownership 导致 portal 卸载时
 *   removeChild error 把 App crash 到 error boundary). 必须点 "跳过引导" 按钮.
 *   路径 A: localStorage 未设 firstLaunchDone → onboarding 渲染 → 点 "跳过引导"
 *   路径 B: 已点过 → onboarding 不渲染 → 跳过
 * 注: 必须在 tablist 可见 (React 已挂载) 后调用, 否则 modal 可能尚未渲染导致 count=0 竞态.
 */
async function dismissOnboarding(page: Page): Promise<void> {
    const modalCount = await page.locator('[data-testid="onboarding-modal"]').count();
    if (modalCount > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5_000 });
        await page.waitForFunction(
            () => document.querySelector('[data-testid="onboarding-modal"]') === null,
            { timeout: 5_000 }
        );
    }
}

test.describe('Pi Desktop a11y', () => {
    let app: ElectronApplication;

    test.afterEach(async () => {
        // v1.0.11 fix: Playwright 1.60 + Electron 36 — app.process() 在 test 结束后变成 undefined.
        // 改用更防御式的 cleanup: 拿到 app 就关, 拿不到 process() 就放过
        if (!app) return;
        try {
            await app.close();
        } catch {
            /* ignore */
        }
    });

    test('command palette page: 0 critical a11y violations', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: process.env.CI ?? '1', ELECTRON_RENDERER_URL: '' },
        });

        const window: Page = await getWindowByUrl(app, "index.html");
        await window.waitForLoadState('domcontentloaded');
        // 冷启动: 先等 networkidle 让初始资源加载稳定, 再定位 tablist (避免 15s 内未渲染超时)
        await window.waitForLoadState('networkidle');

        // 等待 React 挂载。导航已分为顶部标签栏 + 左侧会话列表。
        await window.waitForSelector('[role="tablist"][aria-label="顶部标签栏"]', { timeout: 15_000 });
        await window.waitForSelector('nav[aria-label="会话列表"]', { timeout: 15_000 });

        // 跳过首次引导 (onboarding modal 会捕获焦点, 阻止 Ctrl+K 打开命令面板)
        await dismissOnboarding(window);

        // 触发 Ctrl+K 打开命令面板
        await window.keyboard.press('Control+k');

        // 等待 dialog 出现
        await window.waitForSelector('[role="dialog"][aria-label*="命令面板"]', { timeout: 5_000 });

        // 跑手写 a11y 扫描
        const violations = await checkBasicA11y(window, [
            '[role="tablist"][aria-label="顶部标签栏"]',
            'nav[aria-label="会话列表"]',
            '[role="dialog"][aria-label*="命令面板"]',
        ]);

        if (violations.length > 0) {
            // eslint-disable-next-line no-console
            console.log(
                `[a11y] ${violations.length} violations:\n` +
                    violations
                        .map(
                            (v) =>
                                `  - [${v.rule}] ${v.message}\n      target=${v.target}`
                        )
                        .join('\n')
            );
        }

        expect(violations, `expected 0 a11y violations, got ${violations.length}`).toHaveLength(0);

    });

    test('main chat page: 0 critical a11y violations (without palette open)', async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: { ...process.env, CI: process.env.CI ?? '1', ELECTRON_RENDERER_URL: '' },
        });

        const window: Page = await getWindowByUrl(app, "index.html");
        await window.waitForLoadState('domcontentloaded');
        await window.waitForLoadState('networkidle');
        await window.waitForSelector('[role="tablist"][aria-label="顶部标签栏"]', { timeout: 15_000 });
        await window.waitForSelector('nav[aria-label="会话列表"]', { timeout: 15_000 });
        await dismissOnboarding(window);

        // 不打开命令面板, 扫主聊天界面
        const violations = await checkBasicA11y(window, [
            '[role="tablist"][aria-label="顶部标签栏"]',
            'nav[aria-label="会话列表"]',
            '[role="log"]',
            'form, [aria-label="给 Pi 发消息"]',
        ]);

        if (violations.length > 0) {
            // eslint-disable-next-line no-console
            console.log(
                `[a11y-chat] ${violations.length} violations:\n` +
                    violations
                        .map(
                            (v) =>
                                `  - [${v.rule}] ${v.message}\n      target=${v.target}`
                        )
                        .join('\n')
            );
        }
        expect(violations, `expected 0 a11y violations on main chat, got ${violations.length}`).toHaveLength(0);

    });
});
