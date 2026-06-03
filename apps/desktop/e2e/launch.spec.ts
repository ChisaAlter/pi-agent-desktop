/**
 * E2E smoke: launch the Pi Desktop Electron app and assert the main window
 * appears with the correct title.
 *
 * Pre-requisite: `pnpm --filter @pi-desktop/desktop build` must have produced
 * `apps/desktop/out/main/index.js` and `apps/desktop/out/renderer/index.html`.
 *
 * This spec intentionally does NOT mock the Pi session — the real
 * AgentSession pipeline starts up inside the main process. If the user's
 * local Pi CLI is not installed, the app still launches; piDriver.detect()
 * reports `installed: false` and the renderer shows a friendly install
 * prompt. The assertion only checks window + title, not session state.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { electronMainEntry } from '../playwright.config';

test.describe('Pi Desktop launch', () => {
    let app: ElectronApplication;

    test.afterEach(async () => {
        // v1.0.11: Playwright 1.60 + Electron 36 — app.process() 在 test 结束后
        // 变成 undefined. 改用更防御式的 cleanup: 拿到 app 就关, 拿不到就放过
        // (Electron 进程会被 test runner 自己清理).
        if (!app) return;
        try {
            await app.close();
        } catch {
            /* ignore */
        }
    });

    test('starts main process, shows window with title "Pi Desktop"', async () => {
        app = await _electron.launch({
            args: [electronMainEntry],
            // Forward our existing env (e.g. PATH) so the spawned Electron
            // binary can find node-pty / native deps. CI flag also helps
            // when running under a CI shell.
            env: { ...process.env, CI: process.env.CI ?? '1' },
        });

        // The main process creates exactly one BrowserWindow via
        // createWindow(). firstWindow() resolves as soon as it appears.
        const window: Page = await app.firstWindow();

        // The renderer sets <title>Pi Desktop</title> in index.html, so the
        // document title is available as soon as the HTML is parsed.
        await window.waitForLoadState('domcontentloaded');

        // (1) Title check via the renderer's <title> element.
        const title = await window.title();
        expect(title).toBe('Pi Desktop');

        // (2) Cross-check via the main process: query the BrowserWindow
        // instance directly to assert it is visible and not destroyed.
        const windowState = await app.evaluate(({ BrowserWindow }) => {
            const wins = BrowserWindow.getAllWindows();
            if (wins.length === 0) {
                return { count: 0, visible: false, title: null as string | null };
            }
            const main = wins[0];
            return {
                count: wins.length,
                visible: main.isVisible() && !main.isDestroyed(),
                title: main.getTitle(),
            };
        });

        expect(windowState.count).toBe(1);
        expect(windowState.visible).toBe(true);
        expect(windowState.title).toBe('Pi Desktop');

        // (3) Sanity check: the renderer root is mounted.
        const rootHasContent = await window.evaluate(() => {
            const root = document.getElementById('root');
            return !!root && root.children.length > 0;
        });
        expect(rootHasContent).toBe(true);

        // (4) Clean shutdown.
        await app.close();
    });
});
