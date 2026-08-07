// 临时实机测试: addInitScript 提前注入 paste 监听, 捕获真实剪贴板 items
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

test('init-paste: 捕获真实剪贴板 paste items', async () => {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${test.info().outputPath('user-data')}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 页面加载前注入 (比 React 早)
    await page.addInitScript(() => {
        const g = window as unknown as Record<string, unknown>;
        g.__pasteLog = [];
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items ?? [];
            g.__pasteLog = [...items].map((it) => {
                let fileInfo: Record<string, unknown> | null = null;
                try {
                    const f = it.getAsFile();
                    fileInfo = f ? { name: f.name, size: f.size, type: f.type } : null;
                } catch { fileInfo = null; }
                return { kind: it.kind, type: it.type, file: fileInfo };
            });
        }, true);
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items ?? [];
            g.__pasteLog = [...items].map((it) => {
                let fileInfo: Record<string, unknown> | null = null;
                try {
                    const f = it.getAsFile();
                    fileInfo = f ? { name: f.name, size: f.size, type: f.type } : null;
                } catch { fileInfo = null; }
                return { kind: it.kind, type: it.type, file: fileInfo };
            });
        }, false);
    });

    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() > 0) {
        await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 5_000 });
        await expect(modal).toHaveCount(0, { timeout: 5_000 });
    }

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });
    await textarea.click();

    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);

    await page.waitForTimeout(2_000);
    const pasteLog = await page.evaluate(() => (window as unknown as Record<string, unknown>).__pasteLog);
    console.log('PASTE ITEMS:', JSON.stringify(pasteLog));

    const items = await page.evaluate(() => [...document.querySelectorAll('[role="listitem"]')].map((el) => ({
        text: el.textContent?.slice(0, 40) ?? null,
        imgSrc: el.querySelector('img')?.getAttribute('src')?.slice(0, 30) ?? null,
        className: el.className?.toString().slice(0, 80) ?? null,
        parentClass: el.parentElement?.className?.toString().slice(0, 80) ?? null,
    })));
    console.log('LISTITEMS:', JSON.stringify(items));

    await app.close();
});
