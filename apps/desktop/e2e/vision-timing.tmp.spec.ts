// 临时实机测试: 附件出现时机 + describe 参数
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

async function dumpListItems(page: import('@playwright/test').Page, label: string): Promise<void> {
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="listitem"]')].map((el) => ({
        text: el.textContent?.slice(0, 40) ?? null,
        imgSrc: el.querySelector('img')?.getAttribute('src')?.slice(0, 30) ?? null,
    })));
    console.log(`[${label}] LISTITEMS:`, JSON.stringify(items));
}

test('timing: 附件出现时机与 describe 参数', async () => {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${test.info().outputPath('user-data')}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 新 userData 首次启动有引导弹窗, 会遮挡输入框
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5_000 });
        await expect(modal).toHaveCount(0, { timeout: 5_000 });
    }

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });

    // 打桩 describe, 记录参数
    await app.evaluate(({ ipcMain }) => {
        const g = globalThis as Record<string, unknown>;
        g.__describeArgs = [];
        ipcMain.removeHandler('pi:describe-images');
        ipcMain.handle('pi:describe-images', async (_event, images: unknown) => {
            (g.__describeArgs as Array<unknown>).push(images);
            return { text: '[stub]' };
        });
    });

    // 1. paste 前
    await dumpListItems(page, '启动后');

    await textarea.click();
    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);
    await page.waitForTimeout(2_000);

    // 2. paste 后
    await dumpListItems(page, 'paste后');

    // 3. 发图
    await textarea.fill('测试');
    await textarea.press('Enter');
    await page.waitForTimeout(2_000);
    const args = await app.evaluate(() => (globalThis as Record<string, unknown>).__describeArgs);
    console.log('DESCRIBE ARGS:', JSON.stringify(args));
    const alertText = await page.getByRole('alert').textContent().catch(() => null);
    console.log('ALERT:', JSON.stringify(alertText?.trim() ?? null));

    await app.close();
});
