// 临时实机测试: MutationObserver + 事件日志, 追踪附件来源
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

test('trace: 事件日志 + MutationObserver 追附件来源', async () => {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${test.info().outputPath('user-data')}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.addInitScript(() => {
        const g = window as unknown as Record<string, unknown>;
        g.__events = [];
        g.__mutations = [];
        const log = (name: string) => (): void => {
            (g.__events as Array<Record<string, unknown>>).push({ name, t: Date.now() });
        };
        for (const ev of ['paste', 'keydown', 'drop', 'dragover', 'input', 'beforeinput']) {
            document.addEventListener(ev, log(ev), true);
        }
        const mo = new MutationObserver((records) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLElement && node.getAttribute('role') === 'listitem') {
                        (g.__mutations as Array<Record<string, unknown>>).push({
                            t: Date.now(),
                            text: node.textContent?.slice(0, 30) ?? null,
                            cls: node.className?.toString().slice(0, 40) ?? null,
                        });
                    }
                }
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    });

    // addInitScript 需导航后生效
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5_000 });
        await expect(modal).toHaveCount(0, { timeout: 5_000 });
    }

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });
    await textarea.click();
    await page.waitForTimeout(1_000);

    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);

    await page.waitForTimeout(2_000);
    const events = await page.evaluate(() => (window as unknown as Record<string, unknown>).__events);
    const mutations = await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutations);
    console.log('EVENTS:', JSON.stringify(events));
    console.log('MUTATIONS:', JSON.stringify(mutations));

    const taValue = await page.evaluate(() => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? null);
    console.log('TEXTAREA VALUE:', JSON.stringify(taValue?.slice(0, 50)));

    await app.close();
});
