// E2E: composer 固定高度布局契约 (Composer 溢出修复)
//
// 验证真实 Electron renderer 中的几何契约:
//  - shell 固定高度不被内容改变; 控制栏永远贴底
//  - 长文本/20 附件/错误 全部约束在 shell 内 (滚动而非穿出)
//  - 无文档滚动、无横向溢出; Slash 菜单向上弹出不被裁剪
//  - resize 拖拽后契约保持; --pi-global-composer-height 随挂载/卸载设置与清理
//
// 750×225 是 HTML 原型压力规格, 应用 minWidth/minHeight=896×756,
// 因此本 spec 只测 Electron 可用窗口规格 (896×756 默认 + 1365×768 宽窗).

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

async function getMainWindow(app: ElectronApplication): Promise<Page> {
    await getWindowByUrl(app, "index.html");
    return getWindowByUrl(app, "index.html");
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5000 });
    await expect(modal).toHaveCount(0, { timeout: 5000 });
}

/** 预置 workspace + session + agent, 让 reference composer 挂载在真实会话上 */
async function seedWorkspace(page: Page, workspacePath: string): Promise<void> {
    await page.evaluate(async ({ workspacePath }) => {
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
        window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
        const ws = await window.piAPI.createWorkspace("composer-layout-e2e", workspacePath);
        await window.piAPI.selectWorkspace(ws.path);
        const session = await window.piAPI.createSession(ws.id, "composer-layout-session", "composer-layout-session");
        await window.piAPI.agentsCreate({
            workspaceId: ws.id,
            title: "composer-layout-agent",
            sessionId: session.id,
        });
    }, { workspacePath });
}

async function launchComposerApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const workspacePath = test.info().outputPath('composer-layout-workspace');
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await getMainWindow(app);
    await page.waitForLoadState('domcontentloaded');
    await seedWorkspace(page, workspacePath);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await skipOnboarding(page);
    await page.getByRole('button', { name: 'composer-layout-session', exact: true }).click();
    const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i]').first();
    await expect(textarea).toBeVisible({ timeout: 15_000 });
    return { app, page };
}

interface Geometry {
    shell: { top: number; bottom: number; height: number; width: number } | null;
    controls: { top: number; bottom: number; height: number } | null;
    escapees: string[];
    shellHeightCss: string | null;
    composerVar: string;
    docScrollY: number;
    docOverflowX: number;
    textarea: { scrollH: number; clientH: number; overflowY: string } | null;
    innerHeight: number;
}

async function composerGeometry(page: Page): Promise<Geometry> {
    return page.evaluate(() => {
        const rect = (el: Element | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
        };
        const shell = document.querySelector('[data-testid="chat-input-shell"]');
        const controls = document.querySelector('[data-testid="chat-input-reference-controls"]');
        const escapees: string[] = [];
        if (shell) {
            const s = shell.getBoundingClientRect();
            for (const child of shell.children) {
                const style = getComputedStyle(child);
                if (style.position === "absolute") continue;
                if (style.display === "none") continue;
                const r = child.getBoundingClientRect();
                if (r.top < s.top - 0.5 || r.bottom > s.bottom + 0.5) {
                    escapees.push(
                        `${child.className.split(" ")[0] || child.tagName}: ${Math.round(r.top)}..${Math.round(r.bottom)} vs ${Math.round(s.top)}..${Math.round(s.bottom)}`,
                    );
                }
            }
        }
        const scrolling = document.scrollingElement ?? document.documentElement;
        const ta = document.querySelector('textarea');
        return {
            shell: rect(shell),
            controls: rect(controls),
            escapees,
            shellHeightCss: shell ? (shell as HTMLElement).style.height : null,
            composerVar: document.documentElement.style.getPropertyValue("--pi-global-composer-height"),
            docScrollY: scrolling.scrollHeight - scrolling.clientHeight,
            docOverflowX: scrolling.scrollWidth - scrolling.clientWidth,
            textarea: ta
                ? { scrollH: ta.scrollHeight, clientH: ta.clientHeight, overflowY: getComputedStyle(ta).overflowY }
                : null,
            innerHeight: window.innerHeight,
        };
    });
}

/** 固定高度契约断言 (计划 4.3) */
function expectShellContract(m: Geometry, expectedHeight?: number): void {
    expect(m.shell, "shell visible").not.toBeNull();
    expect(m.controls, "controls visible").not.toBeNull();
    expect(m.escapees, "no in-flow content escapes the shell").toEqual([]);
    expect(m.docScrollY, "document owns no vertical scroll").toBeLessThanOrEqual(4);
    expect(m.docOverflowX, "no horizontal overflow").toBeLessThanOrEqual(1);
    expect(m.shell!.bottom, "shell anchored to viewport bottom").toBeGreaterThan(m.innerHeight - 32);
    const delta = m.shell!.bottom - m.controls!.bottom;
    expect(delta, "controls flush with shell bottom (1px border)").toBeGreaterThanOrEqual(0);
    expect(delta, "controls flush with shell bottom (1px border)").toBeLessThanOrEqual(2);
    if (expectedHeight !== undefined) {
        expect(Math.abs(m.shell!.height - expectedHeight), `shell height equals ${expectedHeight}`).toBeLessThanOrEqual(1);
    }
}

async function waitForComposer(page: Page): Promise<void> {
    await expect.poll(async () => (await composerGeometry(page)).shell, { timeout: 15_000 }).not.toBeNull();
}

/** 向 textarea 派发包含 count 个图片文件的真实粘贴事件 */
async function pasteImages(page: Page, files: Array<{ name: string; bytes: number }>): Promise<void> {
    await page.evaluate((files) => {
        const dt = new DataTransfer();
        for (const f of files) {
            dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: "image/png" }));
        }
        const ta = document.querySelector('textarea');
        if (!ta) throw new Error('textarea not found');
        ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, files);
}

test.describe('Pi Desktop — composer 固定高度布局契约', () => {
    let app: ElectronApplication;
    let page: Page;

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* ignore */ }
    });

    test('基线: 空 composer 固定 95px, 控制栏贴底, 变量=103px, 无越界/无滚动', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        expect(m.composerVar).toBe("103px");
        expect(m.textarea!.overflowY).toBe("auto");
        await page.screenshot({ path: test.info().outputPath('baseline-empty.png') });
    });

    test('500 行长文本: textarea 自身滚动, shell 高度不变, 无文档滚动', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        const textarea = page.locator('textarea').first();
        const longText = Array.from({ length: 500 }, (_, i) => `第 ${i + 1} 行 — 长草稿内容 ${i}🚀 中文English123`).join("\n");
        await textarea.fill(longText);

        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        expect(m.textarea!.scrollH, 'textarea scrollHeight > clientHeight').toBeGreaterThan(m.textarea!.clientH);
        await page.screenshot({ path: test.info().outputPath('long-text-500.png') });
    });

    test('无空格超长 URL: 不产生横向溢出, shell 契约保持', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        const textarea = page.locator('textarea').first();
        await textarea.fill(`https://example.com/very/long/path/${"x".repeat(500)}?q=${"y".repeat(300)}`);
        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        await page.screenshot({ path: test.info().outputPath('long-url.png') });
    });

    test('20 张图片附件: chips 全在 shell 内, 附件区滚动, 控制栏贴底', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        await pasteImages(page, Array.from({ length: 20 }, (_, i) => ({ name: `pasted-${i}.png`, bytes: 64 })));

        const list = page.getByRole('list', { name: '已选附件' });
        await expect(list).toBeVisible({ timeout: 10_000 });
        await expect(list.getByRole('listitem')).toHaveCount(20, { timeout: 10_000 });

        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        const attScroll = await list.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
        expect(attScroll.scrollH, 'attachment area scrollable under pressure').toBeGreaterThan(attScroll.clientH);
        await page.screenshot({ path: test.info().outputPath('attachments-20.png') });
    });

    test('超大图片被拒: 错误提示受控在 shell 内, 契约保持', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        await pasteImages(page, [{ name: 'too-big.png', bytes: 6 * 1024 * 1024 }]);

        const alert = page.getByRole('alert').filter({ hasText: '图片大小不能超过' });
        await expect(alert).toBeVisible({ timeout: 10_000 });
        const alertClass = await alert.evaluate((el) => el.className);
        expect(alertClass).toContain('break-all');
        expect(alertClass).toContain('whitespace-pre-wrap');
        const wrapperClass = await alert.evaluate((el) => (el.parentElement as HTMLElement).className);
        expect(wrapperClass).toContain('overflow-y-auto');
        expect(wrapperClass).toContain('min-h-0');

        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        await page.screenshot({ path: test.info().outputPath('attachment-error.png') });
    });

    test('发送失败错误: 与附件错误同区约束, shell 契约保持', async () => {
        ({ app, page } = await launchComposerApp());
        // slash 命令路径不需要模型: stub 返回 ipcError → sendError
        await app.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('pi:run-builtin-slash-command');
            ipcMain.handle('pi:run-builtin-slash-command', async () => ({
                code: 'e2e.simulated.sendFailure',
                fallback: 'E2E 模拟发送失败: network unreachable',
            }));
        });
        await waitForComposer(page);

        const textarea = page.locator('textarea').first();
        await textarea.fill('/open-settings');
        const sendButton = page.getByRole('button', { name: '发送' }).last();
        await sendButton.click();

        const alert = page.getByRole('alert').filter({ hasText: 'E2E 模拟发送失败' });
        await expect(alert).toBeVisible({ timeout: 10_000 });
        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        await page.screenshot({ path: test.info().outputPath('send-error.png') });
    });

    test('resize 拖拽: 高度变化后契约保持, CSS 变量同步', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        const handle = page.getByRole('separator', { name: '调整输入框高度' });
        const box = await handle.boundingBox();
        if (!box) throw new Error('resize handle not visible');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y - 80, { steps: 6 });
        await page.mouse.up();

        const m = await composerGeometry(page);
        expect(m.shell!.height, 'shell grew after drag').toBeGreaterThan(150);
        expectShellContract(m, m.shell!.height);
        expect(m.composerVar, 'css var tracks shell height + 8').toBe(`${Math.round(m.shell!.height) + 8}px`);
        await page.screenshot({ path: test.info().outputPath('resized.png') });
    });

    test('Slash 菜单: 向上弹出在 shell 上方, 不被裁剪', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        const textarea = page.locator('textarea').first();
        await textarea.fill('/pla');

        const menu = page.getByRole('listbox', { name: 'Pi 命令候选' });
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const menuRect = await menu.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        });
        const m = await composerGeometry(page);
        expect(menuRect.top, 'menu fully inside viewport').toBeGreaterThanOrEqual(0);
        expect(m.shell!.top - menuRect.bottom, 'menu sits just above shell (4px gap)').toBeGreaterThanOrEqual(2);
        expect(m.shell!.top - menuRect.bottom, 'menu sits just above shell').toBeLessThanOrEqual(8);
        expect(m.escapees, 'menu is absolute overlay, shell contract unaffected').toEqual([]);
        await page.screenshot({ path: test.info().outputPath('slash-menu.png') });
    });

    test('切换面板卸载 composer: CSS 变量清理; 切回恢复', async () => {
        ({ app, page } = await launchComposerApp());
        await waitForComposer(page);
        let m = await composerGeometry(page);
        expect(m.composerVar).toBe("103px");

        // 切到"运行"面板 → ChatView inactive → composer 卸载 → 变量清理
        await page.getByRole('button', { name: '运行', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => document.documentElement.style.getPropertyValue('--pi-global-composer-height')), { timeout: 10_000 }).toBe('');
        await expect(page.locator('[data-testid="chat-input-shell"]')).toHaveCount(0);

        // 切回"对话" → composer 重新挂载 → 变量恢复
        await page.getByRole('button', { name: '对话', exact: true }).click();
        await expect.poll(async () => page.evaluate(() => document.documentElement.style.getPropertyValue('--pi-global-composer-height')), { timeout: 10_000 }).toBe('103px');
        m = await composerGeometry(page);
        expectShellContract(m, 95);
    });

    test('1365×768 宽窗口: 同契约, shell 高度与窄窗一致', async () => {
        ({ app, page } = await launchComposerApp());
        await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().includes('index.html'));
            win?.setSize(1365, 768);
        });
        await waitForComposer(page);
        const textarea = page.locator('textarea').first();
        await textarea.fill(Array.from({ length: 300 }, (_, i) => `行 ${i}`).join("\n"));
        await pasteImages(page, Array.from({ length: 12 }, (_, i) => ({ name: `w-${i}.png`, bytes: 64 })));
        await expect(page.getByRole('list', { name: '已选附件' }).getByRole('listitem')).toHaveCount(12, { timeout: 10_000 });

        const m = await composerGeometry(page);
        expectShellContract(m, 95);
        await page.screenshot({ path: test.info().outputPath('wide-1365x768.png') });
    });
});
