import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");

function writeProviderConfig(configDir: string, baseUrl: string): void {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "models.json"), JSON.stringify({
        providers: {
            "failure-test": {
                name: "Failure Test",
                baseUrl,
                apiKey: "local-test-key",
                api: "openai-completions",
                models: [{
                    id: "failure-model",
                    name: "Failure Model",
                    reasoning: false,
                    input: ["text"],
                    contextWindow: 8192,
                    maxTokens: 1024,
                }],
            },
        },
    }, null, 2), "utf8");
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({
        defaultProvider: "failure-test",
        defaultModel: "failure-model",
    }, null, 2), "utf8");
}

async function startFailureServer(status: number, message: string): Promise<{ server: Server; baseUrl: string }> {
    const server = createServer((request, response) => {
        request.resume();
        if (request.url !== "/v1/chat/completions") {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message, type: "provider_error", code: status } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function launchApp(userDataDir: string, configDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: {
            ...process.env,
            CI: "1",
            ELECTRON_RENDERER_URL: "",
            PI_DESKTOP_CONFIG_DIR: configDir,
        },
    });
    const page = await getWindowByUrl(app, "index.html");
    return { app, page };
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

const scenarios = [
    { status: 401, message: "invalid API key", expected: /401|invalid API key|认证失败/i },
    { status: 429, message: "rate limit exceeded", expected: /429|rate limit|请求过于频繁/i },
];

test.describe("Pi Desktop real provider error acceptance", () => {
    let app: ElectronApplication | undefined;
    let server: Server | undefined;

    test.setTimeout(120_000);

    test.afterEach(async () => {
        try { await app?.close(); } catch { /* Best-effort Electron cleanup. */ }
        if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
        app = undefined;
        server = undefined;
    });

    for (const scenario of scenarios) {
        test(`real provider ${scenario.status} errors stay visible and actionable`, async ({}, testInfo) => {
            mkdirSync(ACCEPTANCE_DIR, { recursive: true });
            const userDataDir = testInfo.outputPath(`provider-error-${scenario.status}-user-data`);
            const configDir = testInfo.outputPath(`provider-error-${scenario.status}-config`);
            const workspacePath = testInfo.outputPath(`provider-error-${scenario.status}-workspace`);
            const failureServer = await startFailureServer(scenario.status, scenario.message);
            server = failureServer.server;
            writeProviderConfig(configDir, failureServer.baseUrl);

            let page: Page;
            ({ app, page } = await launchApp(userDataDir, configDir));
            await skipOnboarding(page);

            await page.evaluate(async ({ workspacePath }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
                const workspace = await window.piAPI.createWorkspace("provider-error-real", workspacePath);
                if ("code" in workspace) throw new Error(workspace.fallback);
                await window.piAPI.selectWorkspace(workspace.path);
                await window.piAPI.setSettings({ provider: "failure-test", model: "failure-model" });
            }, { workspacePath });

            const textarea = page.locator('textarea[aria-label="发送"]').first();
            await expect(textarea).toBeVisible({ timeout: 10_000 });
            await textarea.fill(`trigger provider ${scenario.status}`);
            await textarea.press("Enter");

            await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(`trigger provider ${scenario.status}`, { timeout: 10_000 });
            const providerAlert = page.getByRole("alert").filter({ hasText: scenario.expected }).first();
            await expect(providerAlert).toBeVisible({ timeout: 30_000 });
            await expect(providerAlert).not.toContainText("Pi 本轮没有返回内容");
        });
    }
});
