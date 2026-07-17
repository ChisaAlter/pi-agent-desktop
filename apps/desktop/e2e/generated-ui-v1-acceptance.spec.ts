import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
const SESSION_ID = "generated-ui-v1-session";
const SESSION_TITLE = "Generated UI V1 验收";

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
    });
    const page = await getWindowByUrl(app, "index.html");
    return { app, page };
}

async function retryMainEvaluate(action: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await action();
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("Execution context was destroyed") || attempt === 4) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}
async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try {
        await app?.close();
    } catch {
        // ignore Electron shutdown failures during acceptance flow
    }
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function stubHostActions(app: ElectronApplication): Promise<void> {
    await retryMainEvaluate(() => app.evaluate(({ ipcMain }) => {
        const target = globalThis as typeof globalThis & {
            __generatedUiOpenPathCalls?: string[];
        };
        target.__generatedUiOpenPathCalls = [];
        ipcMain.removeHandler("agents:prompt");
        ipcMain.handle("agents:prompt", async () => undefined);
        ipcMain.removeHandler("shell:open-path");
        ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
            target.__generatedUiOpenPathCalls?.push(targetPath);
            return "";
        });
    }));
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

async function emitPlanCard(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().includes("index.html"))
            ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error("No Electron window available for plan:card injection");
        win.webContents.send("plan:card", {
            id: "generated-ui-v1-plan-card",
            title: "生成式 UI 验收计划卡",
            filename: "generated-ui-v1-plan.md",
            content: [
                "- 保持计划卡仍走现有执行 UI",
                "- 不并入任意运行时组件系统",
                "- 与聊天内 generatedUi 卡片并存",
            ].join("\n"),
        });
    });
}

async function openBoundSession(page: Page): Promise<void> {
    const sidebar = page.getByRole("navigation", { name: "会话列表" });
    const sidebarSession = sidebar.getByRole("button", { name: SESSION_TITLE, exact: true });
    // After close+relaunch the session may land in a collapsed date/workspace
    // group in the sidebar. Wait for the row, expanding collapsed group headers
    // if needed so the session button becomes visible.
    try {
        await expect(sidebarSession).toBeVisible({ timeout: 15_000 });
    } catch {
        for (const group of await sidebar.getByRole("button", { expanded: false }).all()) {
            await group.click();
        }
        await expect(sidebarSession).toBeVisible({ timeout: 5_000 });
    }
    await sidebarSession.click();
}

async function scrollChat(page: Page, top: "start" | "end"): Promise<void> {
    await page.locator('[data-testid="chat-scroll-region"]').evaluate((element, nextTop) => {
        const target = element as HTMLDivElement;
        target.scrollTo({ top: nextTop === "start" ? 0 : target.scrollHeight, behavior: "instant" as ScrollBehavior });
    }, top);
}

function chatTextarea(page: Page) {
    return page.locator('textarea[aria-label*="发送" i], textarea[placeholder*="输入消息" i], textarea[placeholder*="在此审查" i], textarea[placeholder*="描述" i]').first();
}

test.describe("Generated UI v1 real Electron acceptance", () => {
    let app: ElectronApplication | undefined;

    test.afterEach(async () => {
        await closeApp(app);
        app = undefined;
    });

    test("verifies historical custom cards, runtime generated ui normalization, whitelist actions, coexistence, and replay with screenshots", async () => {
        await mkdir(ACCEPTANCE_DIR, { recursive: true });

        const userDataDir = test.info().outputPath(`generated-ui-v1-user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const workspacePath = test.info().outputPath("generated-ui-v1-workspace");
        const readmePath = join(workspacePath, "README.md");
        const now = Date.now();

        await mkdir(workspacePath, { recursive: true });
        await writeFile(readmePath, "# Generated UI v1 Acceptance\n", "utf8");

        let page: Page;
        ({ app, page } = await launchApp(userDataDir));

        await page.evaluate(
            async ({ workspacePath, sessionId, sessionTitle, readmePath, now }) => {
                window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
                const workspace = await window.piAPI.createWorkspace("generated-ui-v1-e2e", workspacePath);
                await window.piAPI.selectWorkspace(workspace.path);
                const session = await window.piAPI.createSession(workspace.id, sessionTitle, sessionId);
                await window.piAPI.appendMessage(session.id, {
                    id: "historic_custom_card_message",
                    role: "assistant",
                    content: "",
                    timestamp: new Date(now - 2_000).toISOString(),
                    customCard: {
                        id: "historic_custom_card",
                        kind: "file-actions",
                        title: "历史 customCard 回放",
                        content: "旧会话里的 customCard 仍通过统一卡片渲染器显示。",
                        items: [
                            {
                                id: "historic_file",
                                label: "README.md",
                                status: "ready",
                                description: "历史记录回放时应保持卡片外观",
                                path: readmePath,
                            },
                        ],
                        actions: [
                            {
                                id: "historic_open",
                                label: "打开 README",
                                kind: "open-file",
                                value: readmePath,
                            },
                        ],
                    },
                });
                await window.piAPI.agentsCreate({
                    workspaceId: workspace.id,
                    title: "Generated UI V1 Acceptance Agent",
                    sessionId: session.id,
                });
            },
            { workspacePath, sessionId: SESSION_ID, sessionTitle: SESSION_TITLE, readmePath, now },
        );
        await expect.poll(async () => page.evaluate(async (sessionId) => {
            const sessions = await window.piAPI.listSessions();
            return sessions.some((session) => session.id === sessionId);
        }, SESSION_ID), { timeout: 10_000 }).toBe(true);

        await closeApp(app);
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await stubHostActions(app);
        await skipOnboarding(page);
        await openBoundSession(page);

        await expect(page.getByText("历史 customCard 回放")).toBeVisible({ timeout: 10_000 });
        await scrollChat(page, "start");
        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-07-01-generated-ui-v1-01-historical-custom-card.png"),
            fullPage: true,
        });

        await page.evaluate(() => {
            const target = window as typeof window & {
                __generatedUiRefreshEvents?: Array<{ id: string; value: string }>;
            };
            target.__generatedUiRefreshEvents = [];
            window.addEventListener("custom-card:refresh", (event) => {
                const detail = (event as CustomEvent<{ id: string; value: string }>).detail;
                target.__generatedUiRefreshEvents?.push(detail);
            });
        });

        await emitBoundAgentEvents(page, app, [
            { type: "agent_start" },
            { type: "turn_start" },
            {
                type: "message_update",
                assistantMessageEvent: {
                    type: "text_delta",
                    delta: "本轮生成式 UI 验收已开始。",
                },
            },
            {
                type: "custom_message",
                card: {
                    id: "runtime_legacy_card",
                    kind: "result-summary",
                    title: "运行时 legacy card",
                    content: "旧 custom_message.card 已归一化进入 generatedUi v1。",
                    items: [
                        {
                            id: "legacy_item",
                            label: "legacy -> generatedUi",
                            status: "completed",
                            description: "走 usePiStream normalizeGeneratedUi 统一落盘",
                        },
                    ],
                    actions: [
                        {
                            id: "legacy_switch",
                            label: "打开工具页",
                            kind: "switch-view",
                            value: "tools",
                        },
                        {
                            id: "legacy_invalid",
                            label: "危险动作",
                            kind: "run-script",
                            value: "alert('x')",
                        },
                    ],
                },
            },
            {
                type: "custom_message",
                ui: {
                    id: "runtime_generated_ui",
                    title: "显式 generatedUi",
                    sections: [
                        {
                            id: "generated_summary",
                            kind: "summary",
                            content: "这是 v1 正式协议，只允许固定白名单 section。",
                        },
                        {
                            id: "generated_status",
                            kind: "status_list",
                            items: [
                                {
                                    id: "status_protocol",
                                    label: "协议归一化",
                                    status: "completed",
                                    description: "custom_message.ui 直接进入 generatedUi",
                                },
                            ],
                        },
                        {
                            id: "generated_facts",
                            kind: "key_value",
                            items: [
                                { id: "fact_scope", key: "范围", value: "聊天内卡片式 UI" },
                                { id: "fact_runtime", key: "运行时", value: "无任意脚本执行" },
                            ],
                        },
                        {
                            id: "generated_actions",
                            kind: "action_bar",
                            actions: [
                                {
                                    id: "generated_copy",
                                    label: "复制摘要",
                                    kind: "copy-text",
                                    value: "generated ui summary copied",
                                },
                                {
                                    id: "generated_slash",
                                    label: "填充命令",
                                    kind: "slash-command",
                                    value: "/review README.md",
                                },
                                {
                                    id: "generated_refresh",
                                    label: "刷新卡片",
                                    kind: "refresh",
                                    value: "runtime_generated_ui",
                                },
                                {
                                    id: "generated_open",
                                    label: "打开 README",
                                    kind: "open-file",
                                    value: readmePath,
                                },
                                {
                                    id: "generated_invalid",
                                    label: "执行脚本",
                                    kind: "run-script",
                                    value: "alert('nope')",
                                },
                            ],
                        },
                        {
                            id: "generated_ignored",
                            kind: "iframe",
                            url: "https://example.invalid/should-not-render",
                        },
                    ],
                },
            },
            {
                type: "custom_message",
                details: {
                    operation: "upsert",
                    card: {
                        version: "v2",
                        id: "runtime_generated_ui_v2",
                        title: "生成式 UI v2 验收",
                        subtitle: "表格、图表与表单",
                        sections: [
                            {
                                id: "v2_table",
                                kind: "table",
                                caption: "模块数据",
                                columns: [
                                    { key: "module", label: "模块", sortable: true },
                                    { key: "value", label: "数值", sortable: true },
                                ],
                                rows: [
                                    { module: "Runtime", value: 12 },
                                    { module: "Renderer", value: 24 },
                                ],
                            },
                            {
                                id: "v2_chart",
                                kind: "chart",
                                chartType: "bar",
                                xKey: "module",
                                summary: "Renderer 数值高于 Runtime。",
                                series: [{ key: "value", label: "数值" }],
                                data: [
                                    { module: "Runtime", value: 12 },
                                    { module: "Renderer", value: 24 },
                                ],
                            },
                            {
                                id: "v2_form",
                                kind: "form",
                                submitLabel: "提交验收",
                                fields: [
                                    { id: "target", kind: "select", label: "环境", options: [{ label: "测试", value: "staging" }] },
                                ],
                            },
                        ],
                    },
                },
            },
            {
                type: "custom_message",
                ui: {
                    id: "runtime_fallback",
                    title: "安全回退",
                    sections: [
                        {
                            id: "fallback_invalid",
                            kind: "iframe",
                            url: "https://example.invalid/fallback",
                        },
                    ],
                    content: "未知 section 已被丢弃，并安全回退到 markdown。",
                },
            },
            { type: "turn_end" },
            { type: "agent_end" },
        ]);

        await expect(page.getByRole("heading", { name: "运行时 legacy card" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("heading", { name: "显式 generatedUi" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("heading", { name: "生成式 UI v2 验收" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Renderer 数值高于 Runtime。" )).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: "提交验收" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("heading", { name: "安全回退" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("未知 section 已被丢弃，并安全回退到 markdown。")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: "危险动作" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "执行脚本" })).toHaveCount(0);
        await expect(page.getByText("should-not-render")).toHaveCount(0);

        const runSwitchLatency = await page.evaluate(() => new Promise<number>((resolve, reject) => {
            const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
                .find((item) => item.textContent?.trim() === "运行");
            if (!tab) {
                reject(new Error("Run tab not found"));
                return;
            }
            const startedAt = performance.now();
            tab.click();
            const deadline = startedAt + 2_000;
            const inspect = (): void => {
                const panel = document.querySelector<HTMLElement>('[data-main-panel="run"]');
                if (tab.getAttribute("aria-selected") === "true" && panel?.dataset.active === "true") {
                    requestAnimationFrame(() => resolve(performance.now() - startedAt));
                    return;
                }
                if (performance.now() >= deadline) {
                    reject(new Error("Run panel did not become interactive"));
                    return;
                }
                requestAnimationFrame(inspect);
            };
            requestAnimationFrame(inspect);
        }));
        expect(runSwitchLatency).toBeLessThan(400);
        await page.getByRole("tab", { name: "对话" }).click();

        const persistedBeforeRestart = await page.evaluate(async (sessionId) => {
            const sessions = await window.piAPI.listSessions();
            const session = sessions.find((item) => item.id === sessionId);
            if (!session) return null;
            return {
                customCardIds: session.messages.filter((message) => message.customCard).map((message) => message.customCard?.id),
                generatedUiMessages: session.messages
                    .filter((message) => message.generatedUi)
                    .map((message) => ({
                        messageId: message.id,
                        content: message.content,
                        uiId: message.generatedUi?.id,
                        title: message.generatedUi?.title ?? "",
                        sectionKinds: message.generatedUi?.sections.map((section) => section.kind) ?? [],
                        actionCount: message.generatedUi?.sections
                            .filter((section) => section.kind === "action_bar")
                            .reduce((sum, section) => sum + ("actions" in section ? section.actions.length : 0), 0) ?? 0,
                    })),
            };
        }, SESSION_ID);

        expect(persistedBeforeRestart).toMatchObject({
            customCardIds: ["historic_custom_card"],
        });
        expect(persistedBeforeRestart?.generatedUiMessages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    uiId: "runtime_legacy_card",
                    content: "",
                    sectionKinds: ["summary", "status_list", "action_bar"],
                    actionCount: 1,
                }),
                expect.objectContaining({
                    uiId: "runtime_generated_ui",
                    content: "",
                    sectionKinds: ["summary", "status_list", "key_value", "action_bar"],
                    actionCount: 4,
                }),
                expect.objectContaining({
                    uiId: "runtime_generated_ui_v2",
                    content: "",
                    sectionKinds: ["table", "chart", "form"],
                    actionCount: 0,
                }),                expect.objectContaining({
                    uiId: "runtime_fallback",
                    content: "",
                    sectionKinds: ["markdown"],
                    actionCount: 0,
                }),
            ]),
        );

        await scrollChat(page, "end");
        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-07-01-generated-ui-v1-02-runtime-generated-ui.png"),
            fullPage: true,
        });

        const legacyCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "运行时 legacy card" }) }).first();
        const explicitCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "显式 generatedUi" }) }).first();

        await legacyCard.getByRole("button", { name: "打开工具页" }).click();
        await expect(page.getByRole("tab", { name: "扩展" })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("region", { name: "插件面板" })).toBeVisible();
        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-07-01-generated-ui-v1-03-switch-view-tools.png"),
            fullPage: true,
        });

        await page.getByRole("tab", { name: "对话" }).click();
        await expect(page.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
        await explicitCard.getByRole("button", { name: "填充命令" }).click();
        await expect(chatTextarea(page)).toHaveValue("/review README.md");

        await explicitCard.getByRole("button", { name: "复制摘要" }).click();
        await expect(page.getByRole("status").filter({ hasText: "已复制" })).toBeVisible({ timeout: 5_000 });

        await explicitCard.getByRole("button", { name: "刷新卡片" }).click();
        await expect.poll(async () => page.evaluate(() => {
            const target = window as typeof window & {
                __generatedUiRefreshEvents?: Array<{ id: string; value: string }>;
            };
            return target.__generatedUiRefreshEvents?.length ?? 0;
        })).toBe(1);

        await explicitCard.getByRole("button", { name: "打开 README" }).click();
        await expect(page.getByRole("status").filter({ hasText: "已请求系统打开" })).toBeVisible({ timeout: 5_000 });
        const openPathCalls = await app.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __generatedUiOpenPathCalls?: string[];
            };
            return target.__generatedUiOpenPathCalls ?? [];
        });
        expect(openPathCalls).toContain(readmePath);

        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-07-01-generated-ui-v1-04-whitelist-actions.png"),
            fullPage: true,
        });

        await emitPlanCard(app);
        await expect(page.getByTestId("plan-card")).toBeVisible({ timeout: 10_000 });
        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-07-01-generated-ui-v1-05-plan-card-coexists.png"),
            fullPage: true,
        });

        await closeApp(app);
        app = undefined;

        ({ app, page } = await launchApp(userDataDir));
        await stubHostActions(app);
        await skipOnboarding(page);
        await openBoundSession(page);
        await scrollChat(page, "end");

        await expect(page.getByRole("heading", { name: "显式 generatedUi" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("heading", { name: "生成式 UI v2 验收" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Renderer 数值高于 Runtime。" )).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: "提交验收" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("heading", { name: "安全回退" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: "填充命令" })).toBeVisible({ timeout: 10_000 });
        await page.screenshot({
            path: join(ACCEPTANCE_DIR, "2026-07-01-generated-ui-v1-06-relaunch-replay.png"),
            fullPage: true,
        });

        const persistedAfterRestart = await page.evaluate(async (sessionId) => {
            const sessions = await window.piAPI.listSessions();
            const session = sessions.find((item) => item.id === sessionId);
            if (!session) return null;
            return session.messages.map((message) => ({
                id: message.id,
                hasCustomCard: Boolean(message.customCard),
                generatedUiId: message.generatedUi?.id ?? null,
            }));
        }, SESSION_ID);

        expect(persistedAfterRestart).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "historic_custom_card_message", hasCustomCard: true, generatedUiId: null }),
                expect.objectContaining({ id: "cm_runtime_legacy_card", hasCustomCard: false, generatedUiId: "runtime_legacy_card" }),
                expect.objectContaining({ id: "cm_runtime_generated_ui", hasCustomCard: false, generatedUiId: "runtime_generated_ui" }),
                expect.objectContaining({ id: "cm_runtime_generated_ui_v2", hasCustomCard: false, generatedUiId: "runtime_generated_ui_v2" }),
                expect.objectContaining({ id: "cm_runtime_fallback", hasCustomCard: false, generatedUiId: "runtime_fallback" }),
            ]),
        );
    });
});
