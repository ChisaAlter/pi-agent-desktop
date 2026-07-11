import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { mkdir as mkdirAsync } from "fs/promises";
import { join } from "path";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl, retryMainAction } from "./support/electron-windows";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
const HISTORY_NEEDLE = "m6-history-needle";
const HISTORY_REPLY = "m6-history-reply";
const WORKSPACE_TWO_NEEDLE = "m6-workspace-two-needle";
const HISTORY_SESSION_ID = "m6-history-session";
const HISTORY_SESSION_TITLE = "M6 History Session";

async function ensureAcceptanceDir(): Promise<void> {
    await mkdirAsync(ACCEPTANCE_DIR, { recursive: true });
}

function prepareWorkspaceRepo(workspacePath: string): void {
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, ".github", "workflows"), { recursive: true });
    mkdirSync(join(workspacePath, ".vscode"), { recursive: true });
    mkdirSync(join(workspacePath, "src"), { recursive: true });

    writeFileSync(join(workspacePath, "README.md"), "# M6 Acceptance\n\nInitial content.\n", "utf-8");
    writeFileSync(join(workspacePath, ".gitignore"), "node_modules/\n.env.local\n", "utf-8");
    writeFileSync(join(workspacePath, ".github", "workflows", "ci.yml"), "name: ci\non: [push]\n", "utf-8");
    writeFileSync(join(workspacePath, ".vscode", "settings.json"), '{\n  "editor.tabSize": 2\n}\n', "utf-8");
    writeFileSync(join(workspacePath, "src", "risky.ts"), "export const risky = false;\n", "utf-8");

    execSync("git init", { cwd: workspacePath, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: workspacePath, stdio: "ignore" });
    execSync('git config user.name "Pi Desktop E2E"', { cwd: workspacePath, stdio: "ignore" });
    execSync("git add .", { cwd: workspacePath, stdio: "ignore" });
    execSync('git commit -m "Initial commit"', { cwd: workspacePath, stdio: "ignore" });

    writeFileSync(join(workspacePath, "README.md"), "# M6 Acceptance\n\nREADME changed for release gate.\n", "utf-8");
}

function prepareStubModelConfig(configDir: string): void {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "models.json"), JSON.stringify({
        providers: {
            e2e: {
                name: "E2E Stub",
                baseUrl: "http://127.0.0.1:1/v1",
                api: "openai-completions",
                models: [{ id: "stub-model", name: "Stub Model", contextWindow: 8192, maxTokens: 1024 }],
            },
        },
    }, null, 2), "utf-8");
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({
        defaultProvider: "e2e",
        defaultModel: "stub-model",
    }, null, 2), "utf-8");
}

async function launchApp(
    userDataDir: string,
    configDir: string,
): Promise<{ app: ElectronApplication; page: Page }> {
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

async function dismissOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function reloadAppShell(page: Page): Promise<void> {
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissOnboarding(page);
}

async function stubPromptIpc(app: ElectronApplication): Promise<void> {
    await retryMainAction(() => app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("pi:send");
        ipcMain.handle("pi:send", async () => undefined);
        ipcMain.removeHandler("agents:prompt");
        ipcMain.handle("agents:prompt", async () => undefined);
    }));
}

async function emitCurrentAgentEvents(
    page: Page,
    app: ElectronApplication,
    events: Array<Record<string, unknown>>,
): Promise<void> {
    await page.waitForFunction(
        async () => (await window.piAPI.agentsList()).some((agent) => agent.sessionId),
        { timeout: 10_000 },
    );
    const agent = await page.evaluate(async () => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId) ?? agents[0] ?? null;
    });
    if (!agent) throw new Error("No agent available for agents:event injection");

    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().includes("index.html"))
            ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error("No Electron window available for agents:event injection");
        for (const event of payload.events) {
            win.webContents.send("agents:event", {
                agentId: payload.agent.id,
                workspaceId: payload.agent.workspaceId,
                event,
            });
        }
    }, { agent, events });
}

async function installPermissionCapture(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain }) => {
        const target = globalThis as typeof globalThis & {
            __permissionResponses?: Array<{ requestId: string; response: unknown }>;
            __permissionCaptureInstalled?: boolean;
        };
        target.__permissionResponses = [];
        if (target.__permissionCaptureInstalled) return;
        target.__permissionCaptureInstalled = true;
        ipcMain.on("permission:respond", (_event, requestId: string, response: unknown) => {
            target.__permissionResponses?.push({ requestId, response });
        });
    });
}

async function permissionResponses(app: ElectronApplication): Promise<Array<{ requestId: string; response: { requestId: string; decision: string } }>> {
    return app.evaluate(() => {
        const target = globalThis as typeof globalThis & {
            __permissionResponses?: Array<{ requestId: string; response: { requestId: string; decision: string } }>;
        };
        return target.__permissionResponses ?? [];
    });
}

async function emitPermissionRequest(
    app: ElectronApplication,
    request: { requestId: string; title: string; message?: string; workspaceId?: string },
): Promise<void> {
    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find((item) => {
            try {
                return !item.isDestroyed() && item.webContents.getURL().includes("index.html");
            } catch {
                return false;
            }
        });
        if (!win) throw new Error("Main window not found for permission request injection");
        win.webContents.send("permission:request", {
            requestId: payload.requestId,
            kind: "select",
            source: "permission",
            title: payload.title,
            message: payload.message,
            workspaceId: payload.workspaceId,
            createdAt: Date.now(),
        });
    }, request);
}

async function emitApprovalDeferredReview(
    app: ElectronApplication,
    payload: {
        workspaceId: string;
        filePath: string;
        changeId: string;
        toolCallId: string;
        diff: string;
    },
): Promise<void> {
    await app.evaluate(({ BrowserWindow }, review) => {
        const win = BrowserWindow.getAllWindows().find((item) => {
            try {
                return !item.isDestroyed() && item.webContents.getURL().includes("index.html");
            } catch {
                return false;
            }
        });
        if (!win) throw new Error("Main window not found for approval injection");
        win.webContents.send("approval:deferred", {
            workspaceId: review.workspaceId,
            changeId: review.changeId,
            toolCallId: review.toolCallId,
            filePath: review.filePath,
            op: "write",
            timestamp: Date.now(),
        });
        win.webContents.send("approval:review", {
            workspaceId: review.workspaceId,
            changeId: review.changeId,
            toolCallId: review.toolCallId,
            filePath: review.filePath,
            diff: review.diff,
            newContent: "export const risky = true;\n",
            timestamp: Date.now(),
        });
    }, payload);
}

async function openSettingsWindow(app: ElectronApplication, page: Page): Promise<Page> {
    const settingsWindowPromise = app.waitForEvent("window");
    await page.getByRole("button", { name: "打开设置" }).click();
    const settingsWindow = await settingsWindowPromise;
    await settingsWindow.waitForLoadState("domcontentloaded");
    await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible({ timeout: 10_000 });
    return settingsWindow;
}

async function setFontSize(settingsWindow: Page, value: string): Promise<void> {
    await settingsWindow.getByLabel("字体大小").evaluate((input, nextValue) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}

async function switchWorkspace(page: Page, name: string): Promise<void> {
    const workspaceButton = page.getByRole("button", { name: /切换工作区：/ }).first();
    await expect(workspaceButton).toBeVisible({ timeout: 15_000 });
    await workspaceButton.click();
    const menu = page.locator('[role="menu"]').last();
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitem").filter({ hasText: name }).click();
    await expect(page.getByRole("button", { name: `切换工作区：${name}` }).first()).toBeVisible({ timeout: 10_000 });
}

async function screenshot(page: Page, fileName: string): Promise<void> {
    await page.screenshot({
        path: join(ACCEPTANCE_DIR, fileName),
        fullPage: true,
    });
}

test.describe("M6 release gate — final Electron acceptance", () => {
    test.setTimeout(120_000);
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        try {
            await app?.close();
        } catch {
            // Ignore Electron shutdown races during cleanup.
        } finally {
            app = undefined;
        }
    });

    test("captures final regression evidence across persistence, workspace routing, approvals, settings and search/export", async () => {
        await ensureAcceptanceDir();

        const userDataDir = test.info().outputPath(`m6-user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const configDir = test.info().outputPath("m6-config");
        const workspaceOnePath = test.info().outputPath("m6-workspace-one");
        const workspaceTwoPath = test.info().outputPath("m6-workspace-two");
        const now = Date.now();

        prepareWorkspaceRepo(workspaceTwoPath);
        prepareStubModelConfig(configDir);

        let page: Page;
        ({ app, page } = await launchApp(userDataDir, configDir));
        await stubPromptIpc(app);

        const seeded = await page.evaluate(
            async ({ workspaceOnePath, workspaceTwoPath, now, workspaceTwoNeedle }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop.onboarding.completed", "true");

                const ws1 = await window.piAPI.createWorkspace("m6-workspace-one", workspaceOnePath);
                const ws2 = await window.piAPI.createWorkspace("m6-workspace-two", workspaceTwoPath);
                await window.piAPI.selectWorkspace(ws1.path);

                const historySession = await window.piAPI.createSession(ws1.id, "M6 History Session", "m6-history-session");
                await window.piAPI.agentsCreate({
                    workspaceId: ws1.id,
                    title: "M6 History Session Agent",
                    sessionId: historySession.id,
                });

                const workspaceTwoSession = await window.piAPI.createSession(ws2.id, "M6 Workspace Two Session", "m6-workspace-two-session");
                await window.piAPI.appendMessage(workspaceTwoSession.id, {
                    id: "m6-workspace-two-user",
                    role: "user",
                    content: workspaceTwoNeedle,
                    timestamp: new Date(now - 2_000).toISOString(),
                });
                await window.piAPI.appendMessage(workspaceTwoSession.id, {
                    id: "m6-workspace-two-assistant",
                    role: "assistant",
                    content: "m6-workspace-two-reply",
                    timestamp: new Date(now - 1_500).toISOString(),
                });

                const exportSessionA = await window.piAPI.createSession(ws2.id, "M6 Export Session A", "m6-export-session-a");
                await window.piAPI.appendMessage(exportSessionA.id, {
                    id: "m6-export-message-a",
                    role: "user",
                    content: "batch export candidate A",
                    timestamp: new Date(now - 1_000).toISOString(),
                });

                const exportSessionB = await window.piAPI.createSession(ws2.id, "M6 Export Session B", "m6-export-session-b");
                await window.piAPI.appendMessage(exportSessionB.id, {
                    id: "m6-export-message-b",
                    role: "assistant",
                    content: "batch export candidate B",
                    timestamp: new Date(now - 500).toISOString(),
                });

                return {
                    workspaceOneId: ws1.id,
                    workspaceTwoId: ws2.id,
                };
            },
            { workspaceOnePath, workspaceTwoPath, now, workspaceTwoNeedle: WORKSPACE_TWO_NEEDLE },
        );
        const workspaceTwoId = seeded.workspaceTwoId;

        await reloadAppShell(page);

        await test.step("M1 final gate: session message and reply survive relaunch", async () => {
            const historySessionButton = page
                .getByRole("navigation", { name: "会话列表" })
                .getByRole("button", { name: HISTORY_SESSION_TITLE, exact: true });
            await expect(historySessionButton).toBeVisible({ timeout: 15_000 });
            await historySessionButton.click();
            const textarea = page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="描述" i]').first();
            await expect(textarea).toBeVisible({ timeout: 10_000 });
            await textarea.fill(HISTORY_NEEDLE);
            const sendButton = page.getByRole("button", { name: "发送", exact: true });
            await expect(sendButton).toBeEnabled({ timeout: 10_000 });
            await sendButton.click();

            await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(HISTORY_NEEDLE, { timeout: 10_000 });
            await emitCurrentAgentEvents(page, app!, [
                { type: "agent_start" },
                { type: "message_start" },
                {
                    type: "message_update",
                    assistantMessageEvent: {
                        type: "text_delta",
                        delta: HISTORY_REPLY,
                    },
                },
                { type: "turn_end" },
                { type: "agent_end" },
            ]);
            await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText(HISTORY_REPLY, { timeout: 10_000 });

            await app!.close();
            app = undefined;

            ({ app, page } = await launchApp(userDataDir, configDir));
            await stubPromptIpc(app);
            await dismissOnboarding(page);
            const sidebarSession = page
                .getByRole("navigation", { name: "会话列表" })
                .getByRole("button", { name: HISTORY_SESSION_TITLE, exact: true });
            await expect(sidebarSession).toBeVisible({ timeout: 15_000 });
            await sidebarSession.click();
            await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(HISTORY_NEEDLE, { timeout: 10_000 });
            await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText(HISTORY_REPLY, { timeout: 10_000 });
            await screenshot(page, "2026-06-24-m6-01-session-persisted.png");
        });

        await test.step("M2 final gate: workspace selection, lastActiveAt and history jump stay aligned", async () => {
            await switchWorkspace(page, "m6-workspace-two");

            const workspaces = await page.evaluate(async () => {
                const list = await window.piAPI.listWorkspaces();
                return list.map((workspace) => ({
                    name: workspace.name,
                    lastActiveAt: workspace.lastActiveAt ?? 0,
                }));
            });
            const ws1 = workspaces.find((workspace) => workspace.name === "m6-workspace-one");
            const ws2 = workspaces.find((workspace) => workspace.name === "m6-workspace-two");
            expect((ws2?.lastActiveAt ?? 0)).toBeGreaterThanOrEqual(ws1?.lastActiveAt ?? 0);

            await page.evaluate(() => {
                window.dispatchEvent(new Event("slash-command:open-sessions"));
            });
            await page.keyboard.press("Control+Shift+F");
            const search = page.getByRole("textbox", { name: "搜索对话历史" });
            await expect(search).toBeVisible({ timeout: 5_000 });
            await search.fill(WORKSPACE_TWO_NEEDLE);
            await page.locator("button").filter({ hasText: "M6 Workspace Two Session" }).filter({ hasText: WORKSPACE_TWO_NEEDLE }).click();

            await expect(page.getByRole("button", { name: "切换工作区：m6-workspace-two" }).first()).toBeVisible({ timeout: 5_000 });
            await expect(page.getByRole("article", { name: /你 ·/ })).toContainText(WORKSPACE_TWO_NEEDLE, { timeout: 10_000 });
            await expect(page.getByRole("article", { name: /Pi ·/ })).toContainText("m6-workspace-two-reply", { timeout: 10_000 });
            await screenshot(page, "2026-06-24-m6-02-workspace-history.png");
        });

        await test.step("M3 final gate: runtime permissions and approval review UI remain actionable", async () => {
            await installPermissionCapture(app!);

            await emitPermissionRequest(app!, {
                requestId: "m6_allow_session",
                title: "允许读取 package.json",
                message: "read package.json",
                workspaceId: workspaceTwoId,
            });
            let dialog = page.getByRole("alertdialog", { name: "权限请求 1" });
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            await dialog.getByRole("button", { name: "仅本对话" }).click();
            await expect(dialog).toHaveCount(0, { timeout: 5_000 });

            await emitPermissionRequest(app!, {
                requestId: "m6_allow_always",
                title: "允许运行危险命令",
                message: "pnpm test",
                workspaceId: workspaceTwoId,
            });
            dialog = page.getByRole("alertdialog", { name: "权限请求 1" });
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            await dialog.getByRole("button", { name: "更多权限决策" }).click();
            await page.getByRole("menuitem", { name: /始终授权/ }).click();
            await expect(dialog).toHaveCount(0, { timeout: 5_000 });

            await expect.poll(async () => permissionResponses(app!)).toEqual([
                { requestId: "m6_allow_session", response: { requestId: "m6_allow_session", decision: "allow_session" } },
                { requestId: "m6_allow_always", response: { requestId: "m6_allow_always", decision: "allow_always" } },
            ]);

            const diff = [
                "--- a/risky.ts",
                "+++ b/risky.ts",
                "@@ -1,1 +1,1 @@",
                "-export const risky = false;",
                "+export const risky = true;",
                "",
            ].join("\n");
            await emitApprovalDeferredReview(app!, {
                workspaceId: workspaceTwoId,
                filePath: "src/risky.ts",
                changeId: "m6_change_1",
                toolCallId: "m6_tool_1",
                diff,
            });
            await emitApprovalDeferredReview(app!, {
                workspaceId: workspaceTwoId,
                filePath: "README.md",
                changeId: "m6_change_2",
                toolCallId: "m6_tool_2",
                diff: [
                    "--- a/README.md",
                    "+++ b/README.md",
                    "@@ -1,3 +1,3 @@",
                    " # M6 Acceptance",
                    "-Initial content.",
                    "+README changed for release gate.",
                    "",
                ].join("\n"),
            });

            const approvalPanel = page.getByRole("region", { name: "文件变更审批" });
            await expect(approvalPanel).toBeVisible({ timeout: 5_000 });
            await expect(approvalPanel.getByText("src/risky.ts")).toBeVisible({ timeout: 5_000 });

            const firstPendingCard = approvalPanel.getByRole("listitem").filter({ hasText: "risky.ts" }).first();
            await firstPendingCard.getByRole("button", { name: "接受" }).click();
            await expect(firstPendingCard.getByText("已接受")).toBeVisible({ timeout: 5_000 });
            await expect(approvalPanel.getByRole("button", { name: "全部接受" })).toBeVisible({ timeout: 5_000 });
            await screenshot(page, "2026-06-24-m6-03-permission-approval.png");
        });

        await test.step("M4 final gate: settings persist across reopen and full relaunch", async () => {
            let settingsWindow = await openSettingsWindow(app!, page);

            await settingsWindow.getByRole("tab", { name: "界面" }).click();
            await settingsWindow.getByRole("button", { name: "深色" }).click();
            await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "dark");
            await setFontSize(settingsWindow, "18");
            await expect(settingsWindow.getByText("字体大小: 18px")).toBeVisible({ timeout: 5_000 });

            await settingsWindow.getByRole("tab", { name: "长程能力" }).click();
            const goalSwitch = settingsWindow.getByRole("switch", { name: "Goal / 停止条件" });
            const initialGoalState = await goalSwitch.getAttribute("aria-checked");
            const targetGoalState = initialGoalState === "true" ? "false" : "true";
            await goalSwitch.click();
            await expect(goalSwitch).toHaveAttribute("aria-checked", targetGoalState);

            const closeFirst = settingsWindow.waitForEvent("close");
            await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
            await closeFirst;
            await page.bringToFront();

            settingsWindow = await openSettingsWindow(app!, page);
            await settingsWindow.getByRole("tab", { name: "界面" }).click();
            await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "dark");
            await expect(settingsWindow.getByText("字体大小: 18px")).toBeVisible({ timeout: 5_000 });
            await settingsWindow.getByRole("tab", { name: "长程能力" }).click();
            await expect(settingsWindow.getByRole("switch", { name: "Goal / 停止条件" })).toHaveAttribute("aria-checked", targetGoalState);

            const closeSecond = settingsWindow.waitForEvent("close");
            await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
            await closeSecond;

            await app!.close();
            app = undefined;

            ({ app, page } = await launchApp(userDataDir, configDir));
            await stubPromptIpc(app);
            await dismissOnboarding(page);

            settingsWindow = await openSettingsWindow(app, page);
            await settingsWindow.getByRole("tab", { name: "界面" }).click();
            await expect(settingsWindow.locator("html")).toHaveAttribute("data-theme", "dark");
            await expect(settingsWindow.getByText("字体大小: 18px")).toBeVisible({ timeout: 5_000 });
            await settingsWindow.getByRole("tab", { name: "长程能力" }).click();
            await expect(settingsWindow.getByRole("switch", { name: "Goal / 停止条件" })).toHaveAttribute("aria-checked", targetGoalState);
            await screenshot(settingsWindow, "2026-06-24-m6-04-settings-persisted.png");

            const closeThird = settingsWindow.waitForEvent("close");
            await settingsWindow.getByRole("button", { name: "关闭窗口" }).click();
            await closeThird;
            await page.bringToFront();
        });

        await test.step("M5 final gate: files, git and batch export stay reachable in the real desktop app", async () => {
            const workspaceTwoButton = page.getByRole("button", { name: "切换工作区：m6-workspace-two" }).first();
            if (!(await workspaceTwoButton.isVisible().catch(() => false))) {
                await switchWorkspace(page, "m6-workspace-two");
            }
            await expect(workspaceTwoButton).toBeVisible({ timeout: 10_000 });

            await page.evaluate(() => {
                window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "files" } }));
            });
            const fileSearch = page.getByRole("textbox", { name: "搜索文件" });
            await expect(fileSearch).toBeVisible({ timeout: 5_000 });

            await fileSearch.fill(".g");
            await expect(page.locator('button[title=".gitignore"]')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('button[title=".github/workflows/ci.yml"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('button[title=".github/workflows/ci.yml"]').click();
            await expect(page.getByLabel("文件只读预览")).toContainText("name: ci", { timeout: 5_000 });

            await fileSearch.fill(".v");
            await expect(page.locator('button[title=".vscode/settings.json"]')).toBeVisible({ timeout: 5_000 });

            await page.evaluate(() => {
                window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "git" } }));
            });
            await expect(page.getByRole("region", { name: "Git 面板" })).toBeVisible({ timeout: 5_000 });
            await page.getByRole("button", { name: "刷新 Git 状态" }).click();
            await expect(page.getByText(/0 staged \/ 1 changes/)).toBeVisible({ timeout: 10_000 });
            await page.getByRole("button", { name: "打开 README.md diff" }).click();
            await expect(page.getByText("README changed for release gate.")).toBeVisible({ timeout: 10_000 });

            await page.evaluate(() => {
                window.dispatchEvent(new Event("slash-command:open-sessions"));
            });
            await expect(page.getByRole("heading", { name: "会话中心" })).toBeVisible({ timeout: 5_000 });
            await page.getByRole("button", { name: "批量导出" }).click();
            const exportDialog = page.locator("div.fixed.inset-0");
            await expect(exportDialog.getByRole("heading", { name: "导出会话" })).toBeVisible({ timeout: 5_000 });
            await exportDialog.locator("label", { hasText: "M6 Export Session A" }).click();
            await exportDialog.locator("label", { hasText: "M6 Export Session B" }).click();
            await expect(exportDialog.getByText("选择会话 (2 已选择)")).toBeVisible({ timeout: 5_000 });
            await expect(exportDialog.getByRole("button", { name: "导出" })).toBeEnabled();
            await screenshot(page, "2026-06-24-m6-05-files-git-export.png");
        });
    });
});
