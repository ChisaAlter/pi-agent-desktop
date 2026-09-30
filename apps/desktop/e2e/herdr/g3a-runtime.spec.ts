/**
 * Isolated real-Herdr G3A acceptance.
 *
 * Requires a production build and an official Windows herdr.exe. The spec starts
 * its own named session + socket and never touches the user's default Herdr
 * session, Pi config, or git worktrees.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { electronMainEntry } from "../../playwright.config";
import { resolveElectronExecutablePath } from "../support/electron-launch";
import { getWindowByUrl } from "../support/electron-windows";
import {
    createIsolatedWorkspace,
    resolveIsolatedHerdrExecutable,
    startIsolatedHerdrRuntime,
    type IsolatedHerdrRuntime,
} from "../../src/main/services/herdr/__tests__/isolated-runtime";

const executable = resolveIsolatedHerdrExecutable();

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

test.describe("Herdr G3A isolated runtime", () => {
    test.skip(!executable, "official herdr.exe is not available on this machine");

    let runtime: IsolatedHerdrRuntime | undefined;
    let workspaceDir: string | undefined;
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        if (app) {
            try { await app.close(); } catch { /* ignore */ }
            app = undefined;
        }
        await runtime?.stop();
        runtime?.dispose();
        runtime = undefined;
        if (workspaceDir) {
            try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
            workspaceDir = undefined;
        }
    });

    test("智能体树显示真实隔离 Herdr workspace，而不是 mock", async () => {
        runtime = await startIsolatedHerdrRuntime(executable!);
        workspaceDir = mkdtempSync(join(tmpdir(), "pi-herdr-e2e-ws-"));
        await createIsolatedWorkspace(runtime, workspaceDir, "g3a-isolated");

        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: {
                ...process.env,
                CI: "1",
                PI_DESKTOP_E2E: "1",
                PI_HERDR_MOCK: "0",
                HERDR_SESSION: runtime.sessionName,
                HERDR_SOCKET_PATH: runtime.socketMarker,
                PI_HERDR_EXECUTABLE_PATH: runtime.executable,
            },
        });
        const page = await getWindowByUrl(app, "index.html");
        await page.waitForLoadState("domcontentloaded");
        await skipOnboarding(page);

        await page.locator('[data-mmcode-tab="agents"]').click();
        await expect(page.getByTestId("herdr-control-surface")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId("herdr-status-bar")).toBeVisible();
        await expect(page.getByTestId("herdr-status-dot")).toHaveAttribute("data-server", "connected", { timeout: 20_000 });
        await expect(page.getByTestId("herdr-ws-row").filter({ hasText: "g3a-isolated" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText("任务协调")).toHaveCount(0);
        await expect(page.getByText("v0.9.0")).toHaveCount(0);
        await page.screenshot({ path: "C:/Ai/pi-desktop/scripts/verify-g3a-agents.png", fullPage: true });
    });
});

test.describe("Herdr settings real actions", () => {
    test.skip(!executable, "official herdr.exe is not available on this machine");

    test("设置页：自动连接真实 server → 停止 → 再次连接（全链路真机）", async () => {
        const appData = mkdtempSync(join(tmpdir(), "pi-herdr-e2e-appdata-"));
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: {
                ...process.env,
                CI: "1",
                PI_DESKTOP_E2E: "1",
                PI_HERDR_MOCK: "0",
                PI_HERDR_EXECUTABLE_PATH: executable!,
                // 隔离 APPDATA → server 与 socket 全落在临时目录，不碰用户 Herdr
                APPDATA: appData,
            },
        });
        try {
            const page = await getWindowByUrl(app, "index.html");
            await page.waitForLoadState("domcontentloaded");
            await skipOnboarding(page);
            await page.evaluate(() => window.piAPI.openSettingsWindow());
            let settings: Page | null = null;
            for (let i = 0; i < 20 && !settings; i++) {
                settings = app.windows().find((w) => w.url().includes("settings.html")) ?? null;
                if (!settings) await page.waitForTimeout(500);
            }
            expect(settings, "设置窗口未打开").toBeTruthy();
            const s = settings!;
            await s.locator('[data-settings-tab="herdr"]').click();
            await expect(s.locator("#settings-tabpanel-herdr")).toBeVisible({ timeout: 10_000 });

            const diag = s.getByTestId("herdr-diag-connection");
            const connectBtn = s.getByTestId("herdr-connect");

            // 阶段1：设置页打开即自动连接（订阅触发 herdrGetSnapshot → bridge.start → spawn）
            let connected = false;
            for (let i = 0; i < 30 && !connected; i++) {
                await s.waitForTimeout(1_000);
                const text = (await diag.textContent().catch(() => "")) ?? "";
                connected = text.includes("正常");
                if (i % 5 === 0) console.log(`[g3a] connect t+${i + 1}s diag="${text}"`);
            }
            expect(connected, "设置页应在 30s 内自动连接").toBe(true);
            await expect(connectBtn).toBeDisabled();

            // 阶段2：停止服务 → 确认模态 → 回到未连接（server 真的退出）
            await s.getByTestId("herdr-stop").click();
            await expect(s.getByTestId("herdr-stop-modal")).toBeVisible();
            await s.getByTestId("herdr-stop-confirm").click();
            let stopped = false;
            for (let i = 0; i < 30 && !stopped; i++) {
                await s.waitForTimeout(1_000);
                const text = (await diag.textContent().catch(() => "")) ?? "";
                stopped = text.includes("未连接") || text.includes("Offline");
                if (i % 5 === 0) console.log(`[g3a] stop t+${i + 1}s diag="${text}"`);
            }
            expect(stopped, "停止后应回到未连接").toBe(true);

            // 真机核验：socket 已不可 ping（server 真的退出）
            await expect.poll(async () => {
                const { HerdrRpcClient } = await import("../../src/main/services/herdr/rpc-client");
                const { toHerdrSocketPath } = await import("../../src/main/services/herdr/socket-path");
                const marker = join(appData, "herdr", "herdr.sock");
                const client = new HerdrRpcClient({ socketPath: toHerdrSocketPath(marker) });
                try {
                    await client.request("ping", {}, 1_000);
                    return "alive";
                } catch {
                    return "stopped";
                } finally {
                    client.dispose();
                }
            }).toBe("stopped");

            // 阶段3：再次点「连接」→ 再次连接成功
            await expect(connectBtn).toBeEnabled();
            await connectBtn.click();
            let reconnected = false;
            for (let i = 0; i < 30 && !reconnected; i++) {
                await s.waitForTimeout(1_000);
                const text = (await diag.textContent().catch(() => "")) ?? "";
                reconnected = text.includes("正常");
                if (i % 5 === 0) console.log(`[g3a] reconnect t+${i + 1}s diag="${text}"`);
            }
            expect(reconnected, "重连后应显示已连接").toBe(true);
            await expect(connectBtn).toBeDisabled();
        } finally {
            // 先停掉 spawn 的 herdr server，避免 detached 子进程让 Electron 退出挂起
            try {
                const { HerdrRpcClient } = await import("../../src/main/services/herdr/rpc-client");
                const { toHerdrSocketPath } = await import("../../src/main/services/herdr/socket-path");
                const marker = join(appData, "herdr", "herdr.sock");
                const client = new HerdrRpcClient({ socketPath: toHerdrSocketPath(marker) });
                await client.request("server.stop", {}, 5_000);
                client.dispose();
            } catch { /* server already stopped */ }
            await app.close();
            try { rmSync(appData, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });
});

test.describe("Herdr settings layout", () => {
    test("设置页使用公共分区间距，而不是贴死的原型卡片", async () => {
        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const app = await _electron.launch({
            executablePath: resolveElectronExecutablePath(),
            args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
            env: {
                ...process.env,
                CI: "1",
                PI_DESKTOP_E2E: "1",
                PI_HERDR_MOCK: "0",
            },
        });
        try {
            const page = await getWindowByUrl(app, "index.html");
            await page.waitForLoadState("domcontentloaded");
            await skipOnboarding(page);
            await page.getByRole("button", { name: "打开设置", exact: true }).first().click();
            const settings = await getWindowByUrl(app, "settings.html");
            await settings.locator('[data-settings-tab="herdr"]').click();
            await expect(settings.locator("#settings-tabpanel-herdr")).toBeVisible({ timeout: 10_000 });
            await expect(settings.getByRole("heading", { name: "运行状态" })).toBeVisible();
            await expect(settings.getByRole("heading", { name: "操作" })).toBeVisible();
            await expect(settings.getByRole("heading", { name: "已接入能力" })).toBeVisible();
            // 真实管理内容：连接状态 + 来源 + 能力清单；假更新流程已删除
            await expect(settings.getByTestId("herdr-diag-connection")).toBeVisible();
            await expect(settings.getByTestId("herdr-source-pill")).toBeVisible();
            await expect(settings.getByTestId("herdr-connect")).toBeVisible();
            await expect(settings.getByTestId("check-update")).toHaveCount(0);
            await expect(settings.getByTestId("verify-update")).toHaveCount(0);
            await expect(settings.getByTestId("switch-update")).toHaveCount(0);
            await settings.locator("#settings-tabpanel-herdr").screenshot({
                path: "C:/Ai/pi-desktop/scripts/verify-herdr-settings.png",
            });
        } finally {
            await app.close();
        }
    });
});
