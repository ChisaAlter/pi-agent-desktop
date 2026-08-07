// 临时实机测试: 覆盖所有加图路径, 每个场景真实发图, 检查是否报错
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

const TEST_TEXT = '实机识图测试';
const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

async function waitForReady(app: ElectronApplication, page: Page): Promise<void> {
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });
}

async function pasteFile(page: Page, opts: { name?: string; type?: string; b64?: string }): Promise<void> {
    await page.evaluate(({ b64, name, type }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name ?? 'image.png', { type: type ?? 'image/png' }));
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        const ta = document.querySelector('textarea');
        if (!ta) throw new Error('textarea not found');
        ta.dispatchEvent(ev);
    }, { b64: opts.b64 ?? base64, name: opts.name, type: opts.type });
}

async function sendAndCheck(page: Page, label: string): Promise<string | null> {
    const textarea = page.locator('textarea').first();
    await textarea.fill(TEST_TEXT);
    await textarea.press('Enter');
    const alertLocator = page.getByRole('alert');
    let alertText: string | null = null;
    try {
        await alertLocator.waitFor({ state: 'visible', timeout: 12_000 });
        alertText = (await alertLocator.textContent())?.trim() ?? null;
    } catch {
        alertText = null;
    }
    console.log(`[${label}] ALERT:`, JSON.stringify(alertText));
    // 清掉附件 (点 chip 关闭按钮)
    const closeBtns = page.locator('[role="listitem"] button');
    while (await closeBtns.count() > 0) {
        await closeBtns.first().click().catch(() => undefined);
        await page.waitForTimeout(150);
    }
    return alertText;
}

async function pasteRealClipboard(app: ElectronApplication): Promise<void> {
    // 用 Electron 系统剪贴板写入图片并真实粘贴 — 模拟截图工具粘贴
    await app.evaluate(({ clipboard, nativeImage, BrowserWindow }, b64) => {
        const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
        clipboard.writeImage(img);
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
        if (!win) throw new Error('main window not found');
        win.webContents.paste();
    }, base64);
}

test('vision matrix: 实机各加图路径发图', async () => {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await waitForReady(app, page);

    // 聚焦 textarea (真实粘贴需要焦点)
    await page.locator('textarea').first().click();

    // 场景 1: 真实系统剪贴板粘贴 (截图工具路径)
    await pasteRealClipboard(app);
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 5_000 });
    await sendAndCheck(page, '真实剪贴板粘贴');

    // 场景 2: 构造 File PNG
    await pasteFile(page, {});
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 5_000 });
    await sendAndCheck(page, '构造PNG粘贴');

    // 场景 3: JPEG
    await pasteFile(page, { name: 'shot.jpg', type: 'image/jpeg' });
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 5_000 });
    await sendAndCheck(page, 'JPEG粘贴');

    // 场景 4: GIF
    await pasteFile(page, { name: 'anim.gif', type: 'image/gif' });
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 5_000 });
    await sendAndCheck(page, 'GIF粘贴');

    // 场景 5: WebP
    await pasteFile(page, { name: 'pic.webp', type: 'image/webp' });
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 5_000 });
    await sendAndCheck(page, 'WebP粘贴');

    // 场景 6: 空文件名 (file.name 为空 → 兜底名)
    await pasteFile(page, { name: '', type: 'image/png' });
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 5_000 });
    await sendAndCheck(page, '空文件名粘贴');

    await app.close();
});
