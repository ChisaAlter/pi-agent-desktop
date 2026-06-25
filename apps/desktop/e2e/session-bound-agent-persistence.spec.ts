import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { electronMainEntry } from "../playwright.config";

const ACCEPTANCE_DIR = join(process.cwd(), "..", "..", "docs", "compose", "acceptance");
const SESSION_ID = "m1-bound-session";
const SESSION_TITLE = "M1 Bound Session";

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try {
        await app?.close();
    } catch {
        // Best-effort cleanup for Electron restarts.
    }
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function stubAgentPromptIpc(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("agents:prompt");
        ipcMain.handle("agents:prompt", async () => undefined);
    });
}

async function emitBoundAgentEvents(page: Page, app: ElectronApplication, events: Array<Record<string, unknown>>): Promise<void> {
    const agent = await page.evaluate(async (sessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === sessionId) ?? null;
    }, SESSION_ID);
    if (!agent) {
        throw new Error(`No bound agent found for session ${SESSION_ID}`);
    }
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

async function openBoundSession(page: Page): Promise<void> {
    const sidebar = page.getByRole("navigation", { name: "会话列表" });
    const sidebarSession = sidebar.getByRole("button", { name: SESSION_TITLE, exact: true });
    await expect(sidebarSession).toBeVisible({ timeout: 15_000 });
    await sidebarSession.click();
}

function chatTextarea(page: Page) {
    return page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
}

test.describe("Pi Desktop — session-bound agent persistence", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        await closeApp(app);
        app = undefined;
    });

    test("session-bound agent messages, usage, tool calls, and custom cards survive app restart", async () => {
        await mkdir(ACCEPTANCE_DIR, { recursive: true });

        const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("workspace");

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(async ({ workspacePath, sessionId, sessionTitle }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const ws = await window.piAPI.createWorkspace("m1-bound-agent-e2e", workspacePath);
            await window.piAPI.selectWorkspace(ws.path);
            const session = await window.piAPI.createSession(ws.id, sessionTitle, sessionId);
            await window.piAPI.agentsCreate({
                workspaceId: ws.id,
                title: `${sessionTitle} Agent`,
                sessionId: session.id,
            });
        }, { workspacePath, sessionId: SESSION_ID, sessionTitle: SESSION_TITLE });

        await closeApp(app);
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await stubAgentPromptIpc(app);
        await skipOnboarding(page);
        await openBoundSession(page);

        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-06-24-m1-01.png"),
            fullPage: true,
        });

        const textarea = chatTextarea(page);
        await expect(textarea).toBeVisible({ timeout: 10_000 });
        await textarea.fill("bound session follow up");
        await textarea.press("Enter");

        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText("bound session follow up", { timeout: 10_000 });

        await emitBoundAgentEvents(page, app, [
            { type: "agent_start" },
            {
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_start",
                    toolCallId: "tc_bound_1",
                    toolName: "read",
                    args: { path: "README.md" },
                },
            },
            {
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "bound agent persisted answer",
                },
            },
            {
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_end",
                    toolCallId: "tc_bound_1",
                    result: "done",
                },
            },
            {
                type: "usage_update",
                usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            },
            {
                type: "custom_message",
                card: {
                    id: "bound_card_1",
                    kind: "result-summary",
                    title: "Bound card",
                },
            },
            { type: "turn_end" },
            { type: "agent_end" },
        ]);

        await expect(page.getByRole("article").filter({ hasText: "bound agent persisted answer" }).first()).toBeVisible({ timeout: 10_000 });

        const preRestart = await page.evaluate(async (sessionId) => {
            const sessions = await window.piAPI.listSessions();
            const session = sessions.find((item) => item.id === sessionId);
            if (!session) return null;
            return {
                messageCount: session.messages.length,
                usage: session.usage ?? null,
                hasUserMessage: session.messages.some((message) => message.role === "user" && message.content === "bound session follow up"),
                hasAssistantMessage: session.messages.some((message) => message.role === "assistant" && message.content.includes("bound agent persisted answer")),
                hasCompletedToolCall: session.messages.some((message) =>
                    Array.isArray(message.toolCalls) &&
                    message.toolCalls.some((toolCall) => toolCall.id === "tc_bound_1" && toolCall.status === "completed"),
                ),
                hasCustomCard: session.messages.some((message) => message.customCard?.id === "bound_card_1"),
            };
        }, SESSION_ID);

        expect(preRestart).toMatchObject({
            hasUserMessage: true,
            hasAssistantMessage: true,
            hasCompletedToolCall: true,
            hasCustomCard: true,
            usage: {
                inputTokens: 10,
                outputTokens: 2,
                totalTokens: 12,
            },
        });

        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-06-24-m1-02.png"),
            fullPage: true,
        });

        await closeApp(app);
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await skipOnboarding(page);
        await openBoundSession(page);

        await expect(page.getByRole("article", { name: /你 ·/ })).toContainText("bound session follow up", { timeout: 10_000 });
        await expect(page.getByRole("article").filter({ hasText: "bound agent persisted answer" }).first()).toBeVisible({ timeout: 10_000 });

        const postRestart = await page.evaluate(async (sessionId) => {
            const sessions = await window.piAPI.listSessions();
            const session = sessions.find((item) => item.id === sessionId);
            if (!session) return null;
            return {
                messageCount: session.messages.length,
                usage: session.usage ?? null,
                hasUserMessage: session.messages.some((message) => message.role === "user" && message.content === "bound session follow up"),
                hasAssistantMessage: session.messages.some((message) => message.role === "assistant" && message.content.includes("bound agent persisted answer")),
                hasCompletedToolCall: session.messages.some((message) =>
                    Array.isArray(message.toolCalls) &&
                    message.toolCalls.some((toolCall) => toolCall.id === "tc_bound_1" && toolCall.status === "completed"),
                ),
                hasCustomCard: session.messages.some((message) => message.customCard?.id === "bound_card_1"),
            };
        }, SESSION_ID);

        expect(postRestart).toMatchObject({
            hasUserMessage: true,
            hasAssistantMessage: true,
            hasCompletedToolCall: true,
            hasCustomCard: true,
            usage: {
                inputTokens: 10,
                outputTokens: 2,
                totalTokens: 12,
            },
        });
        expect(postRestart?.messageCount).toBeGreaterThanOrEqual(3);

        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-06-24-m1-03.png"),
            fullPage: true,
        });
    });
});
