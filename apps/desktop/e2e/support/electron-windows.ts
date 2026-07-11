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
