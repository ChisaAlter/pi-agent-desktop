// 临时实机测试: 真实剪贴板粘贴 → 打桩捕获 describeImages 实际参数
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

test('real-clipboard: 打桩捕获 describeImages 参数', async () => {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });
    await textarea.click();

    // 打桩 describe-images, 捕获渲染层实际传参
    await app.evaluate(({ ipcMain }) => {
        const g = globalThis as Record<string, unknown>;
        g.__describeArgs = [];
        ipcMain.removeHandler('pi:describe-images');
        ipcMain.handle('pi:describe-images', async (_event, images: unknown) => {
            (g.__describeArgs as Array<unknown>).push(images);
            return { text: '[stub] 识别结果' };
        });
    });

    // 真实系统剪贴板粘贴 (模拟截图工具)
    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);

    await page.waitForTimeout(1_500);
    // dump 页面上的 listitem (附件 chips?)
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="listitem"]')].map((el) => ({
        text: el.textContent?.slice(0, 50) ?? null,
        imgSrc: el.querySelector('img')?.getAttribute('src')?.slice(0, 40) ?? null,
        title: el.getAttribute('title')?.slice(0, 60) ?? null,
    })));
    console.log('LISTITEMS:', JSON.stringify(items));

    await textarea.fill('测试');
    await textarea.press('Enter');
    await page.waitForTimeout(3_000);

    const args = await app.evaluate(() => (globalThis as Record<string, unknown>).__describeArgs);
    console.log('DESCRIBE ARGS:', JSON.stringify(args));
    const alertText = await page.getByRole('alert').textContent().catch(() => null);
    console.log('ALERT:', JSON.stringify(alertText?.trim() ?? null));

    await app.close();
});
