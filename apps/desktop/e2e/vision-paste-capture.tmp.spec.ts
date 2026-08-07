// 临时实机测试: 注入原生 paste 监听, 观察真实剪贴板 items 结构
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

test('real-clipboard: 观察原生 paste 事件 items', async () => {
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

    // 原生 capture 监听 paste 事件 (先于 React 合成事件)
    await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__pasteLog = [];
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items ?? [];
            const log = [...items].map((it) => {
                let fileInfo: Record<string, unknown> | null = null;
                try {
                    const f = it.getAsFile();
                    fileInfo = f ? { name: f.name, size: f.size, type: f.type } : null;
                } catch {
                    fileInfo = { getAsFileError: true };
                }
                return { kind: it.kind, type: it.type, file: fileInfo };
            });
            (window as unknown as Record<string, unknown>).__pasteLog = log;
            console.log('[paste-capture]', JSON.stringify(log));
        }, true);
    });

    await textarea.click();

    // 真实系统剪贴板粘贴
    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);

    await page.waitForTimeout(2_000);
    const pasteLog = await page.evaluate(() => (window as unknown as Record<string, unknown>).__pasteLog);
    console.log('PASTE ITEMS:', JSON.stringify(pasteLog, null, 1));

    const items = await page.evaluate(() => [...document.querySelectorAll('[role="listitem"]')].map((el) => ({
        text: el.textContent?.slice(0, 50) ?? null,
        imgSrc: el.querySelector('img')?.getAttribute('src')?.slice(0, 40) ?? null,
    })));
    console.log('LISTITEMS:', JSON.stringify(items));

    await app.close();
});
