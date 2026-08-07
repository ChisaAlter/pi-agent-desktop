import { expect, type ElectronApplication, type Page } from "@playwright/test";

export async function getWindowByUrl(
    app: ElectronApplication,
    urlPart: string,
    timeout = 15_000,
): Promise<Page> {
    await expect.poll(async () => {
        return app.windows().some((candidate) => candidate.url().includes(urlPart));
    }, { timeout }).toBe(true);

    const page = app.windows().find((candidate) => candidate.url().includes(urlPart));
    if (!page) {
        throw new Error(`Window page not found for ${urlPart}`);
    }
    await page.waitForLoadState("domcontentloaded");
    const deadline = Date.now() + timeout;
    let stablePasses = 0;
    while (stablePasses < 2) {
        try {
            await app.evaluate(() => true);
            stablePasses += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 启动头 2-3 秒主进程被渲染层 IPC 洪峰占满时, evaluate 的 promise 可能被
            // GC 丢弃 (Chromium "Promise was collected"), 属一次性瞬断 — 应用本身
            // 健康, 重试即可; 与 "Execution context was destroyed" 同样处理。
            if (message.includes("garbage collected")) {
                stablePasses = 0;
                await new Promise((resolve) => setTimeout(resolve, 250));
                continue;
            }
            if (!message.includes("Execution context was destroyed")) throw error;
            stablePasses = 0;
        }
        if (Date.now() >= deadline) {
            throw new Error(`Electron main process context did not stabilize for ${urlPart}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return page;
}
export async function retryMainAction<T>(action: () => Promise<T>, attempts = 8): Promise<T> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await action();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("Execution context was destroyed") || attempt === attempts - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error("Electron main process action did not complete");
}

export async function showSettingsWindow(app: ElectronApplication, mainPage: Page): Promise<Page> {
    await mainPage.getByRole("button", { name: "打开设置" }).click();
    const settingsWindow = await getWindowByUrl(app, "settings.html");
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => {
            try {
                return !candidate.isDestroyed() && candidate.webContents.getURL().includes("settings.html");
            } catch {
                return false;
            }
        });
        return window?.isVisible() ?? false;
    })).toBe(true);
    return settingsWindow;
}
export async function hideSettingsWindow(app: ElectronApplication, settingsWindow: Page): Promise<void> {
    await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => {
            try {
                return !candidate.isDestroyed() && candidate.webContents.getURL().includes("settings.html");
            } catch {
                return false;
            }
        });
        return window?.isVisible() ?? false;
    })).toBe(false);
}
