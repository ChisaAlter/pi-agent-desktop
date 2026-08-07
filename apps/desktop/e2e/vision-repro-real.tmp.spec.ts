// 临时复现: 真实 userData 下发图 (100% 还原用户场景), 捕获错误条
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

test('repro-real: 真实 userData 发图, 捕获错误条与主进程异常', async () => {
    // 不传 --user-data-dir → 真实用户数据
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

    const pageErrors: Array<string> = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') pageErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    const dataUrl = readFileSync(join(process.env.TEMP ?? '', 'vision-test-img.txt'), 'utf8');
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    await page.evaluate(({ b64 }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        const ta = document.querySelector('textarea');
        if (!ta) throw new Error('textarea not found');
        ta.dispatchEvent(ev);
    }, { b64: base64 });

    await expect(page.getByRole('listitem').filter({ hasText: 'image.png' })).toBeVisible({ timeout: 5_000 });

    await textarea.fill('识图复现测试消息');
    await textarea.press('Enter');

    const alertLocator = page.getByRole('alert');
    let alertText: string | null = null;
    try {
        await alertLocator.waitFor({ state: 'visible', timeout: 20_000 });
        alertText = (await alertLocator.textContent())?.trim() ?? null;
    } catch {
        alertText = null;
    }
    console.log('ALERT:', JSON.stringify(alertText));
    console.log('PAGE ERRORS:', JSON.stringify(pageErrors));

    // 主进程最近的 describeImages 异常 (config.ipc 不 log, 看 renderer 有无转发)
    const logs = await app.evaluate(({ log }) => log ?? 'no-log');
    console.log('MAIN LOG SAMPLE:', JSON.stringify(String(logs).slice(0, 200)));

    await page.screenshot({ path: join(tmpdir(), 'repro-real.png') });
    expect(alertText).toBeNull();
    await app.close();
});
