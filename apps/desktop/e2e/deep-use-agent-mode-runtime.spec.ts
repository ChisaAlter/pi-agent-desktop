import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";
import { electronMainEntry } from "../playwright.config";
import { PLAN_DIRECTIVE } from "../src/main/services/agent-modes/plan-prompt";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl, retryMainAction } from "./support/electron-windows";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
const SESSION_ID = "deep-use-agent-mode-session";
const SESSION_TITLE = "深度使用模式验收";
const ATTACHMENT_PATH = "C:\\ai\\pi-agent-desktop\\package.json";

type RuntimePromptCall = {
    message: string;
    streamingBehavior: string | null;
};

type RuntimeRecorderGlobals = typeof globalThis & {
    __PI_DESKTOP_TEST_AGENT_REGISTRY__?: {
        list: () => Array<{ id: string; sessionId?: string; workspaceId: string }>;
        getWorkspaceSession: (agentId: string) => {
            session: {
                prompt: (...args: unknown[]) => Promise<unknown>;
                abort: () => void;
            };
        };
    };
    __deepUseRuntimePromptCalls?: RuntimePromptCall[];
    __deepUseRuntimeAbortCalls?: string[];
};

async function ensureAcceptanceDir(): Promise<void> {
    mkdirSync(ACCEPTANCE_DIR, { recursive: true });
}

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
    });
    const page = await getWindowByUrl(app, "index.html");
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try {
        await app?.close();
    } catch {
        // ignore shutdown failures during acceptance flow
    }
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function installModeAuditIpc(app: ElectronApplication): Promise<void> {
    await retryMainAction(() => app.evaluate(({ ipcMain }, attachmentPath) => {
        ipcMain.removeHandler("files:select");
        ipcMain.handle("files:select", async () => [attachmentPath]);
    }, ATTACHMENT_PATH));
}

async function openSession(page: Page, title: string): Promise<void> {
    const sidebar = page.getByRole("navigation", { name: "会话列表" });
    const button = sidebar.getByRole("button", { name: title, exact: true });
    // After close+relaunch the session may land in a collapsed date/workspace
    // group in the sidebar. Wait for the row, expanding collapsed group headers
    // if needed so the session button becomes visible.
    try {
        await expect(button).toBeVisible({ timeout: 15_000 });
    } catch {
        for (const group of await sidebar.getByRole("button", { expanded: false }).all()) {
            await group.click();
        }
        await expect(button).toBeVisible({ timeout: 5_000 });
    }
    await button.click();
}

async function waitForBoundAgent(page: Page, sessionId: string): Promise<string> {
    await expect.poll(async () => page.evaluate(async (targetSessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === targetSessionId)?.id ?? null;
    }, sessionId), { timeout: 15_000 }).not.toBeNull();
    const agentId = await page.evaluate(async (targetSessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === targetSessionId)?.id ?? null;
    }, sessionId);
    if (!agentId) throw new Error(`No bound agent found for ${sessionId}`);
    return agentId;
}

async function installRuntimePromptRecorder(app: ElectronApplication, sessionId: string): Promise<void> {
    await retryMainAction(() => app.evaluate((_electron, targetSessionId) => {
        const target = globalThis as RuntimeRecorderGlobals;
        target.__deepUseRuntimePromptCalls = [];
        target.__deepUseRuntimeAbortCalls = [];
        const registry = target.__PI_DESKTOP_TEST_AGENT_REGISTRY__;
        if (!registry) {
            throw new Error("Missing __PI_DESKTOP_TEST_AGENT_REGISTRY__ test hook");
        }
        const agent = registry.list().find((item) => item.sessionId === targetSessionId);
        if (!agent) {
            throw new Error(`No bound agent found for ${targetSessionId}`);
        }
        const runtimeSession = registry.getWorkspaceSession(agent.id).session;
        runtimeSession.prompt = async (...args: unknown[]) => {
            const options = args[1] && typeof args[1] === "object"
                ? args[1] as Record<string, unknown>
                : null;
            target.__deepUseRuntimePromptCalls?.push({
                message: typeof args[0] === "string" ? args[0] : String(args[0] ?? ""),
                streamingBehavior: typeof options?.streamingBehavior === "string" ? options.streamingBehavior : null,
            });
            return undefined;
        };
        runtimeSession.abort = () => {
            target.__deepUseRuntimeAbortCalls?.push(agent.id);
        };
    }, sessionId));
}

async function recordedPromptCalls(app: ElectronApplication): Promise<RuntimePromptCall[]> {
    return retryMainAction(() => app.evaluate(() => {
        const target = globalThis as RuntimeRecorderGlobals;
        return target.__deepUseRuntimePromptCalls ?? [];
    }));
}

async function emitBoundAgentEvents(page: Page, app: ElectronApplication, events: Array<Record<string, unknown>>): Promise<void> {
    const agent = await page.evaluate(async (sessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === sessionId) ?? null;
    }, SESSION_ID);
    if (!agent) throw new Error(`No bound agent found for ${SESSION_ID}`);
    await retryMainAction(() => app.evaluate(({ BrowserWindow }, payload) => {
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
    }, { agent, events }));
}

async function selectAgentMode(page: Page, mode: "Build" | "Plan" | "Compose"): Promise<void> {
    const trigger = page.getByRole("button", { name: "选择 Agent 模式" });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    const menu = page.getByRole("menu", { name: "Agent 模式" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await trigger.click();
        try {
            await expect(menu).toBeVisible({ timeout: 1_500 });
            break;
        } catch {
            await page.keyboard.press("Escape");
        }
    }
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitemradio", { name: new RegExp(mode, "i") }).click();
    await expect(trigger).toContainText(mode);
}

function chatTextarea(page: Page) {
    return page.locator('textarea[aria-label="发送"]').first();
}

test.describe("Pi Desktop deep-use agent mode runtime acceptance", () => {
    let app: ElectronApplication | undefined;

    test.setTimeout(120_000);

    test.afterEach(async () => {
        await closeApp(app);
        app = undefined;
    });

    test("verifies real plan/compose/build runtime mode transitions in Electron", async () => {
        await ensureAcceptanceDir();
        const userDataDir = test.info().outputPath(`deep-use-agent-mode-user-data-${Date.now()}`);
        const workspacePath = test.info().outputPath("deep-use-agent-mode-workspace");

        let launched = await launchApp(userDataDir);
        app = launched.app;
        let page = launched.page;
        await installModeAuditIpc(app);

        await page.evaluate(async ({ workspacePath, sessionId, sessionTitle }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const settings = await window.piAPI.getSettings();
            await window.piAPI.setSettings({
                longHorizon: {
                    ...(settings.longHorizon ?? {}),
                    enabled: true,
                    planMode: { enabled: true },
                    composeMode: { enabled: true },
                },
            });
            const workspace = await window.piAPI.createWorkspace("deep-use-agent-mode", workspacePath);
            if (workspace && typeof workspace === "object" && "code" in workspace) {
                throw new Error(String(workspace.fallback));
            }
            await window.piAPI.selectWorkspace(workspace.path);
            const session = await window.piAPI.createSession(workspace.id, sessionTitle, sessionId);
            await window.piAPI.agentsCreate({
                workspaceId: workspace.id,
                title: `${sessionTitle} Agent`,
                sessionId: session.id,
            });
        }, { workspacePath, sessionId: SESSION_ID, sessionTitle: SESSION_TITLE });

        await closeApp(app);
        launched = await launchApp(userDataDir);
        app = launched.app;
        page = launched.page;
        await installModeAuditIpc(app);
        await skipOnboarding(page);
        await openSession(page, SESSION_TITLE);
        await waitForBoundAgent(page, SESSION_ID);
        await installRuntimePromptRecorder(app, SESSION_ID);

        const textarea = chatTextarea(page);
        await expect(textarea).toBeVisible({ timeout: 10_000 });

        const attachButton = page.getByRole("button", { name: "添加文件或图片" });
        await attachButton.click();
        await expect(page.locator('[data-testid="chat-input-shell"]').getByText("package.json", { exact: true })).toBeVisible({ timeout: 10_000 });

        await selectAgentMode(page, "Plan");
        await textarea.fill("了解一下这个项目");
        await textarea.press("Enter");
        const planUserArticle = page.getByRole("article", { name: /你 ·/ }).filter({ hasText: "了解一下这个项目" });
        await expect(planUserArticle).toBeVisible({ timeout: 10_000 });
        await expect(planUserArticle).toContainText("附件: package.json");
        await expect(planUserArticle).not.toContainText("附加文件:");
        await expect.poll(async () => (await recordedPromptCalls(app!)).length, { timeout: 10_000 }).toBe(2);
        await emitBoundAgentEvents(page, app, [
            { type: "agent_start" },
            {
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "plan mode ack" },
            },
            { type: "turn_end" },
            { type: "agent_end" },
        ]);
        await expect(page.getByRole("article", { name: /Pi ·/ }).filter({ hasText: "plan mode ack" }).first()).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-17-plan-mode-runtime-sequence.png"), fullPage: true });

        await selectAgentMode(page, "Compose");
        await textarea.fill("全面审查代码");
        await textarea.press("Enter");
        await expect(page.getByRole("article", { name: /你 ·/ }).filter({ hasText: "全面审查代码" }).first()).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await recordedPromptCalls(app!)).length, { timeout: 10_000 }).toBe(5);
        await emitBoundAgentEvents(page, app, [
            { type: "agent_start" },
            {
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "compose mode ack" },
            },
            { type: "turn_end" },
            { type: "agent_end" },
        ]);
        await expect(page.getByRole("article", { name: /Pi ·/ }).filter({ hasText: "compose mode ack" }).first()).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-18-compose-mode-runtime-sequence.png"), fullPage: true });

        await selectAgentMode(page, "Build");
        await textarea.fill("开始实现");
        await textarea.press("Enter");
        await expect(page.getByRole("article", { name: /你 ·/ }).filter({ hasText: "开始实现" }).first()).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await recordedPromptCalls(app!)).length, { timeout: 10_000 }).toBe(7);
        await emitBoundAgentEvents(page, app, [
            { type: "agent_start" },
            {
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "build mode ack" },
            },
            { type: "turn_end" },
            { type: "agent_end" },
        ]);
        await expect(page.getByRole("article", { name: /Pi ·/ }).filter({ hasText: "build mode ack" }).first()).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "2026-06-26-deep-use-19-build-mode-runtime-sequence.png"), fullPage: true });

        const calls = await recordedPromptCalls(app);
        const planUserMessage = `附加文件:\n@${ATTACHMENT_PATH}\n\n用户消息:\n了解一下这个项目`;
        expect(calls).toEqual([
            { message: "/plan", streamingBehavior: null },
            { message: `${PLAN_DIRECTIVE}\n\n${planUserMessage}`, streamingBehavior: null },
            { message: "/plan", streamingBehavior: null },
            { message: "/compose on", streamingBehavior: null },
            { message: "全面审查代码", streamingBehavior: null },
            { message: "/compose off", streamingBehavior: null },
            { message: "开始实现", streamingBehavior: null },
        ]);
        expect(calls[1]?.message).toContain(PLAN_DIRECTIVE);
        expect(calls[1]?.message).toContain(planUserMessage);
    });
});
