// 临时复现: 用户真实配置下发图 → 捕获识图报错
// 验证后删除本文件, 不进入正式 e2e 套件.
import { test, expect, _electron } from '@playwright/test';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { electronMainEntry } from '../playwright.config';
import { resolveElectronExecutablePath } from "./support/electron-launch";

test('repro: 用户配置下发图, 捕获错误条', async () => {
    // 独立 userData + 复制用户真实 electron-store config.json → 与用户环境等价且不污染真实数据
    const userDataDir = join(tmpdir(), `pi-repro-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(userDataDir, { recursive: true });
    try {
        copyFileSync(
            join(process.env.APPDATA ?? '', '@pi-desktop', 'desktop', 'config.json'),
            join(userDataDir, 'config.json'),
        );
    } catch {
        console.log('no user config to copy, continuing with empty store');
    }

    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 25_000 });
    await expect(textarea).toBeEnabled({ timeout: 20_000 });

    // 捕获渲染层 console + 错误
    const pageErrors: Array<string> = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') pageErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    // 与用户一致的粘贴路径 (截图工具粘贴 image.png 样式)
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

    await textarea.fill('测试识图复现');
    // 诊断: 模型回填状态 + 发送按钮状态
    const sendButton = page.getByRole('button', { name: '发送', exact: true });
    const modelBtn = page.getByTestId('chat-input-model-trigger');
    console.log('MODEL BTN:', await modelBtn.textContent().catch(() => 'n/a'));
    console.log('SEND DISABLED:', await sendButton.isDisabled().catch(() => 'n/a'));
    // 与现有 e2e 一致: Enter 提交
    await textarea.press('Enter');

    // 等 15s, 捕获错误条
    const alertLocator = page.getByRole('alert');
    let alertText: string | null = null;
    try {
        await alertLocator.waitFor({ state: 'visible', timeout: 15_000 });
        alertText = (await alertLocator.textContent())?.trim() ?? null;
    } catch {
        alertText = null;
    }
    console.log('ALERT:', JSON.stringify(alertText));
    console.log('PAGE ERRORS:', JSON.stringify(pageErrors));

    // 输出截图
    await page.screenshot({ path: join(userDataDir, 'repro.png'), fullPage: false });

    // 无错误条 = 发送链路正常 (describeImages 成功)
    expect(alertText).toBeNull();
    await app.close();
});
