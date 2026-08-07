// 临时实机测试: 分步观察附件何时出现 (启动 → click → paste)
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

async function dump(page: import('@playwright/test').Page, label: string): Promise<void> {
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="listitem"]')].map((el) => ({
        text: el.textContent?.slice(0, 40) ?? null,
        imgSrc: el.querySelector('img')?.getAttribute('src')?.slice(0, 30) ?? null,
    })));
    console.log(`[${label}] LISTITEMS:`, JSON.stringify(items));
}

test('step: 附件出现时机分步观察', async () => {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${test.info().outputPath('user-data')}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5_000 });
        await expect(modal).toHaveCount(0, { timeout: 5_000 });
    }

    // evaluate 注册 MutationObserver (操作前)
    await page.evaluate(() => {
        const g = window as unknown as Record<string, unknown>;
        g.__mutations = [];
        const mo = new MutationObserver((records) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLElement && node.getAttribute('role') === 'listitem') {
                        (g.__mutations as Array<Record<string, unknown>>).push({
                            t: Date.now(),
                            text: node.textContent?.slice(0, 30) ?? null,
                        });
                    }
                }
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    });

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });

    // 步骤 1: 启动后
    await dump(page, '启动后');

    // 步骤 2: click textarea
    await textarea.click();
    await page.waitForTimeout(2_000);
    await dump(page, 'click后');

    // 步骤 3: paste
    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);
    await page.waitForTimeout(2_000);
    await dump(page, 'paste后');

    const mutations = await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutations);
    console.log('MUTATIONS:', JSON.stringify(mutations));

    await app.close();
});
